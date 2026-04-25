import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadRegistry, saveRegistry } from "../src/core/registry";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("registry persistence", () => {
  it("returns an empty registry when the file does not exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "seiton-registry-"));

    await expect(loadRegistry(tempDir)).resolves.toEqual({ projects: [], contexts: [] });
  });

  it("saves registry JSON under the app data directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "seiton-registry-"));

    await saveRegistry(tempDir, {
      projects: [
        {
          root: "/repo/a",
          name: "a",
          projectKey: "%2Frepo%2Fa",
          order: 10,
          enabled: true,
          createdAt: "2026-04-24T10:00:00+09:00",
          updatedAt: "2026-04-24T10:00:00+09:00"
        }
      ],
      contexts: [
        {
          id: "ctx-1",
          projectRoot: "/repo/a",
          branch: "feature/a",
          branchKey: "feature%2Fa",
          tmuxSession: "seiton__%2Frepo%2Fa__feature%2Fa",
          kittyTabTitle: "seiton__%2Frepo%2Fa__feature%2Fa",
          order: 10,
          createdAt: "2026-04-24T10:00:00+09:00",
          updatedAt: "2026-04-24T10:00:00+09:00"
        }
      ]
    });

    const raw = await readFile(join(tempDir, "registry.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      projects: [{ root: "/repo/a", order: 10 }],
      contexts: [{ branch: "feature/a", order: 10 }]
    });
    await expect(loadRegistry(tempDir)).resolves.toMatchObject({
      projects: [{ root: "/repo/a", order: 10 }],
      contexts: [{ branch: "feature/a", order: 10 }]
    });
  });
});
