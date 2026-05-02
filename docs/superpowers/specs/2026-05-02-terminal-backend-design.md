# Terminal Backend Design

## Goal

Allow Seiton to operate against either `kitty` or `wezterm` through one global app setting.

After this change:

- terminal operations are abstracted behind a backend interface instead of being hardcoded to `kitty`
- the Settings modal lets the user choose `kitty` or `wezterm`
- focus, sync, rename, reorder, workspace-session creation, and orphan cleanup continue to work through the selected backend

## Why

The current implementation assumes `kitty` across the core model, command execution, IPC payloads, and renderer copy.

That creates two problems:

- users on `wezterm` cannot use Seiton's terminal-tab automation
- the codebase treats one terminal implementation detail as the app's primary abstraction, which makes future backend support harder to add and reason about

The change should preserve the existing `kitty` workflow while making terminal choice an explicit application setting.

## Scope

This design changes:

- registry persistence to store one global terminal backend setting
- terminal resource naming in the model from `kitty*` concepts to generic terminal-tab concepts
- command execution in `src/core/commands.ts` so terminal behavior is delegated to a backend implementation
- Electron IPC so renderer and main process can read and update the selected backend
- the Settings modal so users can choose the backend
- tests for model planning, command execution, and renderer settings behavior

This design does not change:

- managed tmux session naming
- project and context ordering rules
- GitButler branch detection and rename behavior
- the existing default backend for current users, which remains `kitty`

## Requirements

### Global setting

The terminal backend is one app-wide setting, not project-specific.

Supported values:

- `kitty`
- `wezterm`

Default behavior:

- if no setting exists, use `kitty`

### Functional parity target

The selected backend should support the same Seiton workflows:

- detect managed terminal tabs
- create missing terminal tabs during sync and focus flows
- focus an existing tab before tmux pane selection
- rename tabs when managed contexts are renamed
- reorder tabs to match context ordering
- close tabs during orphan cleanup
- support workspace-session creation and focus

If a backend cannot perform a specific action in a given runtime state, Seiton should surface a warning instead of silently degrading.

## Data Model

### Registry settings

Add a `settings` object to the persisted registry.

Recommended shape:

```ts
type RegistrySettings = {
  terminalBackend: "kitty" | "wezterm";
};
```

The registry then becomes:

```ts
type Registry = {
  settings?: RegistrySettings;
  projects?: RegistryProject[];
  contexts: RegistryContext[];
};
```

Keeping `settings` optional preserves backward compatibility for existing registries.

### Generic terminal naming

Current names such as `kittyTabTitle`, `kittyTabs`, and `missing_kitty` leak the implementation choice throughout the app.

Rename those concepts to generic terminal-tab names:

- `kittyTabTitle` -> `terminalTabTitle`
- `kittyTabs` -> `terminalTabs`
- `create_kitty_tab` -> `create_terminal_tab`
- `rename_kitty_tab` -> `rename_terminal_tab`
- `move_kitty_tab_backward` -> `move_terminal_tab_backward`
- `move_kitty_tab_forward` -> `move_terminal_tab_forward`
- `missing_kitty` -> `missing_terminal`

This rename should apply to:

- registry context types
- live snapshot types
- context and workspace-session view models
- sync command types
- renderer status handling

The model should describe app intent, not one backend's command syntax.

## Backend Architecture

### Terminal backend interface

Introduce a shared `TerminalBackend` interface that isolates terminal-specific behavior from the rest of the command layer.

Recommended responsibilities:

```ts
type TerminalTab = {
  id: string | number;
  title: string;
  windowId?: string | number;
  index: number;
};

type TerminalBackend = {
  name: "kitty" | "wezterm";
  listTabs(cwd: string): Promise<CommandResult<TerminalTab[]>>;
  ensureTab(input: { title: string; tmuxSession: string; cwd: string; run: ExecFunction }): Promise<void>;
  focusTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  renameTab(oldTitle: string, newTitle: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabBackward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  moveTabForward(title: string, cwd: string, run: ExecFunction): Promise<void>;
  closeTab(title: string, cwd: string, run: ExecFunction): Promise<void>;
  resolveTargetTmuxClientTty(title: string, cwd: string, run: ExecFunction): Promise<string | undefined>;
  isUnavailableError(error: unknown): boolean;
  isMissingTabError(error: unknown): boolean;
};
```

The exact method signatures may vary, but the boundary should stay at this level: the core asks for terminal-tab operations, and the backend translates those operations into concrete CLI commands.

### Backend selection

Add a resolver such as `getTerminalBackend(registry)` or `getTerminalBackendForSettings(settings)` in the core layer.

The main process should load the registry once per operation, derive the configured backend, and pass it into command helpers that need terminal control.

This keeps backend selection deterministic and testable.

### Implementation layout

Recommended file split:

- `src/core/terminal-backend.ts`: shared types and backend resolver
- `src/core/terminal-backends/kitty.ts`: current `kitty` implementation extracted from `commands.ts`
- `src/core/terminal-backends/wezterm.ts`: new `wezterm` implementation

This keeps `commands.ts` focused on tmux/session orchestration instead of terminal command details.

## Backend Behavior

### Kitty backend

The existing `kitty` behavior should be preserved, but moved behind the new interface.

That includes:

- listing tabs via `kitty @ ls`
- launching tabs via `kitty @ launch --type=tab`
- focusing tabs via `kitty @ focus-tab`
- renaming via `kitty @ set-tab-title`
- moving via `kitty @ action move_tab_backward|move_tab_forward`
- closing via `kitty @ close-tab`
- resolving the owning tmux client from `kitty @ ls`

### WezTerm backend

`wezterm` should target tab-based behavior equivalent to `kitty`.

Expected implementation responsibilities:

- list tabs using `wezterm cli list --format json` or equivalent structured output
- create a tab that starts or attaches to the target tmux session
- focus a matching tab before tmux pane selection
- rename tabs to the managed title
- activate and move tabs to support ordering
- close tabs for orphan cleanup
- inspect enough runtime metadata to map a tab back to the associated tmux client when possible

The design assumes `wezterm` CLI support is sufficient for these operations. If some `wezterm` runtime states do not expose enough metadata to resolve a target tmux client, Seiton should:

- still focus the terminal tab
- avoid switching an unrelated tmux client
- fall back to a safer no-retarget path

That matches the current safety principle already used for `kitty`.

## Command Flow Changes

### Snapshot reads

`readSystemSnapshotForCwd` and `readFullSystemSnapshot` should no longer directly call `readKittyTabs`.

Instead:

- resolve the configured backend
- call `backend.listTabs(...)`
- store the result as `terminalTabs`

Warnings should mention the active backend name so failures are diagnosable.

### Sync command application

`applySyncCommand` should handle generic terminal commands and delegate them to the active backend.

Example:

- `create_terminal_tab` -> `backend.ensureTab(...)`
- `rename_terminal_tab` -> `backend.renameTab(...)`
- `move_terminal_tab_backward` -> `backend.moveTabBackward(...)`
- `move_terminal_tab_forward` -> `backend.moveTabForward(...)`

This removes direct `kitty` CLI execution from sync application logic.

### Focus flow

`focusSessionByName` should become backend-aware without duplicating logic.

Preferred flow:

1. ensure tmux session exists
2. ensure terminal tab exists through the selected backend
3. try to focus the terminal tab
4. if the backend can resolve the associated tmux client tty, switch that client only
5. otherwise avoid retargeting unrelated tmux clients
6. if a pane id is provided, select the tmux window and pane after focus

The safety rule remains unchanged:

- do not switch the current tmux client unless the backend cannot participate at all and the app must fall back to tmux-only behavior

### Orphan cleanup and rename

`removeOrphanContext` and `renameManagedContext` should use generic terminal-tab inputs.

The renderer and preload layer should stop passing `kittyTabTitle` and use `terminalTabTitle` consistently.

## IPC and Renderer

### New settings API

Add IPC support for reading and updating settings.

Recommended preload surface:

- `getSettings(): Promise<SeitonSettings>`
- `updateSettings(input: Partial<SeitonSettings>): Promise<SeitonSettings>`

Where:

```ts
type SeitonSettings = {
  terminalBackend: "kitty" | "wezterm";
};
```

The renderer should load settings on startup alongside CLI command status.

### Settings modal

Add one selector section to the existing Settings modal:

- title: `Terminal backend`
- control: radio group or segmented control for `kitty` and `wezterm`
- helper text: explain that the setting applies to all projects and controls terminal-tab operations

Behavior:

- changing the selection persists immediately
- preview mode can use local component state and default to `kitty`
- the control remains available even if CLI command installation status is unchanged

### Copy updates

User-visible copy should avoid `kitty`-specific language except where backend-specific warnings require it.

Examples:

- status names should refer to `missing terminal` rather than `missing kitty`
- action and warning copy should say `terminal tab` unless the backend name itself is relevant

## Migration

### Registry compatibility

Existing registries should continue to load without manual migration.

Behavior:

- missing `settings` means `terminalBackend = "kitty"`
- existing persisted context records with `kittyTabTitle` should be mapped to `terminalTabTitle`

Preferred implementation:

- normalize loaded registry data in one place when reading from disk
- persist back in the new shape after the next registry save

This avoids scattered backward-compatibility branches.

## Testing

### Model tests

Update model tests to use terminal-generic names and statuses.

Cover:

- sync planning based on `terminalTabs`
- workspace-session status using `missing_terminal`
- ordering commands using generic terminal command types

### Command tests

Add backend-aware command tests for both `kitty` and `wezterm`.

Cover:

- creating a missing terminal tab during focus
- creating missing tmux + terminal resources together
- skipping unsafe tmux client switching when the terminal client cannot be resolved
- gracefully handling backend-unavailable errors
- rename, reorder, and close behavior through the backend interface

These tests should verify both high-level behavior and the backend-specific CLI arguments emitted through the injected `run` function.

### Renderer tests

Add or update tests for:

- Settings modal rendering the terminal backend selector
- current backend value being shown
- changing the backend calling the settings update API
- preview mode rendering a default backend
- terminology updates away from `kitty`-specific status text

## Risks

### WezTerm metadata gaps

`wezterm` may expose less direct information than `kitty` for mapping a tab to a specific tmux client.

Mitigation:

- treat tmux client resolution as best-effort
- keep tab focusing and pane targeting independent where possible
- preserve the existing safety rule that avoids retargeting unrelated tmux clients

### Partial rename migration

Renaming `kitty*` fields throughout the codebase touches many tests and IPC types.

Mitigation:

- do the terminology migration in the same change as backend abstraction
- keep compatibility normalization at the registry boundary
- avoid mixing old and new names in public types

### Settings drift in the renderer

If settings are loaded separately from state, the modal can show stale data after updates.

Mitigation:

- store settings in dedicated renderer state
- update that state from the successful IPC response immediately
- avoid deriving backend choice from unrelated state payloads

## Recommendation

Implement the terminal abstraction and terminology rename in one feature change, not as separate phases.

The rename is broad, but it prevents the codebase from carrying a misleading `kitty` vocabulary while supporting multiple backends. Doing both together keeps the model coherent and reduces follow-up cleanup.
