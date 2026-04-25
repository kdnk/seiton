import { contextBridge, ipcRenderer } from "electron";
import type { Context, ProjectContexts, RegistryProject, SyncCommand } from "../src/core/model";

export type SeitonState = {
  projectRoot: string;
  projectsWithContexts: ProjectContexts[];
  warnings: string[];
};

export type SeitonSyncState = SeitonState & {
  commands: SyncCommand[];
};

const api = {
  refresh: () => ipcRenderer.invoke("seiton:refresh") as Promise<SeitonState>,
  sync: () => ipcRenderer.invoke("seiton:sync") as Promise<SeitonSyncState>,
  selectProjectRoot: () =>
    ipcRenderer.invoke("seiton:select-project-root") as Promise<SeitonState>,
  selectRegisteredProject: (root: string) =>
    ipcRenderer.invoke("seiton:select-registered-project", root) as Promise<SeitonState>,
  focus: (projectRoot: string, branchKey: string, paneId?: string) =>
    ipcRenderer.invoke("seiton:focus", { projectRoot, branchKey, paneId }) as Promise<void>,
  renameContext: (payload: {
    contextId: string;
    projectRoot: string;
    branchId?: string;
    oldBranch: string;
    oldTmuxSession: string;
    oldKittyTabTitle: string;
    newBranch: string;
  }) => ipcRenderer.invoke("seiton:rename-context", payload) as Promise<SeitonState>,
  removeOrphan: (projectRoot: string, tmuxSession: string, kittyTabTitle: string) =>
    ipcRenderer.invoke("seiton:remove-orphan", { projectRoot, tmuxSession, kittyTabTitle }) as Promise<SeitonState>,
  reorderProjects: (from: number, to: number) =>
    ipcRenderer.invoke("seiton:reorder-projects", { from, to }) as Promise<SeitonState>,
  reorderContexts: (projectRoot: string, from: number, to: number) =>
    ipcRenderer.invoke("seiton:reorder-contexts", { projectRoot, from, to }) as Promise<SeitonState>
};

contextBridge.exposeInMainWorld("seiton", api);

export type SeitonApi = typeof api;
