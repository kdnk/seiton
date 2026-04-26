import { describe, expect, it, vi } from "vitest";
import { runCli, shouldRunCliMain } from "../src/cli";
import type { Registry } from "../src/core/model";

function createDeps(overrides: Partial<Parameters<typeof runCli>[1]> = {}) {
  const saved: { appDataDir: string; registry: Registry }[] = [];
  const outputs = { stdout: [] as string[], stderr: [] as string[] };
  const deps: Parameters<typeof runCli>[1] = {
    cwd: "/repo/a",
    env: { HOME: "/Users/tester", SEITON_APP_DATA_DIR: "/tmp/seiton-app-data" },
    platform: "darwin",
    readStdin: vi.fn().mockResolvedValue(""),
    applyAgentHook: vi.fn().mockResolvedValue(undefined),
    loadRegistry: vi.fn().mockResolvedValue({ projects: [], contexts: [] }),
    saveRegistry: vi.fn().mockImplementation(async (appDataDir, registry) => {
      saved.push({ appDataDir, registry });
    }),
    emitLiveUpdate: vi.fn().mockResolvedValue(undefined),
    stdout: { write: (line: string) => void outputs.stdout.push(line) },
    stderr: { write: (line: string) => void outputs.stderr.push(line) }
  };
  return { deps: { ...deps, ...overrides }, saved, outputs };
}

describe("runCli", () => {
  it("treats symlinked entrypoints as direct CLI execution", () => {
    expect(shouldRunCliMain(
      "/Users/kodai/.local/bin/seiton",
      "file:///Users/kodai/workspaces/github.com/kdnk/seiton/dist-electron/cli.js",
      (path) => (
        path === "/Users/kodai/.local/bin/seiton"
          ? "/Users/kodai/workspaces/github.com/kdnk/seiton/dist-electron/cli.js"
          : path
      )
    )).toBe(true);
  });

  it("adds the current working directory for seiton open", async () => {
    const { deps, saved, outputs } = createDeps();

    const exitCode = await runCli(["node", "seiton", "open"], deps);

    expect(exitCode).toBe(0);
    expect(deps.loadRegistry).toHaveBeenCalledWith("/tmp/seiton-app-data");
    expect(deps.saveRegistry).toHaveBeenCalledTimes(1);
    expect(saved[0]).toMatchObject({
      appDataDir: "/tmp/seiton-app-data",
      registry: {
        projects: [
          expect.objectContaining({
            root: "/repo/a",
            name: "a",
            enabled: true
          })
        ]
      }
    });
    expect(deps.emitLiveUpdate).toHaveBeenCalledWith({
      agent: "seiton",
      event: "open",
      paneId: "cli",
      cwd: "/repo/a"
    });
    expect(outputs.stdout.join("")).toContain("Opened /repo/a in Seiton.");
  });

  it("prints a message when the project already exists", async () => {
    const { deps, outputs } = createDeps({
      loadRegistry: vi.fn().mockResolvedValue({
        projects: [
          {
            root: "/repo/a",
            name: "a",
            projectKey: "%2Frepo%2Fa",
            order: 10,
            enabled: true
          }
        ],
        contexts: []
      })
    });

    const exitCode = await runCli(["node", "seiton", "open"], deps);

    expect(exitCode).toBe(0);
    expect(deps.saveRegistry).not.toHaveBeenCalled();
    expect(deps.emitLiveUpdate).not.toHaveBeenCalled();
    expect(outputs.stdout.join("")).toContain("Project already exists in Seiton: /repo/a");
  });

  it("keeps the hook command behavior", async () => {
    const { deps } = createDeps({
      readStdin: vi.fn().mockResolvedValue("{\"ok\":true}")
    });

    const exitCode = await runCli(["node", "seiton", "hook", "agent-1", "finish"], deps);

    expect(exitCode).toBe(0);
    expect(deps.applyAgentHook).toHaveBeenCalledWith(
      "agent-1",
      "finish",
      "{\"ok\":true}",
      deps.env,
      "/repo/a"
    );
  });

  it("prints usage for unsupported commands", async () => {
    const { deps, outputs } = createDeps();

    const exitCode = await runCli(["node", "seiton", "unknown"], deps);

    expect(exitCode).toBe(1);
    expect(outputs.stderr.join("")).toContain("Usage: seiton hook <agent> <event>");
    expect(outputs.stderr.join("")).toContain("Usage: seiton open");
  });
});
