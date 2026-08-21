# PRD: Recoverable build review when the blocker is mechanical, not judgement

**Status:** Approved
**Date:** 2026-08-18
**Tier:** M
**Source:** Intake issue jstoup111/ai-conductor#1629 — two features reached unrecoverable
terminal states on 2026-08-16, both from infrastructure faults rather than review judgement.

## Problem / Background

The `build_review` gate grades a finished build against four rubrics. Each rubric lap
produces one of three outcomes: it was **judged** (a real opinion about the diff), it was
**skipped**, or it hit an **infrastructure failure** — the rubric could not be evaluated at
all because something mechanical went wrong (a stale checkout missing the rubric skill, a
preflight that cannot read a file at the merge base, a provider that returned nothing usable).

An infrastructure failure is not a statement about the code. Today the system treats it as if
it were, in two separate ways, and both have already halted real work:

1. **A review whose only blocker is mechanical cannot be resolved by any operator action.**
   When a rubric fails mechanically on every lap, the review's effective verdict stays FAIL
   even after the operator has accepted every graded finding. The operator-facing report then
   says the verdict is FAIL and the unresolved-findings list is empty — a state that names no
   remaining work and offers no action that would clear it. On 2026-08-16 the only way out was
   to rewrite the feature's document history so the offending change left the diff, amend the
   plan, and re-seal — hours of manual surgery to work around a fault that had nothing to do
   with the code under review.

2. **Mechanical faults spend the budget that exists to bound argument.** The gate carries a
   cumulative allowance for how many times a build may be sent back for rework before a human
   must intervene. That allowance exists to stop *semantic* churn — a reviewer and a builder
   disagreeing in circles. Infrastructure failures consume it at the same rate as genuine
   disagreements. On 2026-08-16 a stale worktree produced six consecutive dispatch failures
   that each took milliseconds and cost nothing, exhausting the allowance and halting the
   feature without a single graded lap having occurred.

In both cases the documented recovery is "hand-edit the durable state files and clear the halt
markers" — an operator-only procedure that is not a supported action, leaves no record of what
was decided or why, and is impossible to audit after the fact.

The consequence is that a mechanical fault converts an otherwise-green build into a
needs-human terminal state. Two features in one day; one of them unresolvable by every control
the system offers. This directly blocks unattended completion, which the release-cut cadence
depends on.

## Goals

- An operator can resolve a review whose only remaining blocker is a persistent mechanical
  fault, through a first-class recorded decision rather than by editing durable state by hand
  or rewriting history.
- The reduced review coverage that decision accepts is visible on the review's own evidence
  and on the record of what shipped, so a reader can later see exactly which rubric did not
  run and on whose authority.
- A mechanical fault never spends the allowance that bounds semantic rework.
- Mechanical faults are still bounded — they retry, and then they stop and ask, rather than
  retrying forever.

## Non-Goals

- Changing how genuine review findings are judged, accepted, or reported.
- Any weakening of the gate for semantic disagreement. A rubric that ran and found a real
  problem blocks exactly as it does today.
- Letting the autonomous build loop decide on its own that reduced coverage is acceptable.
  That judgement stays with a human, always.
- Fixing the individual upstream faults that produce infrastructure failures (a stale
  worktree, an unreadable merge-base file). Those are tracked separately; this feature is
  about how the system behaves when one of them happens.

## Users / Personas

- **The operator** — the human running or supervising builds. Needs a way to say "this rubric
  cannot run here, proceed without it, and record that I said so," and needs to be able to see
  afterwards that they said it.
- **The autonomous build loop** — runs unattended. Needs mechanical faults to not burn its
  semantic budget, and needs to stop cleanly and surface the decision to a human rather than
  guessing.
- **A later reader of the shipped record** — reviewing what merged and under what evidence.
  Needs reduced coverage to be conspicuous, not silent.

## Functional Requirements

- **FR-1** A rubric outcome that is a mechanical fault is distinguished from a rubric outcome
  that is a judgement about the diff, at every point where the system decides what to do next.

- **FR-2** When a rubric lap ends in a mechanical fault, the review is re-attempted without
  spending any of the allowance that bounds semantic rework. The remaining semantic allowance
  after such a lap is identical to what it was before.

- **FR-3** Re-attempts after a mechanical fault are bounded by their own separate allowance. On
  exhausting it the feature stops and requires a human decision; it never retries indefinitely
  and never silently proceeds.

- **FR-4** When the mechanical-fault allowance is exhausted, the operator is presented with the
  specific rubric that could not run and the reason it could not run, in the same report they
  already use to inspect review findings.

- **FR-5** An operator can record a decision to accept the reduced coverage for a named
  exhausted rubric on the current review, supplying a rationale. The decision is durable and
  survives across dispatches.

- **FR-6** Recording that decision requires an interactive session and a verified local human
  operator identity — the same authority already required to accept a review finding. A
  non-interactive caller, an automated process, or the build loop itself is refused, and the
  refusal is observable.

- **FR-7** A decision that accepts reduced coverage names the rubric it covers and the closed
  reason it covers, and covers that `{rubric, closed reason}` pair for the feature — independently
  of which review it was recorded against. A different rubric failing mechanically, or the same
  rubric failing for a different closed reason, still blocks.

  > **Amended 2026-08-21 by operator decision.** The original text required identity bound to the
  > review the decision was recorded against ("covers only that rubric on the review it was
  > recorded against … the same rubric failing on a materially different review still blocks").
  > That contradicted `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D7, which is
  > APPROVED and operator-confirmed, scopes identity to `{rubric, closed reason}` feature-wide, and
  > explicitly lists and rejects "identity including the lap or snapshot digest" under Alternatives
  > because a review-pinned identity re-creates the very livelock this document's Incident 1
  > describes. The ADR is authoritative; this requirement is restated to match it and the
  > implementation at `src/conductor/src/engine/build-review-dispositions.ts`. Story 7's negative
  > paths already enumerate only cross-rubric, cross-class and cross-feature isolation — the
  > "materially different review" clause was dropped at decomposition and never carried into any
  > story, task, or test.

- **FR-8** Once reduced coverage is accepted for every mechanically-failed rubric and every
  graded finding is resolved or accepted, the review's effective verdict is PASS and the build
  proceeds.

- **FR-9** A rubric that ran and produced an unresolved finding continues to block the review
  regardless of any reduced-coverage decision. Reduced-coverage decisions cannot resolve
  findings, and finding acceptances cannot resolve reduced coverage.

- **FR-10** A review that passed with reduced coverage records which rubrics did not run, why,
  who accepted that, and their rationale, on the review's own evidence.

- **FR-11** The same reduced-coverage record appears on the record of what shipped, so reduced
  coverage is discoverable without inspecting per-lap review state.

- **FR-12** A review that passed with full coverage carries no reduced-coverage record and is
  reported exactly as it is today.

- **FR-13** An attempt to accept reduced coverage for a rubric that is not currently in an
  exhausted mechanical-fault state — because it ran, was skipped, or has retries remaining —
  is refused with a reason, and changes nothing.

- **FR-14** Accepting reduced coverage twice for the same rubric on the same review is refused
  as already recorded, and changes nothing.

- **FR-15** Existing recorded state written before this change continues to be read
  successfully, and reviews with no mechanical faults behave identically to today.

## Non-Functional Requirements

- **NFR-1 Fail-closed.** Any ambiguity about whether coverage was legitimately accepted
  resolves to blocking. Unreadable or malformed durable state never grants reduced coverage.
- **NFR-2 Auditability.** Every reduced-coverage decision and every refusal to record one is
  observable through the existing telemetry the system already emits for review decisions —
  not through a new side channel.
- **NFR-3 No unattended weakening.** There is no configuration, environment variable, or flag
  by which the autonomous loop acquires the authority to accept reduced coverage.
- **NFR-4 Bounded cost.** A mechanical fault that recurs must not be able to consume unbounded
  provider spend before reaching its terminal state.

## Acceptance Criteria / Success Metrics

- Replaying the 2026-08-16 livelock — every graded finding accepted, one rubric failing
  mechanically every lap — reaches PASS after one recorded operator decision, with no manual
  edit of durable state and no history rewrite.
- Replaying the 2026-08-16 budget burn — repeated zero-cost dispatch failures — leaves the
  semantic allowance untouched and terminates on the mechanical allowance instead, naming the
  mechanical cause.
- A build whose rubric ran and produced an unresolved finding still blocks, and no
  reduced-coverage decision can clear it.
- The shipped record for a reduced-coverage build names the rubric, the reason, the operator,
  and the rationale.
- Zero paths exist by which a non-interactive caller records a reduced-coverage decision.

## Scope

**In scope**
- How the system classifies and routes a mechanical rubric fault.
- The allowance accounting that separates mechanical faults from semantic rework.
- The operator decision that accepts reduced coverage, and its authority requirements.
- How reduced coverage is surfaced on review evidence, on the shipped record, and in the
  operator's findings report.
- Operator documentation for the new recovery path, including the runbook the halted-feature
  procedure points at.

**Out of scope**
- Repairing the upstream causes of infrastructure failures.
- Any change to rubric content, prompts, or how findings are graded.
- Any change to how findings are accepted.
- Retroactively re-deciding reviews that already halted before this ships.

## Key Decisions & Rationale

- **The decision is a human's, always.** Accepting that a quality check did not run is a risk
  judgement about shipping. The build loop has no basis for making it, and an automatic
  acceptance would turn a recurring mechanical fault into a silent, permanent coverage gap.
  Operator-only and interactive, matching the authority already required to accept a finding.
- **Retry before asking.** Most mechanical faults are transient. Asking a human on the first
  occurrence would make the new decision routine, and a routine risk acceptance stops being a
  risk judgement. Bounded retry first; the human is asked only once the fault has proven
  persistent.
- **Reduced coverage is loud, not silent.** The point of the decision is that someone chose to
  ship with less review than usual. That must be visible on the shipped record, not only in
  per-lap state that is discarded.
- **Separate allowances, because they bound different things.** The semantic allowance bounds
  argument between reviewer and builder. The mechanical allowance bounds a broken environment.
  Conflating them means a broken environment can exhaust the argument budget, which is exactly
  the reported defect.
- **One operator concept, not two.** The operator already has a way to say "I have considered
  this review outcome and accept it." Reduced coverage is the same act applied to a different
  kind of outcome. Presenting it as a second, separate concept would double what an operator
  must learn for no gain in expressiveness.

  > **Amended 2026-08-18 by #1629:** the decision is now a **distinct** recorded act, not the same
  > one applied to a different outcome. `adr-2026-08-13-stable-build-review-finding-dispositions`
  > (APPROVED) decided that infrastructure failures remain blocking and that finding-acceptance
  > refuses them, under a narrowness rule — "One action accepts exactly one finding". Architecture
  > review surfaced the conflict and the operator directed a separate decision kind sharing the
  > existing durable store and authority gate, rather than amending that approved rule. The
  > underlying goal is unchanged: one store, one authority standard, one audit trail. Only the
  > claim that a single operator action should cover both outcomes is withdrawn.

## Dependencies

- The existing operator finding-acceptance capability and its authority gate (interactive
  terminal plus verified local operator identity) — this feature reuses that authority
  standard rather than defining a new one.
- The existing durable per-feature accepted-risk record, the existing review evidence, and the
  existing telemetry spine that carries review decisions. This feature must extend those; per
  the repository's standing rule it must not introduce a parallel channel.
- The existing shipped-record artifact, which must carry the reduced-coverage record.

## Open Questions

Each is a trade-off for `/architecture-review` to weigh and capture as an ADR — none is decided
here.

- **OQ-1** How a mechanical fault should be identified durably enough for a decision recorded
  on one lap to still be recognised on the next, given that the review's inputs change between
  laps. Too strict an identity and the decision evaporates on every re-run; too loose and it
  suppresses a different fault later. This is the central design question.
- **OQ-2** Whether a re-attempt after a mechanical fault should publish a review outcome at all,
  or produce no outcome so the existing "no verdict yet" path re-runs it. The repository already
  contains a narrow precedent for the latter; whether generalising it is safer than adding new
  accounting is a genuine trade-off.
- **OQ-3** What the right bound is for mechanical re-attempts, and whether it should be per
  rubric or per review.
- **OQ-4** Whether reaching the mechanical bound should halt or park the feature, given that
  parking and halting have different operator ergonomics and different re-dispatch behavior.
- **OQ-5** Whether a reduced-coverage decision should expire — for instance if the diff changes
  substantially after it was recorded — and if so, on what signal.
