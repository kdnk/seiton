# Claude Notification Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude hook notifications and manual `seiton notify` support so Claude panes participate in Seiton’s notification flow alongside Codex.

**Architecture:** Generalize the current Codex-only pane model into an agent-neutral pane model, then extend the tmux option writer to normalize Claude hook payloads into the same pane state fields. Keep tmux pane options as the source of truth for live status, use a small temp-file helper for activity logs, and leave stdout-based pane detection as a Codex-only fallback.

**Tech Stack:** TypeScript, Electron, React, Vitest, tmux pane options, GitButler CLI (`but`)

---

### Task 1: Generalize Pane State From Codex-Only To Agent-Neutral

**Files:**
- Modify: `src/core/model.ts`
- Modify: `src/core/commands.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Test: `tests/core.test.ts`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Write the failing model and renderer tests**

```ts
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

it("renders an agent badge for claude panes", async () => {
  window.seiton = {
    refresh: vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/claude-notify",
              branchKey: "feature%2Fclaude-notify",
              tmuxSession: "s_a_feature%2Fclaude-notify",
              kittyTabTitle: "s_a_feature%2Fclaude-notify",
              agentPanes: [
                {
                  agent: "claude",
                  paneId: "%21",
                  command: "claude",
                  lastLine: "Need confirmation before deploy",
                  status: "waiting"
                }
              ],
              order: 10,
              status: "ready"
            }
          ]
        }
      ],
      warnings: []
    }),
    sync: vi.fn(),
    addProjectRoot: vi.fn(),
    focus: vi.fn(),
    renameContext: vi.fn(),
    reorderProjects: vi.fn(),
    reorderContexts: vi.fn(),
    removeOrphan: vi.fn(),
    getCliCommandStatus: vi.fn().mockResolvedValue(null),
    installCliCommand: vi.fn()
  } as never;

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("claude")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the current code fails**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx -t "claude"`
Expected: FAIL with TypeScript or assertion errors because `agentPanes` and `agentPanesBySession` do not exist yet.

- [ ] **Step 3: Replace the Codex-specific types with shared agent types**

```ts
export type AgentName = "codex" | "claude";

export type AgentPaneStatus = "running" | "idle" | "waiting" | "error";

export type AgentPane = {
  agent: AgentName;
  paneId: string;
  command: string;
  lastLine: string;
  status: AgentPaneStatus;
};

export type Context = {
  id: string;
  type: "managed";
  projectRoot: string;
  branch: string;
  branchKey: string;
  branchId?: string;
  tmuxSession: string;
  kittyTabTitle: string;
  primaryPaneId?: string;
  agentPanes: AgentPane[];
  order: number;
  status: ContextStatus;
};

export type SyncInput = {
  projectRoot: string;
  branches: Branch[];
  tmuxSessions: string[];
  kittyTabs: KittyTab[];
  agentPanesBySession: Record<string, AgentPane[]>;
  registry: Registry;
};
```

```ts
const context: Context = {
  id: existing?.id ?? `branch:${branch.name}`,
  type: "managed",
  projectRoot: input.projectRoot,
  branch: branch.name,
  branchKey,
  tmuxSession,
  kittyTabTitle,
  agentPanes: input.agentPanesBySession[tmuxSession] ?? [],
  order: existing?.order ?? nextOrder(scopedRegistry),
  status: statusForPresence(hasTmux, hasKitty)
};
```

- [ ] **Step 4: Update imports and JSX call sites to use `AgentPane` and `agentPanes`**

```ts
import type { AgentPane, Context, ProjectContexts } from "../core/model";

async function focusPane(context: Context, pane: AgentPane) {
  if (!window.seiton) return;
  await window.seiton.focus(context.projectRoot, context.branchKey, pane.paneId);
  await refresh();
}
```

```tsx
{context.agentPanes.length > 0 ? (
  <div className="agent-pane-list">
    {context.agentPanes.map((pane) => (
      <div key={pane.paneId} className="agent-pane-row">
        <div className="agent-pane-main">
          <span className="agent-pane-badge">{pane.agent}</span>
          <span className={`status codex-status ${pane.status}`}>{pane.status}</span>
          <strong>{pane.command}</strong>
          <small>{pane.paneId}</small>
        </div>
      </div>
    ))}
  </div>
) : null}
```

- [ ] **Step 5: Run the focused tests and commit**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx`
Expected: PASS

```bash
printf 'refactor: generalize pane state for multiple agents\n\nWhy:\n- Claude notifications need to appear in the same context model as Codex panes.\n- The current Codex-only naming blocks shared hook handling and UI rendering.\n\nWhat:\n- rename pane types and session maps to agent-neutral names\n- update context detection and renderer call sites to use shared pane state\n' > /tmp/seiton-claude-plan-task1.txt
but commit --message-file /tmp/seiton-claude-plan-task1.txt
```

### Task 2: Read Claude Pane State From tmux Options While Keeping Codex Fallback Detection

**Files:**
- Modify: `src/core/commands.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Add failing tests for Claude pane discovery and stale-state rejection**

```ts
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
```

- [ ] **Step 2: Run the focused discovery tests**

Run: `npm test -- tests/core.test.ts -t "claude pane"`
Expected: FAIL because `readAgentPanesFromTmuxOptions` does not exist and the current code only accepts `@seiton_agent=codex`.

- [ ] **Step 3: Generalize the option-backed pane reader**

```ts
async function readAgentPanes(cwd: string): Promise<CommandResult<Record<string, AgentPane[]>>> {
  try {
    const { stdout } = await exec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_start_command}"
    ], cwd);
    const optionBacked = await readAgentPanesFromTmuxOptions(stdout, cwd, exec);
    const fallback = await parseTmuxCodexPanes(stdout, cwd, exec);
    return { ok: true, value: mergeAgentPaneMaps(optionBacked, fallback) };
  } catch (error) {
    return {
      ok: false,
      value: {},
      error: `tmux list-panes failed: ${formatError(error)}`
    };
  }
}

export async function readAgentPanesFromTmuxOptions(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);
  const result: Record<string, AgentPane[]> = {};

  for (const pane of paneCandidates) {
    const entry = await readAgentPaneFromTmuxOptions(pane, cwd, run);
    if (!entry) continue;
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  return sortPaneMap(result);
}
```

```ts
async function readAgentPaneFromTmuxOptions(
  pane: PaneCandidate,
  cwd: string,
  run: ExecFunction
): Promise<AgentPane | undefined> {
  const agent = await readPaneOption(pane.paneId, "@seiton_agent", cwd, run);
  if (agent !== "codex" && agent !== "claude") return undefined;
  if (!isAgentRuntimeActive(agent, pane.currentCommand, pane.startCommand)) return undefined;

  const [status, prompt] = await Promise.all([
    readPaneOption(pane.paneId, "@seiton_status", cwd, run),
    readPaneOption(pane.paneId, "@seiton_prompt", cwd, run)
  ]);

  const fallbackLine = prompt ? "" : (await readPaneSnapshot(pane.paneId, cwd, run)).lastLine;

  return {
    agent,
    paneId: pane.paneId,
    command: resolveAgentPaneCommand(agent, pane.currentCommand, pane.startCommand),
    lastLine: prompt || fallbackLine,
    status: normalizeAgentPaneStatus(status)
  };
}
```

- [ ] **Step 4: Keep stdout heuristics as Codex-only fallback**

```ts
export async function parseTmuxCodexPanes(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  const paneCandidates = parsePaneCandidates(stdout);
  const result: Record<string, AgentPane[]> = {};

  for (const pane of paneCandidates) {
    const snapshot = await readPaneSnapshot(pane.paneId, cwd, run);
    if (!isCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) continue;
    if (!isLiveCodexPane(pane.currentCommand, pane.startCommand, snapshot.fullText)) continue;
    const entry: AgentPane = {
      agent: "codex",
      paneId: pane.paneId,
      command: resolveAgentPaneCommand("codex", pane.currentCommand, pane.startCommand),
      lastLine: snapshot.lastLine,
      status: inferCodexPaneStatus(snapshot.fullText)
    };
    const existing = result[pane.sessionName] ?? [];
    existing.push(entry);
    result[pane.sessionName] = existing;
  }

  return sortPaneMap(result);
}
```

- [ ] **Step 5: Run the core tests and commit**

Run: `npm test -- tests/core.test.ts`
Expected: PASS

```bash
printf 'refactor: read claude pane state from tmux options\n\nWhy:\n- Claude panes do not expose the same stdout signature as Codex.\n- tmux pane options are the supported source of truth for hook-driven state.\n\nWhat:\n- generalize option-backed pane discovery to codex and claude\n- preserve stdout-based fallback parsing for codex-only sessions\n' > /tmp/seiton-claude-plan-task2.txt
but commit --message-file /tmp/seiton-claude-plan-task2.txt
```

### Task 3: Add Claude Hook Normalization, Activity Log Persistence, and `seiton notify`

**Files:**
- Create: `src/core/activity-log.ts`
- Modify: `src/core/commands.ts`
- Modify: `src/cli.ts`
- Test: `tests/core.test.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write failing tests for Claude hook events, activity logs, and manual notify**

```ts
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

it("accepts seiton notify and routes it into pane state", async () => {
  const notifyCurrentPane = vi.fn().mockResolvedValue(undefined);
  const { deps } = createDeps({
    notifyCurrentPane
  });

  const exitCode = await runCli(["node", "seiton", "notify", "implementation", "finished"], deps);

  expect(exitCode).toBe(0);
  expect(notifyCurrentPane).toHaveBeenCalledWith("implementation finished", deps.env, "/repo/a");
});
```

- [ ] **Step 2: Run the hook and CLI tests**

Run: `npm test -- tests/core.test.ts tests/cli.test.ts -t "claude|notify"`
Expected: FAIL because Claude is unsupported, there is no activity log helper, and `notify` is not in the CLI.

- [ ] **Step 3: Create an activity log helper for pane-scoped temp files**

```ts
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
```

- [ ] **Step 4: Normalize Claude events and implement manual notify**

```ts
const usage = [
  "Usage: seiton hook <agent> <event>",
  "Usage: seiton notify <message>",
  "Usage: seiton open"
].join("\n");

if (command === "notify" && argv.length > 3) {
  const message = argv.slice(3).join(" ").trim();
  await deps.notifyCurrentPane(message, deps.env, deps.cwd);
  return 0;
}
```

```ts
function normalizeHookEvent(agent: string, event: string): string {
  const normalized = event.trim().replace(/[_\s]+/g, "-").toLowerCase();

  if (agent === "codex") {
    if (["session-start", "user-prompt-submit", "stop"].includes(normalized)) return normalized;
    throw new Error(`Unsupported codex event: ${event}`);
  }

  if (agent === "claude") {
    const mapped: Record<string, string> = {
      "session-start": "session_start",
      "user-prompt-submit": "user_prompt_submit",
      "notification": "notification",
      "stop": "stop",
      "stop-failure": "stop_failure",
      "post-tool-use": "activity_log",
      "session-end": "session_end"
    };
    const next = mapped[normalized];
    if (next) return next;
    throw new Error(`Unsupported claude event: ${event}`);
  }

  throw new Error(`Unsupported agent: ${agent}`);
}
```

```ts
async function applyClaudeHook(
  event: string,
  paneId: string,
  input: { cwd?: string; prompt?: string },
  cwd: string,
  run: ExecFunction
): Promise<void> {
  switch (event) {
    case "session_start":
      await writePaneOptions(paneId, {
        "@seiton_agent": "claude",
        "@seiton_status": "idle",
        "@seiton_prompt": input.prompt,
        "@seiton_cwd": input.cwd
      }, cwd, run);
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    case "user_prompt_submit":
      await writePaneOptions(paneId, {
        "@seiton_agent": "claude",
        "@seiton_status": "running",
        "@seiton_prompt": input.prompt,
        "@seiton_cwd": input.cwd,
        "@seiton_started_at": new Date().toISOString()
      }, cwd, run);
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason"], cwd, run);
      return;
    case "notification":
      await writePaneOptions(paneId, {
        "@seiton_agent": "claude",
        "@seiton_status": "waiting",
        "@seiton_prompt": input.prompt,
        "@seiton_cwd": input.cwd,
        "@seiton_attention": "notification",
        "@seiton_wait_reason": "notification"
      }, cwd, run);
      return;
    case "stop":
      await writePaneOptions(paneId, {
        "@seiton_agent": "claude",
        "@seiton_status": "idle",
        "@seiton_prompt": input.prompt,
        "@seiton_cwd": input.cwd
      }, cwd, run);
      await unsetPaneOptions(paneId, ["@seiton_attention", "@seiton_wait_reason", "@seiton_started_at"], cwd, run);
      return;
    case "stop_failure":
      await writePaneOptions(paneId, {
        "@seiton_agent": "claude",
        "@seiton_status": "error",
        "@seiton_prompt": input.prompt,
        "@seiton_cwd": input.cwd,
        "@seiton_attention": "notification",
        "@seiton_wait_reason": "stop_failure"
      }, cwd, run);
      return;
    case "activity_log":
      await appendActivityLog(paneId, input.prompt ?? "Claude tool activity");
      return;
    case "session_end":
      await unsetPaneOptions(paneId, [
        "@seiton_agent",
        "@seiton_status",
        "@seiton_prompt",
        "@seiton_cwd",
        "@seiton_attention",
        "@seiton_wait_reason",
        "@seiton_started_at"
      ], cwd, run);
      return;
    default:
      throw new Error(`Unsupported claude event: ${event}`);
  }
}
```

```ts
export async function notifyCurrentPane(
  message: string,
  env: HookEnvironment,
  cwd = process.cwd(),
  run: ExecFunction = exec
): Promise<void> {
  const paneId = env.TMUX_PANE?.trim();
  if (!paneId) throw new Error("TMUX_PANE is required");

  await writePaneOptions(paneId, {
    "@seiton_status": "waiting",
    "@seiton_prompt": message,
    "@seiton_cwd": env.PWD?.trim() ?? cwd,
    "@seiton_attention": "notification",
    "@seiton_wait_reason": "notification"
  }, cwd, run);

  await appendActivityLog(paneId, message);
}
```

- [ ] **Step 5: Run the focused tests and commit**

Run: `npm test -- tests/core.test.ts tests/cli.test.ts`
Expected: PASS

```bash
printf 'feat: support claude hooks and manual notifications\n\nWhy:\n- Seiton needs to surface Claude waiting and error states in tmux-backed contexts.\n- Manual notifications are part of the spec and unblock non-hook workflows.\n\nWhat:\n- add Claude event normalization and pane-option updates\n- persist activity log entries in temp files\n- add the seiton notify CLI command\n' > /tmp/seiton-claude-plan-task3.txt
but commit --message-file /tmp/seiton-claude-plan-task3.txt
```

### Task 4: Update the Renderer To Present Claude Pane Status Cleanly

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Add a renderer test for Claude waiting state**

```ts
it("shows claude waiting panes with agent-specific labels", async () => {
  const focus = vi.fn().mockResolvedValue(undefined);
  window.seiton = {
    refresh: vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/claude-notify",
              branchKey: "feature%2Fclaude-notify",
              tmuxSession: "s_a_feature%2Fclaude-notify",
              kittyTabTitle: "s_a_feature%2Fclaude-notify",
              agentPanes: [
                {
                  agent: "claude",
                  paneId: "%21",
                  command: "claude",
                  lastLine: "Need confirmation before deploy",
                  status: "waiting"
                }
              ],
              order: 10,
              status: "ready"
            }
          ]
        }
      ],
      warnings: []
    }),
    sync: vi.fn(),
    addProjectRoot: vi.fn(),
    focus,
    renameContext: vi.fn(),
    reorderProjects: vi.fn(),
    reorderContexts: vi.fn(),
    removeOrphan: vi.fn(),
    getCliCommandStatus: vi.fn().mockResolvedValue(null),
    installCliCommand: vi.fn()
  } as never;

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("Need confirmation before deploy")).toBeInTheDocument();
  });

  expect(screen.getByText("claude")).toBeInTheDocument();
  expect(screen.getByText("waiting")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the renderer test**

Run: `npm test -- tests/renderer.test.tsx -t "claude waiting"`
Expected: FAIL if the UI still reads `codexPanes` or only renders Codex-specific copy.

- [ ] **Step 3: Rename the pane list classes and show the agent badge in the row header**

```tsx
{context.agentPanes.length > 0 ? (
  <div className="agent-pane-list">
    {context.agentPanes.map((pane) => (
      <div key={pane.paneId} className="agent-pane-row">
        <div className="agent-pane-main">
          <span className="agent-pane-badge">{pane.agent}</span>
          <span className={`status codex-status ${pane.status}`}>{pane.status}</span>
          <strong>{pane.command}</strong>
          <small>{pane.paneId}</small>
          <button
            type="button"
            className="agent-pane-focus"
            onClick={() => onFocusPane(pane)}
          >
            Focus pane
          </button>
        </div>
        <p className="agent-pane-line" title={pane.lastLine}>
          {pane.lastLine}
        </p>
      </div>
    ))}
  </div>
) : null}
```

- [ ] **Step 4: Add neutral pane styling instead of Codex-only naming**

```css
.agent-pane-list {
  display: grid;
  gap: 8px;
}

.agent-pane-row {
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.55);
}

.agent-pane-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-pane-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.agent-pane-line {
  margin: 6px 0 0;
}
```

- [ ] **Step 5: Run renderer tests and commit**

Run: `npm test -- tests/renderer.test.tsx`
Expected: PASS

```bash
printf 'feat: render claude pane notifications in the UI\n\nWhy:\n- Claude waiting states are only useful if the renderer presents them clearly.\n- The current UI language is Codex-specific and mislabels multi-agent panes.\n\nWhat:\n- render agent-neutral pane rows with an explicit agent badge\n- rename pane list styles and extend renderer coverage for Claude waiting states\n' > /tmp/seiton-claude-plan-task4.txt
but commit --message-file /tmp/seiton-claude-plan-task4.txt
```

### Task 5: Document Claude Hook Setup and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a failing documentation check by locating the stale Claude note**

```md
- Claude hook integration is not implemented yet.
```

- [ ] **Step 2: Verify the current README is stale**

Run: `rg -n "Claude hook integration is not implemented yet|Codex integration|seiton notify" README.md`
Expected: MATCHES show the stale Claude note and no documented `seiton notify` usage.

- [ ] **Step 3: Replace the Codex-only docs with Codex + Claude setup**

```md
## Agent integration

Seiton supports hook-driven status updates for both Codex and Claude.

The shared flow is:

```text
Agent hook -> seiton hook <agent> <event> -> tmux pane options -> Seiton UI polling
```

### Claude events

- `SessionStart`
- `UserPromptSubmit`
- `Notification`
- `Stop`
- `StopFailure`
- `PostToolUse`
- `SessionEnd`

### Manual notification

Use `seiton notify` inside a tmux pane when you need to raise a waiting state manually:

```bash
seiton notify "implementation finished"
```
```

- [ ] **Step 4: Run the full project verification suite**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit the documentation and verification pass**

```bash
printf 'docs: describe claude hook setup and manual notify\n\nWhy:\n- The README still claims Claude support is missing, which will mislead users after implementation.\n- Hook setup instructions need to match the shipped CLI behavior.\n\nWhat:\n- document Claude hook events and the shared Seiton hook flow\n- add manual notify usage and finish with test and build verification\n' > /tmp/seiton-claude-plan-task5.txt
but commit --message-file /tmp/seiton-claude-plan-task5.txt
```

## Self-Review

- Spec coverage: Claude `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`, `PostToolUse`, `SessionEnd`, and manual `seiton notify` each map to a concrete task above.
- Placeholder scan: no `TBD`, `TODO`, or “write tests later” style steps remain; each task names exact files, tests, and commands.
- Type consistency: the plan consistently uses `AgentPane`, `agentPanes`, and `agentPanesBySession` after Task 1 so later tasks do not mix old and new names.

Plan complete and saved to `docs/superpowers/plans/2026-04-26-claude-notifications.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
