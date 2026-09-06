Waives: hook wiring

Rationale: This feature edits the body of the generated `hooks/claude/docs-guard.sh`
(canonical-path resolution and a fail-closed NUL guard) and its source in
`src/conductor/src/engine/session-hook-assets.ts`. The self-host release-gate classifier flags
any `hooks/` path as the "hook wiring" breaking surface (self-host/release-gate.ts:133), but
no wiring changes: the hook keeps its name, its event, its settings.json registration, and its
exit-code contract (0 pass, 2 block). Consumers receive the updated hook body through the
ordinary `bin/install --update` copy with no settings edit, no path change, and nothing for
`bin/migrate` to run. Per adr-2026-07-06-migration-gate-waiver, an internal-only edit flagged
by the path-based classifier is waived rather than given an empty migration block.
