# Terminal Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global terminal backend setting so Seiton can drive either `kitty` or `wezterm` through one abstract terminal-tab layer.

**Architecture:** Replace `kitty`-specific model and command concepts with terminal-generic names, persist a global `terminalBackend` setting in the registry, and route terminal operations through backend implementations selected by that setting. Keep tmux orchestration in `commands.ts`, move terminal CLI details into backend modules, and expose the new setting through Electron IPC and the Settings modal.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest

---

### Task 1: Add registry settings and terminal-generic model names

**Files:**
- Modify: `src/core/model.ts`
- Modify: `src/core/registry.ts`
- Test: `tests/registry.test.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("loads a legacy registry and defaults the terminal backend to kitty", async () => {
  await writeFile(
    registryPath(tmpDir),
    JSON.stringify({
      projects: [{ root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true }],
      contexts: [
        {
          id: "ctx-1",
          projectRoot: "/repo/a",
          branch: "feature/a",
          branchKey: "feature%2Fa",
          tmuxSession: "s_a_feature%2Fa",
          kittyTabTitle: "s_a_feature%2Fa",
          order: 10,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z"
        }
      ]
    })
  );

  const registry = await loadRegistry(tmpDir);

  expect(registry.settings?.terminalBackend).toBe("kitty");
  expect(registry.contexts[0]?.terminalTabTitle).toBe("s_a_feature%2Fa");
});

it("plans generic terminal commands and missing_terminal status", () => {
  const contexts = detectContexts({
    projectRoot: "/repo/a",
    branches: [{ name: "feature/a" }],
    tmuxSessions: ["s_a_feature%2Fa"],
    terminalTabs: [],
    agentPanesBySession: {},
    registry: {
      settings: { terminalBackend: "kitty" },
      projects: [{ root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true }],
      contexts: [
        {
          id: "ctx-1",
          projectRoot: "/repo/a",
          branch: "feature/a",
          branchKey: "feature%2Fa",
          tmuxSession: "s_a_feature%2Fa",
          terminalTabTitle: "s_a_feature%2Fa",
          order: 10,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z"
        }
      ]
    }
  });

  expect(contexts[0]?.status).toBe("missing_terminal");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/registry.test.ts tests/core.test.ts`
Expected: FAIL because `settings`, `terminalTabTitle`, `terminalTabs`, and `missing_terminal` are not implemented yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type TerminalBackendName = "kitty" | "wezterm";

export type RegistrySettings = {
  terminalBackend: TerminalBackendName;
};

export type RegistryContext = {
  // ...
  terminalTabTitle: string;
};

export type Registry = {
  settings?: RegistrySettings;
  projects?: RegistryProject[];
  contexts: RegistryContext[];
};

export async function loadRegistry(appDataDir: string): Promise<Registry> {
  // map legacy kittyTabTitle -> terminalTabTitle
  // default settings.terminalBackend to "kitty"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/registry.test.ts tests/core.test.ts`
Expected: PASS for the new registry/model assertions.

- [ ] **Step 5: Commit**

```bash
but status -fv
but commit wez -m "refactor(model): add terminal backend settings" --status-after
```

### Task 2: Introduce terminal backend modules and backend-aware command execution

**Files:**
- Create: `src/core/terminal-backend.ts`
- Create: `src/core/terminal-backends/kitty.ts`
- Create: `src/core/terminal-backends/wezterm.ts`
- Modify: `src/core/commands.ts`
- Modify: `electron/main.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("creates a missing terminal tab during focus for the selected kitty backend", async () => {
  const run = vi.fn(async (file: string, args: string[]) => {
    if (file === "kitty" && args[1] === "focus-tab") {
      throw new Error("No matching tabs for expression");
    }
    return { stdout: "", stderr: "" };
  });

  await focusContext(
    "/repo/a",
    "feature%2Fnotify-ui",
    undefined,
    "/repo/a",
    run,
    kittyBackend
  );

  expect(run).toHaveBeenCalledWith(
    "kitty",
    ["@", "launch", "--type=tab", "--tab-title", "s_a_feature%2Fnotify-ui", "tmux", "new-session", "-A", "-s", "s_a_feature%2Fnotify-ui"],
    "/repo/a"
  );
});

it("creates and focuses a wezterm tab through the selected backend", async () => {
  const run = vi.fn(async (file: string, args: string[]) => {
    if (file === "wezterm" && args[0] === "cli" && args[1] === "list") {
      return { stdout: "[]", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });

  await createWorkspaceSession("/repo/a", "/repo/a", run, weztermBackend);

  expect(run).toHaveBeenCalledWith(
    "wezterm",
    expect.arrayContaining(["cli"]),
    "/repo/a"
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core.test.ts`
Expected: FAIL because backend modules and backend-aware signatures do not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type TerminalBackend = {
  name: "kitty" | "wezterm";
  listTabs(cwd: string, run?: ExecFunction): Promise<CommandResult<TerminalTab[]>>;
  ensureTab(input: { title: string; tmuxSession: string; cwd: string; run: ExecFunction }): Promise<void>;
  focusTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  renameTab(oldTitle: string, newTitle: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabBackward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabForward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  closeTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  resolveTargetTmuxClientTty(title: string, cwd: string, run: ExecFunction): Promise<string | undefined>;
  isUnavailableError(error: unknown): boolean;
  isMissingTabError(error: unknown): boolean;
};

export function getTerminalBackend(name: TerminalBackendName): TerminalBackend {
  return name === "wezterm" ? weztermBackend : kittyBackend;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core.test.ts`
Expected: PASS for backend selection and command execution behavior.

- [ ] **Step 5: Commit**

```bash
but status -fv
but commit wez -m "refactor(commands): abstract terminal backends" --status-after
```

### Task 3: Expose terminal backend settings through preload, main, and renderer

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the terminal backend setting and saves wezterm selection", async () => {
  const getSettings = vi.fn().mockResolvedValue({ terminalBackend: "kitty" });
  const updateSettings = vi.fn().mockResolvedValue({ terminalBackend: "wezterm" });

  window.seiton = {
    refresh: vi.fn().mockResolvedValue({ projectsWithContexts: [], warnings: [] }),
    sync: vi.fn(),
    addProjectRoot: vi.fn(),
    focus: vi.fn(),
    renameContext: vi.fn(),
    reorderProjects: vi.fn(),
    reorderContexts: vi.fn(),
    removeOrphan: vi.fn(),
    getCliCommandStatus: vi.fn().mockResolvedValue(null),
    installCliCommand: vi.fn(),
    getSettings,
    updateSettings
  } as never;

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("radio", { name: "wezterm" }));

  await waitFor(() => {
    expect(updateSettings).toHaveBeenCalledWith({ terminalBackend: "wezterm" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer.test.tsx`
Expected: FAIL because settings APIs and terminal backend controls are not rendered yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
const api = {
  // ...
  getSettings: () => ipcRenderer.invoke("seiton:get-settings") as Promise<SeitonSettings>,
  updateSettings: (input: Partial<SeitonSettings>) =>
    ipcRenderer.invoke("seiton:update-settings", input) as Promise<SeitonSettings>
};
```

```tsx
const [settings, setSettings] = useState<SeitonSettings>({ terminalBackend: "kitty" });

<fieldset className="settings-group">
  <legend>Terminal backend</legend>
  <label><input type="radio" checked={settings.terminalBackend === "kitty"} />kitty</label>
  <label><input type="radio" checked={settings.terminalBackend === "wezterm"} />wezterm</label>
</fieldset>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer.test.tsx`
Expected: PASS for settings modal selection and persistence behavior.

- [ ] **Step 5: Commit**

```bash
but status -fv
but commit wez -m "feat(settings): add terminal backend selector" --status-after
```

### Task 4: Update remaining terminology, warnings, and full verification

**Files:**
- Modify: `README.md`
- Modify: `src/core/model.ts`
- Modify: `src/core/commands.ts`
- Modify: `tests/core.test.ts`
- Modify: `tests/renderer.test.tsx`
- Modify: `tests/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("surfaces missing_terminal instead of missing_kitty", () => {
  const session = detectWorkspaceSession({
    projectRoot: "/repo/a",
    tmuxSessions: ["a"],
    terminalTabs: [],
    agentPanesBySession: {}
  });

  expect(session?.status).toBe("missing_terminal");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx tests/registry.test.ts`
Expected: FAIL until all `kitty`-specific type names and visible copy are updated.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type ContextStatus =
  | "ready"
  | "missing_tmux"
  | "missing_terminal"
  | "orphan_tmux"
  | "order_drift"
  | "rename_pending"
  | "rename_conflict"
  | "error";
```

```md
- The app is currently optimized for `kitty + tmux + GitButler`.
+ The app currently supports `kitty` and `wezterm` for terminal-tab automation, alongside `tmux` and GitButler.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx tests/registry.test.ts`
Expected: PASS with terminal-generic naming throughout the app.

- [ ] **Step 5: Commit**

```bash
but status -fv
but commit wez -m "docs: update terminal backend terminology" --status-after
```

### Task 5: Run final verification

**Files:**
- Test: `tests/core.test.ts`
- Test: `tests/renderer.test.tsx`
- Test: `tests/registry.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx tests/registry.test.ts`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS
