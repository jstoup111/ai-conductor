# Coherence: Deterministic test-suite BUILD gate

**Date:** 2026-07-29
**Tier:** M
**Track:** technical
**Plan stem:** `2026-07-29-deterministic-test-suite-step`

This chat-origin technical specification has no staged intake-outcome rows and
no product PRD/FR rows. Story and task rows are grounded in the accepted stories
and the implementation plan bearing the same feature name.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-4, task-5, task-6, task-13, task-19 | covered | Registry, fan-out, capped ordering, no-review failure, topology, and final acceptance tasks collectively cover every Story 1 criterion. |
| story | story-2 | task-2, task-4, task-7, task-8, task-9, task-10, task-13, task-19 | covered | Native outcomes, single-writer joining, dual failure, uncertainty, interruption, proof freshness, and lifecycle state cover Story 2. |
| story | story-3 | task-1, task-3, task-14, task-15, task-16, task-17, task-18, task-19 | covered | Engine-native execution, provider exclusion, catalog removal, CLI guidance, two-host cleanup, migration, and acceptance coverage map to Story 3. |
| story | story-4 | task-8, task-10, task-11, task-12, task-19 | covered | Fail-closed outcomes, proof reuse/execution, ignored coverage, locking, timeout, cleanup, and end-to-end regression cover Story 4. |
| task | task-1 | story-1, story-3 | covered | Declares the native deterministic group and preserves the engine step. |
| task | task-2 | story-1, story-2 | covered | Supplies the shared native branch seam required for fan-out and joined outcomes. |
| task | task-3 | story-3 | covered | Structurally prevents a native branch from reaching providers or skills. |
| task | task-4 | story-1, story-2 | covered | Implements concurrent pass/pass execution and the single-writer join. |
| task | task-5 | story-1 | covered | Pins stable cap-one behavior and shared resource bounding. |
| task | task-6 | story-1 | covered | Prevents model and SHIP dispatch after either single deterministic failure. |
| task | task-7 | story-2 | covered | Consolidates dual evidence, rewind, and budget accounting. |
| task | task-8 | story-2, story-4 | covered | Fails closed on exceptions and indeterminate verifier outcomes. |
| task | task-9 | story-2 | covered | Preserves settled progress without manufacturing completion on interruption. |
| task | task-10 | story-2, story-4 | covered | Keeps content-addressed proof reuse and stale execution in the new group. |
| task | task-11 | story-4 | covered | Characterizes ignored coverage output without broadening fingerprint semantics. |
| task | task-12 | story-4 | covered | Retains lock, timeout, cancellation, and process-tree cleanup guarantees. |
| task | task-13 | story-1, story-2 | covered | Aligns selector, resume, completion, rebase, and invalidation topology. |
| task | task-14 | story-3 | covered | Removes the shipped skill surface while preserving engine and CLI machinery. |
| task | task-15 | story-3 | covered | Makes model-free execution explicit in policy and generated metadata. |
| task | task-16 | story-3 | covered | Routes interactive aggregate verification to the deterministic CLI. |
| task | task-17 | story-3 | covered | Safely prunes obsolete harness-owned links for both host catalogs. |
| task | task-18 | story-3 | covered | Supplies the required executable, idempotent consumer migration. |
| task | task-19 | story-1, story-2, story-3, story-4 | covered | Pins the complete cross-story acceptance matrix with internal fakes. |
