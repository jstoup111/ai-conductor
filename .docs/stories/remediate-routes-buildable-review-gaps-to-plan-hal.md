**Status:** Accepted

# Stories: remediate runs a plan-task coverage check before routing to `plan`

**Source:** jstoup111/ai-conductor#1550
**Track:** technical (no PRD — acceptance criteria live here)
**Tier:** S (negative paths are per-story, not per-criterion)

Context the scenarios assume, all verified against the worktree:

- `decideEntryDisposition` refuses autonomous entry to `plan` unconditionally
  (`decide-entry-policy.ts:29,167`) — `plan` is `UNGRANTABLE_STEP`, checked before any grant. In a
  daemon run a `plan` disposition is therefore always a terminal needs-human HALT, never a
  re-plan. This behavior is correct and is **not** changed by this feature.
- The two machine-consumed planner surfaces are `skills/remediate/SKILL.md` and
  `agents/remediation-planner.md`. Both are asserted by contract tests today
  (`test/acceptance/remediation-authority-routing.acceptance.test.ts`), which is the pattern the
  Done-When checkboxes below use.
- The build_review→remediate dispatch is `conductor.ts:7453-7461`; the active plan path is
  resolved by `getActivePlanPath()` only *after* dispatch (`conductor.ts:2456`).

---

## Story 1: A review gap satisfiable within an approved plan task routes to `build`

**Requirement:** Issue #1550, desired outcome 1

As the daemon, I want a `build_review` gap whose fix fits inside an already-approved plan task to
be dispositioned `build`, so that the run continues autonomously instead of ending in a
needs-human halt the operator resolves by hand-writing the same build-step fix.

### Acceptance Criteria

#### Happy Path

- Given both planner surfaces (`skills/remediate/SKILL.md` and `agents/remediation-planner.md`),
  when either is read, then each states that a `plan` disposition may only be chosen **after**
  checking the approved plan's existing tasks, and that a gap whose remedy is admitted by an
  existing task is `build`.
- Given both planner surfaces, when either is read, then each states in the `build` guidance that
  a test which passes against the baseline and needs strengthening within an existing task's
  RED/GREEN steps is `build` work, not a planning miss.
- Given both planner surfaces, when either is read, then each carries a `build_review` trigger
  entry naming its evidence input and its gap-id format, so a build_review gap is no longer
  serialized under an improvised id borrowed from another trigger.

#### Negative Paths

- Given the existing contract assertion that an in-scope planning omission stays on the `plan`
  route (`remediation-authority-routing.acceptance.test.ts`, "keeps an in-scope planning omission
  on the plan route"), when the new coverage-check guidance is added, then that assertion still
  passes — the coverage check narrows *when* `plan` is reached, and does not delete the `plan`
  route or its omission rule.
- Given a gap arriving from a trigger other than `build_review` (`prd_audit`,
  `architecture_review_as_built`, `finish` test failures, `build_stall`), when the planner reads
  the new guidance, then its existing disposition rules for that trigger are unchanged — the
  coverage requirement is scoped to the `plan` disposition and does not re-route those gaps.

### Done When

- [ ] A contract test asserts, over **both** `skills/remediate/SKILL.md` and
      `agents/remediation-planner.md`, that each requires an existing-plan-task coverage check
      before a `plan` disposition and routes a covered gap to `build`.
- [ ] A contract test asserts both surfaces carry a `build_review` trigger entry with its evidence
      input and gap-id format.
- [ ] `remediation-authority-routing.acceptance.test.ts` passes unmodified in its
      "keeps an in-scope planning omission on the plan route" assertion.
- [ ] `test/test_harness_integrity.sh` passes (both edited files are gated artifacts).

---

## Story 2: An uncovered gap still routes to `plan` and still halts, with its coverage check recorded

**Requirement:** Issue #1550, desired outcomes 2 and 3

As an operator reading a needs-human halt, I want the disposition record to name the plan tasks
the gap was matched against and why none admits the fix, so that I can tell a proven planning gap
from a planner that skipped the check — and so the halt tells me what to do rather than only that
it gave up.

### Acceptance Criteria

#### Happy Path

- Given both planner surfaces, when either is read, then each requires a `plan` disposition's
  `rationale` to name the specific plan task id(s) examined and state why none of them admits the
  fix.
- Given both planner surfaces, when either is read, then each states that in a daemon run a `plan`
  disposition is a terminal needs-human HALT — the daemon never re-plans — so `plan` is a
  last-resort route chosen on proof, not the default for an unclear gap.
- Given a `plan` disposition whose rationale carries the coverage evidence, when the run halts,
  then that rationale reaches the operator through the existing halt evidence path
  (`conductor.ts:2577` builds `remediationEvidence` from the gaps, and `renderDecideEntryHalt`
  prints it as `Evidence:`) — no new field, file, or channel is introduced.

#### Negative Paths

- Given the guidance that `plan` is a terminal HALT, when the planner is tempted to treat `halt`
  and `plan` as interchangeable, then both surfaces state that the two `halt` categories
  (`architectural-clarity`, `product-scope`) remain the only HALT categories and that `plan` is
  still a routed disposition — the guidance must not collapse `plan` into `halt` or widen the HALT
  categories.
- Given a gap whose nature is genuinely uncertain rather than provably uncovered, when the planner
  applies the coverage rule, then the existing `verify-claims` calibration still governs: low
  confidence about the gap's *nature* remains a HALT signal and is not laundered into a `build`
  disposition by an unproven claim of task coverage.

### Done When

- [ ] A contract test asserts both surfaces require a `plan` rationale to cite the examined plan
      task id(s) and why none covers the gap.
- [ ] A contract test asserts both surfaces state that `plan` is a terminal needs-human HALT in a
      daemon run.
- [ ] A contract test asserts both surfaces still name exactly `architectural-clarity` and
      `product-scope` as the HALT categories.
- [ ] `decide-entry-policy.ts` is unchanged in this diff — the autonomous-DECIDE refusal that
      produced the reported halt is verified correct and stays intact.
- [ ] No new `.pipeline/` file, event-union member, or `remediation.json` field is added; the
      coverage evidence travels in the existing `rationale` string.

---

## Story 3: The build_review dispatch stops priming for a re-plan and names the active plan

**Requirement:** Issue #1550, enabling change for outcomes 1 and 3

As the remediation planner, I want the build_review dispatch context to tell me which plan file is
this feature's and to stop asserting that the plan task is under-decomposed, so that the coverage
check the skill demands is actually executable and is not pre-empted by the dispatch's own
hypothesis.

### Acceptance Criteria

#### Happy Path

- Given a `build_review` FAIL that `buildReviewFailRoute` routes to `remediate`, when the
  conductor builds the dispatch context, then that context no longer asserts the plan task may be
  under-decomposed, and instead directs the planner to check the approved plan's existing tasks
  before proposing any plan-level change.
- Given the same dispatch, when the context is built, then it carries the active plan path
  resolved from `getActivePlanPath()`, so the planner can identify this feature's plan inside a
  daemon worktree whose `.docs/plans/` also holds every plan merged from main.

#### Negative Paths

- Given a worktree where `getActivePlanPath()` resolves to `null`, when the dispatch context is
  built, then the dispatch still proceeds with the coverage-check direction and simply omits the
  path — a missing plan path never throws, never blocks the remediation dispatch, and never
  degrades the run to the pre-fix priming text.
- Given the other `planRemediation` callers (the validation-group merge path at
  `conductor.ts:4996` and the serial gate-driven tail), when the build_review dispatch string is
  changed, then their dispatch contexts are unaffected — this story changes only the
  `build_review` call site.

### Done When

- [ ] A test asserts the `build_review` remediate dispatch context contains no
      "under-decomposed"-style claim about the plan task.
- [ ] A test asserts the `build_review` remediate dispatch context includes the active plan path
      when one resolves, and that a `null` plan path still produces a valid dispatch context.
- [ ] The change is confined to the `build_review` call site; the validation-group dispatch
      context at `conductor.ts:4996` is byte-for-byte unchanged.
- [ ] `npm test` in `src/conductor/` passes.
