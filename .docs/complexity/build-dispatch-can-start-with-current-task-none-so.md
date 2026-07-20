# Complexity: build-dispatch-can-start-with-current-task-none-so

Tier: S

## Rationale

- Three small, localized changes on existing seams: (1) a deterministic check at the build
  dispatch seam (conductor.ts ~2674-2701) mirroring the existing `build-step-active` marker
  write; (2) a consecutive-abstention loudness counter on the already-written
  `.pipeline/dispatch-count` lines (session-hook-assets.ts:68-75, attribution-enforcement.ts:90-98);
  (3) treating `Task: none` lines as an error state in the same reader.
- No new models, integrations, auth, or state machines; extends the established #519
  abstain-or-loud pattern (adr-2026-07-11-attribution-abstain-or-loud.md) to the dispatch seam.
- Existing test files cover every touched seam (attribution-conductor-wiring.test.ts,
  session-hook-assets.test.ts, attribution-enforcement.test.ts) — targeted additions only.
