# Implementation Plan: FINISH prose revision lap (issue #2006)

**Date:** 2026-08-28
**Stories:** .docs/stories/finish-deadlocks-when-the-prose-judge-asks-for-rev.md
**Conflict check:** Clean as of 2026-08-28

## Summary

Adds a `revision_required` prose state to the FINISH publication snapshot so judged-deficient PR
prose routes back to authoring instead of deadlocking, threads the judge's objection into the
authoring pass and the exhaustion halt, and updates the provider verdict contract. 10 tasks.

## Technical Approach

- **Observation** (`src/conductor/src/engine/finish-publication-production.ts`): `prProse`
  currently takes `acceptedRevision: boolean`; widen that parameter to a three-valued verdict
  summary (`accepted | deficient | none`) computed by the existing observation function from
  `judgmentByRevision` for the currently observed revision digest. A `revision_required` stored
  verdict counts as `deficient` only for reasons `placeholder` and `structurally_incomplete`;
  reason `halt` maps to `none` (its routing stays human-required at judgment time). Precedence
  inside `prProse` is fixed: empty → `placeholder`; halt signal → `halt`; floored body →
  `placeholder`; then `accepted` → `'accepted'`, `deficient` → `'revision_required'`, else
  `'stale'`. Store reads stay best-effort (existing `seedJudgmentStore` try/catch) — an absent or
  malformed store yields `none`, so behavior degrades to today's judge-again path, never a halt.
- **Types and selector** (`src/conductor/src/engine/finish-publication.ts`): add
  `'revision_required'` to both prose unions (snapshot and the production observation's narrower
  union). In `nextFinishPublicationTransition`, route `revision_required` to `author_pr_prose`
  alongside `placeholder` (authoring branch), keeping `stale`/`halt`/`indeterminate` on the
  judgment branch. Widen `PrWithAuthoringNeeded` to `placeholder | revision_required` and keep
  `isPrProseJudgmentNeeded` excluding `revision_required`. TypeScript union exhaustiveness (no
  catch-all branches) is the mechanism that finds every match site.
- **Guidance threading**: `PrProseAuthoringRequest` gains optional `revisionGuidance?: string`,
  populated by the production coordinator from the stored verdict's `detail` for the observed
  revision. `conductor.ts`'s `dispatchAuthoring` (currently ignores its request) forwards it as a
  new step option, and the `finishProsePass === 'author'` prompt block in
  `src/conductor/src/engine/step-runners.ts` renders a revision-lap variant: when guidance is
  present the block says the body was authored but judged deficient (quoting the objection) rather
  than claiming the body is an unauthored placeholder.
- **Halt detail** (mechanism decided here, not left to the builder): the
  `publication_retry`-with-transition shape gains optional `detail?: string`;
  `mapPrProseJudgmentResult` populates it from `revision_required.detail` on the
  `authoring_required_after_judgment` arm. `isExactDisposition` widens to admit the optional field
  in the same diff (adr-2026-08-06-publication-progress-is-its-own-disposition requires the
  validator to move with the union). The conductor records the last retry detail and appends it to
  the allowance-exhaustion halt message (`conductor.ts` near the
  `FINISH_PUBLICATION_PROGRESS_ALLOWANCE` check). `FINISH_PUBLICATION_PROGRESS_ALLOWANCE` itself
  is untouched.
- **Contract**: the finish skill's provider-facing verdict vocabulary section and the unattended
  judgment prompt in `step-runners.ts` are updated to request a concrete `detail` on
  `revision_required`; the decoder (`finish-pr-prose-judgment.ts`) already tolerates absent detail
  and is not changed.
- **Sequencing**: types+classifier first (everything depends on the union), then selector and
  predicates, then the lap plumbing (guidance, identical-revision guard proof), then bounding and
  contract.
- **Local pattern**: the cached-acceptance read (`judgmentByRevision.get(revisionDigest(revision))
  ?.kind === 'accepted'` inside the observation function) is the pattern for the deficient-verdict
  read — same digest keying, same read-inside-observation placement, same tolerance of an absent
  store. Allowed variation: the new read inspects `reason` to exclude `halt`. Search hints:
  `seedJudgmentStore`, `revisionDigest`, `prProse` in `finish-publication-production.ts`.

## Prerequisites

None — the persisted verdict store and all touched seams already exist.

## Tasks

### Task 1: Classify judged-deficient prose as revision_required
**Story:** Story 1 — happy-path criteria (deficient verdicts classify as revision_required; accepted still accepted)
**Type:** happy-path

**Steps:**
1. Write failing tests: `prProse` (via the observation function with a faked store) returns `revision_required` when the observed revision digest has a stored `revision_required` verdict with reason `structurally_incomplete`, and again for reason `placeholder`; returns `accepted` for a stored `accepted` verdict.
2. Verify tests fail (RED) — the union member does not exist yet.
3. Implement: add `'revision_required'` to the prose unions in `finish-publication.ts` (snapshot field and the production classifier's return union); widen `prProse`'s `acceptedRevision` boolean to the three-valued verdict summary per Technical Approach; compute the summary from `judgmentByRevision` beside the existing accepted-revision read (local pattern above).
4. Verify tests pass (GREEN); fix every union match site the compiler flags — no catch-all branches.
5. Commit with message: "finish: classify judged-deficient prose as revision_required"

**Done when:**
- [ ] The prose unions in `finish-publication.ts` include `revision_required` and `npx tsc --noEmit` (via the package's build/test run) passes with no catch-all added at any match site
- [ ] New tests in `src/conductor/test/engine/finish-publication-production.test.ts` assert `revision_required` for both deficient reasons and `accepted` for an accepted verdict, and pass
- [ ] The verdict summary is computed from the digest of the currently observed title/body revision, asserted by a test whose store key matches only that digest

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — prose union members
- src/conductor/src/engine/finish-publication-production.ts — verdict summary + prProse
- src/conductor/test/engine/finish-publication-production.test.ts — classification tests

**Dependencies:** none

### Task 2: Classification precedence and store degradation
**Story:** Story 1 — negative-path criteria (halt precedence, halt-reason exclusion, edited body, unreadable store, floored body)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a halt-signal PR whose digest also has a deficient verdict classifies `halt`; (b) a stored verdict with reason `halt` yields `stale`, not `revision_required`; (c) a body edited after the verdict (digest mismatch) yields `stale`; (d) a malformed store file does not throw and yields `stale` for authored prose; (e) an engine-floored body with a coincidental stored verdict yields `placeholder`.
2. Verify the not-yet-passing cases fail (RED); some may already pass from Task 1's ordering — keep them as pinning tests.
3. Implement any precedence fix needed so the order is exactly: empty → placeholder; halt → halt; floored → placeholder; accepted → accepted; deficient → revision_required; else stale.
4. Verify all five tests pass (GREEN).
5. Commit with message: "finish: pin revision_required precedence and store degradation"

**Done when:**
- [ ] All five scenarios above are asserted by named tests in `finish-publication-production.test.ts` and pass
- [ ] The reason-`halt` exclusion is asserted directly (stored halt-reason verdict never produces `revision_required`)
- [ ] The malformed-store test feeds invalid JSON and asserts no throw and `stale` classification

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts — precedence ordering if needed
- src/conductor/test/engine/finish-publication-production.test.ts — precedence/degradation tests

**Dependencies:** 1

### Task 3: Selector and effect predicates route revision_required to authoring
**Story:** Story 2 — happy-path criterion (selector picks author_pr_prose) and the stale-still-judged negative
**Type:** happy-path

**Steps:**
1. Write failing tests: `nextFinishPublicationTransition` returns `author_pr_prose` for a snapshot with prose `revision_required` (identity one, branch pushed, readiness valid); returns `judge_pr_prose` for `stale` unchanged.
2. Verify RED.
3. Implement: extend the authoring branch of the selector to `placeholder | revision_required`; widen `PrWithAuthoringNeeded` and `isPrProseAuthoringNeeded` to match; confirm `isPrProseJudgmentNeeded` excludes `revision_required` (add the explicit exclusion) so no judgment dispatch fires for a revision already judged.
4. Verify GREEN.
5. Commit with message: "finish: route revision_required prose to the authoring transition"

**Done when:**
- [ ] Selector tests in `src/conductor/test/engine/finish-publication.test.ts` assert `revision_required` → `author_pr_prose` and `stale` → `judge_pr_prose`, and pass
- [ ] A predicate-level test asserts a `revision_required` PR is authoring-needed and not judgment-needed
- [ ] No judgment request is constructible for `revision_required` prose (type-level: `PrWithJudgmentNeeded` excludes it)

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — selector + predicates + narrow types
- src/conductor/test/engine/finish-publication.test.ts — selector/predicate tests

**Dependencies:** 1

### Task 4: The #2006 deadlock is reproduced, then gone; the reconcile guard keeps its purpose
**Story:** Story 2 — the retry-reconcile happy path and the guard-preservation negative
**Type:** negative-path

**Steps:**
1. Write a failing coordinator-level test reproducing issue #2006: authored body, persisted `structurally_incomplete` verdict for its exact digest, fresh dispatch — assert the coordinator advances into `author_pr_prose` (authoring effect invoked) and never resolves `human_required` with reason `publication_transition_unmoved`.
2. Verify RED against pre-change routing (test must fail before Tasks 1+3 land; if authored after them, assert it fails on a checkout without those changes via the TDD harness's red evidence).
3. Implement nothing new if Tasks 1–3 already make it pass; otherwise fix the seam the test exposes (e.g. the halted-PR check ordering in `reconcileSelectablePublicationRetry` stays first).
4. Add/keep a test asserting `reconcileSelectablePublicationRetry` still resolves `human_required: publication_transition_unmoved` for a retry whose named transition the fresh observation genuinely does not select (non-prose example, e.g. a shipped-record retry after the record appears), and a test that a halted PR still resolves `halt_state_pr` before any prose dispatch.
5. Commit with message: "finish: prove the prose revision deadlock is gone and the guard intact"

**Done when:**
- [ ] A test in `src/conductor/test/engine/conductor-finish-publication-defect.test.ts` (or the non-advancing-transition acceptance suite) drives the exact #2006 state and asserts the authoring effect runs with no `publication_transition_unmoved` result
- [ ] A test asserts the guard still fires for a genuinely unselectable non-prose retry
- [ ] A test asserts `halt_state_pr` precedence over the authoring lap for a halted PR

**Files likely touched:**
- src/conductor/test/engine/conductor-finish-publication-defect.test.ts — deadlock repro + guard tests
- src/conductor/test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts — guard preservation

**Verify-only:** no — the repro test is new coverage; expect no production diff beyond Tasks 1–3
**Dependencies:** 3

### Task 5: Authoring request carries the judge's objection
**Story:** Story 3 — guidance-population happy path and the detail-absent negative
**Type:** happy-path

**Steps:**
1. Write failing tests: when the observed revision's stored deficient verdict carries `detail`, the coordinator's authoring dispatch receives a `PrProseAuthoringRequest` with `revisionGuidance` equal to that detail; when the stored verdict has no `detail`, the request omits the field and the dispatch still runs.
2. Verify RED.
3. Implement: add optional `revisionGuidance?: string` to `PrProseAuthoringRequest`; populate it in the production coordinator's authoring path from the stored verdict for the observed digest (same store read as Task 1; guidance lookup tolerates an absent store).
4. Verify GREEN.
5. Commit with message: "finish: deliver the judge's objection to the authoring pass"

**Done when:**
- [ ] `PrProseAuthoringRequest` carries optional `revisionGuidance` and tests in `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` assert populated and omitted cases
- [ ] A detail-less verdict provably still dispatches authoring (test asserts the dispatch happened with no guidance field)

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — request type + request builder
- src/conductor/src/engine/finish-publication-production.ts — guidance population
- src/conductor/test/engine/finish-pr-prose-authoring.test.ts — guidance tests

**Dependencies:** 3

### Task 6: Render the revision-lap authoring prompt
**Story:** Story 3 — the rendered provider task contains the objection
**Type:** happy-path

**Steps:**
1. Write failing tests over the step-runner prompt builder: with `finishProsePass: 'author'` and a supplied guidance string, the prompt contains a revision-lap block naming the judge's objection verbatim and does NOT claim the body is an unauthored placeholder; with no guidance, the existing placeholder-authoring block renders unchanged.
2. Verify RED.
3. Implement: `conductor.ts`'s `dispatchAuthoring` forwards `request.revisionGuidance` into the step options (new optional option beside `finishProsePass`); the `finishProsePass === 'author'` block in `step-runners.ts` renders the revision-lap variant when guidance is present — same boundaries as the existing block (no create/push/merge/ready, no label or completion writes, coordinator re-judges afterwards).
4. Verify GREEN.
5. Commit with message: "finish: revision-lap authoring prompt carries the judge's objection"

**Done when:**
- [ ] Tests in `src/conductor/test/engine/step-runners.test.ts` assert the guidance-present and guidance-absent prompt variants, and pass
- [ ] The revision-lap variant repeats the existing block's prohibition sentences (verbatim or equivalent), asserted by the same test
- [ ] `dispatchAuthoring` in `conductor.ts` no longer discards its request (guidance observable at the step runner, asserted via the wiring test)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — forward guidance option
- src/conductor/src/engine/step-runners.ts — revision-lap prompt variant
- src/conductor/test/engine/step-runners.test.ts — prompt tests

**Dependencies:** 5

### Task 7: An unproductive authoring pass cannot loop
**Story:** Story 3 — byte-identical revision negative path
**Type:** negative-path

**Steps:**
1. Write a failing coordinator test: authoring effect leaves the body byte-identical (post-effect observation still classifies `revision_required` for the same digest) — assert the advance-path dimension guard reports `author_pr_prose` as not having moved `pr.prose` and the result is `human_required` (not `advanced`, not an endless lap).
2. Verify RED if the current post-authoring success check (`prose !== 'placeholder' && !== 'indeterminate'`) wrongly reports `advanced` for unchanged `revision_required`; the test pins the correct behavior either way.
3. Implement: ensure the post-authoring verification treats an observation still in `revision_required` (same digest) as an unmoved dimension — via `advancedPublicationTransition`'s existing before/after compare, not a new mechanism.
4. Verify GREEN.
5. Commit with message: "finish: identical-revision authoring resolves human_required"

**Done when:**
- [ ] A test asserts the byte-identical authoring outcome resolves `human_required` through the existing dimension guard and passes
- [ ] A companion test asserts a genuinely rewritten body (new digest, prose observes `stale`) reports `advanced` — the guard does not false-halt a productive pass

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — post-authoring verification if needed
- src/conductor/test/engine/finish-publication.test.ts — dimension-guard tests

**Dependencies:** 5

### Task 8: Retry detail rides the disposition and the exhaustion halt names the objection
**Story:** Story 4 — halt-carries-detail criteria (with and without detail)
**Type:** happy-path

**Steps:**
1. Write failing tests: `mapPrProseJudgmentResult` on `revision_required`/`structurally_incomplete` with detail yields a `publication_retry` carrying that detail; `isExactDisposition` accepts the widened shape (and still rejects extra unknown fields); the conductor's allowance-exhaustion halt message includes the last retry's detail when present and renders cleanly without one.
2. Verify RED.
3. Implement: add optional `detail?: string` to the transition-bearing `publication_retry` member; populate on the `authoring_required_after_judgment` arm; widen `isExactDisposition` in the same diff; in `conductor.ts`, record the last publication-retry detail and append it to the exhaustion halt reason string.
4. Verify GREEN.
5. Commit with message: "finish: exhaustion halt states the judge's objection"

**Done when:**
- [ ] `isExactDisposition` admits the optional detail and a test proves a five-key retry object is still rejected
- [ ] A test asserts the exhaustion halt string contains the verdict detail verbatim when present and contains no empty detail clause when absent
- [ ] `FINISH_PUBLICATION_PROGRESS_ALLOWANCE` and its derivation are byte-unchanged in the diff

**Files likely touched:**
- src/conductor/src/engine/finish-publication.ts — retry shape + mapper + validator
- src/conductor/src/engine/conductor.ts — exhaustion halt message
- src/conductor/test/engine/finish-publication.test.ts — mapper/validator tests

**Dependencies:** none

### Task 9: Non-convergence terminates at the existing allowance
**Story:** Story 4 — bounded-lap happy path and the converging-lap negative
**Type:** negative-path

**Steps:**
1. Write failing acceptance tests with faked effects: (a) an always-deficient judge (every authored revision judged `structurally_incomplete`) terminates via the existing publication-progress allowance with a halt, not an unbounded loop; (b) a judge that accepts the second revision publishes through to the shipped record with no allowance halt.
2. Verify RED (the lap does not exist before Tasks 3/5).
3. Implement nothing new if prior tasks make both pass; fix any lap-accounting seam the tests expose (each author and judge advance must charge the same allowance counter as today).
4. Verify GREEN.
5. Commit with message: "finish: author-judge laps terminate at the progress allowance"

**Done when:**
- [ ] Both scenarios are asserted in `src/conductor/test/acceptance/finish-publication-progress-budget.acceptance.test.ts` (or a sibling acceptance file) and pass
- [ ] The always-deficient run's terminal halt includes the judge's last objection (composes with Task 8)
- [ ] No new counter, constant, or config key appears in the diff

**Files likely touched:**
- src/conductor/test/acceptance/finish-publication-progress-budget.acceptance.test.ts — lap bounding tests

**Dependencies:** 4, 5, 8

### Task 10: Provider verdict contract documents the lap
**Story:** Story 5 — contract-and-decoder criteria
**Type:** happy-path

**Steps:**
1. Write/extend failing tests: the judgment decoder contract tests assert the documented verdict set in the finish skill matches the decoder exactly after the contract text update; decoder behavior for `malformed_response`, `refused`, `timed_out`, `provider_unavailable`, and detail-less `revision_required` is pinned unchanged.
2. Verify RED where the contract text assertion fails against the un-updated skill text.
3. Implement: update the finish skill's provider-facing verdict vocabulary section to state that deficient verdicts route to an authoring pass and that `revision_required` should carry a concrete `detail` naming what is deficient; update the unattended judgment prompt in `step-runners.ts` to request that detail (decoder unchanged — absence still decodes).
4. Verify GREEN.
5. Commit with message: "finish: verdict contract documents the revision lap and requests detail"

**Done when:**
- [ ] `src/conductor/test/engine/finish-pr-prose-judgment.test.ts` passes with the updated skill text and pins the four unchanged routings plus detail-less decoding
- [ ] The unattended judgment prompt in `step-runners.ts` asks for a concrete objection detail on `revision_required`, asserted by a prompt test
- [ ] The decoder source file has no behavioral diff

**Files likely touched:**
- skills/finish/SKILL.md — verdict contract section
- src/conductor/src/engine/step-runners.ts — judgment prompt detail request
- src/conductor/test/engine/finish-pr-prose-judgment.test.ts — contract tests

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──► Task 2
   │
   └─────► Task 3 ──► Task 4 ──┐
              │                 ├──► Task 9
              └──► Task 5 ──► Task 6
                      │         │
                      └──► Task 7
Task 8 ────────────────────────┘ (Task 9 also depends on Task 8)
Task 10 (independent)
```

## Integration Points

- After Task 4: the #2006 deadlock scenario is provably gone at the coordinator level.
- After Task 6: a full author-with-guidance dispatch is renderable end-to-end with fakes.
- After Task 9: the complete bounded lap (author → judge → author → … → halt/publish) is exercised.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks with no unbounded quality words left open
- [ ] Dependencies are explicit and acyclic
