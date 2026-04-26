import { homedir } from "node:os";
import { join } from "node:path";
import { stdin } from "node:process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { applyAgentHook } from "./core/commands";
import { emitLiveUpdate } from "./core/live-updates";
import { ensureProject, type Registry } from "./core/model";
import { loadRegistry, saveRegistry } from "./core/registry";

export type CliDeps = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  readStdin: () => Promise<string>;
  applyAgentHook: typeof applyAgentHook;
  loadRegistry: typeof loadRegistry;
  saveRegistry: typeof saveRegistry;
  emitLiveUpdate: typeof emitLiveUpdate;
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
};

const usage = ["Usage: seiton hook <agent> <event>", "Usage: seiton open"].join("\n");

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [, , command, agent, event] = argv;

  if (command === "hook" && agent && event) {
    const input = await deps.readStdin();
    await deps.applyAgentHook(agent, event, input, deps.env, deps.cwd);
    return 0;
  }

  if (command === "open") {
    if (deps.cwd === "/") {
      deps.stderr.write("Refusing to add filesystem root as a project: /\n");
      return 1;
    }
    const appDataDir = resolveCliAppDataDir(deps.env, deps.platform);
    const registry = await deps.loadRegistry(appDataDir);
    const status = await openProjectInSeiton(deps.cwd, appDataDir, registry, deps);
    if (status === "exists") {
      deps.stdout.write(`Project already exists in Seiton: ${deps.cwd}\n`);
    } else {
      deps.stdout.write(`Opened ${deps.cwd} in Seiton.\n`);
    }
    return 0;
  }

  deps.stderr.write(`${usage}\n`);
  return 1;
}

export function resolveCliAppDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home = homedir()
): string {
  const overridden = env.SEITON_APP_DATA_DIR?.trim();
  if (overridden) return overridden;

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "seiton");
  }
  if (platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "seiton");
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "seiton");
}

export async function openProjectInSeiton(
  cwd: string,
  appDataDir: string,
  registry: Registry,
  deps: Pick<CliDeps, "saveRegistry" | "emitLiveUpdate">
): Promise<"added" | "exists"> {
  const existingProjects = registry.projects ?? [];
  const nextRegistry = ensureProject({
    registry,
    root: cwd,
    now: new Date().toISOString()
  });

  if ((nextRegistry.projects ?? []).length === existingProjects.length) {
    return "exists";
  }

  await deps.saveRegistry(appDataDir, nextRegistry);
  await deps.emitLiveUpdate({
    agent: "seiton",
    event: "open",
    paneId: "cli",
    cwd
  });
  return "added";
}

async function readStdin(): Promise<string> {
  if (stdin.isTTY) return "";
  let buffer = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) {
    buffer += chunk;
  }
  return buffer;
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv, {
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    readStdin,
    applyAgentHook,
    loadRegistry,
    saveRegistry,
    emitLiveUpdate,
    stdout: process.stdout,
    stderr: process.stderr
  });
  process.exitCode = exitCode;
}

export function shouldRunCliMain(
  executedPath: string | undefined,
  moduleUrl: string,
  resolveRealPath: (path: string) => string = realpathSync
): boolean {
  if (!executedPath) return false;
  try {
    return resolveRealPath(executedPath) === resolveRealPath(fileURLToPath(moduleUrl));
  } catch {
    return fileURLToPath(moduleUrl) === executedPath;
  }
}

if (shouldRunCliMain(process.argv[1], import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
