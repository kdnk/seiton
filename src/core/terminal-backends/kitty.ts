import type { TerminalTab } from "../model";
import type { CommandResult, ExecFunction, TerminalBackend } from "../terminal-backend";

type KittyTabClient = {
  title: string;
  activeWindowPid?: number;
};

type TmuxClient = {
  tty: string;
  pid?: number;
};

export const kittyBackend: TerminalBackend = {
  name: "kitty",
  async listTabs(cwd, run) {
    try {
      const { stdout } = await run("kitty", ["@", "ls"], cwd);
      return { ok: true, value: parseKittyTabs(stdout) };
    } catch (error) {
      return {
        ok: false,
        value: [],
        error: `kitty @ ls failed: ${formatError(error)}`
      };
    }
  },
  async ensureTab({ title, tmuxSession, cwd, run }) {
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
      tmuxSession
    ], cwd);
  },
  async focusTab(title, cwd, run) {
    await run("kitty", ["@", "focus-tab", "--match", `title:${title}`], cwd);
  },
  async renameTab(oldTitle, newTitle, cwd, run) {
    await run("kitty", ["@", "set-tab-title", "--match", `title:${oldTitle}`, newTitle], cwd);
  },
  async moveTabBackward(title, cwd, run) {
    await run("kitty", ["@", "focus-tab", "--match", `title:${title}`], cwd);
    await run("kitty", ["@", "action", "move_tab_backward"], cwd);
  },
  async moveTabForward(title, cwd, run) {
    await run("kitty", ["@", "focus-tab", "--match", `title:${title}`], cwd);
    await run("kitty", ["@", "action", "move_tab_forward"], cwd);
  },
  async closeTab(title, cwd, run) {
    await run("kitty", ["@", "close-tab", "--match", `title:${title}`], cwd);
  },
  async resolveTargetTmuxClientTty(title, cwd, run) {
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
  },
  isUnavailableError(error) {
    const details = errorDetails(error);
    return (
      details.includes("Failed to connect to unix:") ||
      details.includes("connect: no such file or directory")
    );
  },
  isMissingTabError(error) {
    return errorDetails(error).includes("No matching tabs");
  }
};

export function parseKittyTabs(stdout: string): TerminalTab[] {
  const parsed = JSON.parse(stdout) as Array<{
    id: number;
    tabs?: Array<{ id: number; title: string }>;
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
      const [tty = "", _sessionName = "", pidText = ""] = line.split("\t");
      const pid = Number.parseInt(pidText, 10);
      return {
        tty,
        ...(Number.isFinite(pid) ? { pid } : {})
      };
    });
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
