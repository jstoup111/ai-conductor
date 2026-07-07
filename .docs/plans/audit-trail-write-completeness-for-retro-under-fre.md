# Implementation Plan: Audit-trail write-completeness for retro under fresh sessions

**Date:** 2026-07-07
**Design:** .docs/decisions/adr-2026-07-07-audit-trail-event-sink.md (APPROVED)
**Stories:** .docs/stories/audit-trail-write-completeness-for-retro-under-fre.md (Accepted)
**Conflict check:** Clean as of 2026-07-07 (6 degrading resolved — see .docs/conflicts/2026-07-07-audit-trail-write-completeness.md)
**Source:** jstoup111/ai-conductor#328 · Tier M · technical track

## Summary

Builds a single bus-subscribed audit writer that turns engine friction events into
normalized JSONL records in `.pipeline/audit-trail/events.jsonl`, adds the missing
`halt_cleared` emission, wires it in both entry points, and repoints retro's Data
Collection — 19 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/audit-trail.ts`**: `AuditRecord` type
  `{step, phase, event, reason?, cause?, attempt?, at}` with
  `event ∈ {gate_pass, gate_fail, kickback, retry, intervention, halt_cleared}`;
  `AuditTrailWriter` constructed with an explicit `projectRoot` (NEVER
  `process.cwd()` — suite leak-guard constraint), appending whole-line
  `appendFileSync` (O_APPEND, per `engineer-store.ts:262-272` convention) to
  `<projectRoot>/.pipeline/audit-trail/events.jsonl`, idempotent `mkdirSync` that
  never touches existing batch artifacts. Failures are LOUD: caught, written to
  stderr naming step+event, best-effort `WRITE-FAILED` marker — never rethrown into
  the bus (which swallows handler errors, `ui/events.ts:21-43`).
- **Mapping is an explicit allowlist** over existing bus events —
  `gate_verdict`→`gate_pass|gate_fail` (reason from the same in-memory `GateVerdict`,
  `gate-verdicts.ts:38-49`), `step_retry`→`retry`, `kickback`→`kickback`,
  `loop_halt`→`intervention`, `step_completed` (non-verdict steps)→`gate_pass`
  positive evidence. `phase` via `phaseForStep` (`resolved-config.ts:264-266`).
  Unmapped event types are ignored by design.
- **`halt_cleared` becomes a first-class `ConductorEvent`** (union extension in
  `types/events.ts` + union-validity test/fixture updates in the same diff). Emitted
  at the inline clear path; on the daemon side the `watchHaltCleared` callback
  (`daemon-deps.ts:294-337`) appends directly with `cause: 'operator' | 'rekick'`
  (rekick detected via the `HALT.cleared` sibling), synchronously, preserving the
  watcher's no-throw contract.
- **Wiring at both entry points**: `index.ts:765-768` (inline, beside
  `EventPersister`) and `daemon-cli.ts:536-545` (daemon — which today wires no
  persister at all). Daemon runs the engine in-process
  (`runConductorInWorktree`, `daemon-cli.ts:561-641`), so one writer instance per run
  covers it.
- **Sequencing**: writer core first (tasks 1–5), mapping per event type (6–11),
  `halt_cleared` (12–14), wiring (15–16), completeness invariants (17–18), retro/docs
  (19). Raw `.pipeline/events.jsonl` is untouched and remains retro's
  escalation-ladder source (conflict resolution vs retry-as-escalation).

## Prerequisites

- None beyond the checked-out worktree; `npm install` in `src/conductor` for vitest.
- Tests use tmpdir-isolated roots (nested `mkdtemp` parent — never scan `/tmp`
  breadth) and the env kill-switch guard for any spawn-adjacent code.

## Tasks

### Task 1: AuditRecord type + writer skeleton with O_APPEND append
**Story:** Story 1 (writer module), happy path 1–2
**Type:** infrastructure
**Steps:**
1. Write failing test: constructing `AuditTrailWriter(root)` and calling
   `record({step:'build', event:'retry', reason:'tests failed', attempt:2})` appends
   one line to `<root>/.pipeline/audit-trail/events.jsonl` parsing to the full
   `AuditRecord` with `phase:'BUILD'` (via `phaseForStep`) and numeric `at`.
2. Verify RED.
3. Implement `src/conductor/src/engine/audit-trail.ts`: `AuditRecord` type, writer
   class, single `appendFileSync(record + '\n')`, `at = Date.now()`.
4. Verify GREEN. 5. Commit "feat(audit-trail): AuditRecord writer core".
**Files likely touched:** `src/conductor/src/engine/audit-trail.ts` (new),
`src/conductor/test/engine/audit-trail.test.ts` (new)
**Dependencies:** none

### Task 2: Idempotent directory bootstrap that never touches batch artifacts
**Story:** Story 1, happy path 3 (amended — shared dir)
**Type:** happy-path
**Steps:**
1. Failing test: (a) no `.pipeline/audit-trail/` → first record creates it;
   (b) dir pre-seeded with `code-review-satisfied.md` + `batch-1/review.json` →
   append succeeds and those files are byte-identical after.
2. RED. 3. Implement `mkdirSync(..., {recursive:true})` in the append path.
4. GREEN. 5. Commit "feat(audit-trail): idempotent dir bootstrap, batch artifacts untouched".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 1

### Task 3: Paths root at injected projectRoot, never process.cwd()
**Story:** Story 1, negative path (amended — leak-guard constraint)
**Type:** negative-path
**Steps:**
1. Failing test: construct writer with root A, `process.chdir` to root B (tmpdir),
   record — file appears under A, nothing under B; grep-style assertion that
   `audit-trail.ts` contains no `process.cwd()`.
2. RED. 3. Implement (constructor stores absolute root; all joins from it).
4. GREEN. 5. Commit "feat(audit-trail): cwd-independent path derivation".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 1

### Task 4: Loud failure path — stderr + WRITE-FAILED marker, no throw
**Story:** Story 1, negative path 1 (review condition 2)
**Type:** negative-path
**Steps:**
1. Failing test: make the events.jsonl path unwritable (file where dir expected),
   record → no throw; stderr spy receives step+event; `WRITE-FAILED` marker exists
   (best-effort); engine-visible return is void.
2. RED. 3. Implement try/catch around append with self-report.
4. GREEN. 5. Commit "feat(audit-trail): loud non-throwing failure path".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 1

### Task 5: Concurrent append integrity
**Story:** Story 1, negative path 2
**Type:** negative-path
**Steps:**
1. Failing test: two writer instances on the same root append 100 records each
   concurrently (Promise.all over microtask-yielding loops) → exactly 200 lines, all
   `JSON.parse`-able.
2. RED (if append is multi-call). 3. Ensure single whole-line append per record.
4. GREEN. 5. Commit "test(audit-trail): concurrent append integrity".
**Files likely touched:** `audit-trail.test.ts`
**Dependencies:** Task 1

### Task 6: Bus subscription with explicit allowlist; unmapped types ignored
**Story:** Story 1, happy path 1 + negative path 3
**Type:** happy-path
**Steps:**
1. Failing test: `writer.subscribe(emitter)` + emitting a mapped event appends;
   emitting a UI-only event (e.g. `step_started`) appends nothing and does not error.
2. RED. 3. Implement `subscribe(events: ConductorEventEmitter)` registering one
   handler per allowlisted type (EventPersister pattern,
   `event-persister.ts:74-78`).
4. GREEN. 5. Commit "feat(audit-trail): bus subscription allowlist".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 1

### Task 7: gate_verdict → gate_pass/gate_fail with non-divergence
**Story:** Story 2, all criteria
**Type:** happy-path
**Steps:**
1. Failing test: emit `gate_verdict` with `{satisfied:false, reason:'stories missing
   Status: Accepted', checkedAt}` → `gate_fail` record with the exact reason and
   `at ≥ checkedAt`; emit satisfied:true → `gate_pass`; field-for-field derivation
   asserted (no re-computation).
2. RED. 3. Implement mapping from the event's verdict payload.
4. GREEN. 5. Commit "feat(audit-trail): gate verdict mapping (non-divergent)".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 6

### Task 8: Gate history preserved across fail-then-pass
**Story:** Story 2, negative path 1
**Type:** negative-path
**Steps:**
1. Failing test: sequence gate_fail then gate_pass for one step → BOTH lines present
   in order; final record agrees with a `GateVerdict` written via `writeVerdict` to
   `.pipeline/gates/<step>.json` in the same tmp root.
2. RED. 3. Implement (append-only already guarantees; test locks it).
4. GREEN. 5. Commit "test(audit-trail): history preserved vs latest-state gate file".
**Files likely touched:** `audit-trail.test.ts`
**Dependencies:** Task 7

### Task 9: step_retry → retry with attempt + empty-reason fallback
**Story:** Story 4, retry criteria
**Type:** happy-path
**Steps:**
1. Failing test: emit `step_retry` (attempt 2, reason 'tests failed') → retry record
   `{attempt:2, reason:'tests failed'}`; emit with empty/undefined reason → record
   still appended with the engine's fallback description, never dropped.
2. RED. 3. Implement mapping.
4. GREEN. 5. Commit "feat(audit-trail): retry mapping with reason fallback".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 6

### Task 10: kickback → kickback record with cause
**Story:** Story 4, kickback criteria
**Type:** happy-path
**Steps:**
1. Failing test: emit `kickback` `{from:'conflict_check', to:'architecture_review',
   evidence:'missing seam', count:1}` → kickback record with `step` = kicked-back-to
   step and `cause` containing from + evidence.
2. RED. 3. Implement.
4. GREEN. 5. Commit "feat(audit-trail): kickback mapping".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 6

### Task 11: loop_halt → intervention; cap-exceeded keeps both records
**Story:** Story 4 negative path 2 + Story 5 happy path 1
**Type:** happy-path + negative-path
**Steps:**
1. Failing test: emit `loop_halt` (reason payload) → intervention record with cause;
   emit kickback-then-loop_halt sequence (cap exceeded) → BOTH kickback and
   intervention records present.
2. RED. 3. Implement.
4. GREEN. 5. Commit "feat(audit-trail): intervention mapping".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 6

### Task 12: step_completed (non-verdict) → gate_pass positive evidence
**Story:** Story 3, happy paths (review condition 3)
**Type:** happy-path
**Steps:**
1. Failing test: emit `step_completed` with a successful status for a step with no
   gate verdict → one gate_pass record; emit `step_completed` for a step that ALSO
   emits gate_verdict → no duplicate (gate_verdict wins; exactly one pass record per
   step outcome).
2. RED. 3. Implement dedup rule (track steps with verdicts in the writer, or map
   step_completed→gate_pass only for steps absent from the verdict set).
4. GREEN. 5. Commit "feat(audit-trail): positive evidence for non-verdict steps".
**Files likely touched:** `audit-trail.ts`, `audit-trail.test.ts`
**Dependencies:** Task 7

### Task 13: halt_cleared joins the ConductorEvent union (+ union test/fixtures)
**Story:** Story 5, amended criterion (conflict resolution 1)
**Type:** infrastructure
**Steps:**
1. Failing test: type-level + runtime — construct `{type:'halt_cleared', step?,
   cause:'operator'|'rekick'}` event; update the event-union validity test
   (wave-c 4.1-7) and any golden event fixtures in the same commit.
2. RED. 3. Add to `types/events.ts` union.
4. GREEN. 5. Commit "feat(events): halt_cleared event type (+ union test/fixtures)".
**Files likely touched:** `src/conductor/src/types/events.ts`, event-union tests,
fixtures
**Dependencies:** none (parallel with 1–12)

### Task 14: Inline clear path emits halt_cleared
**Story:** Story 5, happy path 3
**Type:** happy-path
**Steps:**
1. Failing test: conductor-level — when the engine clears the HALT marker
   (`clearHaltMarker` caller at `conductor.ts:1561`), a `halt_cleared` event is
   emitted on the bus and (with writer subscribed) a record appended.
2. RED. 3. Emit at the clear site.
4. GREEN. 5. Commit "feat(conductor): emit halt_cleared on inline clear".
**Files likely touched:** `src/conductor/src/engine/conductor.ts`,
`conductor.test.ts`
**Dependencies:** Tasks 6, 13

### Task 15: Daemon watcher appends halt_cleared with operator/rekick cause
**Story:** Story 5, happy paths 1–2 (amended) + negative paths 1–2
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: (a) plain unlink of watched `.pipeline/HALT` → record with
   `cause:'operator'` in THAT worktree's events.jsonl; (b) rename to `HALT.cleared`
   → `cause:'rekick'`; (c) worktree removed between unlink and append → loud log, no
   throw, daemon alive; (d) `watchHaltCleared` on a missing dir still returns no-op
   dispose without throwing (contract preserved).
2. RED. 3. Implement append inside the callback (synchronous, before dispose can
   race), sibling-detection for cause.
4. GREEN. 5. Commit "feat(daemon): halt_cleared audit append with cause attribution".
**Files likely touched:** `src/conductor/src/engine/daemon-deps.ts`,
`daemon-deps.test.ts` (or daemon test file)
**Dependencies:** Tasks 1, 13

### Task 16: Inline wiring in index.ts
**Story:** Story 6, happy path 1
**Type:** infrastructure
**Steps:**
1. Failing test: the inline conduct entry constructs the writer beside
   `EventPersister` (`index.ts:765-768`) rooted at the project dir; an integration
   test drives a minimal run and asserts records appear.
2. RED. 3. Wire.
4. GREEN. 5. Commit "feat(index): wire audit writer (inline)".
**Files likely touched:** `src/conductor/src/index.ts`, integration test
**Dependencies:** Tasks 6, 12

### Task 17: Daemon wiring + non-vacuous regression guard
**Story:** Story 6, happy path 2 + negative path 1 (review condition 1)
**Type:** infrastructure + negative-path
**Steps:**
1. Failing test: daemon-mode test (`runConductorInWorktree` seam,
   `daemon-cli.ts:536-545/561-641`) with induced friction asserts records in the
   worktree's events.jsonl; regression guard: a structural assertion (or unit test on
   the wiring function) that fails if the writer instantiation is removed.
2. RED. 3. Wire in `daemon-cli.ts`.
4. GREEN. 5. Commit "feat(daemon-cli): wire audit writer (daemon)".
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, daemon test
**Dependencies:** Task 16

### Task 18: Completeness invariants — executed ⊆ recorded; skipped absent; drift guard
**Story:** Story 3, happy path 2 + negative paths 1–2
**Type:** negative-path
**Steps:**
1. Failing tests: (a) scripted multi-step run (existing conductor test harness,
   cf. `conductor.test.ts:5097-5136` pattern) asserts every executed step has ≥1
   record and tier-skipped steps have none; (b) drift test enumerating friction
   event fixtures against the writer's allowlist fails on an unmapped friction type.
2. RED. 3. Fix any gaps surfaced.
4. GREEN. 5. Commit "test(audit-trail): completeness + coverage-drift invariants".
**Files likely touched:** `conductor.test.ts` or `audit-trail.test.ts`
**Dependencies:** Tasks 12, 16

### Task 19: retro SKILL.md Data Collection + reconstructability test + CHANGELOG
**Story:** Story 7, all criteria
**Type:** happy-path + negative-path + docs
**Steps:**
1. Failing test: scripted induced gate-failure + retry run; a reader (test helper
   mirroring retro's Data Collection) surfaces both from events.jsonl ONLY (no
   `.pipeline/gates/`, no git); isolation variant: single-step fresh-session run's
   friction reconstructable from the audit trail alone; empty/missing events.jsonl
   despite executed steps → reported INCOMPLETE.
2. RED. 3. Update `skills/retro/SKILL.md` Data Collection: name
   `.pipeline/audit-trail/events.jsonl` as the gate/rework source; keep raw
   `.pipeline/events.jsonl` as the retry-escalation source (retry-as-escalation
   Story 4); specify INCOMPLETE behavior. Add CHANGELOG `[Unreleased]` Added entry.
   Run `test/test_harness_integrity.sh`.
4. GREEN. 5. Commit "feat(retro): audit-trail as gate-history source + CHANGELOG".
**Files likely touched:** `skills/retro/SKILL.md`, `CHANGELOG.md`, test helper
**Dependencies:** Tasks 17, 18

## Task Dependency Graph

```
1 ─┬─ 2
   ├─ 3
   ├─ 4
   ├─ 5
   ├─ 6 ─┬─ 7 ─┬─ 8
   │     │     └─ 12 ─┐
   │     ├─ 9         │
   │     ├─ 10        │
   │     └─ 11        │
   └─ 15 (also ← 13)  │
13 ─┬─ 14 (also ← 6)  │
    └─ 15             │
16 (← 6, 12) ─ 17 ─┬─ 19
18 (← 12, 16) ─────┘
```
Acyclic; 13 can run parallel with 1–12.

## Integration Points

- After Task 12: full mapping testable against a fake emitter end-to-end.
- After Task 16: inline `conduct` run produces a real audit trail (manually
  inspectable).
- After Task 17: daemon-hosted run produces records — the mode retro actually runs in.
- After Task 19: retro consumes the trail; issue #328 acceptance criteria all
  demonstrable.

## Coverage Mapping

| Story | Tasks |
|---|---|
| 1 writer module | 1, 2, 3, 4, 5, 6 |
| 2 gate non-divergence | 7, 8 |
| 3 positive evidence / completeness | 12, 18 |
| 4 kickback + retry | 9, 10, 11 |
| 5 HALT lifecycle | 11, 13, 14, 15 |
| 6 dual-mode wiring | 16, 17 |
| 7 retro reconstruction | 19 |

## Release-gate note (build time)

Internal-only change: no `bin/conduct` CLI, hook wiring, settings schema, or skill
symlink surface. `skills/retro/SKILL.md` is a content edit, not a symlink-target
change. If the self-host release-gate classifier still flags a canonical surface,
follow the waiver rules (CLAUDE.md / adr-2026-07-06-migration-gate-waiver) — do NOT
invent an empty migration block.

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task (explicit tasks 3–5, 8,
      11, 15, 18, 19)
- [x] No task exceeds ~5 minutes of focused work
- [x] Dependencies explicit and acyclic
