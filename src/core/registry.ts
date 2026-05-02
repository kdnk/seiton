import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPersistableProjectRoot, type Registry, type RegistryContext } from "./model";

export function registryPath(appDataDir: string): string {
  return join(appDataDir, "registry.json");
}

export async function loadRegistry(appDataDir: string): Promise<Registry> {
  try {
    const raw = await readFile(registryPath(appDataDir), "utf8");
    const parsed = JSON.parse(raw) as Registry & {
      contexts?: Array<RegistryContext & { kittyTabTitle?: string }>;
    };
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter((project) => (
          project &&
          typeof project.root === "string" &&
          isPersistableProjectRoot(project.root)
        ))
      : [];
    const projectRoots = new Set(projects.map((project) => project.root));
    return {
      settings: {
        terminalBackend: parsed.settings?.terminalBackend === "wezterm" ? "wezterm" : "kitty"
      },
      projects,
      contexts: Array.isArray(parsed.contexts)
        ? parsed.contexts
          .filter((context) => (
            context &&
            typeof context.projectRoot === "string" &&
            projectRoots.has(context.projectRoot)
          ))
          .map(normalizeContext)
        : []
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return { settings: { terminalBackend: "kitty" }, projects: [], contexts: [] };
    }
    throw error;
  }
}

export async function saveRegistry(
  appDataDir: string,
  registry: Registry
): Promise<void> {
  await mkdir(appDataDir, { recursive: true });
  await writeFile(registryPath(appDataDir), `${JSON.stringify(registry, null, 2)}\n`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function normalizeContext(
  context: RegistryContext & { kittyTabTitle?: string }
): RegistryContext {
  return {
    ...context,
    terminalTabTitle: context.terminalTabTitle ?? context.kittyTabTitle ?? context.tmuxSession
  };
}
