# Remove `currentProjectRoot` Design

## Goal

Remove the internal `currentProjectRoot` concept entirely and align the app with the UI model it already presents: multiple registered projects managed at the same time.

After this change:

- the app no longer tracks a single "current" project
- project registration is additive, not selection-based
- top-level sync applies to every registered project
- per-project sync continues to operate on only that project
- future CLI flows such as `seiton open` can add a project without needing hidden selection state

## Why

The current model was inherited from an earlier single-project flow:

- one selected project root
- one top-level sync target
- one directory-picker action that both added and selected a project

That no longer matches the product:

- the renderer shows multiple projects at once
- each project already has its own actions
- the user expects project registration to be independent from any hidden active-root state

Keeping `currentProjectRoot` creates ambiguity in both UI and implementation. Removing it makes the data flow explicit and simpler.

## Scope

This design changes:

- Electron main state and IPC contracts
- renderer actions that still imply selection
- sync behavior at the top level

This design does not change:

- registry persistence format for projects and contexts
- tmux / Kitty / GitButler naming
- Codex hook behavior
- drag-and-drop ordering semantics

## Proposed Model

### Projects

The registry remains the source of truth for the project list.

Each registered project is:

- persisted in the registry
- refreshed independently from GitButler
- displayed independently in the board

There is no separate selected project field in memory.

### Refresh

`refresh` reads the full registry and rebuilds state for all registered projects.

There is no "current root" branch of logic.

### Add Root

The top-level add action becomes `add-project-root`.

Behavior:

1. open a directory picker
2. ensure the chosen directory exists in the registry
3. return the full app state for all registered projects

It does not select, focus, or prioritize the newly added project beyond normal ordering.

### Sync

Two sync paths remain:

- top-level `sync`: sync all registered projects
- project-level `syncProject(root)`: sync only the requested project

Top-level sync applies the existing planning and command execution flow once per registered project and then returns a full multi-project state.

## IPC Changes

### Remove

- `seiton:select-registered-project`

### Rename

- `seiton:select-project-root` -> `seiton:add-project-root`

### Keep

- `seiton:refresh`
- `seiton:sync`
- `seiton:focus`
- `seiton:rename-context`
- `seiton:remove-orphan`
- `seiton:reorder-projects`
- `seiton:reorder-contexts`

## Main Process Changes

### State handling

Remove:

- module-level `currentProjectRoot`

Replace with:

- registry-driven state assembly only

### Full state assembly

`getFullState()`:

- loads the registry
- reads snapshots for all registered project roots
- returns the merged app state

It no longer injects a selected root into the registry path.

### Sync all

Top-level sync should:

1. load the registry
2. iterate registered project roots in registry order
3. for each project:
   - read the project snapshot
   - reconcile that project’s registry state
   - plan sync for that project
   - execute commands for that project
4. return a fresh full state

Warnings should accumulate across all projects.

### Sync one project

Per-project sync keeps the same internal planning flow, but it must operate on an explicit `root` argument rather than any implicit selected root.

## Renderer Changes

### Top bar

`Add root` calls the new additive IPC route.

`Apply` means "sync all registered projects".

### Project rows

Project-level `Sync` keeps its existing meaning.

### Removed assumptions

The renderer should no longer:

- request project selection
- depend on a returned selected root
- model any active project outside the visible list itself

## Data Compatibility

No registry migration is required.

Existing projects and contexts remain valid because:

- the registry already stores a list of projects
- contexts already carry their own `projectRoot`

The removed concept is in runtime control flow, not in the persisted schema.

## Error Handling

### Add root

If directory selection is canceled:

- no registry change
- return the unchanged full state

### Sync all

If one project fails:

- collect warnings for that project
- continue syncing the remaining projects

This preserves the current best-effort behavior and avoids one broken project blocking the whole workspace.

## Testing

Add or update tests for:

- `add-project-root` adds a project without any selection behavior
- top-level sync iterates all registered projects
- project-level sync affects only the requested project
- refresh returns all registered projects without relying on any active root
- renderer no longer calls selection-oriented APIs

## Risks

### Hidden dependencies on current root

Some code paths may still assume that a top-level action implies one active project. This is the main regression risk.

Mitigation:

- remove the selection IPC instead of leaving it as a no-op
- update renderer tests to reflect the new contracts

### Sync fan-out cost

Top-level sync becomes multi-project work.

Mitigation:

- keep per-project sync available
- preserve sequential execution and existing command planning

## Recommendation

Implement the full removal now instead of leaving `currentProjectRoot` as an internal compatibility field.

That keeps the model coherent, simplifies future CLI additions, and avoids continuing to design around a concept the product no longer needs.
