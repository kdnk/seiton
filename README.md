# seiton

Seiton is an Electron app for managing GitButler branches as real tmux and Kitty work contexts.

It gives you one place to:

- add and switch project directories
- sync GitButler branches into managed tmux sessions and Kitty tabs
- rename contexts across GitButler, tmux, and Kitty together
- reorder projects and contexts with drag and drop
- remove orphan tmux and Kitty state
- inspect Codex panes per context and focus them directly

## Requirements

- macOS or Linux
- `tmux`
- `kitty` with remote control available
- `but` (GitButler CLI)
- Node.js

Seiton assumes your working contexts are backed by:

- GitButler branch state
- tmux sessions
- Kitty tabs

## Install

```bash
npm install
```

### macOS release note

If macOS shows `"Seiton" is damaged and can't be opened. You should move it to the Trash.`, remove the quarantine attribute from the installed app:

```bash
xattr -dr com.apple.quarantine /Applications/Seiton.app
```

Run this after moving `Seiton.app` into `/Applications`.

## Run

Start the app:

```bash
npm run electron
```

Start the app with a specific initial project root:

```bash
npm run electron:practice
```

`npm run dev` only starts the Vite renderer. Directory selection, tmux control, Kitty control, and GitButler integration require Electron.

## Build

```bash
npm run build
```

This builds:

- the renderer into `dist/`
- the Electron main and preload bundles into `dist-electron/`
- the CLI entrypoint into `dist-electron/cli.js`

## Test

```bash
npm test
```

## How Seiton works

For each GitButler branch in a registered project, Seiton manages:

- one tmux session
- one Kitty tab
- one registry entry for ordering and persistence

Managed names use this shape:

```text
s_<project-slug>_<branch-key>
```

Examples:

- `git-butler-practice` + `seiton-parser-test` -> `s_gbp_seiton-parser-test`
- `seiton` + `kn-branch-1` -> `s_seiton_kn-branch-1`

## Current behavior

Seiton currently supports:

- project directory registration and switching
- manual sync from GitButler branch state
- context focus into Kitty, tmux session, and tmux pane
- inline context rename
- orphan cleanup
- drag-and-drop ordering for projects and contexts
- Settings panel for CLI command installation
- agent pane display per context

## Install the `seiton` command

Seiton includes a small CLI used for Codex / Claude hooks and shell-based integration.

You can install it from the app:

1. open Seiton in Electron
2. open the `Settings` panel
3. use `Install Command`

Seiton installs a user-level symlink:

- prefers `~/bin/seiton` if `~/bin` is already on `PATH`
- otherwise prefers `~/.local/bin/seiton` if that directory is already on `PATH`
- otherwise installs to `~/.local/bin/seiton`

The Settings panel also shows:

- whether the command is installed
- whether the target directory is on `PATH`
- a shell snippet to add that directory to `PATH` if needed

If you prefer to inspect the built artifact directly, the command source is:

```text
dist-electron/cli.js
```

## Agent integration

Seiton supports Codex and Claude status updates through tmux pane options.

The intended flow is:

```text
Agent hook -> seiton hook <agent> <event> -> tmux pane options -> Seiton UI polling
```

### Supported Codex events

- `SessionStart`
- `UserPromptSubmit`
- `Stop`

These map to:

- `session-start`
- `user-prompt-submit`
- `stop`

### Supported Claude events

- `SessionStart`
- `UserPromptSubmit`
- `Notification`
- `Stop`
- `StopFailure`
- `PostToolUse`
- `SessionEnd`

### tmux pane options used by Seiton

Seiton writes and reads these pane options:

- `@seiton_agent`
- `@seiton_status`
- `@seiton_prompt`
- `@seiton_cwd`
- `@seiton_started_at`
- `@seiton_attention`
- `@seiton_wait_reason`

The current pane status values are:

- `idle`
- `running`
- `waiting`
- `error`

### Prepare the hook command

Run:

```bash
npm run build
```

Then install the command from the Seiton Settings panel, or reference `dist-electron/cli.js` directly.

### Enable Codex hooks

Codex hooks need to be enabled in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

### Configure `~/.codex/hooks.json`

Recommended: install the `seiton` command from the Settings panel first, then use `seiton hook ...` directly.

If you do not want to install the command in `PATH`, you can still call `dist-electron/cli.js` with an absolute path.

### Example with installed `seiton` command

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "seiton hook codex session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "seiton hook codex user-prompt-submit"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "seiton hook codex stop"
          }
        ]
      }
    ]
  }
}
```

### Example with absolute path

Use absolute paths. Replace `/ABS/PATH/TO/SEITON` with your checkout path.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd /ABS/PATH/TO/SEITON && ./dist-electron/cli.js hook codex session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd /ABS/PATH/TO/SEITON && ./dist-electron/cli.js hook codex user-prompt-submit"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd /ABS/PATH/TO/SEITON && ./dist-electron/cli.js hook codex stop"
          }
        ]
      }
    ]
  }
}
```

The hook payload is read from `stdin`, and `TMUX_PANE` is used to know which pane to update.

### Notes about current Codex hook behavior

As of current Codex CLI behavior, the practical setup is:

- put hooks in `~/.codex/hooks.json`
- enable `codex_hooks = true`

This matches the current runtime behavior discussed in `openai/codex` issues:

- plugin-local `hooks.json` is not reliably executed yet: https://github.com/openai/codex/issues/16430
- commonly available hook events are `SessionStart`, `UserPromptSubmit`, and `Stop`: https://github.com/openai/codex/issues/15490

If Codex hook behavior changes upstream, update the config example accordingly.

### Claude hook commands

Claude hooks call the same CLI entrypoint with `claude` as the agent name:

```text
seiton hook claude session-start
seiton hook claude user-prompt-submit
seiton hook claude notification
seiton hook claude stop
seiton hook claude stop-failure
seiton hook claude post-tool-use
seiton hook claude session-end
```

### Manual notifications

Use `seiton notify` inside a tmux pane when you need to raise a waiting state manually:

```bash
seiton notify "implementation finished"
```

## Operational notes

- If `but status -fv` reports `Setup required: No GitButler project found`, Seiton runs `but setup` and retries automatically.
- If a Kitty tab is missing during focus, Seiton creates one.
- If a tmux session is missing during focus, Seiton creates one.
- If a target pane lives in another tmux window, Seiton switches to that window before selecting the pane.
- Orphan cleanup removes both the tmux session and the matching Kitty tab.

## Limitations

- The app is currently optimized for `kitty + tmux + GitButler`.
- Agent activity uses tmux pane options first, then falls back to pane inspection for Codex panes when needed.
- Notification history is not persisted yet.
- Browser-only Vite mode is not a supported operational mode.

## Development notes

Important files:

- [electron/main.ts](./electron/main.ts)
- [electron/preload.ts](./electron/preload.ts)
- [src/core/commands.ts](./src/core/commands.ts)
- [src/core/model.ts](./src/core/model.ts)
- [src/renderer/App.tsx](./src/renderer/App.tsx)

Specification draft:

- [specs/spec.md](./specs/spec.md)
# force trigger
