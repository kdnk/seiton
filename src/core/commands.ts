import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendActivityLog } from "./activity-log";
import { emitLiveUpdate } from "./live-updates";
import { buildManagedName, buildWorkspaceSessionName, type AgentName, type AgentPane, type Branch, type SyncCommand, type TerminalBackendName, type TerminalTab } from "./model";
import type { CommandResult, ExecFunction, TerminalBackend } from "./terminal-backend";
import { kittyBackend } from "./terminal-backends/kitty";
import { weztermBackend } from "./terminal-backends/wezterm";

export type { ExecFunction } from "./terminal-backend";

const execFileAsync = promisify(execFile);

export type SystemSnapshot = {
  branches: Branch[];
  tmuxSessions: string[];
  terminalTabs: TerminalTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  warnings: string[];
};

export type FullSystemSnapshot = {
  projects: Record<string, { branches: Branch[]; warnings: string[] }>;
  tmuxSessions: string[];
  terminalTabs: TerminalTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  globalWarnings: string[];
};

export type RemoveOrphanInput = {
  projectRoot: string;
  tmuxSession: string;
  terminalTabTitle: string;
};

export type RenameManagedInput = {
  projectRoot: string;
  branchId?: string;
  oldBranch: string;
  newBranch: string;
  oldTmuxSession: string;
  oldTerminalTabTitle: string;
  oldTerminalTabId?: number;
};

type PaneCandidate = {
  sessionName: string;
  paneId: string;
  currentCommand: string;
  startCommand: string;
};

export type HookEnvironment = {
  TMUX_PANE?: string;
  PWD?: string;
};

type HookNotifier = (payload: {
  agent: string;
  event: string;
  paneId: string;
  cwd?: string;
}) => Promise<void>;

export function getTerminalBackend(name: TerminalBackendName): TerminalBackend {
  return name === "wezterm" ? weztermBackend : kittyBackend;
}

export async function readSystemSnapshot(): Promise<SystemSnapshot> {
  return readSystemSnapshotForCwd(process.cwd());
}

export async function readFullSystemSnapshot(
  projectRoots: string[],
  backend: TerminalBackend = kittyBackend
): Promise<FullSystemSnapshot> {
  const [tmuxSessions, terminalTabs, agentPanesBySession] = await Promise.all([
    readTmuxSessions(process.cwd()),
    readTerminalTabs(process.cwd(), backend),
    readAgentPanes(process.cwd())
  ]);

  const projectResults = await Promise.all(
    projectRoots.map(async (root) => {
      const branches = await readBranches(root);
      return {
        root,
        branches: branches.value,
        warnings: branches.ok ? (branches.warnings ?? []) : [branches.error, ...(branches.warnings ?? [])]
      };
    })
  );

  const projects: Record<string, { branches: Branch[]; warnings: string[] }> = {};
  for (const res of projectResults) {
    projects[res.root] = { branches: res.branches, warnings: res.warnings };
  }

  return {
    projects,
    tmuxSessions: tmuxSessions.value,
    terminalTabs: terminalTabs.value,
    agentPanesBySession: agentPanesBySession.value,
    globalWarnings: [tmuxSessions, terminalTabs, agentPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([tmuxSessions, terminalTabs, agentPanesBySession].flatMap((result) => (result.ok ? [] : [result.error])))
  };
}

export async function readSystemSnapshotForCwd(
  cwd: string,
  backend: TerminalBackend = kittyBackend
): Promise<SystemSnapshot> {
  const [branches, tmuxSessions, terminalTabs, agentPanesBySession] = await Promise.all([
    readBranches(cwd),
    readTmuxSessions(cwd),
    readTerminalTabs(cwd, backend),
    readAgentPanes(cwd)
  ]);

  return {
    branches: branches.value,
    tmuxSessions: tmuxSessions.value,
    terminalTabs: terminalTabs.value,
    agentPanesBySession: agentPanesBySession.value,
    warnings: [branches, tmuxSessions, terminalTabs, agentPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([branches, tmuxSessions, terminalTabs, agentPanesBySession].flatMap((result) => result.ok ? [] : [result.error]))
  };
}

export async function applySyncCommand(
  command: SyncCommand,
  cwd = process.cwd(),
  backend: TerminalBackend = kittyBackend,
  run: ExecFunction = exec
): Promise<void> {
  switch (command.type) {
    case "create_tmux_session":
      await run("tmux", ["new-session", "-d", "-s", command.tmuxSession], cwd);
      return;
    case "create_terminal_tab":
      await backend.ensureTab({
        title: command.terminalTabTitle,
        tmuxSession: command.tmuxSession,
        cwd,
        run
      });
      return;
    case "rename_tmux_session":
      await run("tmux", [
        "rename-session",
        "-t",
        command.oldSession,
        command.newSession
      ], cwd);
      return;
    case "rename_terminal_tab":
      await backend.renameTab(command.oldTitle, command.newTitle, cwd, run);
      return;
    case "move_terminal_tab_backward":
      await backend.moveTabBackward(command.terminalTabTitle, cwd, run);
      return;
    case "move_terminal_tab_forward":
      await backend.moveTabForward(command.terminalTabTitle, cwd, run);
      return;
  }
}

export async function focusContext(
  projectRoot: string,
  branchKey: string,
  paneId?: string,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  backend: TerminalBackend = kittyBackend
): Promise<void> {
  const title = buildManagedName(projectRoot, decodeURIComponent(branchKey));
  await focusSessionByName(title, paneId, cwd, run, backend);
}

export async function focusWorkspaceSession(
  projectRoot: string,
  paneId?: string,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  backend: TerminalBackend = kittyBackend
): Promise<void> {
  await focusSessionByName(buildWorkspaceSessionName(projectRoot), paneId, cwd, run, backend);
}

export async function createWorkspaceSession(
  projectRoot: string,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  backend: TerminalBackend = kittyBackend
): Promise<void> {
  await ensureSessionResources(buildWorkspaceSessionName(projectRoot), cwd, run, backend);
}

async function focusSessionByName(
  title: string,
  paneId: string | undefined,
  cwd: string,
  run: ExecFunction,
  backend: TerminalBackend
): Promise<void> {
  const { hasTerminal, terminalAvailable } = await ensureSessionResources(title, cwd, run, backend);

  const targetClientTty = terminalAvailable && hasTerminal
    ? await backend.resolveTargetTmuxClientTty(title, cwd, run)
    : undefined;

  const shouldSwitchCurrentClient = !terminalAvailable;
  if (targetClientTty || shouldSwitchCurrentClient) {
    try {
      const args = targetClientTty
        ? ["switch-client", "-c", targetClientTty, "-t", title]
        : ["switch-client", "-t", title];
      await run("tmux", args, cwd);
    } catch (error) {
      if (!isNoCurrentTmuxClient(error)) {
        throw error;
      }
    }
  }
  if (paneId) {
    const windowId = await readPaneWindowId(paneId, cwd, run);
    if (windowId) {
      await run("tmux", ["select-window", "-t", windowId], cwd);
    }
    await run("tmux", ["select-pane", "-t", paneId], cwd);
  }
}

async function ensureSessionResources(
  title: string,
  cwd: string,
  run: ExecFunction,
  backend: TerminalBackend
): Promise<{ hasTerminal: boolean; terminalAvailable: boolean }> {
  let hasTmux = true;
  try {
    await run("tmux", ["has-session", "-t", title], cwd);
  } catch {
    hasTmux = false;
  }

  if (!hasTmux) {
    await run("tmux", ["new-session", "-d", "-s", title], cwd);
  }

  let hasTerminal = true;
  let terminalAvailable = true;
  try {
    await backend.focusTab(title, cwd, run);
  } catch (error) {
    if (backend.isUnavailableError(error)) {
      terminalAvailable = false;
    } else if (backend.isMissingTabError(error)) {
      hasTerminal = false;
    } else {
      throw error;
    }
  }

  if (terminalAvailable && !hasTerminal) {
    await backend.ensureTab({ title, tmuxSession: title, cwd, run });
  }
  return { hasTerminal, terminalAvailable };
}

export async function removeOrphanContext(
  input: RemoveOrphanInput,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  backend: TerminalBackend = kittyBackend
): Promise<void> {
  try {
    await backend.closeTab(input.terminalTabTitle, cwd, run);
  } catch (error) {
    if (!backend.isMissingTabError(error) && !backend.isUnavailableError(error)) {
      throw error;
    }
  }

  try {
    await run("tmux", ["kill-session", "-t", input.tmuxSession], cwd);
  } catch (error) {
    if (!isMissingTmuxSession(error)) {
      throw error;
    }
  }
}

export async function renameManagedContext(
  input: RenameManagedInput,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  backend: TerminalBackend = kittyBackend
): Promise<void> {
  const nextManagedName = buildManagedName(input.projectRoot, input.newBranch);
  const branchRef = input.branchId ?? input.oldBranch;

  await run("but", ["reword", "-m", input.newBranch, branchRef], cwd);
  try {
    await run("tmux", ["rename-session", "-t", input.oldTmuxSession, nextManagedName], cwd);
  } catch (error) {
    if (!isMissingTmuxSession(error)) throw error;
  }
  try {
    if (backend.name === "kitty" && input.oldTerminalTabId !== undefined) {
      await run("kitty", ["@", "set-tab-title", "--match", `id:${input.oldTerminalTabId}`, nextManagedName], cwd);
    } else {
      await backend.renameTab(input.oldTerminalTabTitle, nextManagedName, cwd, run);
    }
  } catch (error) {
    if (!backend.isMissingTabError(error) && !backend.isUnavailableError(error)) throw error;
  }
}

export async function applyAgentHook(
  agent: string,
  event: string,
  stdin: string,
  env: HookEnvironment,
  cwd = process.cwd(),
  run: ExecFunction = exec,
  notify: HookNotifier = emitLiveUpdate
): Promise<void> {
  const paneId = env.TMUX_PANE?.trim();
  if (!paneId) {
    throw new Error("TMUX_PANE is required");
  }

  const payload = parseHookPayload(stdin);
  const cwdValue = readPayloadString(payload, ["cwd", "workspace", "directory"]) ?? env.PWD?.trim();
  const prompt = readPayloadString(payload, ["prompt", "input", "message", "text"]);
  const hookInput: { cwd?: string; prompt?: string } = {};
  if (cwdValue) hookInput.cwd = cwdValue;
  if (prompt) hookInput.prompt = prompt;
  const normalizedEvent = normalizeHookEvent(agent, event);

  if (agent === "codex") {
    await applyCodexHook(normalizedEvent, paneId, hookInput, cwd, run);
  } else if (agent === "claude") {
    await applyClaudeHook(normalizedEvent, paneId, hookInput, cwd, run);
  } else {
    throw new Error(`Unsupported agent: ${agent}`);
  }

  await notify({
    agent,
    event: normalizedEvent,
    paneId,
    ...(cwdValue ? { cwd: cwdValue } : {})
  });
}

export async function notifyCurrentPane(
  message: string,
  env: HookEnvironment,
  cwd = process.cwd(),
  run: ExecFunction = exec
): Promise<void> {
  const paneId = env.TMUX_PANE?.trim();
  if (!paneId) {
    throw new Error("TMUX_PANE is required");
  }

  await writePaneOptions(
    paneId,
    {
      "@seiton_status": "waiting",
      "@seiton_prompt": message,
      "@seiton_cwd": env.PWD?.trim() ?? cwd,
      "@seiton_attention": "notification",
      "@seiton_wait_reason": "notification"
    },
    cwd,
    run
  );

  await appendActivityLog(paneId, message);
}

async function readBranches(cwd: string): Promise<CommandResult<Branch[]>> {
  return readBranchesForProject(cwd, exec);
}

export async function readBranchesForProject(
  cwd: string,
  run: ExecFunction
): Promise<CommandResult<Branch[]>> {
  try {
    const { stdout } = await run("but", ["status", "-fv"], cwd);
    return { ok: true, value: parseButBranches(stdout) };
  } catch (error) {
    if (shouldSetupGitButler(error)) {
      try {
        await run("but", ["setup"], cwd);
        const { stdout } = await run("but", ["status", "-fv"], cwd);
        return {
          ok: true,
          value: parseButBranches(stdout),
          warnings: [`GitButler project was set up automatically for ${cwd}.`]
        };
      } catch (setupError) {
        return {
          ok: false,
          value: [],
          error: `but setup failed: ${formatError(setupError)}`
        };
      }
    }
    return {
      ok: false,
      value: [],
      error: `but status -fv failed: ${formatError(error)}`
    };
  }
}

async function readTmuxSessions(cwd: string): Promise<CommandResult<string[]>> {
  try {
    const { stdout } = await exec("tmux", ["list-sessions", "-F", "#{session_name}"], cwd);
    return {
      ok: true,
      value: stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    };
  } catch (error) {
    return {
      ok: false,
      value: [],
      error: `tmux list-sessions failed: ${formatError(error)}`
    };
  }
}

async function readTerminalTabs(
  cwd: string,
  backend: TerminalBackend
): Promise<CommandResult<TerminalTab[]>> {
  return await backend.listTabs(cwd, exec);
}

async function readAgentPanes(cwd: string): Promise<CommandResult<Record<string, AgentPane[]>>> {
  try {
    const { stdout } = await exec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_start_command}"
    ], cwd);
    return { ok: true, value: await readAgentPanesFromTmux(stdout, cwd, exec) };
  } catch (error) {
    return {
      ok: false,
      value: {},
      error: `tmux list-panes failed: ${formatError(error)}`
    };
  }
}

export function parseButBranches(stdout: string): Branch[] {
  const branches = new Map<string, Branch>();
  for (const line of stdout.split("\n")) {
    const graphMatch = line.match(/┄([A-Za-z0-9]+)\s+\[([^\]]+)\]/);
    if (graphMatch?.[1] && graphMatch[2] && isLocalBranchName(graphMatch[2])) {
      branches.set(graphMatch[2], { id: graphMatch[1], name: graphMatch[2] });
      continue;
    }

    const matches = line.matchAll(/(?:branch|name):\s*([^\s,]+)/gi);
    for (const match of matches) {
      const name = match[1];
      if (name && isLocalBranchName(name)) branches.set(name, { name });
    }
    const bullet = line.match(/^\s*[-*]\s+([A-Za-z0-9._/-]+)\b/);
    if (bullet?.[1] && isLocalBranchName(bullet[1])) {
      branches.set(bullet[1], { name: bullet[1] });
    }
  }
  return [...branches.values()];
}

function isLocalBranchName(name: string): boolean {
  return (
    name !== "unassigned changes" &&
    !name.startsWith("staged to ") &&
    !name.startsWith("origin/") &&
    !name.startsWith("refs/")
  );
}

export async function readAgentPanesFromTmuxOptions(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);
  const result: Record<string, AgentPane[]> = {};

  for (const pane of paneCandidates) {
    const entry = await readAgentPaneFromTmuxOptions(pane, cwd, run);
    if (!entry) continue;
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  return sortPaneMap(result);
}

export async function readAgentPanesFromTmux(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const [optionBacked, codexRuntime, claudeRuntime] = await Promise.all([
    readAgentPanesFromTmuxOptions(stdout, cwd, run),
    parseTmuxCodexPanes(stdout, cwd, run),
    parseTmuxClaudePanes(stdout, cwd, run)
  ]);

  return mergeAgentPaneMaps(optionBacked, mergeAgentPaneMaps(codexRuntime, claudeRuntime));
}

export async function parseTmuxCodexPanes(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);

  const result: Record<string, AgentPane[]> = {};
  for (const pane of paneCandidates) {
    const snapshot = await readPaneSnapshot(pane.paneId, cwd, run);
    if (!isCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    if (!isLiveCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    const entry: AgentPane = {
      agent: "codex",
      paneId: pane.paneId,
      command: resolveAgentPaneCommand("codex", pane.currentCommand, pane.startCommand),
      lastLine: snapshot.lastLine,
      status: inferCodexPaneStatus(snapshot.fullText)
    };
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  return sortPaneMap(result);
}

export async function parseTmuxClaudePanes(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);

  const result: Record<string, AgentPane[]> = {};
  for (const pane of paneCandidates) {
    const snapshot = await readPaneSnapshot(pane.paneId, cwd, run);
    if (!isClaudePane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    if (!isLiveClaudePane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    const entry: AgentPane = {
      agent: "claude",
      paneId: pane.paneId,
      command: resolveAgentPaneCommand("claude", pane.currentCommand, pane.startCommand),
      lastLine: snapshot.lastLine,
      status: inferClaudePaneStatus(snapshot.fullText)
    };
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  return sortPaneMap(result);
}

function parsePaneCandidates(stdout: string): PaneCandidate[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sessionName = "", paneId = "", currentCommand = "", startCommand = ""] = line.split("\t");
      return { sessionName, paneId, currentCommand, startCommand };
    });
}

function mergeAgentPaneMaps(
  primary: Record<string, AgentPane[]>,
  secondary: Record<string, AgentPane[]>
): Record<string, AgentPane[]> {
  const merged: Record<string, AgentPane[]> = {};
  const sessionNames = new Set([...Object.keys(primary), ...Object.keys(secondary)]);

  for (const sessionName of sessionNames) {
    const byPaneId = new Map<string, AgentPane>();
    for (const pane of secondary[sessionName] ?? []) byPaneId.set(pane.paneId, pane);
    for (const pane of primary[sessionName] ?? []) byPaneId.set(pane.paneId, pane);
    const values = [...byPaneId.values()].sort((a, b) => a.paneId.localeCompare(b.paneId));
    if (values.length > 0) merged[sessionName] = values;
  }

  return merged;
}

function sortPaneMap(result: Record<string, AgentPane[]>): Record<string, AgentPane[]> {
  for (const sessionName of Object.keys(result)) {
    result[sessionName] = result[sessionName]!.sort((a, b) => a.paneId.localeCompare(b.paneId));
  }
  return result;
}

async function exec(
  file: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  const env = file === "kitty" ? await buildKittyEnv() : process.env;
  return execFileAsync(file, args, {
    cwd,
    env,
    timeout: 10_000,
    maxBuffer: 1024 * 1024 * 4
  });
}

let cachedKittySocket: { socket?: string; resolvedAt: number } | undefined;
const KITTY_SOCKET_CACHE_MS = 2_000;

async function buildKittyEnv(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  const socket = await resolveKittySocket();
  if (socket) {
    env.KITTY_LISTEN_ON = socket;
  } else {
    delete env.KITTY_LISTEN_ON;
  }
  return env;
}

async function resolveKittySocket(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedKittySocket && now - cachedKittySocket.resolvedAt < KITTY_SOCKET_CACHE_MS) {
    return cachedKittySocket.socket;
  }

  const candidates: string[] = [];
  const fromEnv = process.env.KITTY_LISTEN_ON;
  if (fromEnv) candidates.push(fromEnv);

  const dirs = new Set<string>(["/tmp"]);
  if (process.env.TMPDIR) dirs.add(process.env.TMPDIR);

  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const match = name.match(/^mykitty-(\d+)$/);
      if (!match) continue;
      const pid = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isFinite(pid) || !isProcessAlive(pid)) continue;
      candidates.push(`unix:${path.join(dir, name)}`);
    }
  }

  let resolved: string | undefined;
  for (const candidate of candidates) {
    if (await isLiveKittySocket(candidate)) {
      resolved = candidate;
      break;
    }
  }

  cachedKittySocket = { ...(resolved !== undefined ? { socket: resolved } : {}), resolvedAt: now };
  return resolved;
}

async function isLiveKittySocket(candidate: string): Promise<boolean> {
  const socketPath = candidate.replace(/^unix:/, "");
  try {
    const info = await stat(socketPath);
    if (!info.isSocket()) return false;
  } catch {
    return false;
  }
  const match = socketPath.match(/mykitty-(\d+)$/);
  if (match) {
    const pid = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(pid) && !isProcessAlive(pid)) return false;
  }
  return true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPaneSnapshot(
  paneId: string,
  cwd: string,
  run: ExecFunction
): Promise<{ fullText: string; lastLine: string }> {
  try {
    const { stdout } = await run("tmux", ["capture-pane", "-p", "-t", paneId, "-S", "-120"], cwd);
    const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      fullText: stdout,
      lastLine: lines.at(-1) ?? ""
    };
  } catch {
    return { fullText: "", lastLine: "" };
  }
}

async function readPaneWindowId(
  paneId: string,
  cwd: string,
  run: ExecFunction
): Promise<string | undefined> {
  try {
    const { stdout } = await run("tmux", ["display-message", "-p", "-t", paneId, "#{window_id}"], cwd);
    const windowId = stdout.trim();
    return windowId || undefined;
  } catch {
    return undefined;
  }
}

async function readAgentPaneFromTmuxOptions(
  pane: PaneCandidate,
  cwd: string,
  run: ExecFunction
): Promise<AgentPane | undefined> {
  const agent = await readPaneOption(pane.paneId, "@seiton_agent", cwd, run);
  if (agent !== "codex" && agent !== "claude") return undefined;
  if (!isAgentRuntimeActive(agent, pane.currentCommand, pane.startCommand)) {
    return undefined;
  }

  const [status, prompt] = await Promise.all([
    readPaneOption(pane.paneId, "@seiton_status", cwd, run),
    readPaneOption(pane.paneId, "@seiton_prompt", cwd, run)
  ]);

  const fallbackLine = prompt ? "" : (await readPaneSnapshot(pane.paneId, cwd, run)).lastLine;

  return {
    agent,
    paneId: pane.paneId,
    command: resolveAgentPaneCommand(agent, pane.currentCommand, pane.startCommand),
    lastLine: prompt || fallbackLine,
    status: normalizeAgentPaneStatus(status)
  };
}

async function readPaneOption(
  paneId: string,
  option: string,
  cwd: string,
  run: ExecFunction
): Promise<string | undefined> {
  try {
    const { stdout } = await run("tmux", ["show-options", "-p", "-v", "-t", paneId, option], cwd);
    const value = stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function isCodexPane(currentCommand: string, startCommand: string, paneText: string): boolean {
  const haystack = `${currentCommand} ${startCommand}`.toLowerCase();
  if (haystack.includes("codex")) return true;

  const normalizedPaneText = paneText.toLowerCase();
  return (
    normalizedPaneText.includes("openai codex") ||
    normalizedPaneText.includes(">_ openai codex") ||
    normalizedPaneText.includes(" gpt-5.") ||
    normalizedPaneText.includes(" /model to change")
  );
}

function isCodexRuntimeActive(currentCommand: string, startCommand: string): boolean {
  const haystack = `${currentCommand} ${startCommand}`.toLowerCase();
  if (haystack.includes("codex")) return true;
  const current = currentCommand.trim().toLowerCase();
  return current === "node";
}

function isClaudePane(currentCommand: string, startCommand: string, paneText: string): boolean {
  const haystack = `${currentCommand} ${startCommand}`.toLowerCase();
  if (haystack.includes("claude")) return true;
  if (isClaudeProcessTitle(currentCommand)) return true;

  const normalizedPaneText = paneText.toLowerCase();
  return (
    normalizedPaneText.includes("claude code") ||
    normalizedPaneText.includes("/help for help") ||
    normalizedPaneText.includes("anthropic")
  );
}

function isClaudeRuntimeActive(currentCommand: string, startCommand: string): boolean {
  const haystack = `${currentCommand} ${startCommand}`.toLowerCase();
  if (haystack.includes("claude")) return true;
  return isClaudeProcessTitle(currentCommand);
}

function isClaudeProcessTitle(command: string): boolean {
  return /^\d+\.\d+\.\d+(?:[.-][\w.]+)*$/.test(command.trim());
}

function isAgentRuntimeActive(agent: AgentName, currentCommand: string, startCommand: string): boolean {
  return agent === "codex"
    ? isCodexRuntimeActive(currentCommand, startCommand)
    : isClaudeRuntimeActive(currentCommand, startCommand);
}

function isLiveCodexPane(currentCommand: string, startCommand: string, paneText: string): boolean {
  if (!isCodexRuntimeActive(currentCommand, startCommand)) {
    return false;
  }

  const normalizedPaneText = paneText.toLowerCase();
  return (
    normalizedPaneText.includes("openai codex") ||
    normalizedPaneText.includes(">_ openai codex") ||
    normalizedPaneText.includes("/model to change") ||
    normalizedPaneText.includes("gpt-5.")
  );
}

function isLiveClaudePane(currentCommand: string, startCommand: string, paneText: string): boolean {
  if (isClaudeRuntimeActive(currentCommand, startCommand)) {
    return true;
  }

  const normalizedPaneText = paneText.toLowerCase();
  return normalizedPaneText.includes("claude code") && normalizedPaneText.includes("/help for help");
}



export function resolveAgentPaneCommand(agent: AgentName, currentCommand: string, startCommand: string): string {
  const command = (startCommand || currentCommand).trim();
  if (!command) return agent;
  if (command === "node" || command === "bash" || command === "zsh" || command === "fish") {
    return agent;
  }
  if (agent === "claude" && isClaudeProcessTitle(command)) {
    return agent;
  }
  const parts = command.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const tail = parts.at(-1);
    if (!tail || !looksLikeFilesystemPath(tail)) break;
    parts.pop();
  }
  return parts.join(" ");
}

function normalizeHookEvent(agent: string, event: string): string {
  const normalized = event.trim().replace(/[_\s]+/g, "-").toLowerCase();

  if (agent === "codex") {
    if (["session-start", "user-prompt-submit", "stop"].includes(normalized)) return normalized;
    throw new Error(`Unsupported codex event: ${event}`);
  }

  if (agent === "claude") {
    const mapped: Record<string, string> = {
      "session-start": "session_start",
      "user-prompt-submit": "user_prompt_submit",
      notification: "notification",
      stop: "stop",
      "stop-failure": "stop_failure",
      "post-tool-use": "activity_log",
      "session-end": "session_end"
    };
    const next = mapped[normalized];
    if (next) return next;
    throw new Error(`Unsupported claude event: ${event}`);
  }

  throw new Error(`Unsupported agent: ${agent}`);
}

function looksLikeFilesystemPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~/");
}

function inferCodexPaneStatus(paneText: string): AgentPane["status"] {
  const recentLines = paneText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5);

  if (recentLines.some((line) => line.startsWith("› "))) {
    return "idle";
  }

  return "running";
}

function inferClaudePaneStatus(paneText: string): AgentPane["status"] {
  const recent = paneText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .join("\n");

  if (/\(\d+s[\s·]/.test(recent) || /esc to interrupt/i.test(recent)) {
    return "running";
  }

  return "idle";
}

function normalizeAgentPaneStatus(status: string | undefined): AgentPane["status"] {
  if (status === "idle" || status === "running" || status === "waiting" || status === "error") {
    return status;
  }
  return "idle";
}

async function applyCodexHook(
  event: string,
  paneId: string,
  input: { cwd?: string; prompt?: string },
  cwd: string,
  run: ExecFunction
): Promise<void> {
  switch (event) {
    case "session-start":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "codex",
          "@seiton_status": "idle",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    case "user-prompt-submit":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "codex",
          "@seiton_status": "running",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd,
          "@seiton_started_at": new Date().toISOString()
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason"], cwd, run);
      return;
    case "stop":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "codex",
          "@seiton_status": "idle",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    default:
      throw new Error(`Unsupported codex event: ${event}`);
  }
}

async function applyClaudeHook(
  event: string,
  paneId: string,
  input: { cwd?: string; prompt?: string },
  cwd: string,
  run: ExecFunction
): Promise<void> {
  switch (event) {
    case "session_start":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "claude",
          "@seiton_status": "idle",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    case "user_prompt_submit":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "claude",
          "@seiton_status": "running",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd,
          "@seiton_started_at": new Date().toISOString()
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason"], cwd, run);
      return;
    case "notification":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "claude",
          "@seiton_status": "waiting",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd,
          "@seiton_attention": "notification",
          "@seiton_wait_reason": "notification"
        },
        cwd,
        run
      );
      return;
    case "stop":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "claude",
          "@seiton_status": "idle",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd
        },
        cwd,
        run
      );
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    case "stop_failure":
      await writePaneOptions(
        paneId,
        {
          "@seiton_agent": "claude",
          "@seiton_status": "error",
          "@seiton_prompt": input.prompt,
          "@seiton_cwd": input.cwd,
          "@seiton_attention": "notification",
          "@seiton_wait_reason": "stop_failure"
        },
        cwd,
        run
      );
      return;
    case "activity_log":
      await appendActivityLog(paneId, input.prompt ?? "Claude tool activity");
      return;
    case "session_end":
      await unsetPaneOptions(paneId, [
        "@seiton_agent",
        "@seiton_status",
        "@seiton_prompt",
        "@seiton_cwd",
        "@seiton_attention",
        "@seiton_wait_reason",
        "@seiton_started_at"
      ], cwd, run);
      return;
    default:
      throw new Error(`Unsupported claude event: ${event}`);
  }
}

async function writePaneOptions(
  paneId: string,
  values: Record<string, string | undefined>,
  cwd: string,
  run: ExecFunction
): Promise<void> {
  for (const [option, rawValue] of Object.entries(values)) {
    const value = sanitizeOptionValue(rawValue);
    if (!value) continue;
    await run("tmux", ["set-option", "-p", "-t", paneId, option, value], cwd);
  }
}

async function unsetPaneOptions(
  paneId: string,
  options: string[],
  cwd: string,
  run: ExecFunction
): Promise<void> {
  for (const option of options) {
    try {
      await run("tmux", ["set-option", "-p", "-u", "-t", paneId, option], cwd);
    } catch {
      // ignore missing options
    }
  }
}

function sanitizeOptionValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function parseHookPayload(stdin: string): unknown {
  const trimmed = stdin.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function readPayloadString(payload: unknown, keys: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (keys.includes(key) && typeof value === "string" && value.trim()) {
        return value;
      }
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return undefined;
}

function shouldSetupGitButler(error: unknown): boolean {
  const details = errorDetails(error);
  return details.includes("Setup required: No GitButler project found");
}

function isNoMatchingKittyTab(error: unknown): boolean {
  return errorDetails(error).includes("No matching tabs");
}

function isKittyUnavailable(error: unknown): boolean {
  const details = errorDetails(error);
  return (
    details.includes("Failed to connect to unix:") ||
    details.includes("connect: no such file or directory")
  );
}

function isNoCurrentTmuxClient(error: unknown): boolean {
  return errorDetails(error).includes("no current client");
}

function isMissingTmuxSession(error: unknown): boolean {
  const details = errorDetails(error);
  return details.includes("can't find session") || details.includes("no server running");
}

function formatError(error: unknown): string {
  return errorDetails(error);
}

function errorDetails(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const parts = [];
    if ("message" in error && typeof error.message === "string") parts.push(error.message);
    if ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) parts.push(error.stderr.trim());
    if ("stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) parts.push(error.stdout.trim());
    if (parts.length > 0) return parts.join(" ");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
