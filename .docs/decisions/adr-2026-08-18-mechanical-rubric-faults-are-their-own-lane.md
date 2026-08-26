# ADR: A mechanical rubric fault is its own lane — non-charging retry, then an operator reduced-coverage decision

**Date:** 2026-08-18
**Status:** APPROVED
**Approved:** Operator-approved 2026-08-18
**Deciders:** Engineer (DECIDE phase, jstoup111/ai-conductor#1629), operator-confirmed — including an
explicit operator direction, after reading both texts, that the new decision be a **distinct record
kind rather than an amendment** to `adr-2026-08-13`'s refusal list.

**Conforms to:** `adr-2026-08-13-stable-build-review-finding-dispositions` (decisions 2, 3, 4, 5, 6 —
this ADR adds a record kind to that store and does **not** relax its finding-acceptance rules),
`adr-2026-08-16-closed-build-review-finding-vocabularies` (D1's rule that no identity input is free
text; D3's `absent` reclassification), `adr-2026-08-17-build-review-rubric-repetition-short-circuit`
(D3 explicitly reserves the mechanical-fault lane to this issue).

**Reuses:** `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` (a non-charging
re-entry must carry its own allowance), `adr-2026-07-13-retry-classify-rerun-vs-route` (the
rerun-vs-route classification and its `absent` mapping), `adr-2026-07-01-machine-scoped-operator-identity`
and `adr-2026-08-09-operator-only-scoped-artifact-reseal` (the operator-only authority standard),
`adr-2026-07-28-total-halt-classification-legacy-boundary` (halt classification),
`adr-2026-08-08-finish-human-required-halt-rendering` (halt body rendering).

**Supersedes:** nothing.

**Does not change:** any rubric's PASS/FAIL judgement; finding identity or the finding-acceptance
rules of `adr-2026-08-13` §2/§4 (an infrastructure failure remains un-acceptable *as a finding*, and
`accept` keeps refusing it); `MAX_KICKBACKS_PER_GATE`; `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`'s value
or its cap value; `adr-2026-08-17`'s `rubricFailures` tally, whose D3 already excludes mechanical
faults; the `skipped` branch's existing non-blocking treatment.

## Context

Issue #1629. On 2026-08-16 two features reached terminal states from mechanical faults rather than
review judgement.

**Incident 1 — a verdict no operator act can clear.** A rename in the diff made the tautology
preflight fail on every lap. With every graded finding operator-accepted, `findings` reported
`Effective verdict: FAIL / Unresolved findings: none` — a state naming no remaining work and offering
no action that resolves it. Recovery took a docs-history rewrite, a plan amendment and a reseal.

**Incident 2 — the semantic cap spent by $0 faults.** A stale worktree missing the rubric skills
produced `Unknown command: /build-review-tautology` dispatch failures (0 turns, ~20ms, $0.00 each).
Each incremented the same cumulative counter as a semantic FAIL; the feature halted at
`cumulative 6, cap 5` without one graded lap.

### What the code actually does (verified 2026-08-18, at this branch's merge base)

Confidence **95%, basis: verified** — each claim below was read in source.

- `deriveEffectiveBuildReviewVerdict` (`build-review-aggregate.ts:243`) returns PASS only when
  `judgedCount > 0 && unresolved.length === 0 && infrastructure.length === 0`. **`skipped` does not
  block.** The docstring at `:206` ("skips/infrastructure failures remain blocking") overstates the
  blocking set; only the infrastructure branch blocks. Reduced coverage is therefore already
  representable in this reducer — what is missing is an authorized way to reach it.
- The cumulative counter is bumped at `conductor.ts:7709` (`consumeKickbackBudget('build_review', …)`)
  on **any** published raw FAIL. `bumpKickbackGate` (`kickback-ledger.ts:170`) is cause-blind: it sees
  a reason string, never a result kind.
- A narrow no-publish path already exists. `step-runners.ts:1828-1852` returns a step failure without
  publishing an aggregate for exactly one fault — `invalid-provider-result` whose `detail` starts
  `judged-result contract not satisfied after one repair turn:` — with the comment: "completion
  deliberately classifies a missing verdict as `absent`, which re-dispatches this rubric without
  consuming the build_review kickback budget." Incident 2's fault escaped it only because its
  `detail` did not match that prefix.
- `BuildReviewInfrastructureFailureReason` (`build-review-domain.ts:19-28`) is **already a closed
  eight-member vocabulary**: `provider-error`, `retry-exhausted`, `missing-artifact`,
  `malformed-artifact`, `stale-artifact`, `identity-mismatch`, `preflight-failed`,
  `artifact-read-failed`. `detail` is free text.
- **The closed vocabulary is being thrown away at the boundary.** The coordinator's branch type
  (`build-review-coordinator.ts:74-79`) carries `reason: string`, and `step-runners.ts:1863-1869`
  folds every non-cache branch into `reason: 'provider-error'` with the real cause pushed into free
  text: `detail: \`${branch.reason}: ${branch.detail}\``. The tautology preflight's own closed
  13-member reason set (`build-review-tautology-preflight.ts:118`), including
  `missing-merge-base-file` from incident 1, never reaches the result. `preflight-failed` is a
  declared member that nothing currently produces.
- `.pipeline/build-review-dispositions.json` is feature-scoped, leased, atomically written, and
  deliberately survives removal of `.pipeline/build-review.json` (`adr-2026-08-13` §2, §3).

## Decision

### D1 — A mechanical fault is classified apart at every routing seam

Mechanical faults route on **result kind**, never on reason text. The classification input is
`BuildReviewRubricResult.kind === 'infrastructure-failure'`, which the strict aggregate parser
already guarantees. No routing decision in this ADR reads `detail`, and no `detail` prefix match
survives: the narrow `startsWith('judged-result contract not satisfied…')` test at
`step-runners.ts:1830` is replaced by the kind check, which is what it was approximating.

### D2 — Preserve the closed cause across the boundary

The branch→result mapping stops collapsing distinct classes into `provider-error`. Each coordinator
branch reason maps to the closed result member that names its class — preflight faults to
`preflight-failed`, artifact write/read faults to their existing artifact members — and the specific
sub-reason continues to travel in `detail` for the human report only. This is a prerequisite for D4:
an identity keyed on a reason that is always `provider-error` would not discriminate at all.

The mapping is total and closed at the type level; an unmapped branch reason is a contract defect
caught at authoring time, never silently coerced.

### D3 — A mechanical fault does not publish an aggregate, and does not charge the semantic budget (OQ-2)

A lap with any mechanical fault and remaining mechanical allowance publishes **no** aggregate. The
step returns failure; completion classifies the verdict `absent`; `build_review` re-runs. This is not
a new mechanism — it is `adr-2026-07-13`'s existing build_review mapping ("Missing / stale / malformed
→ `absent`"), already extended to a contract-violation class by `adr-2026-08-16` D3 step 4 with the
identical rationale: "No kickback budget is consumed and no cap advances on a contract violation."
A mechanical fault is the same category of non-judgement.

Because nothing is published, `consumeKickbackBudget` is never reached on such a lap. `cumulative`,
`count`, and `adr-2026-08-17`'s `rubricFailures` are all untouched by construction rather than by a
new exemption branch — which is why this discharges FR-2 without a second counter inside
`bumpKickbackGate`.

### D4 — The mechanical allowance is its own bounded counter (OQ-3)

Per `adr-2026-08-06`, a non-charging re-entry owes its own termination proof. A **total mechanical
allowance** — a counter of laps that ended in a non-publishing mechanical fault, checked against a
fixed ceiling — discharges it. The counter records the rubric and closed reason last seen so the halt
names where the run stopped.

`MAX_MECHANICAL_FAULT_LAPS_BUILD_REVIEW = 3`. Confidence **70%, basis: inferred** — no measured
corpus of mechanical-fault laps exists, unlike `adr-2026-08-17`'s 11-feature sweep. The derivation is
that both #1629 incidents were **deterministic and environmental**: a rename that stays in the diff
and a worktree that stays stale reproduce on every lap, so a transient-absorbing allowance buys
nothing while each lap costs real provider spend on the other three rubrics. Three admits one
transient plus a confirmation and stops. A per-rubric cap is deliberately **not** part of this
decision, following `adr-2026-08-06`'s holding that "the allowance alone discharges the termination
obligation" and that a second counter is a diagnostic refinement, not a correctness requirement.

The counter is feature-scoped and durable across dispatches — the same lifetime as the ledger it sits
beside — and is **not cleared by a `build_review` PASS**. It is credited back by a rebase that
invalidated the gate, under `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D6, which
states that rule over every lap-counting field on `KickbackGateEntry` and supersedes
`adr-2026-08-12` D2's PASS reset. The property being protected is unchanged — a feature whose
passing verdict is later invalidated must not carry stale mechanical laps toward a halt it did not
earn — but it is keyed on the invalidation that justifies it rather than on the PASS, because a PASS
also fires for every downstream kickback that re-opens `build_review`, which is why the counters it
cleared were unreachable.

Amended 2026-08-18, before implementation, on operator decision recorded in that ADR's D6.

### D5 — Exhaustion is a `needs-human` HALT, not a park (OQ-4)

`needs-human`, chosen not defaulted, for `adr-2026-08-17` D4's reason: `daemon-rekick.ts` clears and
re-dispatches `mechanical` and `unclassified` halts on every sweep, so a guard whose halt the daemon
auto-clears is not a guard — and this halt's whole purpose is to wait for a human judgement.
`adr-2026-07-28` permits only `needs-human` or `mechanical` for a new writer and requires
`needs-human` whenever retry safety is not mechanically provable, which is exactly this case.

Not a park: `adr-2026-08-06-honest-park-termination-boundary` and
`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` together require a terminal state
that names its lever. The halt body renders the rubric, its closed reason, the bounded `detail`, the
allowance consumed, and the action that resolves it, per `adr-2026-08-08`.

### D6 — Reduced coverage is a distinct record kind in the existing store, never a finding acceptance

`adr-2026-08-13` §2 and §4 decided that infrastructure failures remain blocking and that `accept`
refuses them, under a narrowness rule: "One action accepts exactly one finding; there is no
rubric-wide, feature-wide, or future-finding wildcard." **That rule is preserved literally.** `accept`
keeps refusing infrastructure failures. Accepting reduced coverage is a different act on a different
object — a rubric that produced no finding at all — and it gets its own record kind and its own CLI
action in the same store, under the same lease, with the same authority gate (interactive TTY plus
machine-scoped operator identity; a piped provider subprocess cannot pass it).

Sharing the store, not the verb, is what makes this conform: `adr-2026-08-13` §3's single
feature-local transaction, §5's external-writer event path, and §6's publication renderer all
generalize to a second record kind without relaxing any finding rule.

Refusals (each leaving the store unchanged, each observable per §5): non-interactive or unidentified
operator; a rubric that is not currently in an **exhausted** mechanical-fault state — it judged, it
was skipped, or allowance remains; a stale review; and a duplicate decision for the same rubric.

**The action's callable interface (amended 2026-08-19, before implementation, on operator decision).**
The action is named and invoked exactly as:

```bash
conduct-ts build-review record-reduced-coverage --feature <slug> --lap <lap> --rubric <rubric> --rationale <text>
```

`record-reduced-coverage`, not `accept-reduced-coverage`: this decision's own rule is that the store
is shared and the verb is not, so the action does not lead with `accept` and cannot read as a variant
of finding acceptance.

Argument shape follows its sibling `build-review accept --feature <slug> --lap <lap> --finding <id>
--rationale <text>`, with `--rubric` replacing `--finding` as the selector. `--lap` is required and
carries the same exact-current-lap semantics `accept` applies — it is what makes this decision's
**stale review** refusal above reachable, and without it this would be the only state-changing
`build-review` action with no freshness pin. The closed reason is **not** an argument: D7 derives it
from engine-supplied state, so the operator names only the rubric.

This paragraph exists because `writing-system-tests` HALTed on 2026-08-19 rather than invent a
public CLI contract for the Story 10 acceptance spec — the story, plan, and this ADR all required a
distinct operator action but none named it. The grammar above is that stable callable interface;
Task 14 implements it and `docs/reference/cli.md` documents it.

### D7 — Identity is `{rubric, closed reason}` — the coarsest key that cannot evaporate (OQ-1)

The decision's identity is derived from the rubric enum and the closed result reason, both engine-
supplied. Nothing free-text enters it, satisfying `adr-2026-08-16` D1's rule that every identity
input is a closed vocabulary member or an engine-verified reference. `detail`, excerpts and timestamps
are report-only, exactly as `summary` and `evidenceLocations` are for findings.

**Why not narrower.** Including the preflight sub-reason, the lap, or the snapshot digest would make
the decision evaporate as the fault's incidental particulars shift between laps — which is precisely
the failure `adr-2026-08-16` was written to fix for findings ("an operator-accepted finding stops
binding as soon as the next lap's grader re-words it"), and precisely the livelock incident 1
suffered. A decision that must be re-made every lap is not a resolution.

**The accepted cost, stated plainly.** A decision covers any later mechanical fault of the same class
on the same rubric within the feature. It cannot cover a different rubric (D6), cannot cover a
different reason class (which is what D2 exists to keep meaningful), and can never suppress a
finding (D8). D2 is therefore load-bearing for this narrowness, not a cosmetic cleanup.

### D8 — A judged finding still blocks, and the two decision kinds cannot substitute

`deriveEffectiveBuildReviewVerdict` gains exactly one relaxation: an infrastructure branch carrying a
matching reduced-coverage decision no longer contributes to the blocking set. `unresolvedFindingIds`
is untouched, so a rubric that ran and found something blocks exactly as today. A reduced-coverage
decision never resolves a finding; a finding acceptance never resolves reduced coverage. The reducer
stays pure, fails closed on unreadable state, and continues to reject a malformed aggregate outright.

> **Amended 2026-08-21 by #1763:** "blocks exactly as today" covers bound and unbound findings. A
> finding the rubric itself marks `boundTo: beyond` (outside every `Done when:` criterion of its
> task) leaves the blocking set per `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D3 —
> a rubric verdict, never an operator decision; reduced coverage still suppresses no finding.

### D9 — Reduced coverage is stamped where a reader will meet it (OQ-5, no expiry)

Every lap that passes with a reduced-coverage decision in force records, on the lap evidence and via
`adr-2026-08-13` §6's existing renderer on the retained PR and the shipped record: rubric, closed
reason, current bounded `detail`, operator, rationale, and decision time. `adr-2026-08-13` §6's
fail-closed rule carries over — a known record that cannot be rendered blocks completion rather than
disappearing.

The decision does **not** expire. It is self-limiting instead: it has effect only while a fault of
that class is actually present, so a healed environment makes it inert without any expiry rule, and
the per-lap re-stamp means a reader always sees the coverage that was actually reduced on the lap
that shipped. An expiry keyed on diff change would re-introduce D7's evaporation failure.

### D10 — Occurrences ride the existing spine

Mechanical-fault laps, allowance exhaustion, and reduced-coverage acceptance/refusal are occurrences
on `ConductorEvent`; the durable counter and the store are state (event-spine exception C). The
standalone CLI writes through `adr-2026-08-13` §5's existing external same-schema writer (exceptions
A/B). No new event file, no new ledger, no sidecar. `build_review_rubric_infrastructure_failure`
already exists and is reused; additive fields follow `adr-2026-07-26-event-sink-registry-exhaustiveness`.

## Alternatives considered

- **Amend `adr-2026-08-13` so `accept` clears an exhausted mechanical fault** (the single-verb form of
  the operator's originally chosen approach). Rejected by operator direction after reading both texts:
  it reopens an operator-approved narrowness rule so one verb can act on two different objects, and
  the ergonomic gain is one command name.
- **A second counter inside `bumpKickbackGate` that mechanical faults increment instead of
  `cumulative`** (the intake's first hypothesis). Rejected: it still publishes a FAIL aggregate, so
  every downstream consumer — remediation routing, the failure-detail renderer, `rubricFailures` —
  must each learn to special-case a non-judgement. D3 removes the FAIL at its source, which is
  strictly less machinery and reuses an approved path.
- **A per-feature rubric waiver read before dispatch, degrading the rubric to `skipped`.** Genuinely
  attractive — `skipped` is already non-blocking, so the reducer would need no change, and no lap
  would be spent on a rubric known to be broken. Rejected as the whole answer because it is
  prospective only: it cannot clear the lap that is already failing, which is incident 1. Its
  pre-dispatch economy is recorded as an available follow-up on top of this decision.
- **Global `build_review.rubrics.<r>.enabled = false`** — today's only non-manual escape hatch.
  Rejected: it is repository-global, unrecorded per feature, invisible on shipped evidence, and
  silently reduces coverage on every subsequent feature until someone remembers to undo it.
- **Auto-accept after N faults, with no human in the loop.** Rejected: a recurring environmental fault
  would become a permanent silent coverage gap, and `adr-2026-08-13`'s threat boundary is precisely
  unattended harness activity.
- **Identity including the lap or snapshot digest.** Rejected — see D7; this is the evaporation
  failure `adr-2026-08-16` already ruled on for findings.

## Consequences

- **Positive.** Both #1629 incidents terminate correctly: incident 2's zero-cost faults stop charging
  the semantic cap and halt on the mechanical allowance naming the mechanical cause; incident 1
  reaches PASS after one recorded decision, with no ledger edit and no history rewrite. `preflight-failed`
  stops being a declared-but-unreachable vocabulary member. Reduced coverage becomes visible on the
  shipped record for the first time.
- **Preserved invariants.** `adr-2026-08-13`'s finding rules, narrowness rule, authority gate and
  refusal list are untouched; `accept` still refuses infrastructure failures. `adr-2026-08-17` D3's
  assumption that mechanical faults do not tick `rubricFailures` is honored by construction.
  `adr-2026-08-12`'s cap value stands; its PASS reset is superseded by `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`. No LLM enters any decision path this ADR adds.
- **Negative / watch.** The allowance of 3 is inferred, not measured (D4) — the first feature to hit a
  genuinely transient fault four times will halt where a larger allowance would have passed; the halt
  names the cause, and the constant is one line to revisit with evidence. A reduced-coverage decision
  is class-scoped, so it can cover a second, different fault of the same class on that rubric later in
  the feature (D7's accepted cost). D2 touches the mapping every branch flows through, so a mapping
  mistake would mis-name a fault class; it is total and closed at the type level to bound that.
- **Known limitation (#497 class), accepted.** `.pipeline/` is gitignored, so deleting
  `.worktrees/<slug>` discards both the allowance counter and the decisions. This fails open — a fresh
  allowance and a re-decidable fault, never a spurious pass — identical to the limitation
  `adr-2026-07-26`, `adr-2026-08-12` and `adr-2026-08-17` each accepted.

## Assumption ledger (verify-claims)

| Assumption | Confidence | Basis | Impact if wrong | Confirmation |
|---|---|---|---|---|
| Only the infrastructure branch blocks the effective verdict; `skipped` does not | 95% | verified — `build-review-aggregate.ts:243` | D8's single relaxation would be insufficient | read at implementation time |
| The `absent` path re-runs build_review without charging any counter | 90% | verified — `step-runners.ts:1828-1834` comment plus `adr-2026-08-16` D3 step 4 | D3 fails; a mechanical fault would spin uncounted | assert in an acceptance test that the ledger is byte-identical across a mechanical lap |
| Every branch reason can be mapped onto the existing eight-member closed result vocabulary without a new member | 75% | inferred — the coordinator's reasons were enumerated, the preflight's 13 were read | D2 needs a vocabulary addition, which is additive and in-scope | enumerate both sets exhaustively during BUILD |
| The mechanical allowance of 3 is right | 70% | inferred — no corpus; derived from both incidents being deterministic | a transient fault halts a healthy feature | revisit against `.daemon/evals-raw` once mechanical-fault laps are recorded |
| `adr-2026-08-17`'s `rubricFailures` is not yet implemented, so this ADR composes with a spec rather than shipped code | 85% | verified — no `rubricFailures` in `kickback-ledger.ts` at this merge base | a conflict at the same ledger entry; both are additive fields | conflict-check, and re-read the ledger at BUILD |
