import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Registry } from "./model";

export function registryPath(appDataDir: string): string {
  return join(appDataDir, "registry.json");
}

export async function loadRegistry(appDataDir: string): Promise<Registry> {
  try {
    const raw = await readFile(registryPath(appDataDir), "utf8");
    const parsed = JSON.parse(raw) as Registry;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      contexts: Array.isArray(parsed.contexts) ? parsed.contexts : []
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return { projects: [], contexts: [] };
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
