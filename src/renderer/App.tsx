import { useEffect, useRef, useState, type ReactNode } from "react";
import { Kbd, Theme, Tooltip } from "@radix-ui/themes";
import { FiPlus, FiRefreshCw, FiSettings, FiX } from "react-icons/fi";
import { createRoot } from "react-dom/client";
import { DndProvider, useDrag, useDragLayer, useDrop } from "react-dnd";
import { getEmptyImage, HTML5Backend } from "react-dnd-html5-backend";
import type { CliCommandStatus, SeitonSettings } from "../../electron/preload";
import type { AgentPane, Context, ProjectContexts, WorkspaceSession } from "../core/model";
import "@radix-ui/themes/styles.css";
import "./styles.css";

type ViewState = {
  projectsWithContexts: ProjectContexts[];
  warnings: string[];
};

type DropEdge = "before" | "after" | null;

type ProjectDragItem = {
  type: "project";
  index: number;
  name: string;
};

type ContextDragItem = {
  type: "context";
  index: number;
  projectRoot: string;
  branch: string;
  status: Context["status"];
};

const previewState: ViewState = {
  projectsWithContexts: [
    {
      project: {
        root: "/Users/kodai/workspaces/github.com/kdnk/seiton",
        name: "seiton",
        projectKey: "%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton",
        order: 10,
        enabled: true
      },
      workspaceSession: {
        type: "workspace",
        projectRoot: "/Users/kodai/workspaces/github.com/kdnk/seiton",
        name: "seiton",
        terminalTabTitle: "seiton",
        agentPanes: [],
        status: "ready"
      },
      contexts: [
        {
          id: "ctx-1",
          type: "managed",
          projectRoot: "/Users/kodai/workspaces/github.com/kdnk/seiton",
          branch: "feat/codex-hook-state",
          branchKey: "feat%2Fcodex-hook-state",
          tmuxSession: "s_seiton_feat%2Fcodex-hook-state",
          terminalTabTitle: "s_seiton_feat%2Fcodex-hook-state",
          agentPanes: [
            {
              agent: "codex",
              paneId: "%12",
              command: "codex",
              lastLine: "Reviewing hook state adapter",
              status: "running"
            }
          ],
          order: 10,
          status: "ready"
        },
        {
          id: "ctx-2",
          type: "managed",
          projectRoot: "/Users/kodai/workspaces/github.com/kdnk/seiton",
          branch: "chore/readme-refresh",
          branchKey: "chore%2Freadme-refresh",
          tmuxSession: "s_seiton_chore%2Freadme-refresh",
          terminalTabTitle: "s_seiton_chore%2Freadme-refresh",
          agentPanes: [
            {
              agent: "codex",
              paneId: "%18",
              command: "codex",
              lastLine: "Update CLI install docs",
              status: "idle"
            }
          ],
          order: 20,
          status: "missing_terminal"
        }
      ]
    },
    {
      project: {
        root: "/Users/kodai/workspaces/github.com/kdnk/git-butler-practice",
        name: "git-butler-practice",
        projectKey: "%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fgit-butler-practice",
        order: 20,
        enabled: true
      },
      workspaceSession: undefined,
      contexts: [
        {
          id: "ctx-3",
          type: "managed",
          projectRoot: "/Users/kodai/workspaces/github.com/kdnk/git-butler-practice",
          branch: "seiton-parser-test",
          branchKey: "seiton-parser-test",
          tmuxSession: "s_gbp_seiton-parser-test",
          terminalTabTitle: "s_gbp_seiton-parser-test",
          agentPanes: [
            {
              agent: "codex",
              paneId: "%21",
              command: "codex",
              lastLine: "Needs review on parser output",
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
};

const previewCliStatus: CliCommandStatus = {
  sourcePath: "/Users/kodai/workspaces/github.com/kdnk/seiton/dist-electron/cli.js",
  targetPath: "/Users/kodai/.local/bin/seiton",
  installed: true,
  availableOnPath: false,
  targetDirOnPath: false,
  pathHint: 'Add /Users/kodai/.local/bin to PATH, for example: export PATH="/Users/kodai/.local/bin:$PATH"'
};

export function App() {
  const previewMode = !window.seiton;
  const [state, setState] = useState<ViewState>({
    projectsWithContexts: [],
    warnings: []
  });
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string>("not synced");
  const [cliStatus, setCliStatus] = useState<CliCommandStatus | null>(null);
  const [settings, setSettings] = useState<SeitonSettings>({ terminalBackend: "kitty" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  function pushGlobalWarning(warning: string) {
    setState((current) => ({
      ...current,
      warnings: current.warnings.includes(warning) ? current.warnings : [warning, ...current.warnings]
    }));
  }

  function handleMissingHandler(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (!error.message.includes("No handler registered")) return false;
    pushGlobalWarning("Restart Seiton to load the latest backend actions.");
    return true;
  }

  useEffect(() => {
    void refresh();
    void refreshCliStatus();
    void refreshSettings();
  }, []);

  useEffect(() => {
    if (!window.seiton?.onStateUpdated) return;
    return window.seiton.onStateUpdated((next) => {
      setState(next);
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target;
      const inEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      const key = event.key.toLowerCase();
      if (key === "/" || (event.shiftKey && key === "?")) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (inEditable) return;
      if (key === "r") {
        event.preventDefault();
        void refresh();
      } else if (key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (key === "o") {
        event.preventDefault();
        void addProjectRoot();
      } else if (key === "s") {
        event.preventDefault();
        void sync();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy]);

  async function refresh() {
    if (!window.seiton) {
      setState(previewState);
      setLastSync("Sample data");
      return;
    }
    setBusy(true);
    setRefreshing(true);
    try {
      setState(await window.seiton.refresh());
    } finally {
      setRefreshing(false);
      setBusy(false);
    }
  }

  async function refreshCliStatus() {
    if (!window.seiton?.getCliCommandStatus) {
      setCliStatus(previewCliStatus);
      return;
    }
    setCliStatus(await window.seiton.getCliCommandStatus());
  }

  async function sync() {
    if (!window.seiton) return;
    setBusy(true);
    try {
      const next = await window.seiton.sync();
      setState(next);
      setLastSync(`${new Date().toLocaleTimeString()} / ${next.commands.length} commands`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSettings() {
    if (!window.seiton?.getSettings) {
      setSettings({ terminalBackend: "kitty" });
      return;
    }
    setSettings(await window.seiton.getSettings());
  }

  async function addProjectRoot() {
    if (!window.seiton) return;
    setBusy(true);
    try {
      setState(await window.seiton.addProjectRoot());
    } finally {
      setBusy(false);
    }
  }

  async function focusContext(context: Context) {
    if (!window.seiton) return;
    await window.seiton.focus(context.projectRoot, context.branchKey, context.primaryPaneId);
    await refresh();
  }

  async function focusWorkspaceSession(projectRoot: string, paneId?: string) {
    if (!window.seiton?.focusWorkspaceSession) return;
    await window.seiton.focusWorkspaceSession(projectRoot, paneId);
    await refresh();
  }

  async function focusPane(context: Context, pane: AgentPane) {
    if (!window.seiton) return;
    await window.seiton.focus(context.projectRoot, context.branchKey, pane.paneId);
    await refresh();
  }

  async function removeOrphan(context: Context) {
    if (!window.seiton) return;
    setBusy(true);
    try {
      setState(await window.seiton.removeOrphan(
        context.projectRoot,
        context.tmuxSession,
        readContextTerminalTabTitle(context)
      ));
    } finally {
      setBusy(false);
    }
  }

  async function renameContext(context: Context, newBranch: string) {
    if (!window.seiton) return;
    setBusy(true);
    try {
      const payload = {
        contextId: context.id,
        projectRoot: context.projectRoot,
        oldBranch: context.branch,
        oldTmuxSession: context.tmuxSession,
        oldTerminalTabTitle: readContextTerminalTabTitle(context),
        newBranch
      };
      setState(await window.seiton.renameContext(
        context.branchId ? { ...payload, branchId: context.branchId } : payload
      ));
    } finally {
      setBusy(false);
    }
  }

  async function removeProjectRoot(root: string) {
    if (!window.seiton?.removeProjectRoot) return;
    setBusy(true);
    try {
      setState(await window.seiton.removeProjectRoot(root));
    } catch (error) {
      if (!handleMissingHandler(error)) throw error;
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspaceSession(projectRoot: string) {
    if (!window.seiton?.createWorkspaceSession) return;
    setBusy(true);
    try {
      setState(await window.seiton.createWorkspaceSession(projectRoot));
    } finally {
      setBusy(false);
    }
  }

  async function moveProject(from: number, to: number) {
    if (!window.seiton || from === to) return;
    setState((current) => ({
      ...current,
      projectsWithContexts: reorderArray(current.projectsWithContexts, from, to)
    }));
    setBusy(true);
    try {
      setState(await window.seiton.reorderProjects(from, to));
    } finally {
      setBusy(false);
    }
  }

  async function moveContext(projectRoot: string, from: number, to: number) {
    if (!window.seiton || from === to) return;
    setState((current) => ({
      ...current,
      projectsWithContexts: current.projectsWithContexts.map((pc) =>
        pc.project.root === projectRoot
          ? { ...pc, contexts: reorderArray(pc.contexts, from, to) }
          : pc
      )
    }));
    setBusy(true);
    try {
      setState(await window.seiton.reorderContexts(projectRoot, from, to));
    } finally {
      setBusy(false);
    }
  }

  async function installCliCommand() {
    if (!window.seiton?.installCliCommand) return;
    setBusy(true);
    try {
      setCliStatus(await window.seiton.installCliCommand());
    } finally {
      setBusy(false);
    }
  }

  async function updateTerminalBackend(terminalBackend: SeitonSettings["terminalBackend"]) {
    if (!window.seiton?.updateSettings) {
      setSettings({ terminalBackend });
      return;
    }
    setSettings(await window.seiton.updateSettings({ terminalBackend }));
  }

  return (
    <Theme appearance="dark" hasBackground={false}>
      <DndProvider backend={HTML5Backend}>
        <main className="app-shell">
          <DragPreviewLayer />

          <header className="topbar">
            <div className="actions">
              <IconTooltipButton
                label="Add project"
                shortcut="⌘O"
                onClick={addProjectRoot}
                disabled={busy}
              >
                <FiPlus className="icon" size={15} aria-hidden="true" focusable="false" data-icon="add-project" />
              </IconTooltipButton>
              <IconTooltipButton
                label="Reload projects and contexts"
                ariaLabel="Reload"
                shortcut="⌘R"
                onClick={refresh}
                disabled={busy}
              >
                <FiRefreshCw
                  className={classNames("icon", refreshing && "spinning")}
                  size={15}
                  aria-hidden="true"
                  focusable="false"
                  data-icon="reload"
                />
              </IconTooltipButton>
              <IconTooltipButton
                label="Open settings"
                ariaLabel="Open settings"
                shortcut="⌘,"
                onClick={() => setSettingsOpen(true)}
                disabled={busy}
              >
                <FiSettings className="icon" size={15} aria-hidden="true" focusable="false" data-icon="settings" />
              </IconTooltipButton>
            </div>
          </header>

          <section className="workspace-frame">
            {state.warnings.length > 0 ? (
              <section className="panel warning-strip" aria-label="Warnings">
                <header>
                  <h2>Warnings</h2>
                  <span>{state.warnings.length}</span>
                </header>
                <div className="warnings-row">
                  {state.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="main-content">
              {state.projectsWithContexts.map((pc, projectIndex) => (
                <ProjectSection
                  key={pc.project.root}
                  projectWithContexts={pc}
                  projectIndex={projectIndex}
                  busy={busy}
                  onMoveProject={moveProject}
                  onMoveContext={moveContext}
                  onFocus={focusContext}
                  onFocusWorkspaceSession={focusWorkspaceSession}
                  onFocusPane={focusPane}
                  onRename={renameContext}
                  onRemoveOrphan={removeOrphan}
                  onCreateWorkspaceSession={createWorkspaceSession}
                  onRemoveProjectRoot={removeProjectRoot}
                />
              ))}
            </div>
          </section>

          {settingsOpen && cliStatus ? (
            <div
              className="modal-backdrop"
              onClick={() => setSettingsOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSettingsOpen(false);
              }}
              role="presentation"
            >
              <section
                className="panel settings-modal"
                aria-label="Settings"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2>Settings</h2>
                  <button
                    className="icon-button settings-close-button"
                    aria-label="Close settings"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <FiX className="icon" size={15} aria-hidden="true" focusable="false" data-icon="close" />
                  </button>
                </header>
                <div className="settings-body">
                  <div className="settings-copy settings-group">
                    <p className="settings-title">Terminal backend</p>
                    <p className="settings-text">
                      Choose the terminal Seiton controls for tab-focused workflows across all projects.
                    </p>
                    <div className="settings-radio-group" role="radiogroup" aria-label="Terminal backend">
                      <label className="settings-radio">
                        <input
                          type="radio"
                          name="terminal-backend"
                          checked={settings.terminalBackend === "kitty"}
                          onChange={() => void updateTerminalBackend("kitty")}
                        />
                        <span>kitty</span>
                      </label>
                      <label className="settings-radio">
                        <input
                          type="radio"
                          name="terminal-backend"
                          checked={settings.terminalBackend === "wezterm"}
                          onChange={() => void updateTerminalBackend("wezterm")}
                        />
                        <span>wezterm</span>
                      </label>
                    </div>
                  </div>
                  <div className="settings-copy">
                    <p className="settings-title">Install `seiton` in PATH</p>
                    <p className="settings-text">
                      {cliStatus.installed && cliStatus.availableOnPath
                        ? "`seiton` is ready to use from your shell."
                        : cliStatus.installed
                          ? "The command is installed, but the target directory is not on PATH yet."
                          : "Install a user-level `seiton` command for Codex hooks and shell usage."}
                    </p>
                    <div className="settings-meta">
                      <span>{cliStatus.targetPath}</span>
                      <span>{cliStatus.installed ? "installed" : "not installed"}</span>
                      <span>{cliStatus.targetDirOnPath ? "PATH ok" : "PATH missing"}</span>
                    </div>
                    {cliStatus.pathHint ? (
                      <p className="settings-hint">{cliStatus.pathHint}</p>
                    ) : null}
                  </div>
                  <div className="settings-actions">
                    <button onClick={refreshCliStatus} disabled={busy}>Refresh</button>
                    <button className="primary" onClick={installCliCommand} disabled={busy || previewMode}>
                      Install Command
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {shortcutsOpen ? (
            <div
              className="modal-backdrop"
              onClick={() => setShortcutsOpen(false)}
              role="presentation"
            >
              <section
                className="panel shortcuts-modal"
                aria-label="Keyboard shortcuts"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2>Shortcuts</h2>
                  <button
                    className="icon-button"
                    aria-label="Close shortcuts"
                    onClick={() => setShortcutsOpen(false)}
                  >
                    <FiX className="icon" size={15} aria-hidden="true" focusable="false" data-icon="close" />
                  </button>
                </header>
                <dl className="shortcuts-list">
                  <div className="shortcut-row">
                    <dt><kbd>⌘</kbd> <kbd>R</kbd></dt>
                    <dd>Reload</dd>
                  </div>
                  <div className="shortcut-row">
                    <dt><kbd>⌘</kbd> <kbd>,</kbd></dt>
                    <dd>Open settings</dd>
                  </div>
                  <div className="shortcut-row">
                    <dt><kbd>⌘</kbd> <kbd>O</kbd></dt>
                    <dd>Add project</dd>
                  </div>
                  <div className="shortcut-row">
                    <dt><kbd>⌘</kbd> <kbd>S</kbd></dt>
                    <dd>Apply</dd>
                  </div>
                  <div className="shortcut-row">
                    <dt><kbd>⌘</kbd> <kbd>/</kbd></dt>
                    <dd>Toggle this panel</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : null}
        </main>
      </DndProvider>
    </Theme>
  );
}

function IconTooltipButton({
  label,
  ariaLabel,
  shortcut,
  onClick,
  disabled,
  className,
  side = "bottom",
  children
}: {
  label: string;
  ariaLabel?: string;
  shortcut?: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}) {
  return (
    <Tooltip
      content={(
        <span className="icon-tooltip-content">
          <span>{label}</span>
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </span>
      )}
      delayDuration={0}
      side={side}
    >
      <button
        className={className ?? "icon-button"}
        aria-label={ariaLabel ?? label}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ProjectSection({
  projectWithContexts,
  projectIndex,
  busy,
  onMoveProject,
  onMoveContext,
  onFocus,
  onFocusWorkspaceSession,
  onFocusPane,
  onRename,
  onRemoveOrphan,
  onCreateWorkspaceSession,
  onRemoveProjectRoot
}: {
  projectWithContexts: ProjectContexts;
  projectIndex: number;
  busy: boolean;
  onMoveProject: (from: number, to: number) => void;
  onMoveContext: (projectRoot: string, from: number, to: number) => void;
  onFocus: (context: Context) => void;
  onFocusWorkspaceSession: (projectRoot: string, paneId?: string) => void;
  onFocusPane: (context: Context, pane: AgentPane) => void;
  onRename: (context: Context, newBranch: string) => void;
  onRemoveOrphan: (context: Context) => void;
  onCreateWorkspaceSession: (projectRoot: string) => void;
  onRemoveProjectRoot: (root: string) => void;
}) {
  const { project, workspaceSession, contexts } = projectWithContexts;
  const warnings = projectWithContexts.warnings ?? [];
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [dropEdge, setDropEdge] = useState<DropEdge>(null);

  const [{ isDragging }, drag, preview] = useDrag<ProjectDragItem, void, { isDragging: boolean }>(() => ({
    type: "project",
    item: {
      type: "project",
      index: projectIndex,
      name: project.name
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  }), [projectIndex, project.name]);

  const [{ isOver, canDrop }, drop] = useDrop<ProjectDragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: "project",
    canDrop: (item) => item.index !== projectIndex,
    hover: (_item, monitor) => {
      if (!sectionRef.current || !monitor.isOver({ shallow: true })) return;
      setDropEdge(getDropEdge(sectionRef.current, monitor.getClientOffset()?.y ?? null));
    },
    drop: (item, monitor) => {
      if (!sectionRef.current || monitor.didDrop()) return;
      const edge = getDropEdge(sectionRef.current, monitor.getClientOffset()?.y ?? null);
      const nextIndex = getReorderedIndex(item.index, projectIndex, edge);
      if (nextIndex !== item.index) onMoveProject(item.index, nextIndex);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop()
    })
  }), [onMoveProject, projectIndex]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  useEffect(() => {
    drag(handleRef);
  }, [drag]);

  useEffect(() => {
    drop(sectionRef);
  }, [drop]);

  useEffect(() => {
    if (!isOver) setDropEdge(null);
  }, [isOver]);

  return (
    <div
      ref={sectionRef}
      className={classNames(
        "project-slot",
        isDragging ? "dragging" : ""
      )}
    >
      <DropGutter visible={canDrop && isOver && dropEdge === "before"} />
      <section className="panel project-section">
        <header>
          <div className="project-header-main">
            <button
              ref={handleRef}
              className="drag-handle"
              aria-label={`Drag project ${project.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <DragHandleIcon />
            </button>
            <div className="project-header-copy">
              <h2>{project.name}</h2>
              <small className="project-path" title={project.root}>
                <bdo dir="ltr">{project.root}</bdo>
              </small>
            </div>
          </div>
          <div className="project-actions">
            <IconTooltipButton
              className="danger-icon"
              label={`Remove project ${project.name}`}
              ariaLabel={`Remove root ${project.name}`}
              side="left"
              onClick={() => onRemoveProjectRoot(project.root)}
              disabled={busy}
            >
              <FiX className="icon" size={15} aria-hidden="true" focusable="false" data-icon="close" />
            </IconTooltipButton>
          </div>
        </header>
        {warnings.length > 0 ? (
          <section className="project-warnings" aria-label={`Warnings for ${project.name}`}>
            <div className="warnings-row">
              {warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          </section>
        ) : (
          <div className="rows">
            <WorkspaceSessionSection
              projectRoot={project.root}
              workspaceSession={workspaceSession}
              busy={busy}
              onFocus={onFocusWorkspaceSession}
              onCreate={onCreateWorkspaceSession}
            />
            {contexts.length === 0 ? (
              <p className="empty-message">No managed contexts in this project.</p>
            ) : (
              contexts.map((context, index) => (
                <ContextRow
                  key={context.id}
                  context={context}
                  index={index}
                  busy={busy}
                  onFocus={() => onFocus(context)}
                  onFocusPane={(pane) => onFocusPane(context, pane)}
                  onRename={(newBranch) => onRename(context, newBranch)}
                  onRemoveOrphan={() => onRemoveOrphan(context)}
                  onMove={(from, to) => onMoveContext(project.root, from, to)}
                />
              ))
            )}
          </div>
        )}
      </section>
      <DropGutter visible={canDrop && isOver && dropEdge === "after"} />
    </div>
  );
}

function WorkspaceSessionSection({
  projectRoot,
  workspaceSession,
  busy,
  onFocus,
  onCreate
}: {
  projectRoot: string;
  workspaceSession: WorkspaceSession | undefined;
  busy: boolean;
  onFocus: (projectRoot: string, paneId?: string) => void;
  onCreate: (projectRoot: string) => void;
}) {
  const sessionName = workspaceSession?.name ?? projectRoot.split("/").filter(Boolean).at(-1) ?? projectRoot;

  return (
    <button
      type="button"
      className={classNames("context-row", "workspace-session-row", !workspaceSession && "workspace-session-missing")}
      aria-label={`Open workspace session ${sessionName}`}
      disabled={busy}
      onClick={() => {
        if (workspaceSession) {
          onFocus(projectRoot);
        } else {
          onCreate(projectRoot);
        }
      }}
    >
      <div className="context-stack">
        <div className="context-main">
          <div className="context-head">
            <span className="agent-pane-badge workspace-session-badge">Workspace Session</span>
            {workspaceSession && workspaceSession.status !== "ready" ? (
              <span className={`status ${workspaceSession.status}`}>{workspaceSession.status}</span>
            ) : null}
            <strong>{sessionName}</strong>
          </div>
        </div>
        {!workspaceSession ? (
          <p className="workspace-session-hint">No workspace session yet. Click to create one.</p>
        ) : workspaceSession.agentPanes.length > 0 ? (
          <div className="agent-pane-list">
            {workspaceSession.agentPanes.map((pane: AgentPane) => (
              <button
                key={pane.paneId}
                type="button"
                className="agent-pane-row"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onFocus(projectRoot, pane.paneId);
                }}
                aria-label={`Focus workspace pane ${pane.paneId}`}
              >
                <div className="agent-pane-main">
                  <span className="agent-pane-badge">{pane.agent}</span>
                  <span className={`status codex-status ${pane.status}`}>{pane.status}</span>
                  <strong>{pane.command}</strong>
                  <small>{pane.paneId}</small>
                </div>
                <p className="agent-pane-line">{pane.lastLine}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ContextRow({
  context,
  index,
  busy,
  onFocus,
  onFocusPane,
  onRename,
  onRemoveOrphan,
  onMove
}: {
  context: Context;
  index: number;
  busy: boolean;
  onFocus: () => void;
  onFocusPane: (pane: AgentPane) => void;
  onRename: (newBranch: string) => void;
  onRemoveOrphan: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [dropEdge, setDropEdge] = useState<DropEdge>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftBranch, setDraftBranch] = useState(context.branch);

  const [{ isDragging }, drag, preview] = useDrag<ContextDragItem, void, { isDragging: boolean }>(() => ({
    type: "context",
    item: {
      type: "context",
      index,
      projectRoot: context.projectRoot,
      branch: context.branch,
      status: context.status
    },
    canDrag: () => !isEditing,
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  }), [context.branch, context.projectRoot, context.status, index, isEditing]);

  const [{ isOver, canDrop }, drop] = useDrop<ContextDragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: "context",
    canDrop: (item) => item.projectRoot === context.projectRoot && item.index !== index,
    hover: (item, monitor) => {
      if (item.projectRoot !== context.projectRoot) return;
      if (!rowRef.current || !monitor.isOver({ shallow: true })) return;
      setDropEdge(getDropEdge(rowRef.current, monitor.getClientOffset()?.y ?? null));
    },
    drop: (item, monitor) => {
      if (item.projectRoot !== context.projectRoot) return;
      if (!rowRef.current || monitor.didDrop()) return;
      const edge = getDropEdge(rowRef.current, monitor.getClientOffset()?.y ?? null);
      const nextIndex = getReorderedIndex(item.index, index, edge);
      if (nextIndex !== item.index) onMove(item.index, nextIndex);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop()
    })
  }), [context.projectRoot, index, onMove]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  useEffect(() => {
    drag(handleRef);
  }, [drag, isEditing]);

  useEffect(() => {
    drop(rowRef);
  }, [drop]);

  useEffect(() => {
    if (!isOver) setDropEdge(null);
  }, [isOver]);

  useEffect(() => {
    setDraftBranch(context.branch);
    setIsEditing(false);
  }, [context.branch]);

  function submitRename() {
    const next = draftBranch.trim();
    if (next.length === 0 || next === context.branch) {
      setDraftBranch(context.branch);
      setIsEditing(false);
      return;
    }
    onRename(next);
    setIsEditing(false);
  }

  return (
    <div
      ref={rowRef}
      className={classNames(
        "context-slot",
        isDragging ? "dragging" : ""
      )}
    >
      <DropGutter visible={canDrop && isOver && dropEdge === "before"} />
      <div
        ref={handleRef}
        className="context-row"
        onClick={() => {
          if (busy || isEditing || context.status === "orphan_tmux") return;
          onFocus();
        }}
      >
        <div className="context-stack">
          <div className="context-main">
            <div className="context-head">
              {shouldRenderContextStatus(context.status) ? (
                <span className={`status ${context.status}`}>{context.status}</span>
              ) : null}
              {isEditing ? (
                <input
                  className="rename-input"
                  aria-label={`Rename ${context.branch}`}
                  autoFocus
                  value={draftBranch}
                  onChange={(event) => setDraftBranch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitRename();
                    if (event.key === "Escape") {
                      setDraftBranch(context.branch);
                      setIsEditing(false);
                    }
                  }}
                  onBlur={() => {
                    setDraftBranch(context.branch);
                    setIsEditing(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="branch-label"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (busy || context.status === "orphan_tmux") return;
                    setIsEditing(true);
                  }}
                  aria-label={`Rename ${context.branch}`}
                >
                  {context.branch}
                </button>
              )}
            </div>
            {context.status === "orphan_tmux" ? (
              <div className="context-actions">
                <button
                  className="danger-icon"
                  aria-label={`Remove orphan ${context.branch}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveOrphan();
                  }}
                >
                  <FiX className="icon" size={15} aria-hidden="true" focusable="false" data-icon="close" />
                </button>
              </div>
            ) : null}
          </div>
          {context.agentPanes.length > 0 ? (
            <div className="agent-pane-list">
              {context.agentPanes.map((pane) => (
                <button
                  key={pane.paneId}
                  type="button"
                  className="agent-pane-row"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFocusPane(pane);
                  }}
                  aria-label={`Focus pane ${pane.paneId}`}
                >
                  <div className="agent-pane-main">
                    <span className="agent-pane-badge">{pane.agent}</span>
                    <span className={`status codex-status ${pane.status}`}>{pane.status}</span>
                    {pane.command && pane.command !== pane.agent ? (
                      <strong>{pane.command}</strong>
                    ) : null}
                    <small>{pane.paneId}</small>
                  </div>
                  <p className="agent-pane-line" title={pane.lastLine}>
                    {pane.lastLine || "No recent output"}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <DropGutter visible={canDrop && isOver && dropEdge === "after"} />
    </div>
  );
}

function DropGutter({ visible }: { visible: boolean }) {
  return (
    <div className={classNames("drop-gutter", visible ? "visible" : "")} aria-hidden="true">
      <span className="drop-gutter-line" />
    </div>
  );
}

function DragPreviewLayer() {
  const { isDragging, itemType, item, offset } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging(),
    itemType: monitor.getItemType(),
    item: monitor.getItem() as ProjectDragItem | ContextDragItem | null,
    offset: monitor.getSourceClientOffset()
  }));

  if (!isDragging || !item || !offset) return null;

  return (
    <div className="drag-layer">
      <div
        className="drag-preview"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        {itemType === "project" ? (
          <div className="drag-preview-card drag-preview-project">
            <span className="drag-preview-kicker">Project</span>
            <strong>{(item as ProjectDragItem).name}</strong>
          </div>
        ) : (
          <div className="drag-preview-card drag-preview-context">
            {shouldRenderContextStatus((item as ContextDragItem).status) ? (
              <span className={`status ${(item as ContextDragItem).status}`}>
                {(item as ContextDragItem).status}
              </span>
            ) : null}
            <strong>{(item as ContextDragItem).branch}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function shouldRenderContextStatus(status: Context["status"]): boolean {
  return status === "orphan_tmux";
}

function getDropEdge(element: HTMLElement, clientY: number | null): DropEdge {
  if (clientY === null) return null;
  const rect = element.getBoundingClientRect();
  const halfway = rect.top + rect.height / 2;
  return clientY < halfway ? "before" : "after";
}

function getReorderedIndex(from: number, target: number, edge: DropEdge): number {
  const rawTarget = edge === "after" ? target + 1 : target;
  return from < rawTarget ? rawTarget - 1 : rawTarget;
}

function reorderArray<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const moved = next.splice(from, 1)[0]!;
  next.splice(to, 0, moved);
  return next;
}

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function readContextTerminalTabTitle(context: Context & { kittyTabTitle?: string }): string {
  return context.terminalTabTitle ?? context.kittyTabTitle ?? context.tmuxSession;
}

function DragHandleIcon() {
  return (
    <svg
      className="icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6" cy="3.5" r="1.3" />
      <circle cx="10" cy="3.5" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="12.5" r="1.3" />
      <circle cx="10" cy="12.5" r="1.3" />
    </svg>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
