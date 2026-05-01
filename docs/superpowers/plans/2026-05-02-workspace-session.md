# Workspace Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level `Workspace Session` that maps to a tmux session named after the project directory, display it above managed contexts, and allow creating it from the app.

**Architecture:** Extend the core snapshot model with an optional project-level workspace session that is derived from live tmux/Kitty state rather than persisted in the registry. Reuse generalized focus/materialization helpers for both managed contexts and workspace sessions, then render the new resource as a dedicated row with an empty state and create action.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest

---

### Task 1: Model workspace sessions in core detection

**Files:**
- Modify: `src/core/model.ts`
- Test: `tests/core.test.ts`

- [ ] Add a `WorkspaceSession` type and an optional `workspaceSession` field to `ProjectContexts`.
- [ ] Derive the expected workspace session name from the project basename and detect exact tmux/Kitty matches.
- [ ] Keep workspace sessions separate from managed contexts and attach `agentPanesBySession[sessionName]`.
- [ ] Add core tests for detection and missing-resource states.

### Task 2: Add create/focus support in commands and IPC

**Files:**
- Modify: `src/core/commands.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Test: `tests/core.test.ts`

- [ ] Extract a shared focus helper that can target an arbitrary tmux session name and optional pane.
- [ ] Add a `createWorkspaceSession(projectRoot)` command that materializes tmux and Kitty resources for the project basename.
- [ ] Add preload/main IPC methods for `focusWorkspaceSession` and `createWorkspaceSession`.
- [ ] Add focused tests for create and focus behavior.

### Task 3: Render workspace sessions and create action

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer.test.tsx`

- [ ] Render a dedicated workspace session row above managed contexts.
- [ ] Show an empty state with `Create workspace session` when the resource is missing.
- [ ] Wire row click to focus and button click to create.
- [ ] Add renderer tests for display, focus, and create actions.

### Task 4: Verify end-to-end behavior

**Files:**
- Test: `tests/core.test.ts`
- Test: `tests/renderer.test.tsx`

- [ ] Run targeted core tests for workspace session detection and commands.
- [ ] Run targeted renderer tests for workspace session display and actions.
- [ ] Run `npm run build`.
