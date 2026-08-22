# Coherence: The judging engine is part of the build_review cache identity (#1759)

**Date:** 2026-08-21
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD).
**Outcome source:** the five Desired-outcome bullets of jstoup111/ai-conductor#1759. Bullet 5 (an operator cache-clear command) is out of scope by the operator-confirmed track boundary and ADR D7; it is recorded as `gap` and waived in `.docs/coherence-waivers/cached-rubric-verdicts-survive-an-engine-change-so.md`.
**ADR change set:** `adr-2026-08-21-engine-identity-in-build-review-cache-key` (new); `adr-2026-08-13-engine-managed-build-review-rubric-branches` (additive amendment note only).

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | "A cached rubric verdict produced by a different engine build is not served; that rubric re-judges and the lap records a fresh result." Story 1 misses on engine stamp and dispatches; Story 2 misses on skill text. |
| outcome | outcome-2 | story-1, story-3 | covered | "After a rubric-behavior change ships, the next dispatch reflects it with no operator action." Story 1 HP2 writes a fresh entry under the new stamp; Story 3 HP3 resolves identity per dispatch with no operator step. |
| outcome | outcome-3 | story-3 | covered | "A cached verdict from the same engine over the same projection is still served." Story 3 HP1/HP2 keep the hit path and restamping unchanged. |
| outcome | outcome-4 | story-5, story-4 | covered | "When a cached verdict is discarded because the engine changed, the daemon log says so, naming the rubric." Story 5 emits and renders the event with rubric and reason; Story 4 makes the legacy transition emit it too. |
| outcome | outcome-5 |  | gap | outcome-5 — "An operator has a supported command to discard cached rubric verdicts for a feature." Excluded by the track's scope boundary (operator chose minimal + log event) and ADR D7; waived, see waiver file. |
| story | story-1 | task-1, task-4 | covered | Stamp derivation with the `dev` sentinel (Task 1) and the `engine-version-mismatch` classification with ordering negatives (Task 4). |
| story | story-2 | task-2, task-5, task-8 | covered | Raw-bytes digest and whitespace negative (Task 2), `skill-digest-mismatch` and single-reason ordering (Task 5), unreadable skill → `cache-read-failed` (Task 8). |
| story | story-3 | task-9, task-11 | covered | Identity resolved once per dispatch and injected (Task 9); same-engine reuse, per-rubric invalidation, and the write-rejection/no-globals checks (Task 11 plus Tasks 1 and 3 via Story 3 NP1/NP2). |
| story | story-4 | task-3 | covered | Staged parse: absent field allowed, malformed/extra-key → `invalid-entry` (Task 3); legacy → `engine-version-mismatch` classification asserted in Task 4; legacy discard event in Task 7. |
| story | story-5 | task-6, task-7, task-10 | covered | Event type and total sink declaration (Task 6), coordinator emission on exactly two reasons and silence otherwise (Task 7), terminal line naming rubric and reason (Task 10). |
| task | task-1 | story-1 | covered | Engine stamp helper; infrastructure task serving Story 1 HP3/HP4/NP3 and Story 3 NP1. |
| task | task-2 | story-2 | covered | Skill digest helper; infrastructure task serving Story 2 HP3/NP1 and the unreadable-file precondition of NP2. |
| task | task-3 | story-4 | covered | Cache schema and staged parse; also satisfies Story 3 NP2 (write rejects missing identity). |
| task | task-4 | story-1 | covered | `engine-version-mismatch` classification and check ordering; also Story 4 HP1/NP3. |
| task | task-5 | story-2 | covered | `skill-digest-mismatch` classification after the engine check. |
| task | task-6 | story-5 | covered | Event variant and `EVENT_SINKS` declaration; infrastructure task serving Story 5 HP2/NP3. |
| task | task-7 | story-5 | covered | Coordinator threads identity and emits the discard event; also Story 1 HP2 and Story 4 HP2. |
| task | task-8 | story-2 | covered | Unreadable skill text settles as the existing `cache-read-failed` reason (conflict-check resolution; no vocabulary growth). |
| task | task-9 | story-3 | covered | Dispatch-site resolution and injection; acceptance-level `events.jsonl` observation for Story 5. |
| task | task-10 | story-5 | covered | Terminal render names rubric and reason. |
| task | task-11 | story-3 | covered | Coordinator-level reuse and per-rubric invalidation regression; Preserves the unchanged-projection hit contract. |
| adr | adr-2026-08-21-engine-identity-in-build-review-cache-key | story-1, story-2, story-3, story-4, story-5 | covered | D1/D2 → Story 1; D3 (as amended) → Story 2; D6 → Story 3; D4 → Story 4; D5 → Story 5. D7's exclusions are honoured: no story or task adds a clear command, bulk clear, or dashboard surface, and no task touches the disposition store. |
| adr | adr-2026-08-13-engine-managed-build-review-rubric-branches | story-1, story-3 | covered | §7 (amended additively) still holds: skips precede the cache, malformed entries never reuse (Story 4 NP1/NP2), and the hit path is unchanged (Story 3). |

Consistency pass (§4d): cross-layer pairs checked both directions — outcome-3 ("same engine … still served") vs Task 3/4 (legacy entries miss): satisfying both holds because legacy entries are by definition not "same engine" (they carry no identity); ADR D4 vs Story 4 NP1 (malformed identity → `invalid-entry`) consistent; outcome-4 vs Task 7's silence on other reasons consistent (outcome names only engine-change discards). No `fail` rows.
