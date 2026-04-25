import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";

describe("App", () => {
  afterEach(() => {
    vi.resetModules();
    delete window.seiton;
    document.body.innerHTML = "";
  });

  it("does not render demo data when preload is unavailable", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("seiton")).toBeInTheDocument();
    });

    expect(screen.getByText("Electron preload is unavailable. Open the app in Electron to add directories and manage contexts.")).toBeInTheDocument();
    expect(screen.queryByText("feature/notify-ui")).not.toBeInTheDocument();
    expect(screen.queryByText("feature/reorder-tabs")).not.toBeInTheDocument();
  });

  it("shows an orphan remove button and calls the API", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              kittyTabTitle: "s_a_feature%2Fnotify-ui",
              codexPanes: [],
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
      selectProjectRoot: vi.fn(),
      selectRegisteredProject: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("feature/notify-ui")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove orphan feature/notify-ui" }));

    await waitFor(() => {
      expect(removeOrphan).toHaveBeenCalledWith("/repo/a", "s_a_feature%2Fnotify-ui", "s_a_feature%2Fnotify-ui");
    });
  });

  it("renames a context through the inline editor", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              branchId: "ab",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              kittyTabTitle: "s_a_feature%2Fnotify-ui",
              codexPanes: [],
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
      selectProjectRoot: vi.fn(),
      selectRegisteredProject: vi.fn(),
      focus: vi.fn(),
      renameContext,
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("feature/notify-ui")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    const input = await screen.findByRole("textbox", { name: "Rename feature/notify-ui" });
    fireEvent.change(input, {
      target: { value: "feature/renamed-ui" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(renameContext).toHaveBeenCalledWith({
        contextId: "ctx-1",
        projectRoot: "/repo/a",
        branchId: "ab",
        oldBranch: "feature/notify-ui",
        oldTmuxSession: "s_a_feature%2Fnotify-ui",
        oldKittyTabTitle: "s_a_feature%2Fnotify-ui",
        newBranch: "feature/renamed-ui"
      });
    });
  });

  it("hides the warnings section when there are no warnings", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [],
      warnings: []
    });
    window.seiton = {
      refresh,
      sync: vi.fn(),
      selectProjectRoot: vi.fn(),
      selectRegisteredProject: vi.fn(),
      focus: vi.fn(),
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });

    expect(screen.queryByRole("region", { name: "Warnings" })).not.toBeInTheDocument();
  });

  it("shows codex panes and focuses a specific pane", async () => {
    const refresh = vi.fn().mockResolvedValue({
      projectRoot: "/repo/a",
      projectsWithContexts: [
        {
          project: { root: "/repo/a", name: "a", projectKey: "%2Frepo%2Fa", order: 10, enabled: true },
          contexts: [
            {
              id: "ctx-1",
              type: "managed",
              projectRoot: "/repo/a",
              branch: "feature/notify-ui",
              branchKey: "feature%2Fnotify-ui",
              tmuxSession: "s_a_feature%2Fnotify-ui",
              kittyTabTitle: "s_a_feature%2Fnotify-ui",
              codexPanes: [
                {
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
      selectProjectRoot: vi.fn(),
      selectRegisteredProject: vi.fn(),
      focus,
      renameContext: vi.fn(),
      reorderProjects: vi.fn(),
      reorderContexts: vi.fn(),
      removeOrphan: vi.fn()
    } as never;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("codex --full-auto")).toBeInTheDocument();
    });

    expect(screen.getByText("Working on rename flow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus pane %12" }));

    await waitFor(() => {
      expect(focus).toHaveBeenCalledWith("/repo/a", "feature%2Fnotify-ui", "%12");
    });
  });
});
