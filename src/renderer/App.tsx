import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DndProvider, useDrag, useDragLayer, useDrop } from "react-dnd";
import { getEmptyImage, HTML5Backend } from "react-dnd-html5-backend";
import type { CliCommandStatus } from "../../electron/preload";
import type { CodexPane, Context, ProjectContexts } from "../core/model";
import "./styles.css";

type ViewState = {
  projectRoot: string;
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
  projectRoot: "/Users/kodai/workspaces/github.com/kdnk/seiton",
  projectsWithContexts: [
    {
      project: {
        root: "/Users/kodai/workspaces/github.com/kdnk/seiton",
        name: "seiton",
        projectKey: "%2FUsers%2Fkodai%2Fworkspaces%2Fgithub.com%2Fkdnk%2Fseiton",
        order: 10,
        enabled: true
      },
      contexts: [
        {
          id: "ctx-1",
          type: "managed",
          projectRoot: "/Users/kodai/workspaces/github.com/kdnk/seiton",
          branch: "feat/codex-hook-state",
          branchKey: "feat%2Fcodex-hook-state",
          tmuxSession: "s_seiton_feat%2Fcodex-hook-state",
          kittyTabTitle: "s_seiton_feat%2Fcodex-hook-state",
          codexPanes: [
            {
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
          kittyTabTitle: "s_seiton_chore%2Freadme-refresh",
          codexPanes: [
            {
              paneId: "%18",
              command: "codex",
              lastLine: "Update CLI install docs",
              status: "idle"
            }
          ],
          order: 20,
          status: "missing_kitty"
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
      contexts: [
        {
          id: "ctx-3",
          type: "managed",
          projectRoot: "/Users/kodai/workspaces/github.com/kdnk/git-butler-practice",
          branch: "seiton-parser-test",
          branchKey: "seiton-parser-test",
          tmuxSession: "s_gbp_seiton-parser-test",
          kittyTabTitle: "s_gbp_seiton-parser-test",
          codexPanes: [
            {
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
    projectRoot: "",
    projectsWithContexts: [],
    warnings: []
  });
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string>("not synced");
  const [cliStatus, setCliStatus] = useState<CliCommandStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void refresh();
    void refreshCliStatus();
  }, []);

  async function refresh() {
    if (!window.seiton) {
      setState(previewState);
      setLastSync("Sample data");
      return;
    }
    setBusy(true);
    try {
      setState(await window.seiton.refresh());
    } finally {
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

  async function selectProjectRoot() {
    if (!window.seiton) return;
    setBusy(true);
    try {
      setState(await window.seiton.selectProjectRoot());
    } finally {
      setBusy(false);
    }
  }

  async function focus(context: Context) {
    if (!window.seiton) return;
    await window.seiton.focus(context.projectRoot, context.branchKey, context.primaryPaneId);
  }

  async function focusPane(context: Context, pane: CodexPane) {
    if (!window.seiton) return;
    await window.seiton.focus(context.projectRoot, context.branchKey, pane.paneId);
  }

  async function removeOrphan(context: Context) {
    if (!window.seiton) return;
    setBusy(true);
    try {
      setState(await window.seiton.removeOrphan(
        context.projectRoot,
        context.tmuxSession,
        context.kittyTabTitle
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
        oldKittyTabTitle: context.kittyTabTitle,
        newBranch
      };
      setState(await window.seiton.renameContext(
        context.branchId ? { ...payload, branchId: context.branchId } : payload
      ));
    } finally {
      setBusy(false);
    }
  }

  async function syncProject(root: string) {
    if (!window.seiton) return;
    setBusy(true);
    try {
      await window.seiton.selectRegisteredProject(root);
      const next = await window.seiton.sync();
      setState(next);
      const pc = next.projectsWithContexts.find((project) => project.project.root === root);
      const name = pc?.project.name ?? root;
      setLastSync(`${new Date().toLocaleTimeString()} (${name}) / ${next.commands.length} cmds`);
    } finally {
      setBusy(false);
    }
  }

  async function moveProject(from: number, to: number) {
    if (!window.seiton || from === to) return;
    setBusy(true);
    try {
      setState(await window.seiton.reorderProjects(from, to));
    } finally {
      setBusy(false);
    }
  }

  async function moveContext(projectRoot: string, from: number, to: number) {
    if (!window.seiton || from === to) return;
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

  return (
    <DndProvider backend={HTML5Backend}>
      <main className="app-shell">
        <DragPreviewLayer />

        <header className="topbar">
          <div className="topbar-brand">
            <div className="brand-mark">S</div>
            <div className="brand-copy">
              <strong>seiton</strong>
              <span>{previewMode ? "sample workspace" : "workspace control"}</span>
            </div>
          </div>
          <div className="actions">
            <button onClick={refresh} disabled={busy}>Reload</button>
            <button onClick={selectProjectRoot} disabled={busy || !window.seiton}>
              Add root
            </button>
            <button className="primary" onClick={sync} disabled={busy || !window.seiton}>
              Apply
            </button>
            <button
              className="icon-button"
              aria-label="Open settings"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
              disabled={busy}
            >
              ⚙
            </button>
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
                onFocus={focus}
                onFocusPane={focusPane}
                onRename={renameContext}
                onRemoveOrphan={removeOrphan}
                onSync={() => syncProject(pc.project.root)}
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
                  className="icon-button"
                  aria-label="Close settings"
                  onClick={() => setSettingsOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="settings-body">
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
      </main>
    </DndProvider>
  );
}

function ProjectSection({
  projectWithContexts,
  projectIndex,
  busy,
  onMoveProject,
  onMoveContext,
  onFocus,
  onFocusPane,
  onRename,
  onRemoveOrphan,
  onSync
}: {
  projectWithContexts: ProjectContexts;
  projectIndex: number;
  busy: boolean;
  onMoveProject: (from: number, to: number) => void;
  onMoveContext: (projectRoot: string, from: number, to: number) => void;
  onFocus: (context: Context) => void;
  onFocusPane: (context: Context, pane: CodexPane) => void;
  onRename: (context: Context, newBranch: string) => void;
  onRemoveOrphan: (context: Context) => void;
  onSync: () => void;
}) {
  const { project, contexts } = projectWithContexts;
  const sectionRef = useRef<HTMLElement | null>(null);
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
    <section
      ref={sectionRef}
      className={classNames(
        "panel",
        "project-section",
        isDragging ? "dragging" : "",
        canDrop && isOver && dropEdge ? `drop-${dropEdge}` : ""
      )}
    >
      <header>
        <div className="project-header-main">
          <button
            ref={handleRef}
            className="drag-handle"
            aria-label={`Drag project ${project.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            :::
          </button>
          <div className="project-header-copy">
            <h2>{project.name}</h2>
            <small>{project.root}</small>
          </div>
        </div>
        <div className="project-actions">
          <button onClick={onSync}>Sync</button>
        </div>
      </header>
      <div className="rows">
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
    </section>
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
  onFocusPane: (pane: CodexPane) => void;
  onRename: (newBranch: string) => void;
  onRemoveOrphan: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
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
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  }), [context.branch, context.projectRoot, context.status, index]);

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
  }, [drag]);

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
        "context-row",
        isDragging ? "dragging" : "",
        canDrop && isOver && dropEdge ? `drop-${dropEdge}` : ""
      )}
    >
      <button
        ref={handleRef}
        className="drag-handle context-handle"
        aria-label={`Drag context ${context.branch}`}
        disabled={isEditing}
      >
        ::
      </button>
      <div className="context-main">
        <div className="context-head">
          <span className={`status ${context.status}`}>{context.status}</span>
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
            <strong>{context.branch}</strong>
          )}
        </div>
        <small>{context.tmuxSession}</small>
        {context.codexPanes.length > 0 ? (
          <div className="codex-pane-list">
            {context.codexPanes.map((pane) => (
              <div key={pane.paneId} className="codex-pane-row">
                <div className="codex-pane-main">
                  <span className={`status codex-status ${pane.status}`}>{pane.status}</span>
                  <strong>{pane.command}</strong>
                  <small>{pane.paneId}</small>
                </div>
                <p className="codex-pane-line" title={pane.lastLine}>
                  {pane.lastLine || "No recent output"}
                </p>
                <button
                  className="codex-pane-focus"
                  disabled={busy}
                  onClick={() => onFocusPane(pane)}
                  aria-label={`Focus pane ${pane.paneId}`}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="context-actions">
        <button onClick={onFocus}>Focus</button>
        {context.status !== "orphan_tmux" ? (
          isEditing ? (
            <>
              <button disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={submitRename}>
                Save
              </button>
              <button
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setDraftBranch(context.branch);
                  setIsEditing(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={() => setIsEditing(true)}>Rename</button>
          )
        ) : null}
        {context.status === "orphan_tmux" ? (
          <button
            className="danger-icon"
            aria-label={`Remove orphan ${context.branch}`}
            disabled={busy}
            onClick={onRemoveOrphan}
          >
            ×
          </button>
        ) : null}
      </div>
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
            <span className={`status ${(item as ContextDragItem).status}`}>
              {(item as ContextDragItem).status}
            </span>
            <strong>{(item as ContextDragItem).branch}</strong>
          </div>
        )}
      </div>
    </div>
  );
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

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
