import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendActivityLog } from "./activity-log";
import { emitLiveUpdate } from "./live-updates";
import { buildManagedName, type AgentName, type AgentPane, type Branch, type KittyTab, type SyncCommand } from "./model";

const execFileAsync = promisify(execFile);

export type ExecFunction = (
  file: string,
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>;

export type CommandResult<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { ok: false; value: T; error: string; warnings?: string[] };

export type SystemSnapshot = {
  branches: Branch[];
  tmuxSessions: string[];
  kittyTabs: KittyTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  warnings: string[];
};

export type FullSystemSnapshot = {
  projects: Record<string, { branches: Branch[]; warnings: string[] }>;
  tmuxSessions: string[];
  kittyTabs: KittyTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  globalWarnings: string[];
};

export type RemoveOrphanInput = {
  projectRoot: string;
  tmuxSession: string;
  kittyTabTitle: string;
};

export type RenameManagedInput = {
  projectRoot: string;
  branchId?: string;
  oldBranch: string;
  newBranch: string;
  oldTmuxSession: string;
  oldKittyTabTitle: string;
  oldKittyTabId?: number;
};

type PaneCandidate = {
  sessionName: string;
  paneId: string;
  currentCommand: string;
  startCommand: string;
};

type KittyTabClient = {
  title: string;
  activeWindowPid?: number;
};

type TmuxClient = {
  tty: string;
  sessionName: string;
  pid?: number;
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

export async function readSystemSnapshot(): Promise<SystemSnapshot> {
  return readSystemSnapshotForCwd(process.cwd());
}

export async function readFullSystemSnapshot(projectRoots: string[]): Promise<FullSystemSnapshot> {
  const [tmuxSessions, kittyTabs, agentPanesBySession] = await Promise.all([
    readTmuxSessions(process.cwd()),
    readKittyTabs(process.cwd()),
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
    kittyTabs: kittyTabs.value,
    agentPanesBySession: agentPanesBySession.value,
    globalWarnings: [tmuxSessions, kittyTabs, agentPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([tmuxSessions, kittyTabs, agentPanesBySession].flatMap((result) => (result.ok ? [] : [result.error])))
  };
}

export async function readSystemSnapshotForCwd(cwd: string): Promise<SystemSnapshot> {
  const [branches, tmuxSessions, kittyTabs, agentPanesBySession] = await Promise.all([
    readBranches(cwd),
    readTmuxSessions(cwd),
    readKittyTabs(cwd),
    readAgentPanes(cwd)
  ]);

  return {
    branches: branches.value,
    tmuxSessions: tmuxSessions.value,
    kittyTabs: kittyTabs.value,
    agentPanesBySession: agentPanesBySession.value,
    warnings: [branches, tmuxSessions, kittyTabs, agentPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([branches, tmuxSessions, kittyTabs, agentPanesBySession].flatMap((result) => result.ok ? [] : [result.error]))
  };
}

export async function applySyncCommand(
  command: SyncCommand,
  cwd = process.cwd()
): Promise<void> {
  switch (command.type) {
    case "create_tmux_session":
      await exec("tmux", ["new-session", "-d", "-s", command.tmuxSession], cwd);
      return;
    case "create_kitty_tab":
      await exec("kitty", [
        "@",
        "launch",
        "--type=tab",
        "--tab-title",
        command.kittyTabTitle,
        "tmux",
        "new-session",
        "-A",
        "-s",
        command.tmuxSession
      ], cwd);
      return;
    case "rename_tmux_session":
      await exec("tmux", [
        "rename-session",
        "-t",
        command.oldSession,
        command.newSession
      ], cwd);
      return;
    case "rename_kitty_tab":
      await exec("kitty", [
        "@",
        "set-tab-title",
        command.newTitle,
        "--match",
        `title:${command.oldTitle}`
      ], cwd);
      return;
    case "move_kitty_tab_backward":
      await exec("kitty", [
        "@",
        "focus-tab",
        "--match",
        `title:${command.kittyTabTitle}`
      ], cwd);
      await exec("kitty", ["@", "action", "move_tab_backward"], cwd);
      return;
    case "move_kitty_tab_forward":
      await exec("kitty", [
        "@",
        "focus-tab",
        "--match",
        `title:${command.kittyTabTitle}`
      ], cwd);
      await exec("kitty", ["@", "action", "move_tab_forward"], cwd);
      return;
  }
}

export async function focusContext(
  projectRoot: string,
  branchKey: string,
  paneId?: string,
  cwd = process.cwd(),
  run: ExecFunction = exec
): Promise<void> {
  const title = buildManagedName(projectRoot, decodeURIComponent(branchKey));
  let hasTmux = true;
  try {
    await run("tmux", ["has-session", "-t", title], cwd);
  } catch {
    hasTmux = false;
  }

  if (!hasTmux) {
    await run("tmux", ["new-session", "-d", "-s", title], cwd);
  }

  let hasKitty = true;
  try {
    await run("kitty", ["@", "focus-tab", "--match", `title:${title}`], cwd);
  } catch (error) {
    if (isNoMatchingKittyTab(error)) {
      hasKitty = false;
    } else {
      throw error;
    }
  }

  if (!hasKitty) {
    await run("kitty", [
      "@",
      "launch",
      "--type=tab",
      "--tab-title",
      title,
      "tmux",
      "new-session",
      "-A",
      "-s",
      title
    ], cwd);
  }

  const targetClientTty = hasKitty
    ? await readTargetTmuxClientTtyForKittyTab(title, cwd, run)
    : undefined;

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
  if (paneId) {
    const windowId = await readPaneWindowId(paneId, cwd, run);
    if (windowId) {
      await run("tmux", ["select-window", "-t", windowId], cwd);
    }
    await run("tmux", ["select-pane", "-t", paneId], cwd);
  }
}

export async function removeOrphanContext(
  input: RemoveOrphanInput,
  cwd = process.cwd(),
  run: ExecFunction = exec
): Promise<void> {
  try {
    await run("kitty", ["@", "close-tab", "--match", `title:${input.kittyTabTitle}`], cwd);
  } catch (error) {
    if (!isNoMatchingKittyTab(error)) {
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
  run: ExecFunction = exec
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
    const tabMatch = input.oldKittyTabId !== undefined
      ? `id:${input.oldKittyTabId}`
      : `title:${input.oldKittyTabTitle}`;
    await run(
      "kitty",
      ["@", "set-tab-title", nextManagedName, "--match", tabMatch],
      cwd
    );
  } catch (error) {
    if (!isNoMatchingKittyTab(error)) throw error;
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

async function readKittyTabs(cwd: string): Promise<CommandResult<KittyTab[]>> {
  try {
    const { stdout } = await exec("kitty", ["@", "ls"], cwd);
    return { ok: true, value: parseKittyTabs(stdout) };
  } catch (error) {
    return {
      ok: false,
      value: [],
      error: `kitty @ ls failed: ${formatError(error)}`
    };
  }
}

async function readAgentPanes(cwd: string): Promise<CommandResult<Record<string, AgentPane[]>>> {
  try {
    const { stdout } = await exec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_start_command}"
    ], cwd);
    const optionBacked = await readAgentPanesFromTmuxOptions(stdout, cwd, exec);
    const fallback = await parseTmuxCodexPanes(stdout, cwd, exec);
    return { ok: true, value: mergeAgentPaneMaps(optionBacked, fallback) };
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

export function parseKittyTabs(stdout: string): KittyTab[] {
  const parsed = JSON.parse(stdout) as Array<{
    id: number;
    tabs?: Array<{ id: number; title: string; windows?: unknown[] }>;
  }>;
  return parsed.flatMap((osWindow) =>
    (osWindow.tabs ?? []).map((tab, index) => ({
      id: tab.id,
      title: tab.title,
      osWindowId: osWindow.id,
      index
    }))
  );
}

async function readTargetTmuxClientTtyForKittyTab(
  title: string,
  cwd: string,
  run: ExecFunction
): Promise<string | undefined> {
  try {
    const [kittyLs, tmuxClients] = await Promise.all([
      run("kitty", ["@", "ls"], cwd),
      run("tmux", ["list-clients", "-F", "#{client_tty}\t#{session_name}\t#{client_pid}"], cwd)
    ]);
    const tabClient = parseKittyTabClients(kittyLs.stdout).find((tab) => tab.title === title);
    if (!tabClient?.activeWindowPid) return undefined;
    const tmuxClient = parseTmuxClients(tmuxClients.stdout).find(
      (client) => client.pid === tabClient.activeWindowPid
    );
    return tmuxClient?.tty;
  } catch {
    return undefined;
  }
}

function parseKittyTabClients(stdout: string): KittyTabClient[] {
  const parsed = JSON.parse(stdout) as Array<{
    tabs?: Array<{
      title: string;
      windows?: Array<{
        is_active?: boolean;
        pid?: number;
        foreground_processes?: Array<{ pid?: number }>;
      }>;
    }>;
  }>;

  return parsed.flatMap((osWindow) =>
    (osWindow.tabs ?? []).map((tab) => {
      const activeWindow =
        tab.windows?.find((window) => window.is_active) ?? tab.windows?.at(0);
      const activeWindowPid =
        activeWindow?.foreground_processes?.[0]?.pid ?? activeWindow?.pid;
      return {
        title: tab.title,
        ...(activeWindowPid !== undefined ? { activeWindowPid } : {})
      };
    })
  );
}

function parseTmuxClients(stdout: string): TmuxClient[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tty = "", sessionName = "", pidText = ""] = line.split("\t");
      const pid = Number.parseInt(pidText, 10);
      return {
        tty,
        sessionName,
        ...(Number.isFinite(pid) ? { pid } : {})
      };
    });
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
  return execFileAsync(file, args, {
    cwd,
    timeout: 10_000,
    maxBuffer: 1024 * 1024 * 4
  });
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

function isClaudeRuntimeActive(currentCommand: string, startCommand: string): boolean {
  const haystack = `${currentCommand} ${startCommand}`.toLowerCase();
  return haystack.includes("claude");
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

export function resolveAgentPaneCommand(agent: AgentName, currentCommand: string, startCommand: string): string {
  const command = (startCommand || currentCommand).trim();
  if (!command) return agent;
  if (command === "node" || command === "bash" || command === "zsh" || command === "fish") {
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
