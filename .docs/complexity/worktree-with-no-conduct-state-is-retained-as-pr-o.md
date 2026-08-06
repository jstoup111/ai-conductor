# Complexity: Worktree with no conduct-state is retained as pr-open-awaiting-main and never dispatched

Tier: M

## Rationale

Two distinct subsystems change together:

1. **Reporting** (`src/conductor/src/engine/daemon-dashboard.ts`) — split the
   never-started worktree case out of the retained bucket, derive each retained row's
   reason from real PR state instead of a hardcoded string, and render an
   operator-legible exclusion reason + remedy for every non-dispatched slug.
2. **Dispatch** (`src/conductor/src/engine/daemon-runner.ts`, `daemon.ts`) — guarantee
   that no dispatch outcome leaves a feature excluded without an operator-clearable
   marker.

Signals: no data models, no auth, no new integrations, no state machine. One new
outbound call surface (PR-state lookup for the retained reason, already available via the
existing `gh` seam). Story count is expected to be mid-single-digit with a mandatory
negative path (a genuinely shipped, PR-open worktree must STILL be excluded from
dispatch — this must not regress).

Not S: it crosses the reporting/dispatch boundary and adds a real external lookup.
Not L: bounded to three files in one engine, no architectural reshaping.
