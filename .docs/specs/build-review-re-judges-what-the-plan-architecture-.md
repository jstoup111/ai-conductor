# PRD: One owner per review question — consolidating build_review, prd_audit, and the as-built architecture review

**Date:** 2026-08-22
**Status:** Approved
**Source:** jstoup111/ai-conductor#1805

> **Product-only.** States what the review gates must do and why. Mechanism choices are deferred to
> architecture-review under Open Questions.

## Problem / Background

Three review gates currently ask overlapping questions against different artifacts at different
phases. build_review's `scope` and `completeness` rubrics judge the diff against the plan during
BUILD; `prd_audit` judges the shipped implementation against the PRD at SHIP; build_review's
`rootCause` rubric judges whether the mechanism closes the defect, which is the question the DECIDE
architecture review already answered. Because `rootCause` cannot reference the plan, it can only
demand a different mechanism, which `scope` then condemns as unauthorized. Every finding becomes
appended plan work that can never be removed, so features reach the convergence cap on the gate
rather than on the work. On 2026-08-22 three features ran build_review, none passed, and all three
needed an operator. The `rootCause` rubric is already disabled by operator hotfix (#1808) pending
this consolidation.

A second problem compounds this: most features are classified technical, so SHIP-phase grading
(prd_audit, the as-built review) is skipped for work that does change behavior.

## Goals & Non-Goals

**Goals**
- A feature whose implementation matches its approved plan reaches SHIP without an operator
  arbitrating between gates.
- Every review question has exactly one owner; no two gates judge the same substance.
- No gate can direct BUILD to perform work the approved plan does not authorize; plan insufficiency
  is reported to the design-owning phase or filed, never ordered.
- Correctness defects that only exist once code exists are still caught.
- The number of plan tasks a feature accumulates is bounded by its authored plan plus explicitly
  accepted, capped additions.
- SHIP-phase grading runs whenever behavior changed, regardless of tier or track.
- Existing merged specs, plans, and operator configuration keep working: retired settings become
  no-ops, not errors.

**Non-Goals**
- Renaming `prd_audit` or any existing step.
- Adding new review rubrics beyond the reshaped test-quality rubric (security and others come later
  on the container this creates).
- Mechanizing scope as a file-path allowlist.
- Arbitration between peer rubrics (#1630, #1765) — consolidation removes the peers instead.

## Users / Personas

- **Operator** running the daemon autonomously; wants features to ship without hand-resolving gate
  disagreements and to be halted only for decisions that are genuinely theirs.
- **Maintainer** authoring specs; wants the plan to remain the authority over what BUILD does.
- **Consumer project** already on the harness; wants an engine update not to break their config or
  in-flight specs.

## Functional Requirements

### Ownership

- **FR-1:** The `scope`, `completeness`, and `rootCause` build_review rubrics are retired: build_review
  no longer judges plan conformance, outcome delivery, or mechanism soundness.
- **FR-2:** build_review is a container of individually opt-in rubrics, each with a closed input
  scope and the ability to fail a lap but never to append plan tasks.
- **FR-3:** The only rubric shipped in the container is a reshaped **test-quality** judgement, off
  by default, that answers: "do the tests added for new behavior assert that behavior, or could
  they pass against a stub?"
- **FR-4:** test-quality judges only tests bound to a story acceptance criterion or a task's
  `Done when:` check. Tests for untouched behavior, refactor-preserving tests, and relocated tests are
  out of scope. A feature with no acceptance-criteria change has an empty scope and the rubric
  passes without judging.
- **FR-5:** The revert-and-rerun preflight runs only when test-quality is opted in, and then as
  evidence the judge may cite, never a finding by itself; a test that stays green under revert is
  not automatically a failure. With test-quality off, no preflight runs.
- **FR-6:** Per-task delivery is evidenced at BUILD when a task closes: each `Done when:` check must
  be shown true before the task counts as complete. A check that cannot be made true under the
  approved plan is reported as a plan gap, not repaired off-plan.

### prd_audit

- **FR-7:** `prd_audit` keeps its name and position and judges the shipped implementation against the
  stories' acceptance criteria as the authority, using PRD functional requirements as context for
  intent when a PRD exists.
- **FR-8:** `prd_audit` runs on every feature whose stories' acceptance criteria changed, regardless
  of complexity tier or track; it is skipped only when no acceptance criteria changed.
- **FR-9:** `prd_audit` owns the scope question: it judges whether shipped behavior stays within the
  plan and the stated intent. Intent is the PRD's Goals/Non-Goals and In/Out Scope when a PRD
  exists, otherwise the stories plus the plan's stated outcome. A widening within intent is
  self-accepted and recorded; a widening outside intent with no user-visible effect is recorded in
  the verdict and the shipped record and the feature ships; a widening outside intent with
  user-visible effect halts for the operator.
- **FR-10:** Each prd_audit finding carries exactly one grade: PASS, FIXABLE (criterion unmet and an
  existing plan task owns the fix), PLAN_GAP (criterion unmet and no plan task owns the fix), or
  OVER_SCOPE.
- **FR-11:** A FIXABLE finding must name the owning plan task and the acceptance criterion; a finding
  that names neither is rejected as malformed and never becomes work.
- **FR-12:** A prd_audit FAIL yields at most one remediation lap per feature, and the tasks it adds
  are capped at both a fixed count (default 5) and a fraction of the authored task count (default
  25%), whichever is lower. Both caps and the lap count are operator-configurable.
- **FR-13:** When FIXABLE findings exceed the cap, or a second lap would be needed, the gate halts
  for the operator listing every finding instead of appending tasks.
- **FR-14:** A PLAN_GAP finding halts for the operator when the unmet criterion is a happy-path
  scenario; for negative-path or edge scenarios it is recorded in the verdict and the shipped
  record and the feature may ship, unless operator configuration requires a halt.

### As-built architecture review

- **FR-15:** The as-built architecture review runs on every feature. Its individual checks are
  conditional on artifact presence and tier: the reachability sweep and the plan-gap check run at
  all tiers; ADR compliance runs whenever approved ADRs exist; diagram drift runs where diagrams exist.
  Each check is operator-configurable per tier.
- **FR-16:** The as-built review's verdict is one of APPROVED, PLAN_GAP, or BLOCKED. PLAN_GAP means
  the code faithfully implements the approved design and the design is the limit; it is recorded
  in the verdict and the shipped record and ships when acceptance criteria still pass, and halts
  when a stated outcome is not delivered.
- **FR-17:** No SHIP-phase gate (prd_audit, as-built review, manual_test) can send work back to BUILD
  that the approved plan does not authorize; every off-plan need is a halt or a recorded,
  non-blocking finding.

### Bounded growth

- **FR-18:** The total number of tasks a plan can accumulate after approval is bounded by the
  authored count plus the capped prd_audit additions; no other gate appends tasks.
- **FR-19:** The operator can see, per feature, how many tasks were authored, how many were added,
  by which gate, and how much cap remains.

### Backward compatibility

- **FR-20:** Operator configuration that enables or tunes a retired rubric is accepted as a no-op
  with a one-time notice naming the retired setting; it never fails configuration loading or halts a
  run.
- **FR-21:** Merged specs whose plans predate this change (no `Done when:` blocks, or carrying
  previously appended remediation tasks) continue to build: tasks without `Done when:` close on the
  prior evidence rule, and existing appended tasks count toward the authored baseline rather than the cap.
- **FR-22:** Persisted review dispositions and verdicts from retired rubrics are ignored, not
  rejected, when a feature resumes after the update.

### Cleanup

- **FR-23:** Code, fixtures, and tests that exist only to serve a retired rubric or a behavior this
  change no-ops are removed in the same change, not left dead; what remains is only what the
  backward-compatibility requirements (FR-20–22) need — the no-op acceptance of retired settings and
  the tolerant reading of old plans and dispositions. No retired rubric remains dispatchable.

## Non-Functional Requirements

- A gate's finding vocabulary and grades are schema-constrained; the engine, not the judge,
  derives the gate outcome.
- Every new verdict, halt, and recorded finding is emitted on the existing telemetry spine.
- Non-blocking findings recorded at ship are shaped so the post-ship action channel (#1810) can
  pick them up without re-running review.

## Acceptance Criteria / Success Metrics

- A plan-conformant feature traverses BUILD→SHIP with zero operator interventions in an
  end-to-end run with faithful fakes.
- A feature whose plan cannot close its defect ends in a recorded PLAN_GAP or a halt with no
  appended tasks beyond the cap.
- A consumer config that still enables `scope`/`completeness`/`rootCause` loads with a notice and
  the run proceeds.
- A merged pre-change spec builds to SHIP unchanged.
- All FRs covered by acceptance tests.

## Scope

### In Scope
- Retiring three rubrics; the rubric container and test-quality rubric.
- prd_audit re-keying, run rule, grades, caps, scope-as-intent.
- As-built review run rule, per-check policy, PLAN_GAP verdict.
- Task-close `Done when:` evidence; growth bound and its visibility.
- Removal of code and tests serving retired rubrics; backward-compat no-ops and resume behavior; ADRs superseding the affected build_review ADRs.

### Out of Scope
- Step renames; additional rubrics; file-list scope mechanization; peer-rubric arbitration.
- A post-ship action channel for non-blocking findings (#1810) and a committed halt record
  (#1809) — separate features; this spec records findings in the verdict and shipped record only.

## Key Decisions & Rationale

- **Cut, don't neuter, rootCause** — a rubric with no authority still costs laps.
- **Scope lives with intent, not structure** — "did we ship more than asked" is a requirements
  question, so it sits with prd_audit, not the as-built review.
- **Stories are the authority, PRD is the lens** — stories exist on both tracks, so one gate covers
  every behavior change.
- **Keep the prd_audit name** — a rename costs a migration and telemetry continuity for no behavior.
- **FIXABLE requires an owning plan task** — the single question that separates "fix it" from "halt".
- **Run every gate; condition the checks** — skips keyed on tier/track are how grading was lost.

## Dependencies

- #1764 (merged): plans carry `Done when:` blocks.
- #1810 (blocker for the full outcome): the post-ship action channel that consumes the
  non-blocking findings this spec records. #1763 (spec merged, not building) is superseded by it.
- #1809 (related): a committed, pushed halt record for operator pickup.
- #1808 (merged): interim hotfix disabling rootCause; superseded by this change.

## Open Questions

- Where the per-feature growth ledger (authored / added / remaining) is recorded and surfaced
  (trade-off: extend the existing kickback ledger vs a new record on the spine).
- How a test is bound to a criterion or `Done when:` check for test-quality scoping (trade-off:
  declared reference in the test vs derived from acceptance-spec provenance).
- Whether the ADR-compliance and diagram checks' tier defaults should also be operator-overridable
  downward (a lighter S-tier lane) in the first version.
