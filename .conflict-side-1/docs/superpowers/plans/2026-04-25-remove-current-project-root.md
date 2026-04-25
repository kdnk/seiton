# Remove `currentProjectRoot` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hidden single-project selection model and make Seiton operate purely on the full registered project list, with top-level sync applying to all projects.

**Architecture:** Replace module-level current-root state in the Electron main process with registry-driven state assembly. Rename the directory-picker IPC to additive project registration, remove project selection IPC, and make top-level sync iterate every registered project in order. Update the renderer to consume the simpler API and keep tests centered on explicit project roots rather than hidden selection.

**Tech Stack:** Electron IPC, TypeScript, Vite/React renderer, Vitest

---

### Task 1: Rename additive project registration IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Write the failing renderer contract test**

Add or update a renderer test so the app calls `addProjectRoot` instead of `selectProjectRoot` when the top bar button is clicked.

```ts
it("adds a project root through the additive IPC", async () => {
  const addProjectRoot = vi.fn().mockResolvedValue({
    projectRoot: "",
    projectsWithContexts: [],
    warnings: []
  });
  window.seiton = {
    refresh: vi.fn().mockResolvedValue({
      projectRoot: "",
      projectsWithContexts: [],
      warnings: []
    }),
    sync: vi.fn(),
    addProjectRoot,
    focus: vi.fn(),
    renameContext: vi.fn(),
    reorderProjects: vi.fn(),
    reorderContexts: vi.fn(),
    removeOrphan: vi.fn(),
    getCliCommandStatus: vi.fn().mockResolvedValue(null),
    installCliCommand: vi.fn(),
    onStateUpdated: () => () => {}
  } as never;

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Add root" }));

  await waitFor(() => {
    expect(addProjectRoot).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer.test.tsx`
Expected: FAIL because the renderer still calls `selectProjectRoot`.

- [ ] **Step 3: Implement the renamed additive IPC**

Update the preload contract and renderer button handler to use `addProjectRoot`, and rename the Electron handler from `seiton:select-project-root` to `seiton:add-project-root`.

```ts
// electron/preload.ts
addProjectRoot: () =>
  ipcRenderer.invoke("seiton:add-project-root") as Promise<SeitonState>,

// src/renderer/App.tsx
async function addProjectRoot() {
  if (!window.seiton) return;
  setBusy(true);
  try {
    setState(await window.seiton.addProjectRoot());
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit feat/seiton-electron-manager -m "refactor(app): rename additive project IPC" --changes <ids> --status-after
```

### Task 2: Remove module-level current-root state from Electron

**Files:**
- Modify: `electron/main.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing state-assembly test**

Add a focused test around the main-process state assembly helper behavior via extracted helper(s): refreshing should read all registered project roots from the registry and should not depend on any mutable selected-root value.

```ts
it("builds full state from every registered project", async () => {
  const registry = {
    projects: [
      { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
      { root: "/repo/b", name: "b", projectKey: "%2Frepo%2Fb", order: 20, enabled: true }
    ],
    contexts: []
  };

  // Assert the helper requests both project roots and returns both groups.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core.test.ts`
Expected: FAIL because `electron/main.ts` still relies on `currentProjectRoot`.

- [ ] **Step 3: Implement registry-driven state assembly**

Remove `currentProjectRoot` and update `getFullState()` plus helper functions to:

- load the registry
- ensure only explicitly added projects are used
- call `readFullSystemSnapshot()` with all registered roots
- return a state object whose `projectRoot` field is empty or derived-free compatibility data

```ts
const projectRoots = (registry.projects ?? []).map((p) => p.root);
const snapshot = await readFullSystemSnapshot(projectRoots);
return {
  projectRoot: "",
  projectsWithContexts: detectAllContexts(registry, snapshot),
  warnings: [...]
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit feat/seiton-electron-manager -m "refactor(app): remove selected project runtime state" --changes <ids> --status-after
```

### Task 3: Make top-level sync operate on all registered projects

**Files:**
- Modify: `electron/main.ts`
- Test: `tests/core.test.ts`

- [ ] **Step 1: Write the failing sync-all test**

Add a test that verifies top-level sync iterates all registered projects and continues after one project warning.

```ts
it("syncs every registered project from the top-level action", async () => {
  // Arrange two projects in registry order.
  // Assert both roots are processed and warnings are accumulated.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core.test.ts`
Expected: FAIL because the existing top-level sync still targets a single project.

- [ ] **Step 3: Implement multi-project sync**

Refactor top-level sync into an explicit loop:

```ts
for (const project of projects) {
  const snapshot = await readSystemSnapshotForCwd(project.root);
  const nextRegistry = await reconcileRegistryForRoot(appData, registry, project.root, snapshot.branches);
  const plan = planSync({ ...snapshot, registry: nextRegistry, projectRoot: project.root });
  // execute commands, collect warnings, persist updates
}
```

Keep per-project sync as a separate explicit-root path used by project row actions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit feat/seiton-electron-manager -m "feat(app): sync all registered projects" --changes <ids> --status-after
```

### Task 4: Remove project-selection IPC and renderer dependencies

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/App.tsx`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Write the failing renderer interaction test**

Add or update a test so project row `Sync` directly calls a dedicated per-project sync IPC instead of selection followed by top-level sync.

```ts
it("syncs a single project without selecting it first", async () => {
  const syncProject = vi.fn().mockResolvedValue({
    projectRoot: "",
    projectsWithContexts: [],
    warnings: []
  });
  window.seiton = {
    refresh: vi.fn().mockResolvedValue(/* state */),
    sync: vi.fn(),
    syncProject,
    addProjectRoot: vi.fn(),
    // ...
  } as never;

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Sync" }));

  await waitFor(() => {
    expect(syncProject).toHaveBeenCalledWith("/repo/a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer.test.tsx`
Expected: FAIL because project sync still goes through `selectRegisteredProject`.

- [ ] **Step 3: Implement explicit per-project sync and remove selection IPC**

Add a `seiton:sync-project` handler and remove `seiton:select-registered-project` from main/preload/renderer.

```ts
// electron/preload.ts
syncProject: (root: string) =>
  ipcRenderer.invoke("seiton:sync-project", root) as Promise<SeitonSyncState>,

// src/renderer/App.tsx
const next = await window.seiton.syncProject(root);
setState(next);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
but commit feat/seiton-electron-manager -m "refactor(app): remove project selection IPC" --changes <ids> --status-after
```

### Task 5: Finish compatibility, docs, and full verification

**Files:**
- Modify: `README.md`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/core.test.ts`
- Test: `tests/renderer.test.tsx`

- [ ] **Step 1: Write the failing documentation and API coverage checks**

Add/update tests so the mocked API shape matches the final renderer contract:

```ts
window.seiton = {
  refresh: vi.fn(),
  sync: vi.fn(),
  syncProject: vi.fn(),
  addProjectRoot: vi.fn(),
  onStateUpdated: () => () => {},
  // no selectRegisteredProject / no selectProjectRoot
} as never;
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npm test -- tests/core.test.ts tests/renderer.test.tsx`
Expected: FAIL until every mock and contract is updated.

- [ ] **Step 3: Update docs and final API surface**

Refresh the README wording:

- `Add root` adds a project to the workspace
- top-level `Apply` syncs all projects
- per-project `Sync` affects only that project
- no selected project concept remains

- [ ] **Step 4: Run full verification**

Run: `npm test`
Expected: `37 passed` or higher with no failures

Run: `npm run build`
Expected: successful renderer, Electron, and CLI builds

- [ ] **Step 5: Commit**

```bash
but commit feat/seiton-electron-manager -m "docs(app): align workspace model with multi-project sync" --changes <ids> --status-after
```

## Self-Review

- Spec coverage: covered additive project registration, no selected root, sync-all, explicit per-project sync, IPC updates, renderer updates, tests, and docs.
- Placeholder scan: every task includes explicit files, commands, and concrete code shapes.
- Type consistency: final API uses `addProjectRoot` and `syncProject`; no later task reintroduces selection-oriented naming.
