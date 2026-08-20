# ADR: the Completeness rubric exempts preservation maintenance, anchored to engine-derived removal evidence and a behavior-level plan clause

**Date:** 2026-08-16
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1580), operator-confirmed
**Relates to:**
`adr-2026-07-21-completeness-as-build-review-rubric.md` (the governing ADR for this rubric, whose
holistic-judgement guardrail this decision must not breach),
`adr-2026-08-12-removal-anchored-tautology-exemption.md` (the structural model — an exception valid
only against engine-computed evidence),
`adr-2026-08-15-verify-only-anchored-tautology-exemption.md` (the second instance of that model, and
the precedent for adding a projection field additively),
`adr-2026-08-13-engine-managed-build-review-rubric-branches.md` (the fan-out that makes the rubric
SKILL.md, not `build-review-prompt.ts`, the live contract surface),
`adr-2026-08-13-stable-build-review-finding-dispositions.md` (the complementary operator valve)
**Supersedes:** nothing.
**Does not change:** the Scope, Root cause, or Tautology rubrics; the all-or-FAIL rule; the grader's
input isolation; the judged-result schema; disposition semantics; or Completeness's default-enabled
status.

## Context

Issue #1580. The Completeness rubric is one of the two loudest finders in the current
`.daemon/daemon.log` (26 findings, tied with rootCause, behind tautology's 44). A recurring family of
those findings is not missing behavior — it is **relocated coverage read as deleted coverage**.

### The incident

Feature `live-daemon-e2e-tier-covers-only-claude-no-real-ag`, 2026-08-14T21:45, produced five
Completeness findings from a single plan task. Task 9's step 4 reads, in full:

```text
4. Verify test passes (GREEN), and confirm the file's existing ungated self-check cases pass
   unchanged.
```

That is **one generic clause**. It names no test case. The grader expanded it into five findings,
one per case it found in the pre-diff file:

```text
[completeness] [99%, verified by repository search] Task 9 required the existing ungated transparent
TokenMeter wrapper/optional-member self-check to pass unchanged, but that case was deleted with
daemon-e2e-live.smoke.test.ts and has no retained equivalent.
[completeness] ... the existing ProvisionedHome injection check for both invoke methods ...
[completeness] ... the existing failed-preflight-before-dispatch self-check ...
[completeness] ... the existing post-preflight outcome-failure/diagnostics distinction self-check ...
[completeness] ... the existing pre-halted-fixture non-dispatch self-check ...
```

The plan's own subject was splitting one smoke file into per-provider legs. The maker did exactly
that. Every named case's disappearance from its original file became a finding regardless of whether
an equivalent assertion survived elsewhere.

Confidence 99%, basis: verified — Task 9 read directly from
`.docs/plans/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`, finding text quoted in #1580.

### The asymmetry

The same diff shape reaches opposite verdicts from two rubrics grading it:

| Surface | Treatment of a relocated test |
|---|---|
| `skills/build-review-tautology/SKILL.md:53` | **Exempt** — "fixture relocation" is one of four closed exceptions |
| `skills/build-review-completeness/SKILL.md:24` | **FAIL** — `removalContext` is "diff-derived removal evidence, **never an exemption**" |

Tautology gained relocation-awareness through `adr-2026-08-12` and two successor ADRs. Completeness
never did, though it receives the identical `removalContext` block in the same v2 projection.
Confidence 97%, basis: verified — both SKILL.md files and
`build-review-projections.ts:73` read directly.

### What is NOT the generator

The issue's leading hypothesis is that `skills/plan/SKILL.md`'s authoring mandates (2–5-minute
granularity, exhaustive per-task enumerations, "must pass unchanged" parity clauses) produce the
load. Measured, that does not hold:

- `skills/plan/SKILL.md` mandates **no** preservation-clause form. A grep for "pass unchanged" and
  "preservation" over it returns zero hits.
- Six of 288 landed plans use the phrase at all.
- The incident plan wrote its clause **generically**; the grader supplied the enumeration.

Confidence 95%, basis: verified by grep over `.docs/plans/` and `skills/plan/SKILL.md`.

The plan skill is therefore not the amplifier. It is, however, missing something: there is no
sanctioned way to write "this behavior's coverage must not regress" such that a grader can tell it
apart from free prose. That gap is real and this decision closes it — but as an enabler for the
rubric change, not as the fix on its own.

### The load-bearing constraint

The governing ADR, `adr-2026-07-21-completeness-as-build-review-rubric`, decision #1, states that the
grader

> reasons **holistically over (diff vs plan)** and is explicitly forbidden from per-task
> SHA/reachability/corroboration reasoning (the guardrail that keeps the deleted wedge classes from
> re-emerging).

Every Tautology exception is a **per-test predicate**. Copying that shape naively into Completeness
would introduce per-item reasoning into the one rubric whose governing ADR forbids it, and would
re-open the wedge classes that ADR was written to close.

**This is the specific way this decision was nearly got wrong, and it is recorded because a future
reader will otherwise read the exception below as a breach of the guardrail.** The prohibition is
narrow and concrete: it forbids chasing *commits* — per-task SHAs, commit reachability, trailer
corroboration. It does not forbid the grader from reading a named clause in the plan and checking the
diff against it; the rubric already does exactly that when it decides an outcome is undelivered. The
predicate below consumes only plan text, diff content, and engine-derived removal evidence. It never
touches a commit, a SHA, a trailer, or `.pipeline/task-status.json`. Confidence 90%, basis: inferred
from the governing ADR's stated rationale plus the wedge classes it names; the distinction is drawn
here deliberately so it can be challenged rather than assumed.

## Options Considered

### Option A: a closed Completeness exception, anchored to removal evidence plus a behavior-level plan clause
- **Pros:** Attacks the measured generator — the grader's named-case-survival reading. Resolves the
  two-rubric contradiction. Reuses a structural model this repository has landed twice this month, so
  the failure modes are known. Requires no new derivation: `removalContext` is already computed by
  `deriveBuildReviewRemovals` and already shipped to this rubric.
- **Cons:** Widens an exemption surface on the rubric that carries sole completeness authority. Adds
  a second plan header form months before #1602 may generalize plan authorization. The
  equivalence judgement is an LLM call, not a deterministic check.

### Option B: authoring-side only
- **Pros:** Smallest possible diff; no exemption risk; no engine change.
- **Cons:** Aimed at a generator the evidence refutes — the incident plan's clause was already
  generic. Does nothing for 288 landed plans, for in-flight features, or for the rubric asymmetry.
  Leaves the grader free to enumerate whatever prose it is handed.

### Option C: engine-computed coverage-delta index
- **Pros:** Deterministic; no LLM in the equivalence call; fully auditable.
- **Cons:** Requires a test-case-title parser per framework, in consumer-facing harness code that
  must work for any stack. Its determinism collapses at exactly the cases that matter —
  table-driven and parameterized cases (`it.each`), renamed-but-equivalent titles, cases split across
  files. It re-mechanizes a question that is inherently a judgement, which `CLAUDE.md`'s design
  principle names as its own failure class ("the mechanism cannot recognize resolution").

## Decision

**Adopt Option A. The Completeness rubric gains exactly one narrow exemption — preservation
maintenance — available only against evidence the engine derived, and judged at the level of
surviving assertions rather than surviving test cases.**

### D1 — A plan may state a preserved behavior, at behavior level

`skills/plan/SKILL.md` gains one task-block header form:

```markdown
**Preserves:** <the behavior or contract whose coverage must not regress>
```

The value names a **behavior**, never a test case, file, or `it(...)` title. Authoring guidance
states that boundary explicitly and gives the incident's clause as the rejected form. The line is
optional; its absence means the task declares no preserved behavior, and the rubric's ordinary
holistic judgement applies unchanged.

This form is scoped to preservation and makes no claim on the broader enumerate-versus-invariant
authorization question that #1602 will decide. If #1602 lands a general invariant form, it may
absorb or supersede this one; that reconciliation belongs to #1602's DECIDE, not this one.

### D2 — The engine parses it deterministically into the projection

A new parser in `src/conductor/src/engine/plan-task-parse.ts` — shaped after the existing
`parsePlanTaskVerifyOnly` — extracts each task's preserved-behavior clause. It travels as
`preservationContext` on `BuildReviewSourceSnapshot`, added **additively to projection version v2**,
exactly as `verifyOnlyContext` was added by `adr-2026-08-15`. No LLM is in the derivation path. A
malformed clause fails closed: it does not appear in the block, so it grants no exemption.

### D3 — It travels as evidence, not as an exemption grant

`removalContext` and `preservationContext` are evidence blocks. Neither one exempts anything by its
presence. The rubric applies a closed **per-clause** predicate, and all three conditions must hold:

1. `preservationContext` names the preserved behavior for a plan task;
2. the engine-derived removal evidence shows this diff deleted or moved the carrier that asserted
   that behavior at merge base; and
3. **no equivalent assertion of that behavior survives anywhere in the post-diff tree.**

A finding fires only when condition 3 holds. Conditions 1 and 2 alone never exempt: relocation is not
a defence, the absence of a surviving equivalent is the defect. Evaluate the predicate **per
preserved-behavior clause, never per diff** — a diff that relocates one behavior's coverage and drops
another's still FAILs on the second.

The judgement in condition 3 is deliberately an LLM judgement, per `CLAUDE.md`'s design principle:
"is this the same coverage?" is judgement-shaped, and the mechanical alternative (Option C) cannot
recognize equivalence across renames, parameterization, or file splits. The bookkeeping around it —
which clauses exist, which carriers moved, which projection the judgement reads — stays mechanical.

### D4 — The governing doctrine changes, narrowly and explicitly

`skills/build-review-completeness/SKILL.md`'s current statement that `removalContext` is "never an
exemption" is revised: it anchors exactly the one exception defined in D3, and nothing else. It
remains never an exemption for any other Completeness concern. This is the only sentence of the
governing rubric contract this decision alters.

### D5 — Holistic judgement is otherwise untouched

Nothing here licenses per-task reasoning about commits. The rubric continues to read plan and diff as
a whole, and remains forbidden from chasing per-task SHAs, verifying per-task commit reachability, or
seeking trailer corroboration. The predicate in D3 consumes plan text, diff content, and engine
removal evidence only.

## Consequences

### Positive
- The incident family stops arising: a plan that names a behavior, whose coverage is reorganized with
  equivalent assertions retained, produces no finding.
- The Tautology/Completeness contradiction on relocated tests is resolved — one diff, one verdict.
- Plans gain a sanctioned way to express "do not regress this" that does not decay into a list of
  case names the next refactor invalidates.
- Findings that would have routed to a needs-human DECIDE halt (the `finish-publication` class) are
  not generated in the first place, which is strictly better than dispositioning them each lap.

### Negative
- The rubric with sole completeness authority now carries an exemption surface it did not have. A
  mis-scoped condition 3 silently stops Completeness from failing genuinely incomplete work — the
  worst failure mode available to this gate. The negative-path story and its acceptance coverage are
  therefore load-bearing, not ceremonial.
- Equivalence is an LLM judgement and will sometimes be wrong in both directions. Rubric dispositions
  (`adr-2026-08-13`) remain the operator's per-finding valve when it errs toward false positives;
  there is no equivalent valve for a false negative, which is why condition 3 is written as "no
  equivalent survives **anywhere**" rather than a locality-scoped check.

  **No downstream gate nets a false negative here, and the obvious candidates do not.** The failure
  mode is a *lost assertion*, not broken behavior: nothing in the diff changed what the code does,
  so the behavior still works and only the test protecting it is gone. The `test-suite` gate passes
  green on a suite with a deleted test; `/manual-test` exercises behavior that is intact;
  `/prd-audit` checks FRs delivered rather than coverage retained (and on a technical track there is
  no PRD at all); and the as-built `/architecture-review` §12 sweep hunts unreachable primitives, of
  which a missing assertion is not one. Every one of them validates *current* behavior, and current
  behavior is exactly what a false negative leaves intact. The regression surfaces months later,
  when someone breaks the now-unprotected behavior and nothing fails. Condition 3's conservatism is
  therefore load-bearing, not belt-and-braces — it is the only guard this failure mode has.
  Confidence 88%, basis: inferred from each gate's stated mandate in its own SKILL.md; recorded
  because the question "surely a later gate catches this?" will be asked again.
- A second plan header form lands ahead of #1602's general authorization decision, accepting a known
  reconciliation cost.
- `preservationContext` enters the projection and therefore the content-addressed cache identity;
  plans that add a `**Preserves:**` line invalidate cached Completeness verdicts. This is correct —
  the judgement genuinely changed — but it costs a re-judge lap on first adoption.

### Follow-up Actions
- [ ] Author the `**Preserves:**` form and its behavior-level boundary in `skills/plan/SKILL.md`
- [ ] Add `parsePlanTaskPreserves` to `plan-task-parse.ts`, fail-closed on malformed clauses
- [ ] Thread `preservationContext` through `BuildReviewSourceSnapshot` and the v2 Completeness projection
- [ ] Revise `skills/build-review-completeness/SKILL.md`: the D3 predicate and the D4 doctrine change
- [ ] Acceptance coverage for the negative path: a deleted carrier with no surviving equivalent still FAILs
- [ ] Acceptance coverage for the positive path: relocated coverage with equivalent assertions produces no finding
