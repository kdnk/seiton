import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emitLiveUpdate } from "./live-updates";
import { buildManagedName, type Branch, type CodexPane, type KittyTab, type SyncCommand } from "./model";

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
  codexPanesBySession: Record<string, CodexPane[]>;
  warnings: string[];
};

export type FullSystemSnapshot = {
  projects: Record<string, { branches: Branch[]; warnings: string[] }>;
  tmuxSessions: string[];
  kittyTabs: KittyTab[];
  codexPanesBySession: Record<string, CodexPane[]>;
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

type HookEnvironment = {
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
  const [tmuxSessions, kittyTabs, codexPanesBySession] = await Promise.all([
    readTmuxSessions(process.cwd()),
    readKittyTabs(process.cwd()),
    readCodexPanes(process.cwd())
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
    codexPanesBySession: codexPanesBySession.value,
    globalWarnings: [tmuxSessions, kittyTabs, codexPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([tmuxSessions, kittyTabs, codexPanesBySession].flatMap((result) => (result.ok ? [] : [result.error])))
  };
}

export async function readSystemSnapshotForCwd(cwd: string): Promise<SystemSnapshot> {
  const [branches, tmuxSessions, kittyTabs, codexPanesBySession] = await Promise.all([
    readBranches(cwd),
    readTmuxSessions(cwd),
    readKittyTabs(cwd),
    readCodexPanes(cwd)
  ]);

  return {
    branches: branches.value,
    tmuxSessions: tmuxSessions.value,
    kittyTabs: kittyTabs.value,
    codexPanesBySession: codexPanesBySession.value,
    warnings: [branches, tmuxSessions, kittyTabs, codexPanesBySession]
      .flatMap((result) => result.warnings ?? [])
      .concat([branches, tmuxSessions, kittyTabs, codexPanesBySession].flatMap((result) => result.ok ? [] : [result.error]))
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

  try {
    await run("tmux", ["switch-client", "-t", title], cwd);
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

  if (agent === "codex") {
    await applyCodexHook(event, paneId, hookInput, cwd, run);
    await notify({
      agent,
      event,
      paneId,
      ...(cwdValue ? { cwd: cwdValue } : {})
    });
    return;
  }

  throw new Error(`Unsupported agent: ${agent}`);
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

async function readCodexPanes(cwd: string): Promise<CommandResult<Record<string, CodexPane[]>>> {
  try {
    const { stdout } = await exec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_start_command}"
    ], cwd);
    const optionBacked = await readCodexPanesFromTmuxOptions(stdout, cwd, exec);
    const fallback = await parseTmuxCodexPanes(stdout, cwd, exec);
    return { ok: true, value: mergeCodexPaneMaps(optionBacked, fallback) };
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

export async function readCodexPanesFromTmuxOptions(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, CodexPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);
  const result: Record<string, CodexPane[]> = {};

  for (const pane of paneCandidates) {
    const entry = await readCodexPaneFromTmuxOptions(pane, cwd, run);
    if (!entry) continue;
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  for (const sessionName of Object.keys(result)) {
    result[sessionName] = result[sessionName]!.sort((a, b) => a.paneId.localeCompare(b.paneId));
  }

  return result;
}

export async function parseTmuxCodexPanes(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, CodexPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);

  const result: Record<string, CodexPane[]> = {};
  for (const pane of paneCandidates) {
    const snapshot = await readPaneSnapshot(pane.paneId, cwd, run);
    if (!isCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    if (!isLiveCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) {
      continue;
    }
    const entry: CodexPane = {
      paneId: pane.paneId,
      command: resolveCodexPaneCommand(pane.currentCommand, pane.startCommand),
      lastLine: snapshot.lastLine,
      status: inferCodexPaneStatus(snapshot.fullText)
    };
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  for (const sessionName of Object.keys(result)) {
    result[sessionName] = result[sessionName]!.sort((a, b) => a.paneId.localeCompare(b.paneId));
  }

  return result;
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

function mergeCodexPaneMaps(
  primary: Record<string, CodexPane[]>,
  secondary: Record<string, CodexPane[]>
): Record<string, CodexPane[]> {
  const merged: Record<string, CodexPane[]> = {};
  const sessionNames = new Set([...Object.keys(primary), ...Object.keys(secondary)]);

  for (const sessionName of sessionNames) {
    const byPaneId = new Map<string, CodexPane>();
    for (const pane of secondary[sessionName] ?? []) byPaneId.set(pane.paneId, pane);
    for (const pane of primary[sessionName] ?? []) byPaneId.set(pane.paneId, pane);
    const values = [...byPaneId.values()].sort((a, b) => a.paneId.localeCompare(b.paneId));
    if (values.length > 0) merged[sessionName] = values;
  }

  return merged;
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

async function readCodexPaneFromTmuxOptions(
  pane: PaneCandidate,
  cwd: string,
  run: ExecFunction
): Promise<CodexPane | undefined> {
  const agent = await readPaneOption(pane.paneId, "@seiton_agent", cwd, run);
  if (agent !== "codex") return undefined;
  if (!isCodexRuntimeActive(pane.currentCommand, pane.startCommand)) {
    return undefined;
  }

  const [status, prompt] = await Promise.all([
    readPaneOption(pane.paneId, "@seiton_status", cwd, run),
    readPaneOption(pane.paneId, "@seiton_prompt", cwd, run)
  ]);

  const fallbackLine = prompt ? "" : (await readPaneSnapshot(pane.paneId, cwd, run)).lastLine;

  return {
    paneId: pane.paneId,
    command: "codex",
    lastLine: prompt || fallbackLine,
    status: normalizeCodexPaneStatus(status)
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

export function resolveCodexPaneCommand(currentCommand: string, startCommand: string): string {
  const command = (startCommand || currentCommand).trim();
  if (!command) return "codex";
  if (command === "node" || command === "bash" || command === "zsh" || command === "fish") {
    return "codex";
  }
  const parts = command.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const tail = parts.at(-1);
    if (!tail || !looksLikeFilesystemPath(tail)) break;
    parts.pop();
  }
  return parts.join(" ");
}

function looksLikeFilesystemPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~/");
}

function inferCodexPaneStatus(paneText: string): CodexPane["status"] {
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

function normalizeCodexPaneStatus(status: string | undefined): CodexPane["status"] {
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
