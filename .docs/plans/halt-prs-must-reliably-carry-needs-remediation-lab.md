# Implementation Plan: Halt-PR presentation reliability

**Date:** 2026-07-05
**Design/ADR:** `.docs/decisions/adr-2026-07-05-halt-pr-presentation-reliability.md` (D1–D5)
**Stories:** `.docs/stories/halt-pr-presentation-reliability.md`
**Conflict check:** Clean as of 2026-07-05 (one degrading design-overlap with #271 documented +
coordination contract — `.docs/conflicts/2026-07-05-halt-pr-reliability.md`)
**Complexity:** `.docs/complexity/halt-prs-must-reliably-carry-needs-remediation-lab.md` (Tier M)
**Source:** ai-conductor#274

## Summary
Make halt-PR presentation (needs-remediation label + draft status + durable body marker) guaranteed
rather than best-effort, via an idempotent verify-after-write helper at escalation plus a
reconciliation sweep wired into the daemon. ~20 tasks.

## Technical Approach

All new logic lives behind the existing injected `GhRunner` seam in
`src/conductor/src/engine/pr-labels.ts`, so every task is unit-testable with the `makeFakeGh`
template from `test/engine/mergeable-sweep.test.ts` and the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch.

Building blocks (in dependency order):
1. **New gh primitives in `pr-labels.ts`:** (a) `readHaltPresentation(prUrl)` — a read that returns
   `{ isDraft, labels, body }` via `gh pr view <url> --json isDraft,labels,body` (the existing
   `prMergeState` reads `state,mergeable,statusCheckRollup,labels` — **no** `isDraft`/`body` — so a
   new read is required); (b) `convertToDraft(prUrl)` — `gh pr ready --undo <url>` (verified
   available; draft support confirmed by #267); (c) `ensureBodyMarker(prUrl, body)` — idempotent
   append of `<!-- conductor:needs-remediation -->` to the PR **body/description** via
   `gh pr edit <url> --body ...`, distinct from the existing **comment** marker at `pr-labels.ts:418`.
2. **`ensureHaltPresentation(runGh, cwd, prUrl, log)`** (`pr-labels.ts`) — idempotent verify-after-
   write: assert body marker, draft, and `needs-remediation` label (label via REST `gh api
   .../issues/N/labels`, never `gh pr edit --add-label`, per PR #172), then re-read and retry bounded
   (fixed small attempt count + backoff) on any mismatch. Returns `'confirmed' | 'unconfirmed'`;
   never throws. Shared by escalation and the sweep.
3. **Escalation wiring** (`build-failure-escalation.ts:73`): replace the bare `ensureLabel`+`addLabel`
   pair with a call to `ensureHaltPresentation` after `findOrCreatePr`, so the reuse path also forces
   draft + label + marker.
4. **`reconcileHaltPrs({projectRoot, log, runGh})`** — new file
   `src/conductor/src/engine/halt-pr-reconciliation.ts`, modeled on `mergeable-sweep.ts:118`.
   Enumerate open PRs (`gh pr list --json number,url,body,isDraft,labels --state open --limit <N>`),
   filter to body-marker carriers, call `ensureHaltPresentation` on any non-conforming PR. Best-
   effort/non-throwing.
5. **Daemon wiring** (`daemon.ts`): add an injected dep hook `reconcileHaltPrs?` (ADR-013 pattern,
   same shape as `sweepMergeableLabels`), invoked in `runDaemon` startup (`daemon.ts:457-507`) and
   the idle tick (`daemon.ts:739`), **before** `sweepBestEffort()` so the label is present when the
   mergeable sweep evaluates.
6. **Removal-on-finish verify (D5)** (`daemon-runner.ts:174` clear-on-success and
   `halt-pr-rehabilitation.ts:72` `rehabilitateHaltPr`): after clearing, re-read and confirm label
   gone + `isDraft:false` + body marker removed; retry bounded, report `partial` on exhaustion (never
   throw). The marker strip MUST be the same body write as #271's finish body rewrite (coordination
   contract) — if #271 regenerates the body it already drops the marker (assert absence); otherwise
   D5 strips it in the same clean-body write.

## Prerequisites
- Worktree has `src/conductor` deps installed (`npm install` in `src/conductor`) for vitest.

## Tasks

### Task 1: `readHaltPresentation` primitive
**Story:** D2 happy path (read-back). **Type:** infrastructure
**Steps:** 1. Failing test: fake `gh` returns `pr view --json isDraft,labels,body` payload →
`readHaltPresentation` returns `{isDraft,labels,body}`. 2. RED. 3. Implement in `pr-labels.ts` using
injected `GhRunner`; return a sentinel (e.g. `null`) + log on error, never throw. 4. GREEN.
5. Commit: "feat(pr-labels): readHaltPresentation reads isDraft+labels+body".
**Files:** `pr-labels.ts`, `test/engine/pr-labels.test.ts`. **Dependencies:** none.

### Task 2: `convertToDraft` primitive (gh pr ready --undo)
**Story:** D3 happy path. **Type:** infrastructure
**Steps:** 1. Failing test: `convertToDraft(url)` records a `gh pr ready --undo <url>` argv on the
fake. 2. RED. 3. Implement (non-throwing, log on error). 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** none.

### Task 3: `ensureBodyMarker` idempotent body write
**Story:** D1 happy path + idempotence. **Type:** infrastructure
**Steps:** 1. Failing test: given a body without the marker → records a `gh pr edit --body` argv whose
body contains the marker exactly once; given a body already containing the marker → records NO edit
(idempotent). 2. RED. 3. Implement: read current body (or accept passed body), append marker only if
absent, preserve existing body text. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** none.

### Task 4: Export the body-marker constant distinct from the comment marker
**Story:** D1. **Type:** infrastructure
**Steps:** 1. Failing test asserting `NEEDS_REMEDIATION_BODY_MARKER` is defined and equals
`<!-- conductor:needs-remediation -->` and is not the same symbol as the comment marker. 2. RED.
3. Add the constant near `pr-labels.ts:418`. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** none.

### Task 5: `ensureHaltPresentation` — happy path (all three confirmed)
**Story:** D2 happy path. **Type:** happy-path
**Steps:** 1. Failing test: fresh PR, fake `gh` accepts all writes; after call, read-back shows
`isDraft:true`, `needs-remediation` label, body marker; returns `'confirmed'` with no extra retries.
2. RED. 3. Implement: assert marker (Task 3) → assert draft (Task 2, only if not draft per Task 1
read) → REST add label → re-read (Task 1) → return `confirmed`. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 1,2,3,4.

### Task 6: `ensureHaltPresentation` — label write uses REST, not gh pr edit
**Story:** D2 negative (REST enforcement). **Type:** negative-path
**Steps:** 1. Failing test: recorded label argv is the `gh api ... repos/OWNER/REPO/issues/N/labels`
form; assert NO `gh pr edit --add-label` argv appears. 2. RED. 3. Ensure implementation calls
existing `addLabel` (REST). 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 5.

### Task 7: `ensureHaltPresentation` — retry on first label failure then confirm
**Story:** D2 negative (retry). **Type:** negative-path
**Steps:** 1. Failing test: fake `gh` fails label add on attempt 1, succeeds on attempt 2; re-read
after attempt 1 shows label missing → helper retries → returns `'confirmed'`. 2. RED. 3. Implement
bounded retry loop with backoff. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 5.

### Task 8: `ensureHaltPresentation` — exhaustion returns `unconfirmed`, no throw
**Story:** D2 negative (sustained rate-limit). **Type:** negative-path
**Steps:** 1. Failing test: fake `gh` fails label add on every attempt → helper returns
`'unconfirmed'` and does not throw. 2. RED. 3. Implement exhaustion path. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 7.

### Task 9: `ensureHaltPresentation` — unreadable PR returns `unconfirmed`, no throw
**Story:** D2 negative (NOTFOUND/network). **Type:** negative-path
**Steps:** 1. Failing test: read primitive returns the error sentinel → helper returns `unconfirmed`,
logs, no throw. 2. RED. 3. Implement guard. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 5.

### Task 10: `ensureHaltPresentation` — draft conversion only when not already draft
**Story:** D3 happy path + idempotence. **Type:** happy-path
**Steps:** 1. Failing test: reused OPEN non-draft PR → records `gh pr ready --undo`, read-back
`isDraft:true`; reused already-draft PR → records NO `--undo`. 2. RED. 3. Implement conditional on the
Task-1 read. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 5.

### Task 11: `ensureHaltPresentation` — draft conversion failure returns `unconfirmed`
**Story:** D3 negative. **Type:** negative-path
**Steps:** 1. Failing test: `gh pr ready --undo` fails every attempt → helper returns `unconfirmed`,
no throw. 2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 10.

### Task 12: `ensureHaltPresentation` — body marker preserved/appended, not clobbered
**Story:** D1 negative (preserve human body). **Type:** negative-path
**Steps:** 1. Failing test: reused PR with human body text → after call, body retains original text
AND contains the marker once. 2. RED. 3. Implement append-not-replace. 4. GREEN. 5. Commit.
**Files:** `pr-labels.ts`, test. **Dependencies:** 5.

### Task 13: Wire `ensureHaltPresentation` into escalation
**Story:** D2/D1 happy path (integration). **Type:** infrastructure
**Steps:** 1. Failing test: `escalateBuildFailure` with fake `gh` → after run, the PR is draft +
labeled + body-marked; the existing failure-reason **comment** (`upsertComment`) is still posted.
2. RED. 3. Replace the `ensureLabel`+`addLabel` pair (`build-failure-escalation.ts:174-175`) with
`ensureHaltPresentation`; keep the `upsertComment` call. 4. GREEN. 5. Commit.
**Files:** `build-failure-escalation.ts`, `test/engine/build-failure-escalation.test.ts`.
**Dependencies:** 5,10.

### Task 14: Escalation still posts comment when presentation is `unconfirmed`
**Story:** D2 negative (best-effort contract). **Type:** negative-path
**Steps:** 1. Failing test: `ensureHaltPresentation` returns `unconfirmed` → `escalateBuildFailure`
still posts the failure comment and returns `{prUrl}` without throwing. 2. RED. 3. Ensure ordering.
4. GREEN. 5. Commit.
**Files:** `build-failure-escalation.ts`, test. **Dependencies:** 13.

### Task 15: `reconcileHaltPrs` — enumerate + heal broken, skip correct/unmarked
**Story:** D4 happy + negative (skip unmarked). **Type:** happy-path
**Steps:** 1. Failing test: fake `gh pr list` returns a marked-broken PR, a marked-correct PR, and an
unmarked ready PR → after run, broken healed, correct untouched (no writes), unmarked skipped (never
drafted/labeled). 2. RED. 3. Implement new `halt-pr-reconciliation.ts` (enumerate → filter by body
marker → `ensureHaltPresentation` per non-conforming). 4. GREEN. 5. Commit.
**Files:** `halt-pr-reconciliation.ts`, `test/engine/halt-pr-reconciliation.test.ts`.
**Dependencies:** 5,10.

### Task 16: `reconcileHaltPrs` — heal PR missing only one of {label, draft}
**Story:** D4 negative (partial state). **Type:** negative-path
**Steps:** 1. Failing test: marked PR missing only label (already draft) → adds label, no `--undo`;
marked PR missing only draft (already labeled) → `--undo`, no redundant label add. 2. RED. 3. Rely on
`ensureHaltPresentation` idempotence. 4. GREEN. 5. Commit.
**Files:** test. **Dependencies:** 15.

### Task 17: `reconcileHaltPrs` — `gh pr list` failure/empty is a non-throwing no-op
**Story:** D4 negative (dependency unavailability). **Type:** negative-path
**Steps:** 1. Failing test: fake `pr list` throws / returns empty → `reconcileHaltPrs` returns
without throwing and performs no writes. 2. RED. 3. Implement guard. 4. GREEN. 5. Commit.
**Files:** `halt-pr-reconciliation.ts`, test. **Dependencies:** 15.

### Task 18: Wire `reconcileHaltPrs` into `runDaemon` startup + idle tick (before mergeable sweep)
**Story:** D4 happy (integration). **Type:** infrastructure
**Steps:** 1. Failing test: daemon test with an injected fake counts `reconcileHaltPrs` invoked on
startup and on an idle tick, and ordered **before** `sweepMergeableLabels`. 2. RED. 3. Add
`reconcileHaltPrs?` dep hook (ADR-013), invoke in `daemon.ts:457-507` + `:739` before
`sweepBestEffort`. 4. GREEN. 5. Commit.
**Files:** `daemon.ts`, `test/engine/daemon*.test.ts`. **Dependencies:** 15.

### Task 19: Removal-on-finish verify-after-write + marker strip (D5)
**Story:** D5 happy + negative. **Type:** negative-path
**Steps:** 1. Failing tests: (a) finished PR that had label/draft/marker → after clear, read-back
confirms label absent + `isDraft:false` + marker removed; (b) label-remove fails once then succeeds →
confirmed clean (retry); (c) fails every attempt → `partial`, no throw; (d) residual marker after
label+ready succeed → reported `partial` (surfaced), not silent success. 2. RED. 3. Add verify-after-
write + marker strip to `daemon-runner.ts:174` clear-on-success and `rehabilitateHaltPr`
(`halt-pr-rehabilitation.ts:72`); marker strip is the same body write as #271's rewrite (assert
absence if #271 regenerates the body). 4. GREEN. 5. Commit.
**Files:** `daemon-runner.ts`, `halt-pr-rehabilitation.ts`, `pr-labels.ts` (removal helper if needed),
tests. **Dependencies:** 1,3.

### Task 20: Finished PR is not re-halted by the sweep (loop closure)
**Story:** D5 happy (sweep exclusion) + D4. **Type:** negative-path
**Steps:** 1. Failing test: after finish (marker removed), `reconcileHaltPrs` enumerates zero PRs for
that branch → no re-draft, no re-label. 2. RED. 3. Confirmed by marker-based enumeration + Task 19
strip. 4. GREEN. 5. Commit.
**Files:** test. **Dependencies:** 15,19.

### Task 21: Docs — README + src/conductor/README + CHANGELOG
**Story:** repo docs policy. **Type:** infrastructure
**Steps:** 1. Update `README.md` and `src/conductor/README.md` to document the guaranteed halt-PR
presentation (verify-after-write + reconciliation sweep). 2. Add a `CHANGELOG.md` `## [Unreleased]`
entry under Fixed/Added referencing #274. 3. Commit. (No test — docs.)
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`. **Dependencies:** 18,19.

## Task Dependency Graph
```
1,2,3,4 (primitives, parallel)
   └─▶ 5 (ensureHaltPresentation happy)
        ├─▶ 6,7,9,12 (verify/negative)
        │    └─▶ 8 (exhaustion, after 7)
        ├─▶ 10 (draft-on-reuse) ─▶ 11 (draft-fail)
        ├─▶ 13 (escalation wiring, needs 5,10) ─▶ 14
        └─▶ 15 (reconcile, needs 5,10)
             ├─▶ 16,17
             └─▶ 18 (daemon wiring)
1,3 ─▶ 19 (finish verify) ─▶ 20 (loop closure, needs 15,19)
18,19 ─▶ 21 (docs)
```

## Integration Points
- After Task 13: escalation end-to-end produces a fully-present halt PR (fake `gh`).
- After Task 18: daemon startup/tick heals broken halt PRs end-to-end.
- After Task 20: full lifecycle closed (halt → heal → finish → not re-halted).

## Verification
- [ ] All happy-path criteria (D1–D5) covered: D1→3,4,12,15; D2→1,5,6,7,13; D3→2,10; D4→15,16,18;
      D5→19,20.
- [ ] All negative-path criteria covered: D2→6,7,8,9,14; D3→11; D1→12; D4→16,17; D5→19,20.
- [ ] No task exceeds ~5 minutes; each is one TDD RED→GREEN→COMMIT.
- [ ] Dependencies explicit and acyclic (graph above).
- [ ] Docs + CHANGELOG task included (Task 21).
