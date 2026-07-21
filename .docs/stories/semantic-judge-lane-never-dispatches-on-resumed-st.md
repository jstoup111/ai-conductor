**Status:** Accepted

# Stories: Judge lane dispatches on resumed/stalled build-gate residue (#570)

Technical track. Acceptance criteria for fixing the #520 semantic-attribution-judge dispatch
predicate so the judge fires on inherited build-gate residue even when the current build attempt
added no new commits. Fix = Approach A: drop the `!isZeroWork` guard from the judge-lane dispatch
predicate (`conductor.ts:3057-3062`); leave the separate kickback-path zero-work use (`:3244`) and
the two existing no-op paths intact.

Source: `jstoup111/ai-conductor#570`.

---

## Story: Judge lane dispatches on inherited residue when the current attempt added no new commits

**Requirement:** Desired outcome 1 — the judge lane provably dispatches on build-gate residue when
the cutover is armed, even when the current attempt added no new commits (residue inherited from a
prior crashed/partial run).

As the daemon build gate, I want the semantic attribution judge to dispatch whenever there is
build-gate residue and the cutover is armed — regardless of whether *this* attempt produced new
commits — so that #520's auto-heal net is actually exercised on resumed/stalled runs, which are the
builds most likely to carry residue.

### Acceptance Criteria

#### Happy Path
- Given the attribution judge cutover is armed (a past `attribution_judge_cutover`), and a build
  gate-miss leaves a non-empty residue set (`residueIds.length > 0`), and `HEAD` is present, and the
  current attempt added no new commits (`headShaBeforeBuild === headShaAfterBuild`), when the judge
  lane block at `conductor.ts:3037-3132` evaluates, then `runAttributionLane` is invoked and its
  `dispatchVerifier` is called (an `attribution_verify` dispatch occurs).
- Given the same preconditions, when the verifier returns a verdict, then the lane processes it
  exactly as it does for a fresh-commit build (stamps satisfied residue tasks, merges unsatisfied
  reasons into the build retry hint) — i.e. inherited-residue dispatch is on the identical code path
  as fresh-commit dispatch, differing only in that it is no longer suppressed.

#### Negative Paths
- Given the cutover is armed and residue is present, but the current attempt DID add new commits
  (`headShaBeforeBuild !== headShaAfterBuild`), when the judge block evaluates, then the lane still
  dispatches (behavior unchanged for the previously-working case — the fix must not regress the
  fresh-commit path).

### Done When
- [ ] A unit/engine test drives the judge block with cutover armed, non-empty `residueIds`, present
      `HEAD`, and `headShaBeforeBuild === headShaAfterBuild`, and asserts `dispatchVerifier` was
      called exactly once (previously it was never called).
- [ ] The same test asserts a returned satisfied verdict results in `laneResult.stampedTaskIds`
      non-empty and a re-check of completion (the stamp path runs).
- [ ] A regression test asserts the fresh-commit case (`headShaBeforeBuild !== headShaAfterBuild`)
      still dispatches — no behavior change for the previously-working path.

---

## Story: Judge lane no-ops when the cutover is disabled or absent

**Requirement:** Desired outcome 2 — negative path preserved: a disabled/absent cutover still
no-ops the lane (no dispatch).

As the daemon build gate, I want the judge lane to remain fully inert when the cutover is absent or
still in the future, so that the inert-by-default rollout guarantee (#520 Story 11) is preserved and
the fix does not turn the judge on where it was off.

### Acceptance Criteria

#### Happy Path
- Given `attribution_judge_cutover` is absent (undefined), when a build gate-miss with a non-empty
  residue set occurs and the current attempt added no new commits, then `isAttributionJudgeCutoverActive`
  returns false, the judge lane block is skipped at its cutover guard (`conductor.ts:3037-3039`), and
  `runAttributionLane`/`dispatchVerifier` are never invoked.

#### Negative Paths
- Given `attribution_judge_cutover` is set to a FUTURE timestamp (relative to build time), when the
  same build gate-miss occurs, then the cutover predicate returns false and no dispatch occurs —
  a future cutover is treated identically to an absent one.

### Done When
- [ ] A test with `attribution_judge_cutover` undefined and inherited residue (no new commits)
      asserts `dispatchVerifier` was never called.
- [ ] A test with a future `attribution_judge_cutover` and inherited residue asserts
      `dispatchVerifier` was never called.

---

## Story: Judge lane no-ops when the residue set is empty

**Requirement:** Desired outcome 3 — negative path preserved: a genuinely empty residue set
(`residueIds.length === 0`) still no-ops.

As the daemon build gate, I want the judge lane to skip dispatch when there is no residue to judge,
so that removing the `!isZeroWork` guard does not cause the judge to fire on fully-completed builds
that have nothing to attribute.

### Acceptance Criteria

#### Happy Path
- Given the cutover is armed and the derived completion shows every task completed/skipped so the
  residue set is empty (`residueIds.length === 0`), when the judge block evaluates, then the
  conductor dispatch predicate (`conductor.ts:3057-3062`) is false on the `residueIds.length > 0`
  clause and `runAttributionLane` is not entered — and even if entered, the lane's own
  `residueIds.length === 0` guard (`attribution-lane.ts:447`) returns `dispatched: false`.

#### Negative Paths
- Given the cutover is armed, residue is empty, and the current attempt added no new commits, when
  the judge block evaluates, then no `attribution_verify` dispatch occurs — an empty residue set is a
  no-op independent of the (now-removed) zero-work signal.

### Done When
- [ ] A test with cutover armed and `residueIds` empty asserts `dispatchVerifier` was never called.
- [ ] The test confirms the no-op holds whether or not the current attempt added new commits.

---

## Story: The separate kickback / no-evidence zero-work path is unchanged by the fix

**Requirement:** Invariant side-effect on alternate branches — removing the judge-lane `!isZeroWork`
guard must not alter the distinct, correct zero-work use at `conductor.ts:3244` (kickback retry-hint
+ no-evidence ledger), where "this attempt made no progress" IS the right signal.

As the daemon build gate, I want the zero-work kickback signal to keep firing exactly as before, so
that fixing the judge-lane suppression does not weaken the retry-hint/no-evidence-ledger machinery
that legitimately depends on attempt-scoped zero-work detection.

### Acceptance Criteria

#### Happy Path
- Given a build attempt that produced zero work product (`detectZeroWorkProduct` true at
  `conductor.ts:3244`), when the gate-miss retry/stall evaluation runs, then the `zero_work_product`
  event is still emitted, the corrective retry-hint preamble ("Previous attempt made zero
  progress…") is still prepended, and the no-evidence ledger still records
  `noEvidenceReasons: ["zero_work_product"]` — byte-for-byte the pre-fix behavior.

#### Negative Paths
- Given a build attempt that DID make progress (resolved more tasks than the prior attempt), when
  the retry/stall evaluation runs, then `detectZeroWorkProduct` is false at `:3244`, no
  `zero_work_product` event fires, and the no-evidence counter is reset — confirming the fix touched
  only the judge-lane predicate, not the kickback path.

### Done When
- [ ] A test exercising the `:3244` path with a zero-work attempt asserts the `zero_work_product`
      event, the retry-hint preamble, and the `noEvidenceReasons: ["zero_work_product"]` ledger tag
      are all still produced after the judge-lane guard is removed.
- [ ] The diff shows no change to the `conductor.ts:3236-3299` kickback/no-evidence block (only the
      judge-lane block at `:3037-3132` is edited).
