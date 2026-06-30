# Conflict Check: Pluggable Memory — Phase 1
**Date:** 2026-06-29
**Stories checked:** pluggable-memory.md (13 stories) vs all `.docs/stories/` + the PRD.
**Result:** 2 degrading findings, both RESOLVED. Zero blocking. Re-check clean.

## Conflict 1 — State gap (degrading → resolved): fallback memory unrecallable
**Type:** state-conflict | **Stories:** FR-13a (write-failure → default local store) vs FR-3 (recall from active platform).
**Description:** A fallback-written entry (active platform down) lands in the default local store, but recall reads the active platform → the entry is written but not surfaced; reconciliation was undefined.
**Resolution (operator-selected):** Reconcile-on-reconnect. Added **FR-13b**: fallback entries are reconciled into the active platform once it is available again, then recalled normally; until then they are a known, bounded invisible-but-safe gap. Stories + PRD updated.

## Conflict 2 — Scope clarity (degrading → resolved): two "harness memories"
**Type:** resource-contention (namespace) / scope | **Stories:** pluggable-memory vs phase-9.1 engineer store (`~/.ai-conductor/engineer/`).
**Description:** Both are "harness memory" under `~/.ai-conductor/`; the PRD did not state that pluggable-memory governs ONLY the `/memory` skill's per-project memory, risking future confusion. (No real contention — distinct subdirs; engineer store never touches `/memory`/`.memory/`.)
**Resolution:** Added an explicit **Non-Goal** excluding the engineer/retro-signal store. PRD updated.

## Re-check
After resolutions, no blocking or degrading conflicts remain. The earlier FR-9/FR-5, FR-3/FR-9, FR-11/FR-12 tensions were already reconciled by the clarification pass.
