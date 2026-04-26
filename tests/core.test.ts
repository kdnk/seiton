import { describe, expect, it } from "vitest";
import {
  buildBranchKey,
  buildManagedName,
  buildProjectSlug,
  buildProjectKey,
  detectContexts,
  ensureProject,
  planKittyOrderMoves,
  planSync,
  reconcileRegistry,
  removeProject,
  type Branch,
  type Registry
} from "../src/core/model";
import {
  applyAgentHook,
  parseButBranches,
  parseTmuxCodexPanes,
  readAgentPanesFromTmuxOptions,
  focusContext,
  removeOrphanContext,
  renameManagedContext,
  readBranchesForProject,
  resolveAgentPaneCommand,
  type ExecFunction
} from "../src/core/commands";

const registry: Registry = {
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
      branch: "feature/notify-ui",
      branchKey: "feature%2Fnotify-ui",
      tmuxSession: "s_a_feature%2Fnotify-ui",
      kittyTabTitle: "s_a_feature%2Fnotify-ui",
      order: 10,
      createdAt: "2026-04-24T10:00:00+09:00",
      updatedAt: "2026-04-24T10:00:00+09:00"
    }
  ]
};

function contextFixture(
  overrides: Partial<Registry["contexts"][number]>
): Registry["contexts"][number] {
  return {
    id: "ctx-fixture",
    projectRoot: "/repo/a",
    branch: "feature/fixture",
    branchKey: "feature%2Ffixture",
    tmuxSession: "s_a_feature%2Ffixture",
    kittyTabTitle: "s_a_feature%2Ffixture",
    order: 10,
    createdAt: "2026-04-24T10:00:00+09:00",
    updatedAt: "2026-04-24T10:00:00+09:00",
    ...overrides
  };
}

describe("managed naming", () => {
  it("builds safe names from branch names", () => {
    expect(buildBranchKey("feature/notify-ui")).toBe("feature%2Fnotify-ui");
    expect(buildManagedName("/repo/a", "feature/notify-ui")).toBe(
      "s_a_feature%2Fnotify-ui"
    );
  });

  it("builds stable project keys from directory paths", () => {
    expect(buildProjectKey("/repo/a")).toBe("%2Frepo%2Fa");
  });

  it("builds a short slug from the final directory name", () => {
    expect(buildProjectSlug("/Users/kodai/workspaces/github.com/kdnk/git-butler-practice")).toBe("gbp");
    expect(buildProjectSlug("/Users/kodai/workspaces/github.com/kdnk/MyGreatApp")).toBe("mga");
    expect(buildProjectSlug("/Users/kodai/workspaces/github.com/kdnk/snake_case_tool")).toBe("sct");
    expect(buildProjectSlug("/Users/kodai/workspaces/github.com/kdnk/seiton")).toBe("seiton");
  });
});

describe("project registry", () => {
  it("adds a directory as an enabled project", () => {
    const next = ensureProject({
      registry: { projects: [], contexts: [] },
      root: "/repo/b",
      now: "2026-04-24T11:00:00+09:00"
    });

    expect(next.projects).toEqual([
      {
        root: "/repo/b",
        name: "b",
        projectKey: "%2Frepo%2Fb",
        order: 10,
        enabled: true,
        createdAt: "2026-04-24T11:00:00+09:00",
        updatedAt: "2026-04-24T11:00:00+09:00"
      }
    ]);
  });

  it("ignores the filesystem root as a project", () => {
    const next = ensureProject({
      registry: { projects: [], contexts: [] },
      root: "/",
      now: "2026-04-24T11:00:00+09:00"
    });

    expect(next).toEqual({ projects: [], contexts: [] });
  });

  it("removes a project and its scoped contexts", () => {
    const next = removeProject({
      registry: {
        projects: [
          {
            root: "/repo/a",
            name: "a",
            projectKey: "%2Frepo%2Fa",
            order: 10,
            enabled: true
          },
          {
            root: "/repo/b",
            name: "b",
            projectKey: "%2Frepo%2Fb",
            order: 20,
            enabled: true
          }
        ],
        contexts: [
          contextFixture({
            id: "ctx-a",
            projectRoot: "/repo/a",
            branch: "feature/a",
            branchKey: "feature%2Fa",
            tmuxSession: "s_a_feature%2Fa",
            kittyTabTitle: "s_a_feature%2Fa"
          }),
          contextFixture({
            id: "ctx-b",
            projectRoot: "/repo/b",
            branch: "feature/b",
            branchKey: "feature%2Fb",
            tmuxSession: "s_b_feature%2Fb",
            kittyTabTitle: "s_b_feature%2Fb",
            order: 20
          })
        ]
      },
      root: "/repo/b"
    });

    expect(next.projects).toEqual([
      {
        root: "/repo/a",
        name: "a",
        projectKey: "%2Frepo%2Fa",
        order: 10,
        enabled: true
      }
    ]);
    expect(next.contexts).toEqual([
      expect.objectContaining({
        id: "ctx-a",
        projectRoot: "/repo/a"
      })
    ]);
  });
});

describe("context detection", () => {
  it("detects claude panes from agent-backed session state", () => {
    const contexts = detectContexts({
      projectRoot: "/repo/a",
      branches: [{ name: "feature/claude-notify" }],
      tmuxSessions: ["s_a_feature%2Fclaude-notify"],
      kittyTabs: [{ id: 1, title: "s_a_feature%2Fclaude-notify", osWindowId: 100, index: 0 }],
      agentPanesBySession: {
        "s_a_feature%2Fclaude-notify": [
          {
            agent: "claude",
            paneId: "%21",
            command: "claude",
            lastLine: "Need confirmation before deploy",
            status: "waiting"
          }
        ]
      },
      registry: { projects: [], contexts: [] }
    });

    expect(contexts[0]?.agentPanes).toEqual([
      expect.objectContaining({
        agent: "claude",
        paneId: "%21",
        status: "waiting"
      })
    ]);
  });

  it("marks GitButler branches with tmux and Kitty resources as ready", () => {
    const contexts = detectContexts({
      projectRoot: "/repo/a",
      branches: [{ name: "feature/notify-ui" }],
      tmuxSessions: ["s_a_feature%2Fnotify-ui"],
      kittyTabs: [
        { id: 1, title: "s_a_feature%2Fnotify-ui", osWindowId: 100, index: 0 }
      ],
      agentPanesBySession: {},
      registry
    });

    expect(contexts).toMatchObject([
      {
        branch: "feature/notify-ui",
        branchKey: "feature%2Fnotify-ui",
        status: "ready"
      }
    ]);
  });

  it("reports orphan tmux sessions without a matching branch", () => {
    const contexts = detectContexts({
      projectRoot: "/repo/a",
      branches: [],
      tmuxSessions: ["s_a_feature%2Fnotify-ui"],
      kittyTabs: [],
      agentPanesBySession: {},
      registry
    });

    expect(contexts).toMatchObject([
      {
        branch: "feature/notify-ui",
        status: "orphan_tmux"
      }
    ]);
  });

  it("recognizes legacy managed session names for orphan detection", () => {
    const contexts = detectContexts({
      projectRoot: "/repo/a",
      branches: [],
      tmuxSessions: ["seiton__%2Frepo%2Fa__feature%2Fnotify-ui"],
      kittyTabs: [],
      agentPanesBySession: {},
      registry
    });

    expect(contexts).toMatchObject([
      {
        branch: "feature/notify-ui",
        status: "orphan_tmux"
      }
    ]);
  });

  it("isolates registry contexts by project directory", () => {
    const contexts = detectContexts({
      projectRoot: "/repo/b",
      branches: [{ name: "feature/notify-ui" }],
      tmuxSessions: ["s_a_feature%2Fnotify-ui"],
      kittyTabs: [
        { id: 1, title: "s_a_feature%2Fnotify-ui", osWindowId: 100, index: 0 }
      ],
      agentPanesBySession: {},
      registry
    });

    expect(contexts[0]).toMatchObject({
      id: "branch:feature/notify-ui",
      projectRoot: "/repo/b",
      order: 10
    });
  });
});

describe("GitButler parsing", () => {
  it("parses branch names and CLI ids from but status output", () => {
    const output = `Initiated a background sync...
╭┄zz [unassigned changes] (no changes)
┊
┊╭┄ei [seiton-parser-test] (no commits)
├╯
┊
┴ eb06544 [origin/main] 2026-04-01 Create README.md`;

    expect(parseButBranches(output)).toEqual([
      { id: "ei", name: "seiton-parser-test" }
    ]);
  });

  it("ignores staged-target pseudo branches from but status output", () => {
    const output = `Initiated a background sync...
╭┄zz [unassigned changes] (no changes)
┊
┊╭┄ei [feature/real-branch] (no commits)
├╯
┊
┊╭┄ab [staged to feature/real-branch] (2 files)
├╯`;

    expect(parseButBranches(output)).toEqual([
      { id: "ei", name: "feature/real-branch" }
    ]);
  });

  it("runs but setup and retries status when GitButler project is missing", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "but" && args.join(" ") === "status -fv") {
        if (calls.filter((call) => call.file === "but" && call.args.join(" ") === "status -fv").length === 1) {
          throw new Error("Command failed: but status -fv Error: Setup required: No GitButler project found at .");
        }
        return {
          stdout: "┊╭┄ei [seiton-parser-test] (no commits)\n├╯",
          stderr: ""
        };
      }
      if (file === "but" && args.join(" ") === "setup") {
        return { stdout: "setup ok", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readBranchesForProject("/repo/a", exec);

    expect(result).toEqual({
      ok: true,
      value: [{ id: "ei", name: "seiton-parser-test" }],
      warnings: ["GitButler project was set up automatically for /repo/a."]
    });
    expect(calls).toEqual([
      { file: "but", args: ["status", "-fv"], cwd: "/repo/a" },
      { file: "but", args: ["setup"], cwd: "/repo/a" },
      { file: "but", args: ["status", "-fv"], cwd: "/repo/a" }
    ]);
  });

  it("detects setup-required errors from stderr metadata", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "but" && args.join(" ") === "status -fv") {
        if (calls.filter((call) => call.file === "but" && call.args.join(" ") === "status -fv").length === 1) {
          throw {
            message: "Command failed: but status -fv",
            stderr: "Error: Setup required: No GitButler project found at ."
          };
        }
        return {
          stdout: "┊╭┄ei [seiton-parser-test] (no commits)\n├╯",
          stderr: ""
        };
      }
      if (file === "but" && args.join(" ") === "setup") {
        return { stdout: "setup ok", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readBranchesForProject("/repo/a", exec);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { file: "but", args: ["status", "-fv"], cwd: "/repo/a" },
      { file: "but", args: ["setup"], cwd: "/repo/a" },
      { file: "but", args: ["status", "-fv"], cwd: "/repo/a" }
    ]);
  });

  it("groups codex panes by tmux session with last output line", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "tmux" && args[0] === "capture-pane" && args[3] === "%12") {
        return {
          stdout: "╭────────────────────╮\n│ >_ OpenAI Codex    │\n╰────────────────────╯\nWorking on rename flow\n",
          stderr: ""
        };
      }
      if (file === "tmux" && args[0] === "capture-pane" && args[3] === "%9") {
        return {
          stdout: "model: gpt-5.4 medium /model to change\n› Write tests for @filename\nWaiting for input\n",
          stderr: ""
        };
      }
      if (file === "tmux" && args[0] === "capture-pane" && args[3] === "%7") {
        return {
          stdout: "╭────────────────────╮\n│ >_ OpenAI Codex    │\n╰────────────────────╯\nBye\n",
          stderr: ""
        };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await parseTmuxCodexPanes(
      [
        "s_a_feature%2Fnotify-ui\t%12\tnode\t",
        "s_a_feature%2Fnotify-ui\t%9\tnode\t",
        "s_a_feature%2Fnotify-ui\t%7\tfish\t",
        "other\t%3\tbash\tbash"
      ].join("\n"),
      "/repo/a",
      exec
    );

    expect(result).toEqual({
      "s_a_feature%2Fnotify-ui": [
        {
          agent: "codex",
          paneId: "%12",
          command: "codex",
          lastLine: "Working on rename flow",
          status: "running"
        },
        {
          agent: "codex",
          paneId: "%9",
          command: "codex",
          lastLine: "Waiting for input",
          status: "idle"
        },
      ]
    });
  });

  it("prefers tmux pane options for codex status", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_agent") {
        return { stdout: "codex\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_status") {
        return { stdout: "waiting\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_prompt") {
        return { stdout: "needs review\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readAgentPanesFromTmuxOptions(
      "s_a_feature%2Fnotify-ui\t%12\tnode\t",
      "/repo/a",
      exec
    );

    expect(result).toEqual({
      "s_a_feature%2Fnotify-ui": [
        {
          agent: "codex",
          paneId: "%12",
          command: "codex",
          lastLine: "needs review",
          status: "waiting"
        }
      ]
    });
  });

  it("ignores stale codex pane options after the process exits", async () => {
    const exec: ExecFunction = async (file, args) => {
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_agent") {
        return { stdout: "codex\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_status") {
        return { stdout: "idle\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_prompt") {
        return { stdout: "stale\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readAgentPanesFromTmuxOptions(
      "s_a_feature%2Fnotify-ui\t%12\tfish\t",
      "/repo/a",
      exec
    );

    expect(result).toEqual({});
  });

  it("reads a claude pane from tmux options", async () => {
    const exec: ExecFunction = async (file, args) => {
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_agent") {
        return { stdout: "claude\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_status") {
        return { stdout: "waiting\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_prompt") {
        return { stdout: "Need approval to continue\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readAgentPanesFromTmuxOptions(
      "s_a_feature%2Fclaude-notify\t%21\tclaude\tclaude\n",
      "/repo/a",
      exec
    );

    expect(result).toEqual({
      "s_a_feature%2Fclaude-notify": [
        {
          agent: "claude",
          paneId: "%21",
          command: "claude",
          lastLine: "Need approval to continue",
          status: "waiting"
        }
      ]
    });
  });

  it("ignores stale claude pane options after claude exits", async () => {
    const exec: ExecFunction = async (file, args) => {
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_agent") {
        return { stdout: "claude\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_status") {
        return { stdout: "idle\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "show-options" && args[5] === "@seiton_prompt") {
        return { stdout: "stale\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    const result = await readAgentPanesFromTmuxOptions(
      "s_a_feature%2Fclaude-notify\t%21\tfish\tfish\n",
      "/repo/a",
      exec
    );

    expect(result).toEqual({});
  });

  it("writes codex hook events into tmux pane options", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const notifications: Array<{ agent: string; event: string; paneId: string; cwd?: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await applyAgentHook(
      "codex",
      "user-prompt-submit",
      JSON.stringify({ prompt: "Review current branch", cwd: "/repo/a" }),
      { TMUX_PANE: "%12", PWD: "/repo/a" },
      "/repo/a",
      exec,
      async (payload) => {
        notifications.push(payload);
      }
    );

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%12", "@seiton_agent", "codex"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%12", "@seiton_status", "running"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%12", "@seiton_prompt", "Review current branch"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%12", "@seiton_cwd", "/repo/a"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%12", "@seiton_started_at", expect.any(String)],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-u", "-t", "%12", "@seiton_attention"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-u", "-t", "%12", "@seiton_wait_reason"],
        cwd: "/repo/a"
      }
    ]);
    expect(notifications).toEqual([
      {
        agent: "codex",
        event: "user-prompt-submit",
        paneId: "%12",
        cwd: "/repo/a"
      }
    ]);
  });

  it("writes claude notification events into tmux pane options", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const notifications: Array<{ agent: string; event: string; paneId: string; cwd?: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await applyAgentHook(
      "claude",
      "Notification",
      JSON.stringify({ message: "Need approval to continue", cwd: "/repo/a" }),
      { TMUX_PANE: "%21", PWD: "/repo/a" },
      "/repo/a",
      exec,
      async (payload) => {
        notifications.push(payload);
      }
    );

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_agent", "claude"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_status", "waiting"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_prompt", "Need approval to continue"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_cwd", "/repo/a"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_attention", "notification"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["set-option", "-p", "-t", "%21", "@seiton_wait_reason", "notification"],
        cwd: "/repo/a"
      }
    ]);
    expect(notifications).toEqual([
      {
        agent: "claude",
        event: "notification",
        paneId: "%21",
        cwd: "/repo/a"
      }
    ]);
  });
});

describe("codex pane command labels", () => {
  it("drops cwd-style path arguments from the displayed agent command", () => {
    expect(resolveAgentPaneCommand(
      "codex",
      "codex",
      "codex --model gpt-5 /Users/kodai/workspaces/github.com/kdnk/seiton"
    )).toBe("codex --model gpt-5");
  });
});

describe("focusing contexts", () => {
  it("creates missing kitty tab during focus", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "kitty" && args[1] === "focus-tab") {
        throw new Error(
          "Command failed: kitty @ focus-tab --match title:s_a_feature%2Fnotify-ui Error: No matching tabs for expression: title:s_a_feature%2Fnotify-ui"
        );
      }
      if (file === "kitty" && args[1] === "launch") {
        return { stdout: "", stderr: "" };
      }
      if (file === "tmux") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    await focusContext("/repo/a", "feature%2Fnotify-ui", undefined, "/repo/a", exec);

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["has-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "focus-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "launch", "--type=tab", "--tab-title", "s_a_feature%2Fnotify-ui", "tmux", "new-session", "-A", "-s", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["switch-client", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("selects a target pane when pane id is provided", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "kitty" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              id: 1,
              tabs: [
                {
                  id: 10,
                  title: "s_a_feature%2Fnotify-ui",
                  windows: [
                    {
                      is_active: true,
                      pid: 1234,
                      foreground_processes: [{ pid: 1234 }]
                    }
                  ]
                }
              ]
            }
          ]),
          stderr: ""
        };
      }
      if (file === "kitty") return { stdout: "", stderr: "" };
      if (file === "tmux" && args[0] === "has-session") return { stdout: "", stderr: "" };
      if (file === "tmux" && args[0] === "list-clients") {
        return { stdout: "/dev/ttys000\ts_a_feature%2Fnotify-ui\t1234\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "switch-client" && args.includes("-c")) {
        return { stdout: "", stderr: "" };
      }
      if (file === "tmux" && args[0] === "switch-client") {
        throw { message: "Command failed", stderr: "no current client\n" };
      }
      if (file === "tmux" && args[0] === "display-message") {
        return { stdout: "@14\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "select-window") return { stdout: "", stderr: "" };
      if (file === "tmux" && args[0] === "select-pane") return { stdout: "", stderr: "" };
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    await focusContext("/repo/a", "feature%2Fnotify-ui", "%12", "/repo/a", exec);

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["has-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "focus-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "ls"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["list-clients", "-F", "#{client_tty}\t#{session_name}\t#{client_pid}"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["switch-client", "-c", "/dev/ttys000", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["display-message", "-p", "-t", "%12", "#{window_id}"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["select-window", "-t", "@14"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["select-pane", "-t", "%12"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("creates missing tmux session and kitty tab during focus", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "kitty" && args[1] === "focus-tab") {
        throw new Error("No matching tabs");
      }
      if (file === "tmux" && args[0] === "has-session") {
        throw new Error("can't find session");
      }
      return { stdout: "", stderr: "" };
    };

    await focusContext("/repo/a", "feature%2Fnotify-ui", undefined, "/repo/a", exec);

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["has-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["new-session", "-d", "-s", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "focus-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "launch", "--type=tab", "--tab-title", "s_a_feature%2Fnotify-ui", "tmux", "new-session", "-A", "-s", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["switch-client", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("ignores tmux switch-client when there is no current tmux client", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "kitty") {
        return { stdout: "", stderr: "" };
      }
      if (file === "tmux" && args[0] === "has-session") {
        return { stdout: "", stderr: "" };
      }
      if (file === "tmux" && args[0] === "list-clients") {
        return { stdout: "", stderr: "" };
      }
      if (file === "tmux" && args[0] === "switch-client") {
        throw {
          message: "Command failed: tmux switch-client -t s_a_feature%2Fnotify-ui",
          stderr: "no current client\n"
        };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    await expect(
      focusContext("/repo/a", "feature%2Fnotify-ui", undefined, "/repo/a", exec)
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["has-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "focus-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "ls"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["list-clients", "-F", "#{client_tty}\t#{session_name}\t#{client_pid}"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["switch-client", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("targets the tmux client that belongs to the focused kitty tab", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "tmux" && args[0] === "has-session") {
        return { stdout: "", stderr: "" };
      }
      if (file === "kitty" && args[1] === "focus-tab") {
        return { stdout: "", stderr: "" };
      }
      if (file === "kitty" && args[1] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              id: 1,
              tabs: [
                {
                  id: 10,
                  title: "s_a_feature%2Fnotify-ui",
                  windows: [
                    {
                      is_active: true,
                      pid: 1234,
                      foreground_processes: [{ pid: 1234 }]
                    }
                  ]
                }
              ]
            }
          ]),
          stderr: ""
        };
      }
      if (file === "tmux" && args[0] === "list-clients") {
        return { stdout: "/dev/ttys007\ts_other\t9999\n/dev/ttys009\ts_a_feature%2Fnotify-ui\t1234\n", stderr: "" };
      }
      if (file === "tmux" && args[0] === "switch-client") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };

    await focusContext("/repo/a", "feature%2Fnotify-ui", undefined, "/repo/a", exec);

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["has-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "focus-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "ls"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["list-clients", "-F", "#{client_tty}\t#{session_name}\t#{client_pid}"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["switch-client", "-c", "/dev/ttys009", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });
});

describe("removing orphan contexts", () => {
  it("closes kitty tab and kills tmux session", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await removeOrphanContext(
      { projectRoot: "/repo/a", tmuxSession: "s_a_feature%2Fnotify-ui", kittyTabTitle: "s_a_feature%2Fnotify-ui" },
      "/repo/a",
      exec
    );

    expect(calls).toEqual([
      {
        file: "kitty",
        args: ["@", "close-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["kill-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("ignores missing kitty tab and missing tmux session", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      if (file === "kitty") {
        throw new Error("No matching tabs for expression");
      }
      if (file === "tmux") {
        throw { message: "Command failed", stderr: "can't find session\n" };
      }
      return { stdout: "", stderr: "" };
    };

    await expect(
      removeOrphanContext(
        { projectRoot: "/repo/a", tmuxSession: "s_a_feature%2Fnotify-ui", kittyTabTitle: "s_a_feature%2Fnotify-ui" },
        "/repo/a",
        exec
      )
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        file: "kitty",
        args: ["@", "close-tab", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["kill-session", "-t", "s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });
});

describe("renaming managed contexts", () => {
  it("renames gitbutler branch, tmux session, and kitty tab together", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await renameManagedContext(
      {
        projectRoot: "/repo/a",
        branchId: "ab",
        oldBranch: "feature/notify-ui",
        newBranch: "feature/renamed-ui",
        oldTmuxSession: "s_a_feature%2Fnotify-ui",
        oldKittyTabTitle: "s_a_feature%2Fnotify-ui"
      },
      "/repo/a",
      exec
    );

    expect(calls).toEqual([
      {
        file: "but",
        args: ["reword", "-m", "feature/renamed-ui", "ab"],
        cwd: "/repo/a"
      },
      {
        file: "tmux",
        args: ["rename-session", "-t", "s_a_feature%2Fnotify-ui", "s_a_feature%2Frenamed-ui"],
        cwd: "/repo/a"
      },
      {
        file: "kitty",
        args: ["@", "set-tab-title", "s_a_feature%2Frenamed-ui", "--match", "title:s_a_feature%2Fnotify-ui"],
        cwd: "/repo/a"
      }
    ]);
  });

  it("renames kitty tab by id when the original tab id is known", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await renameManagedContext(
      {
        projectRoot: "/repo/a",
        branchId: "ab",
        oldBranch: "feature/notify-ui",
        newBranch: "feature/renamed-ui",
        oldTmuxSession: "s_a_feature%2Fnotify-ui",
        oldKittyTabTitle: "s_a_feature%2Fnotify-ui",
        oldKittyTabId: 42
      },
      "/repo/a",
      exec
    );

    expect(calls[2]).toEqual({
      file: "kitty",
      args: ["@", "set-tab-title", "s_a_feature%2Frenamed-ui", "--match", "id:42"],
      cwd: "/repo/a"
    });
  });

  it("falls back to old branch name when no branch id is available", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: ExecFunction = async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      return { stdout: "", stderr: "" };
    };

    await renameManagedContext(
      {
        projectRoot: "/repo/a",
        oldBranch: "feature/notify-ui",
        newBranch: "feature/renamed-ui",
        oldTmuxSession: "s_a_feature%2Fnotify-ui",
        oldKittyTabTitle: "s_a_feature%2Fnotify-ui"
      },
      "/repo/a",
      exec
    );

    expect(calls[0]).toEqual({
      file: "but",
      args: ["reword", "-m", "feature/renamed-ui", "feature/notify-ui"],
      cwd: "/repo/a"
    });
  });
});

describe("registry reconciliation", () => {
  it("creates project-scoped registry contexts for new branches", () => {
    const next = reconcileRegistry({
      projectRoot: "/repo/b",
      branches: [{ id: "ei", name: "seiton-parser-test" }],
      registry,
      now: "2026-04-24T11:00:00+09:00"
    });

    expect(next.contexts).toContainEqual({
      id: "/repo/b:seiton-parser-test",
      projectRoot: "/repo/b",
      branch: "seiton-parser-test",
      branchKey: "seiton-parser-test",
      branchId: "ei",
      tmuxSession: "s_b_seiton-parser-test",
      kittyTabTitle: "s_b_seiton-parser-test",
      order: 10,
      createdAt: "2026-04-24T11:00:00+09:00",
      updatedAt: "2026-04-24T11:00:00+09:00"
    });
    expect(next.contexts).toContainEqual(registry.contexts[0]);
  });
});

describe("sync planning", () => {
  it("creates missing tmux sessions and Kitty tabs for branches", () => {
    const plan = planSync({
      projectRoot: "/repo/a",
      branches: [{ name: "feature/notify-ui" }],
      tmuxSessions: [],
      kittyTabs: [],
      agentPanesBySession: {},
      registry
    });

    expect(plan.commands).toEqual([
      {
        type: "create_tmux_session",
        branch: "feature/notify-ui",
        tmuxSession: "s_a_feature%2Fnotify-ui"
      },
      {
        type: "create_kitty_tab",
        branch: "feature/notify-ui",
        kittyTabTitle: "s_a_feature%2Fnotify-ui",
        tmuxSession: "s_a_feature%2Fnotify-ui"
      }
    ]);
  });

  it("uses GitButler branch names over pending registry renames", () => {
    const plan = planSync({
      projectRoot: "/repo/a",
      branches: [{ name: "feature/gitbutler-name", id: "branch-1" }],
      tmuxSessions: ["s_a_feature%2Fold-name"],
      kittyTabs: [
        { id: 1, title: "s_a_feature%2Fold-name", osWindowId: 100, index: 0 }
      ],
      agentPanesBySession: {},
      registry: {
        contexts: [
          {
            id: "ctx-1",
            projectRoot: "/repo/a",
            branch: "feature/old-name",
            branchKey: "feature%2Fold-name",
            branchId: "branch-1",
            pendingBranch: "feature/electron-name",
            tmuxSession: "s_a_feature%2Fold-name",
            kittyTabTitle: "s_a_feature%2Fold-name",
            order: 10,
            createdAt: "2026-04-24T10:00:00+09:00",
            updatedAt: "2026-04-24T10:00:00+09:00"
          }
        ]
      }
    });

    expect(plan.commands).toContainEqual({
      type: "rename_tmux_session",
      oldSession: "s_a_feature%2Fold-name",
      newSession: "s_a_feature%2Fgitbutler-name"
    });
    expect(plan.registryUpdates[0]).toMatchObject({
      branch: "feature/gitbutler-name"
    });
    expect(plan.registryUpdates[0]).not.toHaveProperty("pendingBranch");
    expect(plan.warnings).toContain(
      "GitButler branch name overrides pending Electron rename for feature/old-name."
    );
  });
});

describe("Kitty order planning", () => {
  it("plans adjacent moves inside a contiguous managed block", () => {
    const branches: Branch[] = [
      { name: "feature/a" },
      { name: "feature/b" },
      { name: "feature/c" }
    ];

    const moves = planKittyOrderMoves({
      projectRoot: "/repo/a",
      branches,
      tmuxSessions: [],
      agentPanesBySession: {},
      registry: {
        contexts: [
          contextFixture({ branch: "feature/c", branchKey: "feature%2Fc", order: 10 }),
          contextFixture({ branch: "feature/a", branchKey: "feature%2Fa", order: 20 }),
          contextFixture({ branch: "feature/b", branchKey: "feature%2Fb", order: 30 })
        ]
      },
      kittyTabs: [
        { id: 1, title: "s_a_feature%2Fa", osWindowId: 100, index: 0 },
        { id: 2, title: "s_a_feature%2Fb", osWindowId: 100, index: 1 },
        { id: 3, title: "s_a_feature%2Fc", osWindowId: 100, index: 2 }
      ]
    });

    expect(moves).toEqual({
      commands: [
        { type: "move_kitty_tab_backward", kittyTabTitle: "s_a_feature%2Fc" },
        { type: "move_kitty_tab_backward", kittyTabTitle: "s_a_feature%2Fc" }
      ],
      warnings: []
    });
  });

  it("warns instead of crossing unmanaged tabs", () => {
    const moves = planKittyOrderMoves({
      projectRoot: "/repo/a",
      branches: [{ name: "feature/a" }, { name: "feature/b" }],
      tmuxSessions: [],
      agentPanesBySession: {},
      registry: {
        contexts: [
          contextFixture({ branch: "feature/b", branchKey: "feature%2Fb", order: 10 }),
          contextFixture({ branch: "feature/a", branchKey: "feature%2Fa", order: 20 })
        ]
      },
      kittyTabs: [
        { id: 1, title: "s_a_feature%2Fa", osWindowId: 100, index: 0 },
        { id: 9, title: "shell", osWindowId: 100, index: 1 },
        { id: 2, title: "s_a_feature%2Fb", osWindowId: 100, index: 2 }
      ]
    });

    expect(moves.commands).toEqual([]);
    expect(moves.warnings).toEqual([
      "Managed Kitty tabs are separated by unmanaged tabs; order sync skipped."
    ]);
  });
});
