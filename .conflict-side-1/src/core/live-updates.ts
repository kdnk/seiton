import { watchFile, unwatchFile } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LiveUpdatePayload = {
  agent: string;
  event: string;
  paneId: string;
  cwd?: string;
  updatedAt: string;
};

export function getLiveUpdatePath(): string {
  return join(homedir(), ".seiton", "live-update.json");
}

export async function emitLiveUpdate(payload: Omit<LiveUpdatePayload, "updatedAt">): Promise<void> {
  const targetPath = getLiveUpdatePath();
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify({
      ...payload,
      updatedAt: new Date().toISOString()
    }),
    "utf8"
  );
}

export function watchLiveUpdates(onChange: () => void): () => void {
  const targetPath = getLiveUpdatePath();
  const listener = () => onChange();
  watchFile(targetPath, { interval: 400 }, listener);
  return () => {
    unwatchFile(targetPath, listener);
  };
}
