# Conflict Check: declared pattern replication for Nth-of-a-kind BUILD work

**Date:** 2026-08-09
**Stem:** `build-dispatches-every-plan-task-through-a-full-ge`
**Tier:** M · **Track:** technical
**Scope:** the 7 stories in `.docs/stories/build-dispatches-every-plan-task-through-a-full-ge.md`,
checked internally pairwise and against `.docs/stories/`, `.docs/decisions/`, `.docs/plans/`, and
`HARNESS.md`.
**Result:** PASSED — zero blocking conflicts. One coverage gap found and resolved in-pass; one
degrading narrowing accepted by prior operator decision.

All pairs sharing a behavior, gate, or artifact were tested in **both** directions ("if A is fully
satisfied, does B still hold?"). Conclusions below carry confidence and basis; nothing is recorded
as clean on the assumption that a pair is compatible.

---

## Resolved: Stories 5 and 6 did not partition the task set

**Stories involved:** Story 5 (tasks the copy satisfies close on existing evidence) vs Story 6
(delta tasks run the full, unmodified cycle)
**Type:** sequencing / coverage gap — **not** an oscillation
**Severity:** degrading (was), resolved
**Confidence:** 90%, verified against both stories' text

**Oscillation test, both directions.** Fully satisfying Story 6 (every new-behavior task runs the
full cycle) leaves Story 5 intact, because Story 5 governs only tasks the copy satisfies. Fully
satisfying Story 5 leaves Story 6 intact for the same reason. Two "yes" answers, so this is not an
oscillation and never was.

**What was actually wrong.** Neither story governed a task whose criteria the copy satisfies only
*partly*. That task fell between them, and the closure decision is made per task at build time by
an agent — precisely the condition under which an unstated boundary becomes rework. Left alone this
would not loop, but it would produce inconsistent closures across builds and give the completeness
rubric contradictory precedents.

**Resolution applied** — a tie-break section added between Stories 4 and 5, plus a matching
negative-path criterion on Story 5:

> A task closes via `Evidence: satisfied-by` only if the copy satisfies **every** one of its
> acceptance criteria. Any unsatisfied criterion makes the whole task a delta task running the full
> cycle. No partial closure; no build-time task splitting. Ambiguity resolves toward the full
> cycle.

This makes the two stories jointly exhaustive and mutually exclusive. It also fails safe: the
uncertain case gets *more* verification, not less, which is the direction
`adr-2026-07-21-s-tier-pipeline-knobs` D3's "smallness lowers the floor; it never removes the
safety net" points.

---

## Accepted (degrading): Story 7 narrows a standing duplication-review convention

**Stories involved:** Story 7 vs `skills/simplify/SKILL.md:43` ("Copy-paste with tweaks | Same
method with 1-2 param differences | Extract with parameters")
**Type:** behavioral overlap
**Severity:** degrading — accepted
**Confidence:** 85%, verified against the cited line

**Both directions.** Satisfying Story 7 leaves `simplify:43` operative for all undeclared
duplication; Story 7 suppresses only the reflex flag on the declared source-target pairs and
explicitly retains extraction authority. Satisfying `simplify:43` in its current unnarrowed form
would flag every declared replication, which Story 7 forbids — one "no", so this is an ordinary
overlap resolved by narrowing, not an oscillation.

**The cross-feature loop was examined specifically and is not one.** The feared shape is:
review proposes extraction → operator extracts → next feature re-creates a replication → review
proposes extraction again. That does not oscillate, because extraction changes the source: once the
family is parameterized there is no longer an Nth copy to declare, and the next feature declares
the parameterized surface instead. The steady state is stable in both branches.

**Accepted on prior operator decision (2026-08-09):** copying is the correct end state for these
instances because they are meant to evolve independently, *and* the duplication review may still
refactor where it genuinely makes sense. Story 7 encodes exactly that pair. The accepted cost is
that a replication family can grow un-extracted for longer than the unnarrowed convention would
allow.

No `.docs/` artifact assertion is falsified, so no amendment note is required. `simplify/SKILL.md`
is a skill contract, not a DECIDE artifact; its change is a plan task.

---

## Clean: Story 2's failure and Story 4's failure cannot be confused

**Confidence:** 92%, verified against step wiring

They occur at **different steps against different objects**. Story 2's failure is a *spec* failing
during `acceptance_specs`, counted by the existing RED-evidence validation's `failed` tally — a
desired outcome and the step's success condition. Story 4's failure is a *task* failing during
`build` on a copy-equivalence mismatch — fatal. There is no shared counter, no shared artifact, and
no step where both are in scope.

**One guard is nonetheless required in the plan**, because the separation is currently structural
rather than asserted: the copy-equivalence check must not run at `acceptance_specs`, and the RED
evidence must never be derived from an equivalence result. Recorded here so `/plan` carries it as
an explicit task constraint rather than an accident of ordering.

---

## Clean, and NOT redundant: Story 6's invariant test vs plan tasks T4/T6

**Checked against:** `.docs/plans/s-tier-pipeline-knobs.md` T4 and T6
**Confidence:** 88%, verified against both task descriptions

This was raised as a suspected redundancy. It is not one — the two pin **different axes**:

| | Varies | Holds fixed | Asserts |
|---|---|---|---|
| T4 / T6 | the **tier** (S vs others) | no declaration present | `getSkippableSteps('S')` equals an exact list; `shouldSkipForTier` is false for the evidence-gate set |
| Story 6 | the **presence of a declaration** | tier | the skip set and enabled-gate set are unchanged by a declaration |

T4/T6 never vary a declaration — they predate the concept. Story 6's test is the only thing that
would catch a future edit adding a declaration-conditional skip, which is exactly the regression
this feature makes newly possible. Keeping both is a genuine safety gain, not a maintenance cost.

Story 6 also does not contradict T4/T6: it asserts the same sets are unchanged, so a violation of
Story 6 that touched the tier axis would fail T4/T6 as well. The pins are complementary and
mutually consistent.

---

## Clean: the inactive path is total

**Confidence:** 90%, verified by enumerating every story

Stories 1, 2, 3, 5, and 7 each carry an explicit "plan with no declaration" negative path. Story 4
does not, and Story 6's is implicit — but both are covered by the cross-cutting acceptance item:

> A plan carrying no declaration produces behavior byte-identical to the pre-change baseline at
> every affected step.

That item is unqualified and applies to all seven stories, so the inactive path is total. No story
assumes a declaration exists in a context where one may be absent. Story 3's third negative path
closes the inverse case explicitly — a copy task on a plan with no declaration is invalid rather
than silently permitted.

---

## Clean: no conflict with the governing APPROVED ADRs

- **`adr-2026-07-21-s-tier-pipeline-knobs`** — no conflict. Nothing here is tier-conditional;
  nothing is added to any `skippableForTiers` list; no gate is disabled. D4's RED-first invariant
  is preserved in substance by Story 6 and reinforced by the new tie-break, which resolves ambiguity
  toward more verification. Confidence 85%; the residual is the prose-reading question already
  recorded as Assumption 2 in `adr-2026-08-09-declared-pattern-replication-in-build.md`, and it does
  not bind under the chosen approach because nothing is weakened.
- **`adr-2026-07-17-verify-only-judged-closure`** — no conflict. Story 5 uses the existing
  `Evidence: satisfied-by` form unchanged, introduces no new variant, and its Done When explicitly
  pins that no existing derivation check is relaxed. The sha-exists and ancestor-of-HEAD
  requirements are carried forward as negative paths rather than assumed. Confidence 90%.
- **`HARNESS.md`** — no conflict found. The nearest sentence is the plan-tasks-own-their-scoped-tests
  rule, which the design satisfies: the copy task owns the equivalence check, and delta tasks own
  their RED/GREEN tests. Confidence 80%; flagged for `/plan` to re-read in context rather than
  asserted as settled.

---

## Recurring patterns

No prior report in `.docs/conflicts/` covers this feature area. Nothing here recurs from an earlier
check.

## Carried into `/plan`

1. The equivalence check must not run at `acceptance_specs`, and RED evidence must never be derived
   from an equivalence result.
2. Re-read the `HARNESS.md` plan-tasks-own-their-tests sentence in context and confirm no amendment
   is needed.
3. The four conditions from
   `architecture-review-2026-08-09-build-dispatches-every-plan-task-through-a-full-ge.md`.
