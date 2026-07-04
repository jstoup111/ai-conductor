# Implementation Plan: Daemon kickback log visibility

**Date:** 2026-07-04
**Design:** .docs/decisions/adr-2026-07-04-kickback-event-emission-and-log-prominence.md (APPROVED, amended), .docs/decisions/architecture-review-2026-07-04-daemon-kickback-log-visibility.md (APPROVED WITH CONDITIONS)
**Stories:** .docs/stories/daemon-logs-surface-kickback-steps-visibly.md (Accepted, 4 stories)
**Conflict check:** Clean as of 2026-07-04 (.docs/conflicts/2026-07-04-daemon-kickback-log-visibility.md)
**Source:** jstoup111/ai-conductor#240

## Summary

Makes every backward pipeline move visible in the daemon log: restyles the kickback line to
an undimmed `↩ KICKBACK:` format, emits kickback events (with shared-counter cap
enforcement) for currently-silent DECIDE-phase amendment kickbacks, and renders the
currently-dropped `navigation_back` event. 12 tasks.

## Technical Approach

- **Renderer (`src/conductor/src/daemon-cli.ts`, `renderDaemonEvent` ~:576-623).** The
  `kickback` case drops the leading dim `·` and renders
  `↩ KICKBACK: <from> re-opened <to>[ — <evidence>] (×<count>)` in bold yellow
  (`chalk.bold.yellow`); the count stays undimmed so the whole line strips clean. A new
  `navigation_back` case renders `↰ BACK: <from> → <to> (operator)` in yellow. All other
  cases are byte-for-byte unchanged. `test/engine/daemon-render.test.ts` is the format
  contract — expectations change in the SAME commit as the renderer (RED first).
- **Engine (`src/conductor/src/engine/conductor.ts`, `advanceTail`).** Extract the existing
  tail kickback scan (:1905-1933: count → emit → cap-HALT → navigateBack) into a private
  helper `scanKickbackVerdicts(step, state, kickbackCounts, verdicts, topo, {navigate})`
  returning `'halt' | 'kicked' | null`. The tail calls it with `navigate: true` (behavior
  identical); a new call **before** the front-half early return (:1869-1871) uses
  `navigate: false` — reads verdicts, emits the same event shape, increments the SAME
  `kickbackCounts` map, HALTs past `MAX_KICKBACKS_PER_GATE` via the identical sequence
  (`.pipeline/HALT` + `surfaceRemediationPr` + `loop_halt`, return 'halt'), and otherwise
  leaves the linear `i++` untouched (returns null from advanceTail as today). Exactly-once
  emission holds because both scans match on `v.kickback.from === <completed step>` and a
  verdict's `from` equals exactly one step per write.
- **No event-shape or state changes.** `kickback` and `navigation_back` already exist in
  the `ConductorEvent` union; verdict writing, `markDownstreamStale`, selector routing, and
  step statuses are untouched.
- **Sequencing.** Renderer first (pure, fast feedback), file-log parity second, then the
  engine refactor + front-half emission, then integration coverage, docs last.

## Prerequisites

- `npm install` in `src/conductor` for this worktree (worktree-local node_modules).
- Run tests with `rtk proxy npx vitest run` (RTK swallows vitest output otherwise).

## Tasks

### Task 1: Restyle the kickback render case
**Story:** Story 1 — happy paths 1-2, negative path 1 (NO_COLOR)
**Type:** happy-path

**Steps:**
1. Write failing test: update `daemon-render.test.ts` kickback expectations to
   `['↩ KICKBACK: build re-opened plan — AC missing (×1)']` (color off), add a `count: 2`
   case asserting `(×2)`, and a color-on case asserting ANSI present with underlying text
   `↩ KICKBACK: build re-opened plan — AC missing (×1)` after stripping.
2. Verify test fails (RED) — current output is `· ↩ kickback: … (×1)`.
3. Implement: rewrite the `kickback` case — no `dot`, `chalk.bold.yellow` over
   `↩ KICKBACK: <from> re-opened <to>`, evidence via existing ternary, ` (×${count})`
   plain (no `chalk.dim`).
4. Verify test passes (GREEN); all other render cases still pass unmodified.
5. Commit: "feat(daemon-log): render kickbacks as prominent undimmed KICKBACK lines"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — kickback case in renderDaemonEvent
- src/conductor/test/engine/daemon-render.test.ts — kickback expectations

**Dependencies:** none

### Task 2: Missing-evidence kickback line has no dangling separator
**Story:** Story 1 — negative path 2
**Type:** negative-path

**Steps:**
1. Write failing/pinning test: `{ …kickback, evidence: undefined }` renders
   `['↩ KICKBACK: build re-opened plan (×1)']` — no `— undefined`, no trailing `— `.
2. Verify (RED if Task 1's rewrite regressed the ternary; otherwise pins behavior).
3. Implement: adjust the evidence ternary if needed.
4. Verify GREEN.
5. Commit: "test(daemon-log): pin KICKBACK line without evidence"

**Files likely touched:**
- src/conductor/test/engine/daemon-render.test.ts — new case
- src/conductor/src/daemon-cli.ts — only if the ternary needs adjusting

**Dependencies:** Task 1

### Task 3: Render navigation_back as an operator BACK line
**Story:** Story 4 — happy path 1, negative path 1 (color off)
**Type:** happy-path

**Steps:**
1. Write failing test: `{ type: 'navigation_back', from: 'manual_test', to: 'build' }`
   renders `['↰ BACK: manual_test → build (operator)']` color-off; color-on case asserts
   ANSI + same stripped text.
2. Verify test fails (RED) — currently renders nothing (default case).
3. Implement: add `navigation_back` case, `chalk.yellow`, before `default`.
4. Verify GREEN.
5. Commit: "feat(daemon-log): render operator back-navigation as BACK lines"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — new case
- src/conductor/test/engine/daemon-render.test.ts — new cases

**Dependencies:** none (parallel with Task 1)

### Task 4: KICKBACK vs BACK distinctness + rendered-set guard
**Story:** Story 4 — happy path 2, negative path 2
**Type:** negative-path

**Steps:**
1. Write failing test: (a) render one of each; assert the kickback line contains `KICKBACK`
   and not `(operator)`, the back line contains `BACK` + `(operator)` and not `KICKBACK`;
   assert `/\bKICKBACK\b/` matches only the kickback line. (b) Feed every `ConductorEvent`
   variant through `lines()`; assert the set of types producing output is exactly the
   previous set ∪ {navigation_back}.
2. Verify RED/GREEN as appropriate (b fails if any other type accidentally renders).
3. Implement: none expected — this is a guard.
4. Verify GREEN.
5. Commit: "test(daemon-log): guard rendered-event set and KICKBACK/BACK distinctness"

**Files likely touched:**
- src/conductor/test/engine/daemon-render.test.ts — new describe block

**Dependencies:** Tasks 1, 3

### Task 5: File-log parity — ANSI-free KICKBACK anchor in daemon.log
**Story:** Story 2 — happy paths 1-2, negative path 1
**Type:** happy-path

**Steps:**
1. Write failing test (in `test/engine/daemon-log.test.ts` or a new
   `daemon-log-kickback.test.ts`): with `chalk.level` forced >0, push a kickback event
   through the real sink composition (`renderDaemonEvent` → strip-ANSI →
   `formatDaemonLogLine` → file, mirroring `daemon-cli.ts` log()); assert the written line
   is timestamped, contains `KICKBACK: prd_audit re-opened build`, and has zero ANSI bytes.
2. Verify RED (test doesn't exist yet), then GREEN — bold+yellow nested styles must strip
   clean.
3. Implement: none expected; fix stripping only if nested styles leak.
4. Add grep-anchor uniqueness assertion: render every event variant; only the kickback
   line contains the substring `KICKBACK`.
5. Commit: "test(daemon-log): KICKBACK lines are ANSI-free and greppable in daemon.log"

**Files likely touched:**
- src/conductor/test/engine/daemon-log.test.ts (or new sibling test file)

**Dependencies:** Task 1

### Task 6: Rotation preserves the kickback line intact
**Story:** Story 2 — negative path 2
**Type:** negative-path

**Steps:**
1. Write failing test: fill the log to just under the 1 MB rotation cap, write a kickback
   line, trigger rotation with a subsequent write; assert the kickback line exists intact
   (single complete line) in `daemon.log.1`.
2. Verify RED then GREEN (rotation is whole-file, so expected GREEN — this pins it).
3. Implement: none expected.
4. Commit: "test(daemon-log): rotation keeps KICKBACK lines intact"

**Files likely touched:**
- src/conductor/test/engine/daemon-log.test.ts

**Dependencies:** Task 5

### Task 7: Extract shared kickback-scan helper (no behavior change)
**Story:** Story 3 — enabler (architecture-review condition 2: one counter, one HALT sequence)
**Type:** refactor

**Steps:**
1. Confirm existing gate-loop tests green (baseline).
2. Implement: extract `advanceTail`'s kickbackTargets loop (:1905-1933) into
   `scanKickbackVerdicts(step, state, kickbackCounts, verdicts, topo, {navigate: boolean})`
   → `'halt' | 'kicked' | null`; tail calls with `navigate: true`, preserving order:
   count++ → emit kickback → cap-exceeded? HALT-sequence : navigateBack.
3. Verify: full suite green, byte-identical behavior (kickback + ping-pong HALT
   integration tests in `gate-loop.test.ts` pass unmodified).
4. Commit: "refactor(conductor): extract shared kickback verdict scan from advanceTail"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — helper extraction

**Dependencies:** none (parallel with renderer tasks)

### Task 8: Front-half emission at detection time, routing unchanged below cap
**Story:** Story 3 — happy paths 1-2
**Type:** happy-path

**Steps:**
1. Write failing integration test (`gate-loop.test.ts`): a front-half step
   (`conflict_check`-shaped) completes leaving a kickback verdict
   `{satisfied:false, kickback:{from:'conflict_check', evidence:'incompatible ADR seam'}}`
   on `architecture_review`; assert exactly one `kickback` event
   `{from:'conflict_check', to:'architecture_review', evidence, count:1}` fires at that
   step's completion, AND the subsequent step order below the cap is identical to a
   baseline run (linear to `build`, selector re-opens architecture afterward — no
   navigateBack at detection, statuses untouched by the scan).
2. Verify RED — no event fires today (front-half early return).
3. Implement: in `advanceTail`, before the `firstLoopIndex` early return, call
   `scanKickbackVerdicts(…, {navigate: false})`; on 'halt' propagate 'halt'; otherwise
   still return null.
4. Verify GREEN.
5. Commit: "feat(conductor): emit kickback events for front-half amendment kickbacks"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — advanceTail front-half call
- src/conductor/test/integration/gate-loop.test.ts — new scenario

**Dependencies:** Task 7

### Task 9: Non-kickback and mismatched-from verdicts emit nothing
**Story:** Story 3 — negative paths 3-4 (no-provenance; wrong `from`)
**Type:** negative-path

**Steps:**
1. Write failing/pinning unit tests: (a) front-half step completes with a plain
   unsatisfied upstream verdict (no `kickback` field) → zero kickback events; (b) a
   kickback verdict with `kickback.from: 'stories'` present when `conflict_check`
   completes → zero events for conflict_check's scan.
2. Verify RED/GREEN (guards the scan predicate).
3. Implement: none expected.
4. Commit: "test(conductor): front-half scan ignores non-kickback and foreign verdicts"

**Files likely touched:**
- src/conductor/test/integration/gate-loop.test.ts (or engine unit test)

**Dependencies:** Task 8

### Task 10: One shared per-gate counter across both scans
**Story:** Story 3 — happy path 3, negative path 2 (shared counter)
**Type:** negative-path

**Steps:**
1. Write failing test: same gate re-opened once via front-half scan and then via tail
   scan; assert the second event carries `count: 2` (single accumulating counter).
2. Verify RED if implementation accidentally uses a separate map; GREEN otherwise.
3. Implement: ensure both call sites pass the same `kickbackCounts` map (they do by
   construction — pin it).
4. Commit: "test(conductor): front-half and tail kickbacks share one per-gate cap counter"

**Files likely touched:**
- src/conductor/test/integration/gate-loop.test.ts

**Dependencies:** Task 8

### Task 11: Cap-exceeded front-half kickback HALTs identically to tail
**Story:** Story 3 — negative path 1; architecture-review condition 2
**Type:** negative-path

**Steps:**
1. Write failing integration test (daemon:true, isolated repo per rebase-test
   convention): drive front-half re-opens of one gate past `MAX_KICKBACKS_PER_GATE`;
   assert `.pipeline/HALT` exists with a ping-pong reason naming gate and count, a
   `loop_halt` event fired (✋ path), the run stopped, and the kickback event itself was
   still emitted with the truthful count before halting.
2. Verify RED then GREEN (Task 7's helper already carries the HALT sequence; this proves
   the `navigate: false` path reaches it).
3. Implement: none expected beyond wiring already done in Task 8.
4. Commit: "test(conductor): front-half kickback ping-pong halts at the shared cap"

**Files likely touched:**
- src/conductor/test/integration/gate-loop.test.ts

**Dependencies:** Task 8

### Task 12: Docs + changelog
**Story:** all — repo "Docs track features" rule
**Type:** infrastructure

**Steps:**
1. Update `src/conductor/README.md` (daemon log section): document the `↩ KICKBACK`,
   `↰ BACK`, and existing ✋ line meanings and the KICKBACK grep anchor; mention front-half
   amendment kickbacks now log and count toward the cap.
2. Add `CHANGELOG.md` `[Unreleased]` entries — Added (front-half kickback
   emission + BACK line), Changed (kickback line format; front-half re-opens now enforce
   the existing cap).
3. Verify `test/test_harness_integrity.sh` passes.
4. Commit: "docs(conductor): document prominent kickback/BACK daemon log lines"

**Files likely touched:**
- src/conductor/README.md, CHANGELOG.md

**Dependencies:** Tasks 1-11 (content reflects final behavior)

## Task Dependency Graph

```
Task 1 ─→ Task 2
   │  └──→ Task 5 ─→ Task 6
Task 3 ─┐
Task 1 ─┴→ Task 4
Task 7 ─→ Task 8 ─→ Task 9
              ├───→ Task 10
              └───→ Task 11
Tasks 1-11 ─→ Task 12
```
(Renderer chain 1-6 and engine chain 7-11 are independent and parallelizable.)

## Integration Points

- After Task 4: full renderer surface testable — every event type's line (or silence) pinned.
- After Task 8: end-to-end DECIDE amendment visibility — a real front-half kickback verdict
  produces a prominent line in a live daemon log.
- After Task 11: complete cap story — oscillation in either half halts with ✋ + HALT marker.

## Coverage

| Story criterion | Task(s) |
|---|---|
| S1 happy 1-2 (format, ×N) | 1 |
| S1 happy 3 (other lines unchanged) | 1, 4b |
| S1 negative 1 (NO_COLOR tag-only prominence) | 1 |
| S1 negative 2 (missing evidence) | 2 |
| S2 happy 1-2 (file line, grep anchor) | 5 |
| S2 negative 1 (ANSI stripped) | 5 |
| S2 negative 2 (rotation intact) | 6 |
| S3 happy 1 (detection-time event) | 8 |
| S3 happy 2 (routing unchanged below cap) | 8 |
| S3 happy 3 (count accumulates) | 10 |
| S3 negative 1 (cap → HALT sequence) | 11 |
| S3 negative 2 (shared counter, no 2×cap spin) | 10 |
| S3 negative 3 (no provenance → silent) | 9 |
| S3 negative 4 (foreign from → silent) | 9 |
| S3 negative 5 (tail no-duplicate, exactly-once) | 8 (exactly-one assertion) |
| S4 happy 1 (BACK line) | 3 |
| S4 happy 2 (non-conflatable, grep -w) | 4 |
| S4 negative 1 (distinct without color) | 3, 4 |
| S4 negative 2 (no accidental un-silencing) | 4 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
