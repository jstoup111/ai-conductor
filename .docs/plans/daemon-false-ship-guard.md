# Implementation Plan: daemon false-ship guard (ai-conductor#337)

**Date:** 2026-07-06
**Design:** .docs/decisions/adr-2026-07-06-daemon-false-ship-guard.md (APPROVED)
**Stories:** .docs/stories/daemon-false-ship-guard.md (Accepted)
**Conflict check:** Clean as of 2026-07-06 (.docs/conflicts/daemon-false-ship-guard.md)

## Summary

Closes the #337 false-ship class with two independent engine guards plus a skill STOP gate:
the finish completion gate demands offline push evidence for `choice=pr` (and refuses
`keep`/`merge-local`/`discard` convergence in daemon mode), and the daemon done-branch ships
only a proven PR ship — anything else HALTs with the worktree kept and the branch surfaced.
16 tasks.

## Technical Approach

- **New evidence primitive** `headPushedToUpstream(runGit, cwd)` in a small new module
  `src/conductor/src/engine/push-evidence.ts`, using the injected `GitRunner` from
  `pr-labels.ts`. Resolves the branch's upstream tracking ref (`git rev-parse
  --symbolic-full-name @{u}`; fallback `refs/remotes/origin/<branch>`), then
  `git merge-base --is-ancestor HEAD <ref>`. Returns `true` (pushed), `false` (not pushed /
  no tracking ref), `null` (indeterminate: not a repo, git missing). Purely local — no
  network.
- **CompletionContext grows two fields** (same seam as #367's `getHeadSha`,
  `artifacts.ts:245-263`): `daemon?: boolean` and `isHeadPushed?: () => Promise<boolean |
  null>`. `Conductor.completionCtx()` (`conductor.ts:483`) threads `daemon: this.daemon` and
  a production reader rooted at `this.projectRoot`. Contract in the finish predicate:
  `true` → pass; `false` → incomplete (fail-closed, reason names branch + missing evidence);
  `null` or absent injectable → skip (fail-open, legacy/non-git parity); reader throw →
  incomplete with the error in the reason (never a silent pass).
- **Finish predicate** (`artifacts.ts:737-796`): after the existing `pr_url` check, run the
  evidence check for `choice=pr`; new leading branch for daemon mode — `keep`, `merge-local`,
  `discard` return incomplete with a choice-naming reason.
- **Daemon done-branch** (`daemon-runner.ts:173-225`): a ship-eligibility predicate
  (`finishChoice === 'pr' && prUrl != null`) guards ALL ship side effects (clear-on-success,
  enroll, markProcessed, teardown-remove). Ineligible done-outcomes take a new failed-ship
  path: delete `.pipeline/DONE`, write `.pipeline/HALT` with the contradiction reason
  (conflict resolution: states stay disjoint), call `escalateBuildFailure` with the worktree
  as cwd (best-effort; FR-7 degradation acceptable), `teardownWorktree(keep=true)`,
  `maybeSweep()`, return `status:'halted'`. New injectable deps `failShip`-style primitives
  live in daemon-deps with production defaults so existing test injection patterns hold.
- **Skill + prompt truth**: `skills/finish/SKILL.md` §5 Option 2 gets the STOP gate (verify
  non-empty PR URL + ancestry before writing `finish-choice=pr`); the §4 auto/daemon block
  references it; the step-runners auto-prompt tells the session to verify the push landed
  before recording `pr`.
- **Sequencing**: evidence primitive → context threading → gate branches → daemon guard →
  skill/docs. Tests colocate with existing suites (`artifacts.test.ts` finish predicate
  block, `daemon-runner.test.ts` injected-deps block, new `push-evidence.test.ts` with
  fakeGit + one real temp-repo case per the injected-runner-needs-real-smoke rule).

## Prerequisites

None — no migrations, no new packages. `src/conductor` npm install present in the build
worktree (standard).

## Tasks

### Task 1: push-evidence module — happy path
**Story:** Story 1 (happy)
**Type:** infrastructure
**Steps:**
1. Write failing test: `push-evidence.test.ts` — fakeGit responding to `@{u}` resolve +
   `merge-base --is-ancestor` exit 0 → `headPushedToUpstream` resolves `true`.
2. RED. 3. Implement `engine/push-evidence.ts` (GitRunner-injected). 4. GREEN.
5. Commit: "feat(conductor): headPushedToUpstream evidence primitive (#337)".
**Files:** src/conductor/src/engine/push-evidence.ts (new), test/engine/push-evidence.test.ts (new)
**Dependencies:** none

### Task 2: push-evidence — not-pushed, no-upstream fallback, indeterminate
**Story:** Story 1 (negatives: stale URL, never-pushed)
**Type:** negative-path
**Steps:**
1. Failing tests: ancestor-check exit 1 → `false`; `@{u}` fails but
   `refs/remotes/origin/<branch>` exists → fallback path used; neither ref exists → `false`;
   git spawn error → `null`.
2. RED. 3. Implement branches. 4. GREEN.
5. Commit: "test(conductor): push-evidence negative branches (#337)".
**Files:** same as Task 1
**Dependencies:** Task 1

### Task 3: push-evidence — real-binary smoke
**Story:** Story 1 (happy, grounding)
**Type:** infrastructure
**Steps:**
1. Failing test: temp `git init` repo + bare remote; before push → `false`; after
   `git push -u` → `true` (real git, no fake — injected-runner argv can lie).
2. RED. 3. (Implementation exists.) 4. GREEN.
5. Commit: "test(conductor): push-evidence real-git smoke (#337)".
**Files:** test/engine/push-evidence.test.ts
**Dependencies:** Task 2

### Task 4: CompletionContext fields + conductor threading
**Story:** Stories 1–2 (seam)
**Type:** infrastructure
**Steps:**
1. Failing test: `completionCtx`-shaped assertion — predicate receives `daemon` and
   `isHeadPushed` when conductor builds ctx (unit-test the builder or predicate wiring).
2. RED. 3. Add `daemon?`, `isHeadPushed?` to `CompletionContext` (docs comment mirroring
   getHeadSha's); thread both in `completionCtx()` (conductor.ts:483). 4. GREEN.
5. Commit: "feat(conductor): thread daemon + push-evidence into CompletionContext (#337)".
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/src/engine/conductor.ts
**Dependencies:** Task 1

### Task 5: finish gate — evidence pass for choice=pr
**Story:** Story 1 (happy)
**Type:** happy-path
**Steps:**
1. Failing test in `artifacts.test.ts` finish block: fresh `finish-choice=pr` + `pr_url` +
   ctx `isHeadPushed: async () => true` → `{done:true}`.
2. RED. 3. Add evidence check after the pr_url check in the finish predicate. 4. GREEN.
5. Commit: "feat(conductor): finish gate requires push evidence for choice=pr (#337)".
**Files:** src/conductor/src/engine/artifacts.ts, test/engine/artifacts.test.ts
**Dependencies:** Tasks 1, 4

### Task 6: finish gate — evidence fail-closed negatives
**Story:** Story 1 (negatives: stale reused PR URL / never pushed / reader throws)
**Type:** negative-path
**Steps:**
1. Failing tests: `isHeadPushed → false` → `{done:false}` with reason naming the branch and
   missing push evidence; reader throws → `{done:false}` with the error message in reason.
2. RED. 3. Implement. 4. GREEN.
5. Commit: "test(conductor): finish gate refuses unpushed pr ship (#337)".
**Files:** same as Task 5
**Dependencies:** Task 5

### Task 7: finish gate — fail-open parity (absent injectable / null)
**Story:** Story 1 (negative: missing injectable = legacy)
**Type:** negative-path
**Steps:**
1. Tests: ctx without `isHeadPushed` → all existing finish-predicate tests pass unmodified
   (byte-parity); `isHeadPushed → null` → pass (evidence indeterminate).
2. RED (only the null case is new). 3. Implement. 4. GREEN.
5. Commit: "test(conductor): finish gate fail-open without evidence reader (#337)".
**Files:** same as Task 5
**Dependencies:** Task 5

### Task 8: finish gate — daemon keep/merge-local/discard non-convergence
**Story:** Story 2 (all)
**Type:** negative-path
**Steps:**
1. Failing tests: ctx `daemon:true` + fresh choice ∈ {keep, merge-local, discard} →
   `{done:false}` with choice-naming reason; ctx `daemon:false`/absent + same choices →
   `{done:true}` (interactive parity).
2. RED. 3. Add the daemon branch ahead of the per-choice logic. 4. GREEN.
5. Commit: "feat(conductor): daemon finish requires a pr ship — keep/merge-local/discard do
   not converge (#337)".
**Files:** same as Task 5
**Dependencies:** Task 4

### Task 9: daemon ship-eligibility predicate + happy ship
**Story:** Story 3 (happy)
**Type:** happy-path
**Steps:**
1. Failing test in `daemon-runner.test.ts`: outcome `{done, finishChoice:'pr', prUrl}` →
   markProcessed called with prUrl, teardown remove, `status:'done'` (existing :45 test
   extended to set finishChoice — assert it still passes with the guard in place).
2. RED. 3. Introduce `isVerifiedShip(outcome)` and gate the done-branch. 4. GREEN.
5. Commit: "feat(conductor): daemon ships only a verified pr outcome (#337)".
**Files:** src/conductor/src/engine/daemon-runner.ts, test/engine/daemon-runner.test.ts
**Dependencies:** none (parallel to gate tasks)

### Task 10: failed-ship path — HALT written, DONE deleted, worktree kept
**Story:** Story 3 (negatives: null prUrl, missing choice) + conflict resolution
**Type:** negative-path
**Steps:**
1. Failing tests (injected recorders + tmp dir with real marker files): outcome
   `{done:true, prUrl:undefined}` → no markProcessed call, teardown called with keep=true,
   `status:'halted'`, `.pipeline/HALT` exists with reason containing choice+prUrl, and
   `.pipeline/DONE` is absent afterward; same for `{done:true, prUrl:'url',
   finishChoice:undefined}`.
2. RED. 3. Implement failed-ship branch with a `failShip` dep (production impl in
   daemon-deps: unlink DONE, write HALT). 4. GREEN.
5. Commit: "feat(conductor): false-ship outcome halts — DONE removed, worktree kept (#337)".
**Files:** src/conductor/src/engine/daemon-runner.ts, src/conductor/src/engine/daemon-deps.ts,
test/engine/daemon-runner.test.ts
**Dependencies:** Task 9

### Task 11: failed-ship path — escalation surfacing + FR-7 degradation
**Story:** Story 4 (all)
**Type:** negative-path
**Steps:**
1. Failing tests: escalation recorder invoked with the worktree path as projectRoot and a
   reason naming the contradiction; escalation resolving `{}` (push failed, FR-7) → outcome
   unchanged (halted, HALT present, no shipped marker); maybeSweep still invoked.
2. RED. 3. Wire `escalateBuildFailure` (injectable dep, production default) into the
   failed-ship branch. 4. GREEN.
5. Commit: "feat(conductor): surface false-ship halts via needs-remediation escalation (#337)".
**Files:** same as Task 10
**Dependencies:** Task 10

### Task 12: ship side effects skipped on failed ship
**Story:** Story 3 (negative: label/enroll skipped) + Story 5 (live-path invariant)
**Type:** negative-path
**Steps:**
1. Failing tests: on the failed-ship path, zero calls to clear-on-success (prMergeState /
   removeLabel / setReady) and zero enroll calls; marker-recorder asserts zero
   markProcessed calls across all failed-ship variants.
2. RED. 3. (Should already hold from Task 10's structure — tests pin it.) 4. GREEN.
5. Commit: "test(conductor): no ship side effects on failed ship (#337)".
**Files:** test/engine/daemon-runner.test.ts
**Dependencies:** Task 11

### Task 13: repairProcessed exemption regression pin
**Story:** Story 5 (repair path stays legitimate)
**Type:** negative-path
**Steps:**
1. Test (may already RED-pass — write as characterization): `repairProcessed` with
   `{malformed:true}` still writes `{"status":"shipped","prUrl":null}`, with a comment citing
   the ADR scope note.
2. 3. 4. (No production change.) 5. Commit: "test(conductor): pin repairProcessed
   null-prUrl exemption (#337)".
**Files:** test/engine/shipped-record.test.ts or daemon-deps test home
**Dependencies:** none

### Task 14: /finish SKILL.md STOP gate + auto-prompt truth
**Story:** Story 6 (all)
**Type:** infrastructure
**Steps:**
1. Add §5 Option 2 STOP gate (verify `gh pr view --json url` non-empty AND `git merge-base
   --is-ancestor HEAD @{u}` before writing `finish-choice`/`pr_url`; on failure STOP, do not
   mask as `keep`); reference it from the §4 unattended block; extend the step-runners
   auto-prompt (:656-661) to instruct verification before recording `pr`.
2. Run `test/test_harness_integrity.sh` (frontmatter, section numbering, cross-refs).
3. Commit: "docs(finish): STOP gate — verify push+PR before recording pr choice (#337)".
**Files:** skills/finish/SKILL.md, src/conductor/src/engine/step-runners.ts
**Dependencies:** none

### Task 15: CHANGELOG + README docs
**Story:** repo gates (docs track features)
**Type:** infrastructure
**Steps:**
1. CHANGELOG.md `[Unreleased]` → Fixed: daemon false-ship guard summary (#337).
2. src/conductor/README.md: daemon section — a done-outcome without a verified PR ship now
   halts (worktree kept, needs-remediation PR); finish gate push-evidence behavior.
3. Commit: "docs: changelog + conductor README for false-ship guard (#337)".
**Files:** CHANGELOG.md, src/conductor/README.md
**Dependencies:** Tasks 5–12 (describe shipped behavior)

### Task 16: full verification sweep
**Story:** all (Done When checkboxes)
**Type:** infrastructure
**Steps:**
1. `rtk proxy npx vitest run` in src/conductor (expect the 1 known pre-existing load-flake
   at worst); `bash test/test_harness_integrity.sh`.
2. Fix any regression before finishing.
5. Commit only if fixes were needed.
**Files:** n/a
**Dependencies:** all prior

## Task Dependency Graph

```
T1 → T2 → T3
T1 → T4 → T5 → T6
          T5 → T7
     T4 → T8
T9 → T10 → T11 → T12
T13 (independent)
T14 (independent)
{T5–T12} → T15
all → T16
```

## Integration Points

- After Task 8: the full gate behavior is testable end-to-end at the predicate level
  (daemon + evidence + parity).
- After Task 11: a simulated daemon feature with a null-prUrl outcome exercises
  gate-miss → guard → HALT → escalation as one flow (daemon-runner test with real marker
  files in a tmp worktree dir).

## Coverage

- Story 1: T1–T7 (happy T1/T3/T5; stale/never-pushed T2/T6; fail-open T7; throw T6)
- Story 2: T8 (all four choices + interactive parity)
- Story 3: T9 (happy), T10 (null prUrl, missing choice, DONE deletion), T12 (side effects)
- Story 4: T11 (escalation happy, FR-7 degradation, never-throws), T12 (maybeSweep pinned in T11)
- Story 5: T12 (live-path invariant), T13 (repair exemption)
- Story 6: T14 (+ Story 1's gate as the daemon-mode backstop)

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
