import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function getActivityLogPath(paneId: string): string {
  const safePaneId = paneId.replace(/[^A-Za-z0-9_-]/g, "");
  return join(tmpdir(), `seiton-activity-${safePaneId}.log`);
}

export async function appendActivityLog(paneId: string, message: string): Promise<void> {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  const target = getActivityLogPath(paneId);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${new Date().toISOString()} ${normalized}\n`, "utf8");
}
