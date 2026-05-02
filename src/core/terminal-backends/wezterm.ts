import type { TerminalTab } from "../model";
import type { CommandResult, ExecFunction, TerminalBackend } from "../terminal-backend";

type WeztermListEntry = {
  window_id: number;
  tab_id: number;
  pane_id: number;
  title: string;
  tab_title?: string;
};

export const weztermBackend: TerminalBackend = {
  name: "wezterm",
  async listTabs(cwd, run) {
    try {
      const { stdout } = await run("wezterm", ["cli", "list", "--format", "json"], cwd);
      return { ok: true, value: parseWeztermTabs(stdout) };
    } catch (error) {
      return {
        ok: false,
        value: [],
        error: `wezterm cli list failed: ${formatError(error)}`
      };
    }
  },
  async ensureTab({ title, tmuxSession, cwd, run }) {
    const shellCommand = `printf '\\033]1;%s\\007\\033]2;%s\\007' ${shellQuote(title)} ${shellQuote(title)}; exec tmux new-session -A -s ${shellQuote(tmuxSession)}`;
    const { stdout } = await run("wezterm", ["cli", "spawn", "--cwd", cwd, "--", "sh", "-lc", shellCommand], cwd);
    const paneId = stdout.trim();
    if (paneId) {
      await run("wezterm", ["cli", "set-tab-title", "--pane-id", paneId, title], cwd);
    }
  },
  async focusTab(title, cwd, run) {
    const tab = await findTabByTitle(title, cwd, run);
    await run("wezterm", ["cli", "activate-tab", "--tab-id", String(tab.id)], cwd);
  },
  async renameTab(oldTitle, newTitle, cwd, run) {
    const tab = await findTabByTitle(oldTitle, cwd, run);
    await run("wezterm", ["cli", "set-tab-title", "--pane-id", String(tab.paneId), newTitle], cwd);
    await run(
      "wezterm",
      [
        "cli",
        "send-text",
        "--pane-id",
        String(tab.paneId),
        "--no-paste",
        `\u001b]1;${newTitle}\u0007\u001b]2;${newTitle}\u0007`
      ],
      cwd
    );
  },
  async moveTabBackward() {
    throw new Error("wezterm tab reordering is not supported by the current CLI integration");
  },
  async moveTabForward() {
    throw new Error("wezterm tab reordering is not supported by the current CLI integration");
  },
  async closeTab(title, cwd, run) {
    const tab = await findTabByTitle(title, cwd, run);
    await run("wezterm", ["cli", "kill-pane", "--pane-id", String(tab.paneId)], cwd);
  },
  async resolveTargetTmuxClientTty() {
    return undefined;
  },
  isUnavailableError(error) {
    const details = errorDetails(error);
    return details.includes("unable to resolve") || details.includes("no running wezterm instance");
  },
  isMissingTabError(error) {
    return errorDetails(error).includes("No matching wezterm tab");
  }
};

type WeztermTab = TerminalTab & { paneId: number };

function parseWeztermTabs(stdout: string): WeztermTab[] {
  const parsed = JSON.parse(stdout) as WeztermListEntry[];
  const byTabId = new Map<number, WeztermTab>();
  const tabIndexes = new Map<number, number>();

  for (const entry of parsed) {
    if (byTabId.has(entry.tab_id)) continue;
    const nextIndex = tabIndexes.get(entry.window_id) ?? 0;
    byTabId.set(entry.tab_id, {
      id: entry.tab_id,
      title: entry.tab_title && entry.tab_title.length > 0 ? entry.tab_title : entry.title,
      osWindowId: entry.window_id,
      index: nextIndex,
      paneId: entry.pane_id
    });
    tabIndexes.set(entry.window_id, nextIndex + 1);
  }

  return [...byTabId.values()];
}

async function findTabByTitle(title: string, cwd: string, run: ExecFunction): Promise<WeztermTab> {
  const { stdout } = await run("wezterm", ["cli", "list", "--format", "json"], cwd);
  const tabs = parseWeztermTabs(stdout);
  const tab = tabs.find((candidate) => candidate.title === title);
  if (!tab) {
    throw new Error(`No matching wezterm tab: ${title}`);
  }
  return tab;
}

function formatError(error: unknown): string {
  return errorDetails(error);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
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
