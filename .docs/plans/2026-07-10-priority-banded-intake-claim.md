# Implementation Plan: Priority-banded intake claim (#461)

**Date:** 2026-07-10
**Design:** technical track — `adr-2026-07-10-intake-claim-priority-banding` (APPROVED) + `.docs/architecture/2026-07-10-priority-banded-intake-claim.md`
**Stories:** `.docs/stories/2026-07-10-priority-banded-intake-claim.md` (TR-1..TR-4, Accepted)
**Conflict check:** Clean as of 2026-07-10 (`.docs/conflicts/2026-07-10-priority-banded-intake-claim.md`)

## Summary

Make `conduct-ts engineer claim` serve pending ideas priority-band-first (reusing PR #460's
band vocabulary), oldest-first within a band, failing open to today's FIFO on any label-read
outage. 12 tasks.

## Technical Approach

- **`backlog-priority.ts`** gains one additive export: the band ranking (today the
  module-private `BAND_RANK`). Exported as `PRIORITY_BAND_RANK: Record<PriorityBand, number>`;
  `orderBacklog` keeps using it internally. No behavior change on the daemon side.
- **`dependency-claim.ts`** gains a band-resolution seam and a banded walk:
  - New exported helper `resolveClaimBands(reader: IssueLabelReader, refs: string[]):
    Promise<Map<string, PriorityBand>>` — calls the reader once with the unique refs, maps
    labels through `parsePriorityLabels` (`not-found`/missing → `unlabeled`). Throws bubble
    to the caller (outage signal).
  - `DependencyClaimDeps` gains optional `resolveBands?: (refs: string[]) => Promise<Map<string,
    PriorityBand>>` and `log?: (msg: string) => void`. **Absent `resolveBands` ⇒ byte-for-byte
    today's behavior** (drain order = FIFO) — every existing test keeps passing unmodified.
  - `claimUnblocked` walk change: (1) drain ALL pending via the injected queue's `claim()`
    into `held` (the finally-release bookkeeping already exists); (2) if `resolveBands` is
    present, call it with the held envelopes' sourceRefs — on success stable-sort `held` by
    `PRIORITY_BAND_RANK` (no sourceRef → `no-issue`), preserving drain order (which is
    `receivedAt` FIFO from the queue's filename sort) within a band; on throw, `log` exactly
    one warning and keep drain order; (3) evaluate blocker verdicts in the final order —
    first `unblocked` is removed from `held` and returned; deferred entries accumulate for
    the all-blocked report exactly as today; (4) `finally` releases everything left in
    `held` (selected removed, so never re-released; never-evaluated candidates are released
    too — the new drain-first shape makes this the no-loss invariant).
- **`engineer-cli.ts` claim case** wires the real reader: `resolveBands = (refs) =>
  resolveClaimBands(ghIssueLabelReader((args) => gh(args, { cwd: process.cwd() })), refs)`,
  `log: printErr`. The claim JSON output shape is unchanged; band/outage info goes to stderr
  only.
- **`queue.ts` is untouched** — banding sorts envelopes the walk already holds above the
  atomic-rename primitive.
- Sequencing: export first (everything imports it), then the pure helper, then the walk
  (happy → stability → fail-open → composability/no-loss), then CLI wiring, then docs/gates.

## Prerequisites

- Worktree has its own `npm install` in `src/conductor` (RTK/vitest convention).
- All tests run from `src/conductor`: `cd src/conductor && rtk proxy npx vitest run <file>`.

## Tasks

### Task 1: Export the band ranking from backlog-priority.ts
**Story:** TR-1 (Done When: single exported ranking, no duplicate map)
**Type:** infrastructure

**Steps:**
1. Write failing test: `PRIORITY_BAND_RANK` is exported from `backlog-priority.ts`, ranks
   `no-issue:0 < critical:1 < high:2 < medium:3 < low:4 < unlabeled:5`.
2. Verify test fails (RED).
3. Implement: rename module-private `BAND_RANK` to exported `PRIORITY_BAND_RANK` (update the
   two internal uses in `orderBacklog`).
4. Verify test passes + existing `backlog-priority.test.ts` suite still green.
5. Commit: "feat(priority): export PRIORITY_BAND_RANK for cross-scheduler reuse"

**Files:**
- src/conductor/src/engine/backlog-priority.ts
- src/conductor/test/backlog-priority.test.ts

**Dependencies:** none

### Task 2: resolveClaimBands helper — labels to band map
**Story:** TR-1 (404 → unlabeled; multi-label highest wins; claim-time read)
**Type:** happy-path

**Steps:**
1. Write failing tests in `dependency-claim.test.ts`: with a fake `IssueLabelReader`,
   `resolveClaimBands` returns `critical` for a `priority: critical` ref, `unlabeled` for a
   `not-found` ref and for a ref absent from the reader result, highest band for a
   multi-label ref; a throwing reader propagates the throw (no catch here).
2. Verify RED.
3. Implement `resolveClaimBands(reader, refs)` in `dependency-claim.ts`: unique refs, one
   reader call, `parsePriorityLabels` per ref.
4. Verify GREEN.
5. Commit: "feat(intake): resolveClaimBands maps issue labels to priority bands"

**Files:**
- src/conductor/src/engine/engineer/intake/dependency-claim.ts
- src/conductor/test/engine/engineer/intake/dependency-claim.test.ts

**Dependencies:** Task 1

### Task 3: Banded walk — drain all, sort band-first, critical beats older low
**Story:** TR-1 happy paths 1–2 (critical(newest) beats low(oldest); band drain across claims)
**Type:** happy-path

**Steps:**
1. Write failing tests: fake queue with pending {A: low, oldest; B: critical, newest}, both
   unblocked, `resolveBands` injected → claim returns B; A released back (fake queue asserts
   release). Second scenario: {unlabeled, high, medium} → high claimed first, then medium on
   the next call.
2. Verify RED.
3. Implement the drain-then-sort walk in `claimUnblocked` per Technical Approach step (2)–(4):
   drain to null, optional band sort (stable), verdict walk in final order, release all
   non-selected in finally.
4. Verify GREEN + all existing `dependency-claim.test.ts` cases (no `resolveBands`) unmodified
   and green.
5. Commit: "feat(intake): claimUnblocked orders candidates by priority band"

**Files:**
- src/conductor/src/engine/engineer/intake/dependency-claim.ts
- src/conductor/test/engine/engineer/intake/dependency-claim.test.ts

**Dependencies:** Task 2

### Task 4: No-sourceRef parity — no-issue band ranks first, no reader call for it
**Story:** TR-1 negative path 3
**Type:** negative-path

**Steps:**
1. Write failing test: held set {X: no sourceRef; Y: critical} → X sorts first (`no-issue`
   rank 0); the fake reader receives only Y's ref (no undefined/empty ref passed).
2. Verify RED (or confirm GREEN if Task 3's implementation already satisfies it — then
   strengthen the assertion on reader args).
3. Implement/adjust ref collection to skip undefined sourceRefs and band them `no-issue`.
4. Verify GREEN.
5. Commit: "feat(intake): no-sourceRef envelopes take the no-issue band"

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 5: Within-band receivedAt FIFO stability
**Story:** TR-3 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: three same-band (high) entries with distinct receivedAt → three
   sequential claims serve strictly oldest-first; mixed banded/unlabeled set → unlabeled
   entries keep their relative drain order (stable sort); two identical-receivedAt same-band
   entries → identical order across two runs (deterministic tie-break = drain order, which
   the queue derives from filename `receivedAt__id` sort).
2. Verify RED.
3. Implement: stable sort by band rank only (drain index as implicit tie-break — sort must
   be stable; use index-decorated sort as `orderBacklog` does).
4. Verify GREEN.
5. Commit: "feat(intake): within-band claim order stays receivedAt FIFO, stable"

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 6: Fail-open — reader throw degrades whole claim to FIFO, one warning
**Story:** TR-2 happy path + negative path 1 (no half-banding)
**Type:** negative-path

**Steps:**
1. Write failing tests: throwing `resolveBands` → claim still returns the OLDEST unblocked
   (drain order), injected `log` called exactly once with an outage message; reader that
   fails "after partially succeeding" is irrelevant by construction (single call, whole-map
   or throw) — assert a throw from `resolveClaimBands` mid-map (reader throws on 2nd ref)
   yields pure FIFO order, never a partial band sort.
2. Verify RED.
3. Implement: try/catch around the `resolveBands` call in `claimUnblocked`; catch → log once,
   `bands = null`, skip sort.
4. Verify GREEN.
5. Commit: "feat(intake): label-read outage fails open to FIFO with one warning"

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 7: Composability — blocked critical defers to next banded candidate
**Story:** TR-4 happy paths 1–2 + negative path 3 (#279 liveness unchanged)
**Type:** happy-path

**Steps:**
1. Write failing tests: {critical: blocked verdict, high: unblocked} → high claimed,
   critical released, no ledger write for it (fake ledger asserts zero transitions for
   deferred); all-pending-blocked → `all-blocked` outcome with entries in banded order.
2. Verify RED.
3. Implement: verdict evaluation loop over the banded order (largely falls out of Task 3;
   this task pins the deferral semantics with tests).
4. Verify GREEN.
5. Commit: "test(intake): banded order composes with blocker deferral unchanged"

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 8: No-loss invariant — crash mid-walk releases every drained envelope
**Story:** TR-4 negative paths 1–2
**Type:** negative-path

**Steps:**
1. Write failing tests: resolver (verdict fn) throws on the 2nd candidate → the throw
   propagates AND every drained, non-selected envelope was released (fake queue counts
   claims vs releases; selected=none); concurrent-claim semantics: a queue whose `claim()`
   returns null after the first drain (someone else drained) → `empty` outcome unchanged.
2. Verify RED (release accounting for never-evaluated candidates is the new surface).
3. Implement: ensure `finally` releases the full remaining `held` set (drain-first shape).
4. Verify GREEN.
5. Commit: "fix(intake): banded walk never drops a drained envelope on crash"

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 9: CLI wiring — real reader, stderr logging, unchanged JSON shape
**Story:** TR-1 happy path 3 (relabel honored at next claim), TR-2 negative path 2 (fallback
side effects identical)
**Type:** integration

**Steps:**
1. Write failing tests in `engineer-cli-intake.test.ts`: claim with an injected `gh` fake
   serving issue labels → banded selection observable end-to-end (critical served over older
   low) and stdout JSON shape exactly `{kind, text, source, sourceRef}`; gh fake throwing on
   the label read → claim still succeeds (oldest served), warning on stderr, ack + ledger
   `claimed` transition still performed; two sequential claims with the label fixture
   changed between them → second claim reflects the new band (claim-time read, no cache).
2. Verify RED.
3. Implement: build `resolveBands` from `ghIssueLabelReader` in the `claim` case of
   `engineer-cli.ts`, pass `log: printErr`.
4. Verify GREEN. Existing CLI claim tests: label reads now occur — fakes that reject unknown
   `gh api` calls exercise the fail-open path; update any exact-stderr assertions.
5. Commit: "feat(engineer): claim serves priority-banded intake via claim-time labels"

**Files:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-intake.test.ts

**Dependencies:** Tasks 3, 6

### Task 10: Queue untouched guard + full suite
**Story:** TR-4 Done When 3 (queue.ts byte-identical)
**Type:** infrastructure

**Steps:**
1. Verify `git diff main -- src/conductor/src/engine/engineer/intake/queue.ts` is empty.
2. Run the full conductor suite: `cd src/conductor && rtk proxy npx vitest run`.
3. Fix any regression surfaced (acceptance suites `dependency-ordered-intake-and-dispatch`
   and `background-intake-conduct-loop` must stay green — they inject no `resolveBands`, so
   behavior is unchanged by construction; investigate any failure as a real bug).
4. Commit (only if fixes were needed): "test(intake): full-suite pass for banded claim"

**Files:** none

**Dependencies:** Tasks 1–9

### Task 11: Docs — README claim-ordering behavior
**Story:** repo gate (Docs track features)
**Type:** infrastructure

**Steps:**
1. Update `README.md` (engineer/claim section) and `src/conductor/README.md`: claim serves
   priority-band-first (critical → high → medium → low → unlabeled; no-issue first),
   oldest-first within band, claim-time label read, fail-open to FIFO on gh outage.
2. Commit: "docs: claim ordering honors priority bands"

**Files:**
- README.md
- src/conductor/README.md

**Dependencies:** Task 9

### Task 12: CHANGELOG + harness validation
**Story:** repo gate (Changelog on every PR)
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` / Changed: "`conduct-ts engineer claim` now serves pending
   ideas by priority band (critical first) before capturedAt FIFO, reading labels at claim
   time and failing open to FIFO on gh outages (#461)."
2. Run `test/test_harness_integrity.sh` from the repo root; fix any failure.
3. Commit: "chore: changelog for priority-banded intake claim"

**Files:**
- CHANGELOG.md

**Dependencies:** Task 11

## Task Dependency Graph

```
1 → 2 → 3 → {4, 5, 6, 7, 8}
3,6 → 9 → 11 → 12
1–9 → 10
```

## Integration Points

- After Task 3: banded selection works end-to-end at the walk level (unit-testable).
- After Task 9: full CLI behavior observable — `conduct-ts engineer claim` with a critical
  pending serves it first; outage path verified.

## Coverage Map

| Criterion | Task(s) |
|---|---|
| TR-1 happy 1 (critical beats older low) | 3, 9 |
| TR-1 happy 2 (band drain order) | 3 |
| TR-1 happy 3 (relabel-after-capture) | 9 |
| TR-1 neg 1 (404 → unlabeled) | 2 |
| TR-1 neg 2 (multi-label highest) | 2 |
| TR-1 neg 3 (no-sourceRef → no-issue) | 4 |
| TR-1 Done-When 3 (shared ranking export) | 1 |
| TR-2 happy (outage → FIFO + 1 warning) | 6 |
| TR-2 neg 1 (no half-banding) | 6 |
| TR-2 neg 2 (fallback side effects identical) | 9 |
| TR-2 neg 3 (no new timeout machinery) | scope note — no task adds timeouts |
| TR-3 all (within-band FIFO, stable, deterministic) | 5 |
| TR-4 happy 1 (blocked critical defers) | 7 |
| TR-4 happy 2 (all-blocked banded) | 7 |
| TR-4 neg 1 (crash → all released) | 8 |
| TR-4 neg 2 (concurrent claim → empty) | 8 |
| TR-4 neg 3 (#279 deferral unchanged) | 7 |
| TR-4 Done-When 3 (queue byte-identical) | 10 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
