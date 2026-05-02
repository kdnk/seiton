import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { SeitonState } from "../electron/preload";

describe("App", () => {
  afterEach(() => {
    vi.resetModules();
    delete window.seiton;
    document.body.innerHTML = "";
  });

  it("renders the web preview when preload is unavailable", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add project" })).toBeInTheDocument();
    });

    expect(screen.getByText("feat/codex-hook-state")).toBeInTheDocument();
    expect(screen.getAllByText("git-butler-practice").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Warnings" })).not.toBeInTheDocument();
    expect(screen.queryByText("sample workspace")).not.toBeInTheDocument();
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
                terminalTabTitle: "s_a_feature%2Fclaude-notify",
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
      expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });

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
                terminalTabTitle: "s_a_feature%2Fclaude-runtime",
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
      expect(screen.getByText("> Summarize the failing tests")).toBeInTheDocument();
    });

    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows an orphan remove button and calls the API", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          workspaceSession: undefined,
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              terminalTabTitle: "s_a_feature%2Fnotify-ui",
              agentPanes: [],
              order: 10,
              status: "orphan_tmux"
            }
          ]
        }
      ],
      warnings: []
    });
    const removeOrphan = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan,
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("feature/notify-ui")).toBeInTheDocument();
    });

    expect(screen.getByText("orphan_tmux")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove orphan feature/notify-ui" }));

    await waitFor(() => {
      expect(removeOrphan).toHaveBeenCalledWith("/repo/a", "s_a_feature%2Fnotify-ui", "s_a_feature%2Fnotify-ui");
    });
  });

  it("renames a context through the inline editor", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          workspaceSession: undefined,
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              branchId: "ab",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              terminalTabTitle: "s_a_feature%2Fnotify-ui",
              agentPanes: [],
              order: 10,
              status: "ready"
            }
          ]
        }
      ],
      warnings: []
    });
    const renameContext = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext,
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("feature/notify-ui")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename feature/notify-ui" }));

    const input = await screen.findByRole("textbox", { name: "Rename feature/notify-ui" });
    fireEvent.change(input, {
      target: { value: "feature/renamed-ui" }
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(renameContext).toHaveBeenCalledWith({
        contextId: "ctx-1",
        projectRoot: "/repo/a",
        branchId: "ab",
        oldBranch: "feature/notify-ui",
        oldTmuxSession: "s_a_feature%2Fnotify-ui",
        oldTerminalTabTitle: "s_a_feature%2Fnotify-ui",
        newBranch: "feature/renamed-ui"
      });
    });
  });

  it("hides the warnings section when there are no warnings", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh,
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
      expect(refresh).toHaveBeenCalled();
    });

    expect(screen.queryByRole("region", { name: "Warnings" })).not.toBeInTheDocument();
  });

  it("renders global warnings separately from project warnings", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [],
          warnings: ["Only /repo/a needs attention."]
        }
      ],
      warnings: ["tmux is unavailable."]
    });
    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeProjectRoot: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });

    expect(screen.getByRole("region", { name: "Warnings" })).toBeInTheDocument();
    expect(screen.getByText("tmux is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Only /repo/a needs attention.")).toBeInTheDocument();
  });

  it("shows codex panes and focuses a specific pane", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          workspaceSession: undefined,
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              terminalTabTitle: "s_a_feature%2Fnotify-ui",
              agentPanes: [
                {
                  agent: "codex",
                  paneId: "%12",
                  command: "codex --full-auto",
                  lastLine: "Working on rename flow",
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
    });
    const focus = vi.fn().mockResolvedValue(undefined);
    window.seiton = {
      refresh,
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
      expect(screen.getByText("codex --full-auto")).toBeInTheDocument();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Working on rename flow")).toBeInTheDocument();
    expect(screen.getByText("%12")).toBeInTheDocument();
    expect(screen.queryByText("s_a_feature%2Fnotify-ui")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus pane %12" }));

    await waitFor(() => {
      expect(focus).toHaveBeenCalledWith("/repo/a", "feature%2Fnotify-ui", "%12");
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });

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
                terminalTabTitle: "s_a_feature%2Fclaude-notify",
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

    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getByText("waiting")).toBeInTheDocument();
  });

  it("adds a project root through the additive IPC", async () => {
    const addProjectRoot = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
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
    fireEvent.click(await screen.findByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(addProjectRoot).toHaveBeenCalled();
    });
  });

  it("opens the add project flow with the keyboard shortcut", async () => {
    const addProjectRoot = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
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

    await screen.findByRole("button", { name: "Add project" });
    fireEvent.keyDown(window, { key: "o", metaKey: true });

    await waitFor(() => {
      expect(addProjectRoot).toHaveBeenCalledTimes(1);
    });
  });

  it("opens settings with the keyboard shortcut", async () => {
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [],
        warnings: []
      }),
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue({
        sourcePath: "/repo/a/dist-electron/cli.js",
        targetPath: "/Users/kodai/.local/bin/seiton",
        installed: true,
        availableOnPath: true,
        targetDirOnPath: true
      }),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    await screen.findByRole("button", { name: "Open settings" });
    fireEvent.keyDown(window, { key: ",", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    });
  });

  it("renders a workspace session row and focuses it", async () => {
    const focusWorkspaceSession = vi.fn().mockResolvedValue(undefined);
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
            workspaceSession: {
              type: "workspace",
              projectRoot: "/repo/a",
              name: "a",
              terminalTabTitle: "a",
              agentPanes: [],
              status: "ready"
            },
            contexts: [],
            warnings: []
          }
        ],
        warnings: []
      }),
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      createWorkspaceSession: vi.fn(),
      focus: vi.fn(),
      focusWorkspaceSession,
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open workspace session a" }));

    await waitFor(() => {
      expect(focusWorkspaceSession).toHaveBeenCalledWith("/repo/a", undefined);
    });
  });

  it("creates a workspace session when its row is clicked while missing", async () => {
    const createWorkspaceSession = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
            contexts: [],
            warnings: []
          }
        ],
        warnings: []
      }),
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      createWorkspaceSession,
      focus: vi.fn(),
      focusWorkspaceSession: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open workspace session a" }));

    await waitFor(() => {
      expect(createWorkspaceSession).toHaveBeenCalledWith("/repo/a");
    });
  });

  it("removes an added project root", async () => {
    const removeProjectRoot = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/b", name: "b", projectKey: "%2Frepo%2Fb", order: 20, enabled: true },
            contexts: [],
            warnings: []
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
      removeProjectRoot,
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove root b" }));

    await waitFor(() => {
      expect(removeProjectRoot).toHaveBeenCalledWith("/repo/b");
    });
  });

  it("shows a restart warning when a new IPC handler is unavailable", async () => {
    const removeProjectRoot = vi.fn().mockRejectedValue(
      new Error("Error invoking remote method 'seiton:remove-project-root': Error: No handler registered for 'seiton:remove-project-root'")
    );
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/b", name: "b", projectKey: "%2Frepo%2Fb", order: 20, enabled: true },
            contexts: [],
            warnings: []
          }
        ],
        warnings: []
      }),
      sync: vi.fn(),
      syncProject: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeProjectRoot,
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove root b" }));

    await waitFor(() => {
      expect(screen.getByText("Restart Seiton to load the latest backend actions.")).toBeInTheDocument();
    });
  });

  it("applies pushed state updates from Electron", async () => {
    let listener: ((state: SeitonState) => void) | undefined;
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: (next: (state: SeitonState) => void) => {
        listener = next;
        return () => {};
      }
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });

    listener?.({
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          workspaceSession: undefined,
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/live-update",
              branchKey: "feature%2Flive-update",
              tmuxSession: "s_a_feature%2Flive-update",
              terminalTabTitle: "s_a_feature%2Flive-update",
              agentPanes: [],
              order: 10,
              status: "ready"
            }
          ]
        }
      ],
      warnings: []
    });

    await waitFor(() => {
      expect(screen.getByText("feature/live-update")).toBeInTheDocument();
    });
  });

  it("shows CLI install status and runs install from settings", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    const getCliCommandStatus = vi.fn()
      .mockResolvedValueOnce({
        sourcePath: "/repo/a/dist-electron/cli.js",
        targetPath: "/Users/kodai/.local/bin/seiton",
        installed: false,
        availableOnPath: false,
        targetDirOnPath: false,
        pathHint: 'Add /Users/kodai/.local/bin to PATH, for example: export PATH="/Users/kodai/.local/bin:$PATH"'
      })
      .mockResolvedValueOnce({
        sourcePath: "/repo/a/dist-electron/cli.js",
        targetPath: "/Users/kodai/.local/bin/seiton",
        installed: true,
        availableOnPath: true,
        targetDirOnPath: true
      });
    const installCliCommand = vi.fn().mockResolvedValue({
      sourcePath: "/repo/a/dist-electron/cli.js",
      targetPath: "/Users/kodai/.local/bin/seiton",
      installed: true,
      availableOnPath: true,
      targetDirOnPath: true
    });

    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus,
      installCliCommand
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    });
    expect(screen.getByText("/Users/kodai/.local/bin/seiton")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install Command" }));

    await waitFor(() => {
      expect(installCliCommand).toHaveBeenCalled();
    });
  });

  it("renders the terminal backend setting and saves wezterm selection", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });
    const getSettings = vi.fn().mockResolvedValue({ terminalBackend: "kitty" });
    const updateSettings = vi.fn().mockResolvedValue({ terminalBackend: "wezterm" });

    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue({
        sourcePath: "/repo/a/dist-electron/cli.js",
        targetPath: "/Users/kodai/.local/bin/seiton",
        installed: true,
        availableOnPath: true,
        targetDirOnPath: true
      }),
      installCliCommand: vi.fn(),
      getSettings,
      updateSettings
    } as never;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "wezterm" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "wezterm" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ terminalBackend: "wezterm" });
    });
  });

  it("renders toolbar and modal controls with dedicated icons", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectsWithContexts: [],
      warnings: []
    });

    window.seiton = {
      refresh,
      sync: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue({
        sourcePath: "/repo/a/dist-electron/cli.js",
        targetPath: "/Users/kodai/.local/bin/seiton",
        installed: true,
        availableOnPath: true,
        targetDirOnPath: true
      }),
      installCliCommand: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Reload" })).toHaveAttribute("title", "Reload (⌘R)");
    expect(screen.getByRole("button", { name: "Open settings" })).toHaveAttribute("title", "Settings (⌘,)");
    expect(screen.getByRole("button", { name: "Reload" }).querySelector('[data-icon="reload"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open settings" }).querySelector('[data-icon="settings"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Close settings" }).querySelector('[data-icon="close"]')).not.toBeNull();
  });

  it("animates the reload icon while refresh is in progress", async () => {
    let resolveRefresh: ((value: { projectsWithContexts: []; warnings: [] }) => void) | undefined;
    const refresh = vi.fn()
      .mockResolvedValueOnce({ projectsWithContexts: [], warnings: [] })
      .mockImplementation(
        () =>
          new Promise<{ projectsWithContexts: []; warnings: [] }>((resolve) => {
            resolveRefresh = resolve;
          })
      );

    window.seiton = {
      refresh,
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

    const reloadButton = await screen.findByRole("button", { name: "Reload" });
    await waitFor(() => {
      expect(reloadButton).not.toBeDisabled();
    });

    expect(reloadButton.querySelector('[data-icon="reload"]')?.classList.contains("spinning")).toBe(false);

    fireEvent.click(reloadButton);

    expect(refresh).toHaveBeenCalled();
    expect(reloadButton.querySelector('[data-icon="reload"]')?.classList.contains("spinning")).toBe(true);

    resolveRefresh?.({ projectsWithContexts: [], warnings: [] });

    await waitFor(() => {
      expect(reloadButton.querySelector('[data-icon="reload"]')?.classList.contains("spinning")).toBe(false);
    });
  });

  it("does not render per-project sync buttons", async () => {
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
            contexts: [],
            warnings: []
          }
        ],
        warnings: []
      }),
      sync: vi.fn(),
      syncProject: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeProjectRoot: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "a" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("shows remove buttons for every registered project", async () => {
    window.seiton = {
      refresh: vi.fn().mockResolvedValue({
        projectsWithContexts: [
          {
            project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
            contexts: [],
            warnings: []
          },
          {
            project: { root: "/repo/b", name: "b", projectKey: "%2Frepo%2Fb", order: 20, enabled: true },
            contexts: [],
            warnings: []
          }
        ],
        warnings: []
      }),
      sync: vi.fn(),
      syncProject: vi.fn(),
      addProjectRoot: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeProjectRoot: vi.fn(),
      removeOrphan: vi.fn(),
      getCliCommandStatus: vi.fn().mockResolvedValue(null),
      installCliCommand: vi.fn(),
      onStateUpdated: () => () => {}
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove root a" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove root b" })).toBeInTheDocument();
    });
  });
});
