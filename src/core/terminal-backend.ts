import type { TerminalBackendName, TerminalTab } from "./model";

export type ExecFunction = (
  file: string,
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>;

export type CommandResult<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { ok: false; value: T; error: string; warnings?: string[] };

export type TerminalBackend = {
  name: TerminalBackendName;
  listTabs(cwd: string, run: ExecFunction): Promise<CommandResult<TerminalTab[]>>;
  ensureTab(input: { title: string; tmuxSession: string; cwd: string; run: ExecFunction }): Promise<void>;
  focusTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  renameTab(oldTitle: string, newTitle: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabBackward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabForward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  closeTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  resolveTargetTmuxClientTty(title: string, cwd: string, run: ExecFunction): Promise<string | undefined>;
  isUnavailableError(error: unknown): boolean;
  isMissingTabError(error: unknown): boolean;
};

