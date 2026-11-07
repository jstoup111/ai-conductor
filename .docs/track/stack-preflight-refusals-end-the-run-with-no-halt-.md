# Track: Stack preflight refusals end the run with no HALT or reason

Track: technical

Scope boundary: Balanced. Every stopping `runStackPreflight` result carries a specific detail and is
made observable for all three callers (conductor resume, the rebase step, daemon rekick): a
needs-human HALT whose first line is the detail plus a `loop_halt` event, never overwriting an
existing live HALT. A `live-owner` journal refusal writes a `mechanical`-class HALT naming the owner,
which the daemon's existing base-advance re-kick may clear (operator decision 2026-10-26). Excluded: #3436's closure-ref versus repairing-marker
inconsistency detection, the conductor's generic pre-loop terminal-marker backstop, and any
dependency on spec PR #3435's `RunRestackResult.detail`.

Engine diagnostics for an internal restack boundary; no user-facing product requirements, so
acceptance lives directly in stories.
