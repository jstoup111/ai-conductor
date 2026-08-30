# ADR: build_review failures fan in through one remediate case judgement

**Date:** 2026-08-29
**Status:** Superseded by `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
**Approved:** Operator-approved 2026-08-29; mechanical-exhaustion composition amendment
operator-approved 2026-08-29
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#2033
**Amends:** `adr-2026-08-13-engine-managed-build-review-rubric-branches` decision 5 (the raw
aggregate remains mechanical, but a failed content join now has a typed post-join judgement before
outer routing); `adr-2026-07-13-kickback-build-no-op-escalation` decision 2 (semantic case repetition
is now a stronger unchanged-verdict signal and halts even when BUILD moved the tree)
**Conforms to:** `adr-2026-08-12-cumulative-build-review-convergence-bound`,
`adr-2026-08-13-stable-build-review-finding-dispositions`,
`adr-2026-08-16-closed-build-review-finding-vocabularies`,
`adr-2026-08-18-content-anchored-finding-reference-schema`,
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-22-one-owner-per-review-question`

## Context

Issue #2033. Rubric branches are correctly independent, but their outputs currently meet only in a
mechanical aggregate. A raw FAIL then routes directly to BUILD with every unresolved reason. As the
registry grows, independently correct rubrics can describe the same defect differently, recommend
competing changes, or rediscover a case a prior BUILD lap already attempted. Mechanical finding ids
preserve exact identity; they deliberately do not answer the semantic questions “are these the same
case?”, “which repair wins?”, or “did the prior repair resolve it?”.

Those are judgement questions. Replacing them with string matching would reproduce the cycling class
this design is meant to remove. Conversely, asking every rubric to coordinate would destroy the
write-disjoint fan-out, let one rubric influence another’s judgement, and entangle registry growth.

The repository already has the right judge: `remediate`. It is one fresh provider dispatch that
classifies blocking evidence and emits a schema-constrained plan; the engine validates and performs
the effects. The missing piece is a post-join case contract and durable history, not a second
adjudicator skill.

The adjacent issue boundaries are intentional:

- #2033 owns build_review synthesis and the reusable case contract.
- #2060 owns the SHIP validation group’s post-remediate budget/append/terminal split. It should reuse
  this contract without dispatching a second judge.
- #2020 owns rubric-catalog expansion and which rubrics may block. This ADR does not add or enable a
  rubric.

## Options considered

### Option A — Put all rubrics in one judging prompt

One provider session would see the whole review and could avoid duplicate findings at source.

- **Pros:** one artifact and one judgement.
- **Cons:** loses independent failure isolation, capped fan-out, per-rubric evidence/cache identity,
  and registry ownership. One malformed concern can erase every sibling outcome.

### Option B — Keep independent rubrics; share one case contract and the existing remediate judge

The engine joins raw outcomes mechanically, applies operator dispositions, and dispatches the
existing `remediate` capability once over all remaining content findings plus prior cases. The shared
contract is reusable; build_review owns its routing and budget effects.

- **Pros:** preserves fan-out, gives semantic equivalence to a judgement boundary, centralizes
  bookkeeping and retry safety in machinery, and creates the seam #2060 can reuse.
- **Cons:** adds durable state and one provider dispatch on a failed content lap; requires careful
  crash recovery across case state, kickback state, and external issue creation.

### Option C — Mechanically cluster findings, then remediate each cluster

- **Pros:** less context per judgement and easy parallelism.
- **Cons:** the cluster key is the hard semantic question disguised as machinery; false splits retain
  contradictions, false merges suppress independent findings, and multiple remediate sessions can
  still disagree.

## Decision

Adopt **Option B**.

### D1 — Preserve independent rubric judgement and the mechanical raw join

Every enabled rubric continues to run from the same frozen snapshot in its own fresh session and
write its own branch artifact. Rubrics receive neither sibling findings nor case history. The group
waits for every member and validates every branch before producing the raw aggregate.

The raw aggregate remains source evidence. It preserves every rubric result and stable finding
identity; it does not merge, prioritize, reject, defer, file intake, or spend a kickback.

Per `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`, any infrastructure-failure member
with mechanical allowance remaining keeps the lap on the non-publishing mechanical lane. Valid
sibling artifacts remain inspectable, but no semantic adjudication or external effect runs.

When the mechanical allowance is exhausted, the existing design publishes the aggregate so an
operator can record reduced coverage. The infrastructure branch remains prior authority: until every
exhausted infrastructure result has an exact current reduced-coverage disposition, no content
adjudication or external effect runs. Once those branches are covered, remaining content findings
may enter D3. Autonomous case judgement can never grant reduced coverage.

### D2 — Operator dispositions retain separate and prior authority

The existing exact, content-anchored operator accepted-risk reducer runs before autonomous
adjudication. Findings it resolves never enter `remediate`.

Autonomous case outcomes are stored separately and never become operator dispositions. A provider
cannot write, broaden, or infer accepted risk. An operator disposition that becomes effective while
the post-join path is running is re-read at every route, halt, and PASS exit, preserving the current
late-acceptance rule.

### D3 — One existing remediate dispatch owns the semantic fan-in

A mechanically complete raw FAIL with at least one operator-unresolved content finding causes one
fresh `remediate` dispatch. No new step, skill, provider member, or second adjudicator is introduced.

The input is a closed projection:

1. every current unresolved finding with rubric id, stable finding id, anchor, bounded summary, and
   evidence locations;
2. every feature-local prior remediation case, including its outcome, source links, effect status,
   and resolution evidence;
3. the active plan contract and task-status/effect pointers needed to decide whether a repair is
   admitted or already attempted.

Prior cases are represented by bounded fields and the assembled input has an engine-enforced byte
ceiling. The engine includes all feature-local cases or halts `needs-human` on overflow; it never
silently truncates older cases and thereby recreates cycling. `remediate` reasons over supplied
evidence and does not re-audit the source tree.

### D4 — The shared output is source-complete and case-oriented

The additive remediation artifact mode contains two linked collections:

- **source outcomes:** exactly one row for every current unresolved finding, with outcome
  `acted | deferred | rejected | merged`; a `merged` row names the canonical case row; and
- **case judgements:** one row per canonical case, optionally binding an existing engine-stamped case
  id, with disposition `act | defer | reject`, priority, rationale, confidence, and the effect data
  required by that disposition.

An `act` case names route `build` and carries concrete, ordered, file-scoped work. That work is a
retry work order; it is not appended to the approved plan. A `defer` case carries the proposed
intake title/body and must explain why no current plan task admits the work. A `reject` case explains
why the raw finding is non-actionable under the governing rubric/plan contract. `merged` is a source
trace outcome, not a case disposition.

Provider output may reference current finding ids and existing case ids. It may not mint durable
case or effect ids; the engine stamps those only after full validation.

The validator rejects the whole adjudication when a current finding is missing or duplicated, a
reference is unknown, two rows give one case contradictory dispositions/routes, an action has no
dispatchable work, a deferral has no out-of-scope justification, or any field exceeds its bound.
Invalid, missing, stale, or contradictory output fails closed and can never publish PASS or consume
the semantic kickback budget.

### D5 — Durable case state is shared machinery with domain-owned effects

A versioned, feature-scoped `.pipeline/remediation-cases.json` store records engine-stamped cases,
all raw-source links, current disposition, resolution status, and effect state. It is read/validated
fail-closed, leased for mutation, and written by atomic replace. It is distinct from
`.pipeline/build-review-dispositions.json`, whose operator-only authority is unchanged.

The shared schema includes a domain discriminator. This feature implements only the `build_review`
adapter. Future SHIP validation-group work may use the same case/reconciliation primitives, but its
budget, plan-growth, and terminal effects remain owned by #2060.

Cases are not matched mechanically by summaries. `remediate` may bind a current finding to an
existing case; the engine validates the reference and appends the current raw source trace. When the
current lap no longer reports an open case, the engine marks it resolved using current-lap absence
plus mechanically available action evidence. It never deletes history.

### D6 — Effects use a reserved, idempotent outbox

After complete validation, the engine reserves stable effect ids in the case store before performing
an effect. Effect states are `reserved | applied | failed`, with bounded diagnostic evidence.

- **Act:** publish one durable, prioritized BUILD work order containing every new `act` case. BUILD
  context reads the work order by effect id, so restart does not depend on an in-memory retry hint.
- **Defer:** search the configured intake repository for an exact hidden effect marker. Reuse a
  matching open or closed issue; otherwise file through the existing intake adapter with the marker,
  sanitized Observed/Impact/Desired Outcomes/Hypotheses content, and existing label/dependency rules.
- **Reject/merge:** finalize the case and trace links without an external write.

A crash after reservation resumes the same effect. A crash after remote issue creation discovers the
marker before attempting another create. An unavailable intake service leaves the effect pending or
failed and blocks PASS; it never converts a deferral into a silent drop.

### D7 — Only a new actionable work order consumes the existing kickback

Budget granularity remains a **route/lap**, not one counter increment per finding. If an adjudication
contains one or more new `act` cases, their prioritized work is consolidated into one BUILD work
order and `consumeKickbackBudget('build_review', ...)` runs once for that stable effect id. Every
actual first-time BUILD kickback therefore still increments `count` and `cumulative` exactly as
`adr-2026-08-12` requires. Deferred, rejected, and merged-only adjudications consume no kickback.

The kickback ledger records charged build-review effect ids idempotently. A crash-interrupted
reserved/charged effect may resume the same BUILD route without a second increment.

An equivalent case that BUILD already attempted and the next complete lap still reports is semantic
no-progress. It does **not** consume another kickback and does **not** receive a free BUILD route; it
halts `needs-human` with the current finding, prior case, work order, and attempt evidence. This
strengthens the existing no-op escalation for the judgement case: tree movement cannot disguise an
unresolved equivalent finding. A previously deferred or rejected case reuses that outcome after the
current adjudication confirms the binding. A resolved case that reappears also halts as a regression
of an adjudicated case rather than reopening an unbounded route.

### D8 — The effective verdict is derived only after required effects settle

The effective result is:

- `PASS` when all raw content findings are operator-resolved or map to finalized deferred, rejected,
  or merged outcomes and every required intake effect is applied;
- one BUILD kickback when at least one newly actionable case has an applied durable work order and
  the existing kickback bounds permit it; or
- fail-closed retry/HALT for a below-allowance infrastructure failure, an exhausted infrastructure
  result without exact operator reduced coverage, adjudication failure, effect failure, cap
  exhaustion, or a repeated attempted/regressed case.

The raw aggregate remains unchanged and inspectable. Every raw finding can be followed to its
operator disposition or autonomous source outcome, canonical case, effect, and terminal gate route.

### D9 — Occurrences extend the event spine; state stays state

Adjudication start/completion/failure, case reconciliation, effect reservation/application/failure,
and semantic-repeat halt are additive `ConductorEvent` occurrences, registered explicitly with every
sink. `.pipeline/remediation-cases.json` and the charged-effect set in the kickback ledger are durable
control state under event-spine exception C. No second event file, timestamp protocol, or polling
channel is added.

### D10 — Rollout is gated and default-on after compatibility validation

An optional `build_review.adjudication.enabled` setting defaults on. Disabling it restores the current
raw-FAIL direct BUILD route and does not read or write case state. The old remediation artifact shape
continues to parse for every existing SHIP/stall caller; the new case mode is additive and is selected
only by an engine-stamped build_review dispatch context.

Removal of the switch is follow-up work after production evidence shows successful convergence and
no duplicate intake effects. The switch does not relax fail-closed parsing while enabled.

## Consequences

### Positive

- Rubric fan-out remains independent while all current findings receive one coherent priority and
  route.
- Semantic equivalence is judged where judgement is required; bookkeeping, completeness, effects,
  idempotency, and bounds remain mechanical.
- Prior acted/deferred/rejected/merged outcomes are visible on every later lap, eliminating silent
  re-litigation and double charging.
- #2060 gains a shared case contract without gaining another adjudicator.

### Negative

- A failed content lap costs one additional provider dispatch.
- The case/outbox store and charged-effect idempotency add cross-file recovery states that need
  adversarial restart coverage.
- A false semantic merge or rejection can suppress a raw finding from the effective blocking set.
  The raw evidence remains visible, the judgement is schema-constrained, and operator acceptance is
  not implicated, but this remains the central model-risk trade-off.
- Repeated actionable cases halt earlier than the cumulative cap even after real tree movement. This
  is intentional: the semantic judge established that the same repair case persisted.

## Rejected shortcuts

- **Use stable finding ids as semantic case ids.** They are exact, content-anchored identities and
  intentionally change when the substantive locus changes; they cannot merge sibling rubrics or
  judge resolution.
- **Let prior state mechanically suppress a matching summary.** Free text is not identity and would
  silently inherit old mistakes.
- **Append build_review actions to the plan.** Violates the one-appender authority: only validated
  prd_audit/as-built evidence may grow the plan.
- **Give every rubric prior history.** Couples independent judges and multiplies context/cycling
  behavior instead of resolving it once.
- **Allow repeated acted cases to route without charge.** Creates an unbounded free loop and defeats
  the cumulative convergence ADR.

## Known limitations and follow-ups

- The byte ceiling is a safety bound, not a forgetting policy; overflow requires a human until a
  separately designed compaction format exists.
- Cross-feature equivalence is intentionally out of scope. Cases are feature-local.
- #2060 must decide how the SHIP validation group maps this shared case contract onto its one shared
  allowance and append transaction.
- #2020 must decide catalog membership and blocking authority before new rubrics rely on this seam.
