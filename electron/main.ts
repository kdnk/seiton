import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySyncCommand, focusContext, readFullSystemSnapshot, readSystemSnapshotForCwd, removeOrphanContext, renameManagedContext } from "../src/core/commands";
import {
  buildBranchKey,
  buildManagedName,
  detectAllContexts,
  ensureProject,
  planSync,
  reconcileRegistry,
  type Branch,
  type Context,
  type ProjectContexts,
  type Registry,
  type RegistryProject,
  type SyncCommand
} from "../src/core/model";
import { loadRegistry, saveRegistry } from "../src/core/registry";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
let currentProjectRoot = process.env.SEITON_PROJECT_ROOT ?? process.cwd();

type AppState = {
  projectRoot: string;
  projectsWithContexts: ProjectContexts[];
  warnings: string[];
};

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "seiton",
    backgroundColor: "#101314",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    await win.loadFile(join(__dirname, "../dist/index.html"));
  }
}

// Helper to avoid redundant logic in IPC handlers
async function getFullState(): Promise<AppState> {
  const appData = app.getPath("userData");
  const projectRoot = currentProjectRoot;
  const loadedRegistry = await loadRegistry(appData);
  const registry = ensureProject({
    registry: loadedRegistry,
    root: projectRoot,
    now: new Date().toISOString()
  });
  if (JSON.stringify(registry) !== JSON.stringify(loadedRegistry)) {
    await saveRegistry(appData, registry);
  }
  const projectRoots = (registry.projects ?? []).map((p) => p.root);
  const snapshot = await readFullSystemSnapshot(projectRoots);
  return {
    projectRoot,
    projectsWithContexts: detectAllContexts(registry, snapshot),
    warnings: [
      ...snapshot.globalWarnings,
      ...Object.values(snapshot.projects).flatMap((p) => p.warnings)
    ]
  };
}

ipcMain.handle("seiton:refresh", async (): Promise<AppState> => {
  const appData = app.getPath("userData");
  const projectRoot = currentProjectRoot;
  const loadedRegistry = await loadRegistry(appData);

  const registryWithCurrent = ensureProject({
    registry: loadedRegistry,
    root: projectRoot,
    now: new Date().toISOString()
  });

  const projectRoots = (registryWithCurrent.projects ?? []).map((p) => p.root);
  const snapshot = await readFullSystemSnapshot(projectRoots);

  const registry = await reconcileAndPersistRegistry(
    appData,
    registryWithCurrent,
    snapshot.projects[projectRoot]?.branches ?? []
  );

  return {
    projectRoot,
    projectsWithContexts: detectAllContexts(registry, snapshot),
    warnings: [
      ...snapshot.globalWarnings,
      ...Object.values(snapshot.projects).flatMap((p) => p.warnings)
    ]
  };
});

ipcMain.handle("seiton:sync", async (): Promise<AppState & { commands: SyncCommand[] }> => {
  const appData = app.getPath("userData");
  const projectRoot = currentProjectRoot;
  const loadedRegistry = await loadRegistry(appData);
  const snapshot = await readSystemSnapshotForCwd(projectRoot);
  const registry = await reconcileAndPersistRegistry(appData, loadedRegistry, snapshot.branches);
  const plan = planSync({ ...snapshot, registry, projectRoot });
  const warnings = [...snapshot.warnings, ...plan.warnings];

  for (const command of plan.commands) {
    try {
      await applySyncCommand(command, projectRoot);
    } catch (error) {
      warnings.push(`${command.type} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (plan.registryUpdates.length > 0) {
    const nextRegistry = {
      ...registry,
      contexts: registry.contexts.map((context) => {
        const update = plan.registryUpdates.find((candidate) => candidate.id === context.id);
        return update ?? context;
      })
    };
    await saveRegistry(appData, nextRegistry);
  }

  return {
    ...(await getFullState()),
    commands: plan.commands,
    warnings: [...warnings, ...(await getFullState()).warnings]
  };
});

ipcMain.handle(
  "seiton:focus",
  async (_event, payload: { projectRoot: string; branchKey: string; paneId?: string }) => {
    await focusContext(payload.projectRoot, payload.branchKey, payload.paneId, payload.projectRoot);
  }
);

ipcMain.handle(
  "seiton:rename-context",
  async (
    _event,
    payload: {
      contextId: string;
      projectRoot: string;
      branchId?: string;
      oldBranch: string;
      oldTmuxSession: string;
      oldKittyTabTitle: string;
      newBranch: string;
    }
  ): Promise<AppState> => {
    const nextBranch = payload.newBranch.trim();
    if (nextBranch.length === 0) {
      throw new Error("Branch name cannot be empty");
    }
    if (nextBranch === payload.oldBranch) {
      return await getFullState();
    }

    const appData = app.getPath("userData");
    const registry = await loadRegistry(appData);
    const snapshot = await readSystemSnapshotForCwd(payload.projectRoot);
    const nextManagedName = buildManagedName(payload.projectRoot, nextBranch);

    if (snapshot.branches.some((branch) => branch.name === nextBranch && branch.name !== payload.oldBranch)) {
      throw new Error(`Branch already exists: ${nextBranch}`);
    }
    if (snapshot.tmuxSessions.includes(nextManagedName) && payload.oldTmuxSession !== nextManagedName) {
      throw new Error(`tmux session already exists: ${nextManagedName}`);
    }
    if (
      snapshot.kittyTabs.some((tab) => tab.title === nextManagedName) &&
      payload.oldKittyTabTitle !== nextManagedName
    ) {
      throw new Error(`kitty tab already exists: ${nextManagedName}`);
    }

    const renameInput = {
      projectRoot: payload.projectRoot,
      oldBranch: payload.oldBranch,
      newBranch: nextBranch,
      oldTmuxSession: payload.oldTmuxSession,
      oldKittyTabTitle: payload.oldKittyTabTitle
    };
    await renameManagedContext(
      payload.branchId ? { ...renameInput, branchId: payload.branchId } : renameInput,
      payload.projectRoot
    );

    const updatedAt = new Date().toISOString();
    const nextRegistry: Registry = {
      ...registry,
      contexts: registry.contexts.map((context) =>
        context.id === payload.contextId
          ? {
              ...context,
              branch: nextBranch,
              branchKey: buildBranchKey(nextBranch),
              tmuxSession: nextManagedName,
              kittyTabTitle: nextManagedName,
              updatedAt
            }
          : context
      )
    };
    await saveRegistry(appData, nextRegistry);

    return await getFullState();
  }
);

ipcMain.handle(
  "seiton:remove-orphan",
  async (
    _event,
    payload: { projectRoot: string; tmuxSession: string; kittyTabTitle: string }
  ): Promise<AppState> => {
    await removeOrphanContext(payload, payload.projectRoot);
    return await getFullState();
  }
);

ipcMain.handle("seiton:select-project-root", async (): Promise<AppState> => {
  const result = await dialog.showOpenDialog({
    title: "Select project directory",
    properties: ["openDirectory"]
  });
  if (!result.canceled && result.filePaths[0]) {
    currentProjectRoot = result.filePaths[0];
  }
  return await getFullState();
});

ipcMain.handle("seiton:select-registered-project", async (_event, root: string): Promise<AppState> => {
  currentProjectRoot = root;
  return await getFullState();
});

ipcMain.handle("seiton:reorder-projects", async (_event, { from, to }): Promise<AppState> => {
  const appData = app.getPath("userData");
  const registry = await loadRegistry(appData);
  const projects = [...(registry.projects ?? [])].sort((a, b) => a.order - b.order);
  const [item] = projects.splice(from, 1);
  if (item) {
    projects.splice(to, 0, item);
    projects.forEach((p, index) => {
      p.order = (index + 1) * 10;
    });
    await saveRegistry(appData, { ...registry, projects });
  }
  return await getFullState();
});

ipcMain.handle("seiton:reorder-contexts", async (_event, { projectRoot, from, to }): Promise<AppState> => {
  const appData = app.getPath("userData");
  const registry = await loadRegistry(appData);
  const contexts = [...registry.contexts].filter(c => c.projectRoot === projectRoot).sort((a, b) => a.order - b.order);
  const [item] = contexts.splice(from, 1);
  if (item) {
    contexts.splice(to, 0, item);
    contexts.forEach((c, index) => {
      c.order = (index + 1) * 10;
    });
    const otherContexts = registry.contexts.filter(c => c.projectRoot !== projectRoot);
    await saveRegistry(appData, { ...registry, contexts: [...otherContexts, ...contexts] });
  }
  return await getFullState();
});

async function reconcileAndPersistRegistry(
  appData: string,
  registry: Registry,
  branches: Branch[]
): Promise<Registry> {
  const registryWithProject = ensureProject({
    registry,
    root: currentProjectRoot,
    now: new Date().toISOString()
  });
  const next = reconcileRegistry({
    projectRoot: currentProjectRoot,
    branches,
    registry: registryWithProject,
    now: new Date().toISOString()
  });
  if (JSON.stringify(next) !== JSON.stringify(registry)) {
    await saveRegistry(appData, next);
  }
  return next;
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
