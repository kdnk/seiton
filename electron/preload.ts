import { contextBridge, ipcRenderer } from "electron";
import type { ProjectContexts, SyncCommand, TerminalBackendName } from "../src/core/model";

export type SeitonState = {
  projectsWithContexts: ProjectContexts[];
  warnings: string[];
};

export type CliCommandStatus = {
  sourcePath: string;
  targetPath: string;
  installed: boolean;
  availableOnPath: boolean;
  targetDirOnPath: boolean;
  pathHint?: string;
};

export type SeitonSyncState = SeitonState & {
  commands: SyncCommand[];
};

export type SeitonSettings = {
  terminalBackend: TerminalBackendName;
};

const api = {
  refresh: () => ipcRenderer.invoke("seiton:refresh") as Promise<SeitonState>,
  sync: () => ipcRenderer.invoke("seiton:sync") as Promise<SeitonSyncState>,
  syncProject: (root: string) =>
    ipcRenderer.invoke("seiton:sync-project", root) as Promise<SeitonSyncState>,
  addProjectRoot: () =>
    ipcRenderer.invoke("seiton:add-project-root") as Promise<SeitonState>,
  removeProjectRoot: (root: string) =>
    ipcRenderer.invoke("seiton:remove-project-root", root) as Promise<SeitonState>,
  createWorkspaceSession: (projectRoot: string) =>
    ipcRenderer.invoke("seiton:create-workspace-session", projectRoot) as Promise<SeitonState>,
  focus: (projectRoot: string, branchKey: string, paneId?: string) =>
    ipcRenderer.invoke("seiton:focus", { projectRoot, branchKey, paneId }) as Promise<void>,
  focusWorkspaceSession: (projectRoot: string, paneId?: string) =>
    ipcRenderer.invoke("seiton:focus-workspace-session", { projectRoot, paneId }) as Promise<void>,
  renameContext: (payload: {
    contextId: string;
    projectRoot: string;
    branchId?: string;
    oldBranch: string;
    oldTmuxSession: string;
    oldTerminalTabTitle: string;
    newBranch: string;
  }) => ipcRenderer.invoke("seiton:rename-context", payload) as Promise<SeitonState>,
  removeOrphan: (projectRoot: string, tmuxSession: string, terminalTabTitle: string) =>
    ipcRenderer.invoke("seiton:remove-orphan", { projectRoot, tmuxSession, terminalTabTitle }) as Promise<SeitonState>,
  reorderProjects: (from: number, to: number) =>
    ipcRenderer.invoke("seiton:reorder-projects", { from, to }) as Promise<SeitonState>,
  reorderContexts: (projectRoot: string, from: number, to: number) =>
    ipcRenderer.invoke("seiton:reorder-contexts", { projectRoot, from, to }) as Promise<SeitonState>,
  getSettings: () =>
    ipcRenderer.invoke("seiton:get-settings") as Promise<SeitonSettings>,
  updateSettings: (input: Partial<SeitonSettings>) =>
    ipcRenderer.invoke("seiton:update-settings", input) as Promise<SeitonSettings>,
  getCliCommandStatus: () =>
    ipcRenderer.invoke("seiton:get-cli-command-status") as Promise<CliCommandStatus>,
  installCliCommand: () =>
    ipcRenderer.invoke("seiton:install-cli-command") as Promise<CliCommandStatus>,
  onStateUpdated: (listener: (state: SeitonState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: SeitonState) => {
      listener(state);
    };
    ipcRenderer.on("seiton:state-updated", wrapped);
    return () => {
      ipcRenderer.removeListener("seiton:state-updated", wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("seiton", api);

export type SeitonApi = typeof api;
