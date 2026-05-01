# Workspace Session Design

## Goal

Treat a non-managed tmux session whose name exactly matches the project directory name as a first-class project resource in Seiton.

After this change:

- each project can expose one special tmux session for project-wide development setup
- the app shows that session separately from managed branch contexts
- users can create the session from the app when it does not exist

## Naming

### User-facing name

Use `Workspace Session`.

Rationale:

- it distinguishes this concept from managed branch contexts
- it reads as a project-level working area rather than a branch-specific workspace
- it remains broad enough for dev servers, project bootstrap commands, and long-running support tasks

### Detection rule

For a project rooted at `/path/to/seiton`, the app treats tmux session `seiton` as the project's workspace session.

This is based on the existing project name already derived from the directory basename.

## Why

The app currently focuses on managed branch contexts only.

That leaves a common workflow outside the model:

- a user keeps one project-level tmux session open for bootstrapping the development environment
- that session is not tied to a GitButler branch
- the user still wants it visible and actionable from the same board

Without explicit modeling, this session is invisible or risks being confused with unrelated unmanaged tmux sessions.

## Scope

This design changes:

- project-level snapshot modeling in `src/core/model.ts`
- tmux and Kitty resource handling in `src/core/commands.ts`
- renderer project sections in `src/renderer/App.tsx`
- tests for core modeling and renderer behavior

This design does not change:

- managed branch context naming or ordering
- registry persistence for branch contexts
- orphan detection rules for managed sessions
- branch rename flows

## Proposed Model

### New project-level resource

Add a project-level `workspaceSession` field to each `ProjectContexts` entry.

This resource is separate from the `contexts` array because it has different semantics:

- it is not branch-backed
- it is not reorderable with managed contexts
- it is not renameable from branch operations
- it is optional and at most one per project

### Workspace session shape

The resource should carry:

- `name`: tmux session name, equal to the project directory name
- `kittyTabTitle`: same value by default
- `primaryPaneId?`
- `agentPanes`
- `status`

The status set can stay minimal:

- `ready`
- `missing_tmux`
- `missing_kitty`

No `orphan_tmux` state is needed because this resource is discovered by explicit project-name matching, not by managed naming conventions.

## Detection Rules

### tmux session match

For each registered project:

- derive the expected workspace session name from the project directory basename
- if `tmuxSessions` contains that exact name, mark tmux as present

The match must be exact and case-sensitive to avoid accidentally claiming other unmanaged sessions.

### Kitty tab match

The default Kitty tab for this resource should also be the same exact name.

If Kitty contains a tab with that title, mark Kitty as present.

### Agent panes

If the workspace session exists in tmux, attach `agentPanesBySession[sessionName] ?? []` just like managed contexts.

This keeps agent visibility consistent across workspace and branch-level sessions.

## Renderer Design

### Placement

Render the workspace session near the top of each project section, above managed contexts.

Order:

1. project header
2. workspace session area
3. managed contexts list

This gives the project-level environment a stable and prominent place without mixing it into branch ordering.

### Visual treatment

Show the workspace session as a dedicated single row with a distinct label.

Recommended structure:

- badge: `Workspace Session`
- primary label: session name
- status badge when not fully ready
- optional agent panes below or inline using the existing pane row style

It should visually resemble a context row enough to feel native, but still be clearly categorized as project-level.

### Empty state

If the workspace session does not exist, render an inline empty state in the same slot instead of hiding the feature.

Recommended content:

- label: `Workspace Session`
- secondary copy: `No workspace session yet.`
- primary action: `Create workspace session`

This keeps discoverability high and makes the intended workflow obvious.

## Interaction Design

### Focus existing workspace session

When the workspace session row exists:

- clicking the row focuses that session
- if a matching Kitty tab exists, focus it first
- if a target tmux client tty can be identified, switch only that client

This should reuse the same safety rules introduced for managed focus, so unrelated tmux clients are not retargeted.

### Create workspace session

When the workspace session is missing and the user clicks `Create workspace session`:

1. create tmux session `<project name>` if missing
2. create Kitty tab `<project name>` if missing
3. focus the created workspace session
4. refresh state

This mirrors the managed "materialize missing resources" behavior, but without any branch dependency.

## Command Design

### New explicit action

Add a dedicated project-level action instead of overloading managed context sync.

Recommended API shape:

- preload/main: `createWorkspaceSession(projectRoot)`
- core command helper: `createWorkspaceSession(projectRoot, cwd, run)`

The helper should:

- derive the project session name from the project root
- create missing tmux and Kitty resources
- avoid mutating unrelated sessions or tabs

### Focus action reuse

Do not create a separate focus pipeline if existing focus logic can be generalized.

Preferred approach:

- extract a shared "focus arbitrary session name + optional pane" helper
- reuse it for both managed contexts and workspace sessions

This avoids duplicating the Kitty/tmux safety logic.

## Data and Persistence

No new registry persistence is required for phase one.

The workspace session is derivable from:

- registered project root
- project name
- live tmux session list
- live Kitty tab list

Because the rule is deterministic, storing it in the registry would add complexity without adding meaningful user control.

## Error Handling

If workspace session creation fails:

- surface a project-level warning in the same way other command failures surface warnings
- leave the project section visible with the create action still available

If tmux exists but Kitty does not:

- show `missing_kitty`
- allow focus/create behavior to repair the missing tab

If Kitty exists but tmux does not:

- show `missing_tmux`
- allow create behavior to repair the missing session

## Testing

Add or update tests for:

- project snapshot detection of a workspace session by exact project-name match
- workspace session remaining separate from managed contexts
- renderer showing a workspace session row above managed contexts
- renderer showing a `Create workspace session` action when the session is absent
- clicking the workspace session row invoking focus behavior
- creating the workspace session invoking the new project-level backend action
- missing-resource states for workspace sessions

## Risks

### Name collisions

A user may already have an unrelated tmux session whose name happens to match the project directory name.

Mitigation:

- treat the convention as intentional for now
- keep the feature project-scoped and explicit in the UI
- avoid inferring anything beyond that one exact name

### Visual overload

Adding a new row to every project section can make the board busier.

Mitigation:

- keep the workspace row single-line by default
- use a compact labeled style rather than a second full context list

### Future extensibility

Users may later want more than one project-level utility session.

Mitigation:

- model this first version as a distinct project-level resource, not as a fake managed context
- that keeps the door open to expanding into a small project-level resources section later

## Recommendation

Implement phase one as a single deterministic `Workspace Session` per project:

- detected by exact tmux session name equal to the project directory name
- shown above managed contexts
- created on demand from the app
- kept fully separate from managed branch contexts in both data model and UI
