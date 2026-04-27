# Claude Pane Detection Design

## Goal

Make Claude panes visible in Seiton whenever Claude is actively running inside a tmux pane, even if Claude hooks are not configured.

After this change:

- Claude panes appear in the app through runtime detection, not only hook metadata
- hook-backed Claude panes still expose richer states such as `waiting` and `error`
- the renderer continues to use the same `agentPanes` model for Codex and Claude

## Why

The current app already models Claude as a supported agent, but in practice Claude visibility depends on tmux pane options written by `seiton hook claude ...`.

That creates a mismatch with Codex behavior:

- Codex panes can be discovered from tmux runtime state
- Claude panes can disappear from Seiton when hooks are missing or incomplete
- users cannot reliably see active Claude work from the app, even though the pane exists

The app should treat "Claude is running in a tmux pane" as the base signal, then layer hook metadata on top when available.

## Scope

This design changes:

- tmux pane discovery in `src/core/commands.ts`
- agent pane merge behavior for Claude runtime detection
- core and renderer tests that cover pane discovery and display

This design does not change:

- the persisted registry schema
- hook payload formats
- renderer layout or interaction patterns
- Codex pane detection behavior

## Proposed Model

### Detection sources

Claude pane discovery uses two sources:

1. tmux pane options written by hooks
2. tmux runtime inspection from command metadata and captured pane text

Hooks remain the authoritative source for richer transient states, but they are no longer required for baseline visibility.

### Merge priority

Claude pane entries from tmux options and Claude runtime detection are merged by `paneId`.

Priority:

1. hook-backed pane entry
2. runtime-detected pane entry

This means:

- `waiting` and `error` from hooks are preserved
- hook prompt text is preferred when available
- runtime detection fills the gap when no hook metadata exists

### Runtime-derived status

When a Claude pane is visible only through runtime detection:

- `running` means Claude appears active and not at an input-ready prompt
- `idle` means Claude appears to be waiting for user input

Runtime detection does not infer `waiting` or `error`. Those states remain hook-driven.

## Main Process Changes

### Add Claude runtime parser

Add a Claude-specific parser alongside the existing Codex runtime parser:

- `parseTmuxClaudePanes(stdout, cwd, run)`

This parser should:

- iterate pane candidates from `tmux list-panes`
- capture recent pane output
- identify Claude panes from command metadata and Claude-specific pane text
- derive a fallback `AgentPane` entry with `agent`, `paneId`, `command`, `lastLine`, and runtime status

### Claude pane identification

Claude pane detection should use dedicated heuristics rather than reusing Codex checks.

Primary signals:

- `currentCommand` or `startCommand` contains `claude`

Secondary signals from captured pane text:

- Claude Code banner or branding text
- stable interaction text that indicates the Claude CLI session is active
- input prompt patterns that are specific enough to avoid matching normal shells

The heuristic should be conservative. A plain shell pane should not be labeled as Claude just because old output mentions Claude once.

### Claude runtime liveness

Claude runtime entries should be emitted only when the process appears live.

Base rule:

- if command metadata still points to Claude, the pane is live

Fallback textual checks may support wrapped launches, but they should still require evidence that the pane is currently in a Claude session rather than containing stale history.

### Claude runtime status inference

Add a Claude-specific status inference helper, for example:

- `inferClaudePaneStatus(paneText)`

This helper should:

- inspect recent non-empty lines
- return `idle` when the pane looks input-ready
- otherwise return `running`

The implementation should intentionally mirror Codex behavior at the product level while using Claude-specific textual cues.

## Command Merge Changes

`readAgentPanes(...)` should combine:

- tmux option-backed panes
- Codex runtime panes
- Claude runtime panes

The existing merge-by-`paneId` behavior can stay, as long as hook-backed entries are merged last so they override runtime-derived Claude entries.

If the current ordering already gives tmux option entries precedence, keep that ordering and extend it to Claude runtime data.

## Renderer Impact

No renderer contract changes are required.

The renderer should continue to display:

- agent badge
- status badge
- command label
- pane id
- last line

Claude panes discovered only from runtime state should therefore appear automatically in the existing UI.

## Error Handling

If pane capture fails for a Claude candidate:

- skip that pane or fall back to command-only evidence when safe
- do not fail the whole snapshot

If Claude-specific heuristics are inconclusive:

- prefer not emitting the pane over a false positive

This keeps the board trustworthy.

## Testing

Add or update tests for:

- runtime detection of a live Claude pane without any tmux hook options
- hook-backed Claude pane still winning over runtime-derived status
- stale Claude pane options being ignored after Claude exits
- renderer showing Claude panes that originate from runtime detection
- renderer continuing to show `waiting` for hook-backed Claude panes

## Risks

### False positives

Claude text heuristics may accidentally match ordinary shell output.

Mitigation:

- require strong command evidence first
- use textual heuristics only as a supplement
- keep the idle/running inference separate from agent identification

### False negatives for wrapped launches

Some users may start Claude through wrappers that hide the `claude` executable name.

Mitigation:

- add a small set of Claude-specific pane text signals
- keep the detection code isolated so heuristics can be tuned without touching Codex logic

### Divergence from Codex internals

Codex and Claude will share the same product model but use different detection internals.

Mitigation:

- keep both parsers shaped the same at the API boundary
- share only the generic merge and normalization logic
