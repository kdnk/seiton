# Claude Pane Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect live Claude tmux panes even without Claude hooks, while preserving hook-derived `waiting` and `error` states when they exist.

**Architecture:** Extend `src/core/commands.ts` with a Claude-specific runtime parser that inspects tmux pane command metadata and recent pane text, then merge those runtime entries with the existing hook-backed pane entries by `paneId`. Keep the renderer contract unchanged so runtime-detected Claude panes flow through the existing `agentPanes` UI.

**Tech Stack:** TypeScript, Electron, Vitest, React Testing Library, tmux/kitty integration helpers in `src/core/commands.ts`

---

### Task 1: Add a failing core test for Claude runtime detection without hooks

**Files:**
- Modify: `tests/core.test.ts`
- Modify: `src/core/commands.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("detects a live claude pane from runtime state without tmux options", async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === "show-options" && args.includes("@seiton_agent")) return { stdout: "", stderr: "" };
      if (args[0] === "capture-pane") {
        return {
          stdout: [
            " Claude Code",
            "",
            " /help for help",
            " > Summarize the failing tests"
          ].join("\n"),
          stderr: ""
        };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await readAgentPanesFromTmux(
      "s_a_feature%2Fclaude\t%21\tclaude\tclaude\n",
      "/repo",
      run
    );

    expect(result).toEqual({
      "s_a_feature%2Fclaude": [
        {
          agent: "claude",
          paneId: "%21",
          command: "claude",
          lastLine: "> Summarize the failing tests",
          status: "idle"
        }
      ]
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core.test.ts -t "detects a live claude pane from runtime state without tmux options"`
Expected: FAIL because Claude runtime panes are not currently returned without hook metadata.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function parseTmuxClaudePanes(
  stdout: string,
  cwd: string,
  run: ExecFunction
): Promise<Record<string, AgentPane[]>> {
  // Parse pane candidates, capture pane text, detect live Claude panes,
  // and infer idle/running from recent output.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core.test.ts -t "detects a live claude pane from runtime state without tmux options"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit <branch> -m "test(core): cover Claude runtime pane detection" --changes <id> --status-after
```

### Task 2: Preserve hook-backed Claude states over runtime-derived entries

**Files:**
- Modify: `tests/core.test.ts`
- Modify: `src/core/commands.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("prefers hook-backed claude pane state over runtime-derived state", async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === "show-options" && args.includes("@seiton_agent")) return { stdout: "claude\n", stderr: "" };
      if (args[0] === "show-options" && args.includes("@seiton_status")) return { stdout: "waiting\n", stderr: "" };
      if (args[0] === "show-options" && args.includes("@seiton_prompt")) {
        return { stdout: "Need confirmation before deploy\n", stderr: "" };
      }
      if (args[0] === "capture-pane") {
        return { stdout: ["Claude Code", "", "> continue"].join("\n"), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await readAgentPanesFromTmux(
      "s_a_feature%2Fclaude\t%21\tclaude\tclaude\n",
      "/repo",
      run
    );

    expect(result["s_a_feature%2Fclaude"]?.[0]).toMatchObject({
      status: "waiting",
      lastLine: "Need confirmation before deploy"
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core.test.ts -t "prefers hook-backed claude pane state over runtime-derived state"`
Expected: FAIL if runtime parsing replaces or degrades the hook-backed entry.

- [ ] **Step 3: Write minimal implementation**

```ts
async function readAgentPanes(...) {
  const optionBacked = await readAgentPanesFromTmuxOptions(stdout, cwd, run);
  const codexRuntime = await parseTmuxCodexPanes(stdout, cwd, run);
  const claudeRuntime = await parseTmuxClaudePanes(stdout, cwd, run);
  return mergeAgentPaneMaps(optionBacked, mergeAgentPaneMaps(codexRuntime, claudeRuntime));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core.test.ts -t "prefers hook-backed claude pane state over runtime-derived state"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit <branch> -m "fix(core): prefer Claude hook state over runtime fallback" --changes <id> --status-after
```

### Task 3: Cover renderer behavior and run targeted verification

**Files:**
- Modify: `tests/renderer.test.tsx`
- Test: `tests/renderer.test.tsx`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing renderer test**

```ts
  it("renders a runtime-detected claude pane without hook metadata", async () => {
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
                branch: "feature/claude-runtime",
                branchKey: "feature%2Fclaude-runtime",
                tmuxSession: "s_a_feature%2Fclaude-runtime",
                kittyTabTitle: "s_a_feature%2Fclaude-runtime",
                agentPanes: [
                  {
                    agent: "claude",
                    paneId: "%21",
                    command: "claude",
                    lastLine: "> Summarize the failing tests",
                    status: "idle"
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
      // existing test doubles omitted for brevity
    } as never;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer.test.tsx -t "renders a runtime-detected claude pane without hook metadata"`
Expected: FAIL until the test fixture and expectations are wired correctly.

- [ ] **Step 3: Finish implementation and test coverage**

```ts
// Keep renderer production code unchanged; only extend test coverage
// after the core detection path is in place.
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/core.test.ts -t "claude"`
Expected: PASS

Run: `npm test -- tests/renderer.test.tsx -t "claude"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit <branch> -m "test(renderer): cover Claude runtime pane visibility" --changes <id> --status-after
```

### Task 4: Run the relevant suite and prepare branch completion

**Files:**
- Modify: `src/core/commands.ts`
- Modify: `tests/core.test.ts`
- Modify: `tests/renderer.test.tsx`

- [ ] **Step 1: Run the full targeted suite**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx`
Expected: PASS

- [ ] **Step 2: Inspect final diff**

Run: `but status -fv`
Expected: only the intended implementation files remain assigned to the branch, with no unrelated leftovers.

- [ ] **Step 3: Commit any remaining implementation changes**

```bash
but commit <branch> -m "feat(core): detect live Claude panes from tmux runtime" --changes <id>,<id> --status-after
```

- [ ] **Step 4: Prepare completion handoff**

Run: `git show --stat --oneline -1`
Expected: a concise summary of the final implementation commit for reporting.
