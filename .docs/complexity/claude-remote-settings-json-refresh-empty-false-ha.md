# Complexity: Claude remote-settings.json empty-to-{} refresh false-halts self-host builds (#3096)

Tier: S

Rationale: one engine module (`src/conductor/src/engine/self-host/live-boundary.ts`) gains a small
per-provider table naming the Claude provider-state root file `remote-settings.json`, and the
manifest digest step canonicalizes that one path's content when it is semantically empty (zero
bytes, whitespace only, or JSON that parses to an empty object). No new exclusion entry, no data
model, external integration, auth, event, CLI, hook, or schema change; the halt-reason format is
unchanged. Tests extend the existing `src/conductor/test/engine/self-host/live-boundary.test.ts`.
Expected story count 1. Per tier rules: architecture-diagram, architecture-review,
conflict-check, coherence-check are skipped. Operator pre-accepted the S tier for this issue
(2026-10-10).
