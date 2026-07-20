**Status:** Accepted

# Stories: Seed task-status.json before the pre-dispatch attribution guard

Technical track, Small tier. Source: jstoup111/ai-conductor#692.

Acceptance criteria are stated as observable engine behavior at the build step's pre-dispatch
attribution-machinery seam (`checkAttributionMachineryIntact`, `conductor.ts:584`), with
enforcement configured. The *mechanism* (where exactly the seed call is placed, helper shape) is
the plan's job — these stories fix the observable WHAT.

---

## Story: Fresh dispatch seeds task-status.json and proceeds instead of false-halting

**Requirement:** Technical intent — eliminate the deterministic false-halt in #692.

As the conductor engine, I want `.pipeline/task-status.json` seeded from the committed plan before
the pre-dispatch attribution-machinery guard evaluates, so that a fresh/legitimate build dispatch
proceeds instead of halting on a setup-ordering artifact.

### Acceptance Criteria

#### Happy Path
- Given a fresh worktree where `.pipeline/` exists, `.pipeline/session-hooks/{pre-dispatch,post-dispatch,mutation-gate}.sh` are present, the `.pipeline/current-task` stamp path is writable, a single resolvable plan exists under `.docs/plans/`, and `.pipeline/task-status.json` is ABSENT, when the build step reaches its pre-dispatch attribution-machinery check with enforcement configured, then `task-status.json` is seeded from the resolved plan (rows for every plan task, status `pending`) BEFORE the guard evaluates, the guard returns intact, and the build dispatches with no HALT marker written.
- Given the same preconditions, when the seed runs, then the build proceeds to dispatch on the FIRST attempt (no reliance on `attempt >= 2`), so no `.pipeline/halt-*` marker referencing "task-status.json is missing" is ever written for a fresh legitimate dispatch.

#### Negative Paths
- Given `.pipeline/task-status.json` ALREADY exists with `in_progress`/`completed` rows (a resumed or retried build with real prior progress), when the pre-dispatch seed runs, then existing task progress is preserved — the seed merges (never resets completed/in-progress rows back to pending) and no prior evidence attribution is lost.
- Given the pre-dispatch seed itself fails (e.g. `.pipeline/` is not writable so the seed write throws), when the guard path runs, then the build does NOT silently dispatch as if healthy — a clear diagnostic naming the seed-write failure is surfaced (retryable/halt per existing step-retry semantics), distinct from the "attribution machinery broken: task-status.json is missing" wording.

### Done When
- [ ] On a fresh worktree (task-status.json absent, plan present, machinery otherwise intact) with enforcement configured, the build step dispatches without a HALT; `.pipeline/task-status.json` exists and contains one row per plan task after the pre-dispatch check.
- [ ] The seed occurs before `checkAttributionMachineryIntact`'s task-status.json presence check for the build step, verifiable by a test that asserts no "task-status.json is missing" HALT on attempt 1 of a fresh enforcement-configured dispatch.
- [ ] A resumed build whose `task-status.json` has completed rows retains those rows after the pre-dispatch seed (regression test asserts no reset-to-pending).

---

## Story: Genuinely broken attribution machinery still HALTs after the seed

**Requirement:** Technical intent — the seed must not mask real brokenness the #676 guard exists to catch.

As the conductor engine, I want the pre-dispatch guard to still HALT when the machinery is truly
broken (missing session hooks or an unwritable stamp path), so that seeding task-status.json closes
only the false-halt hole and preserves the guard's real protection.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/` exists, task-status.json is seedable from a resolvable plan, all three session-hook scripts are present, and the `.pipeline/current-task` stamp path is writable, when the pre-dispatch check runs, then it returns intact (null) and the build dispatches.

#### Negative Paths
- Given `.pipeline/` exists and the plan is resolvable, but one or more of `.pipeline/session-hooks/{pre-dispatch,post-dispatch,mutation-gate}.sh` is missing, when the pre-dispatch check runs (after the seed attempt), then it still HALTs with the specific "session-hooks/ is missing expected script(s): …" diagnostic — the seed change does not suppress this branch.
- Given `.pipeline/` exists, the plan is resolvable, and session hooks are present, but the `.pipeline/current-task` stamp path is NOT writable, when the pre-dispatch check runs, then it still HALTs with the "current-task stamp path is not writable" diagnostic.
- Given `.pipeline/` does NOT yet exist (a run that hasn't reached pipeline initialization), when the pre-dispatch check runs, then the existing "nothing to attribute yet → intact (null), no HALT" outcome is preserved — the fix must not convert this benign case into a false HALT. (Note for the plan: `seedTaskStatus` currently `mkdir -p`s `.pipeline/`; the plan decides whether the pre-dispatch seed is gated on `.pipeline/` already existing — as the guard's own early return is — so this branch's observable outcome is unchanged. At the build step with enforcement configured, `.pipeline/` already exists from worktree setup, so this case is defensive.)

### Done When
- [ ] A test with a missing session-hook script still produces the session-hooks HALT diagnostic after the seeding change.
- [ ] A test with an unwritable stamp path still produces the stamp-path HALT diagnostic.
- [ ] A test with no `.pipeline/` directory returns intact (no HALT, no early `.pipeline/` creation).

---

## Story: Unresolvable plan surfaces a distinct diagnostic, not "machinery broken"

**Requirement:** Technical intent — when seeding cannot happen because the plan can't be resolved, say so precisely.

As an operator, I want a build that cannot seed task-status.json because the plan is unresolvable to
report a distinct "plan unresolvable" reason, so that I fix the real problem (missing/ambiguous plan)
instead of chasing a misleading "attribution machinery broken" message.

### Acceptance Criteria

#### Happy Path
- Given exactly one plan resolves for the feature (via engine-recorded path, single plan, or slug match), when the pre-dispatch seed runs, then it seeds successfully and the guard proceeds.

#### Negative Paths
- Given `.pipeline/` exists and machinery is otherwise intact, but the plan cannot be resolved (multiple plans under `.docs/plans/` with no `feature_desc`/slug match, so `resolveFeaturePlanPath` returns undefined), when the pre-dispatch seed runs and has nothing to seed, then the guard surfaces a distinct reason that names the unresolvable/ambiguous plan as the cause — NOT the "task-status.json is missing / attribution machinery broken" wording — so the diagnostic points the operator at the plan.
- Given no plan file exists at all under `.docs/plans/` (`resolveFeaturePlanPath` returns undefined) with `.pipeline/` present and enforcement configured, when the pre-dispatch check runs, then the HALT/diagnostic names the missing plan as the cause rather than implying broken attribution machinery.
- Given enforcement is NOT configured, when the build step runs, then no pre-dispatch seed side effect is introduced at the seam and behavior is unchanged from today (the existing post-dispatch completion-predicate seed remains the only seed) — the fix is scoped to the path where the guard actually runs.

### Done When
- [ ] A test with an ambiguous/unresolvable plan and otherwise-intact machinery produces a diagnostic that references the plan (unresolvable/ambiguous), distinguishable from the missing-task-status.json wording.
- [ ] A test with enforcement disabled shows no new pre-dispatch seed behavior at the build seam (scoping regression).
- [ ] The distinct plan-unresolvable reason is asserted by string/shape, so a future refactor cannot silently regress it back to the generic "machinery broken" message.
