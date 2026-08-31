# ADR: As-built BLOCKED findings are classified per finding, and remediable ones take a bounded route to BUILD
**Date:** 2026-08-25
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1874
**Supersedes:** adr-2026-08-22-as-built-review-runs-always-with-plan-gap (decision 3 only)
**Amends:** adr-2026-08-22-one-owner-per-review-question, adr-2026-07-13-kickback-build-no-op-escalation
**Amended:** 2026-08-26 by operator (James Stoup) — decision 7 added; the "no new ledger
schema" consequence below is corrected to match it.
**Amended:** 2026-08-26 by operator (James Stoup) — decision 8 added, subordinating this
route to `adr-2026-07-10-validation-group-join` decision 3.
**Amended:** 2026-08-31 by #2119 — decision 9 added: a finding whose remedy existing plan
tasks already own takes a non-appending `existing-task` disposition that never draws on the
plan-growth allowance; decisions 3, 4, and 7 are qualified accordingly.

## Context

On 2026-08-25 four of five as-built BLOCKED halts were resolved purely by writing code an
already-APPROVED artifact required — no design question, no superseded ADR, no operator
judgement — yet each consumed an operator round trip (one feature sat halted 05:48Z→~19:00Z).
The fifth halt genuinely needed a human and produced a new operator-APPROVED ADR. The gate
cannot tell these apart: `Verdict: BLOCKED` is a whole-report scalar
(`classifyAsBuiltReviewOutcome`), `## Blocking Violations` and `## Resolution` are unparsed
prose, and both halt writers (serial SHIP walk and validation-group join) map every BLOCKED to
a `needs-human` halt per adr-2026-08-22-as-built-review-runs-always-with-plan-gap decision 3.
Issue #1874 asks for autonomous convergence of the remediable class and knowingly carries the
cost of superseding that decision.

Whether a finding's governing artifact has already decided the remedy is a judgement call; per
the softened machinery principle (PR #1625) the design is an LLM verdict constrained by a
closed schema, with all bookkeeping (parsing, caps, ledger, halts) mechanical and fail-closed.

## Options Considered

### Option A: Admit remediable findings through the existing single-appender seam (chosen)
- **Pros:** reuses `planRemediation` gap admission, `appendRemediationTasks`, the gate-keyed
  growth ledger (`byGate` needs no schema change), lap caps, and the no-op escalation pair;
  preserves one appender; smallest new-machinery surface.
- **Cons:** amends two APPROVED ADRs; couples as-built remediation to prd_audit's seam semantics.

### Option B: Dedicated as-built→build route (revive the dead dispatch block)
- **Cons:** creates a second BUILD-directing route, against one-owner's binding principle;
  duplicates cap/ledger machinery.

### Option C: Classify and surface only, no routing
- **Cons:** removes diagnosis cost but not the operator round trip; operator explicitly chose
  full convergence.

## Decision

1. **Per-finding classification (LLM judgement, closed schema).** A BLOCKED as-built report
   MUST carry a machine-read `## Blocking Findings` table, one row per finding:
   finding id, class from the closed set `REMEDIABLE | DESIGN`, the governing APPROVED clause
   (ADR filename stem plus decision number, or the feature's own plan task id), and a one-line
   summary. `REMEDIABLE` means the shipped code does not do what that already-APPROVED clause
   requires and the remedy is code conforming to it. `DESIGN` means resolution requires a
   decision no approved artifact has made — superseding an ADR, or choosing between
   incompatible approved constraints. The skill's existing `## Blocking Violations` and
   `## Resolution` prose sections remain, unparsed.

2. **Fail-closed parsing.** A new parser (mirroring `parsePrdAuditReport`'s shape: scoped to
   the section, header-validated, closed grade set) validates the table. A BLOCKED report with
   a missing table, an unknown class, or a `REMEDIABLE` row that names no governing clause is
   **invalid as a whole** and halts `needs-human` naming the defect — ambiguity never
   self-heals. `AsBuiltReviewOutcome`'s `blocked` arm widens to
   `blocked-remediable` (every finding REMEDIABLE) vs `blocked-design` (any finding DESIGN).

3. **Bounded route to BUILD (supersedes adr-2026-08-22-as-built-review-runs-always-with-plan-gap
   decision 3; that ADR's other decisions stand).** `blocked-design` halts `needs-human`, the
   halt body recording every finding with its class and governing clause. `blocked-remediable`
   routes through `planRemediation`: each finding becomes a clause-bound remediation gap
   admitted through the existing `appendRemediationTasks` appender under gate key
   `architecture_review_as_built` (`requiresPlanGrowthAllowance` admits the as-built source),
   navigates back to BUILD, and restages the gate stale. The retired capture/check no-op
   escalation pair (adr-2026-07-13) is re-armed for this gate so a zero-progress lap escalates
   instead of looping.

4. **Termination.** The gate gets its own remediation lap cap, default **1**
   (operator-configurable, config key under `architecture_review_as_built`), and its appended
   tasks draw on the **shared** plan-growth allowance
   (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D5/D6) via the existing
   gate-keyed `growth.byGate` record. A second lap, an exceeded allowance, or a no-op
   escalation halts with the existing `kickback-cap` class, listing every finding. No new halt
   class is introduced (adr-2026-07-28 D1 unchanged); laps ride
   `gates.architecture_review_as_built`, never build_review's cumulative counter.

5. **One appender, restated (amends adr-2026-08-22-one-owner-per-review-question).** The
   binding principle becomes: *a gate may fail a lap or halt, and only the
   `planRemediation` → remediation-append seam may append plan tasks — with `prd_audit` and
   `architecture_review_as_built` as its only admitted sources, each under its own cap; no gate
   may direct BUILD to a mechanism the approved plan (or the governing approved clause a
   remediation task cites) does not authorize.* Appended tasks carry the governing clause the
   way prd_audit tasks carry `Criterion:`.

6. **Observability and lifecycle.** Per-finding classification and each remediation outcome
   are projected into the verdict artifact and the shipped record through the existing
   recorded-findings renderer, so a reader can tell afterward why a finding remediated or
   halted and against which clause. Every new exit emits its lifecycle terminal
   (adr-2026-08-12 D1); refused-step stamping is unchanged (adr-2026-08-24 D4); halts go
   through `writeHaltMarker` with existing classes only. A config kill switch
   (`architecture_review_as_built.remediation.enabled`, default on) reverts exactly to
   halt-always-on-BLOCKED.

7. **Cross-restart durability of pending remediation findings (added 2026-08-26 by operator
   amendment; corrects the "no new ledger schema" consequence recorded below).** A finding
   admitted to a remediation lap is not yet remediated: the per-finding record decision 6
   promises may only be written once the rebuilt gate returns a successful verdict, and the
   BUILD traversal between those two moments routinely spans dispatches — separate processes —
   in daemon mode. The pending set is therefore **durable state**, persisted as an OPTIONAL
   `pendingAsBuiltRemediationFindings` array on the existing **version-1** kickback ledger,
   alongside `gates.*.laps` and `growth.byGate`. Binding constraints: the array is validated
   fail-closed on read, an ill-formed entry invalidating the whole ledger exactly as a
   malformed `growth` record does; it is absent on ledgers with no pending findings and reads
   as empty when absent, so the schema stays compatible in both directions with **no version
   bump**; an entry is written only when the append that authorizes the lap succeeds, so an
   unauthorized repair is never recorded; and the array is cleared in the same step that
   projects its findings into the verdict artifact, so a pending entry never outlives its
   projection. This is the only durable surface the feature adds, and no component outside the
   remediation seam reads it.

8. **The bounded route is a fallback, never a preemption (added 2026-08-26 by operator
   amendment).** `adr-2026-07-10-validation-group-join` decision 3 is unchanged and keeps
   primacy: when a validation-group join carries a `manual_test` FAIL alongside review gaps,
   the engine merges both classification streams into ONE work order with a single rewind and
   the FAIL rows attached as evidence. That merge already admits
   `architecture_review_as_built` gaps. This ADR's route therefore applies **only where the
   consolidated kickback does not** — an as-built `blocked-remediable` verdict with no
   `manual_test` FAIL in the same round. Whenever a FAIL is present, as-built gaps ride the
   consolidated dispatch and this route must not run. A mixed `prd_audit`/as-built round with
   no FAIL still belongs to this route: that shared repair, with its single-counted plan
   growth, is what decision 4 establishes.

   The route was authored as the `if` arm ahead of the consolidated path, so a
   `blocked-remediable` verdict rewound before the merge could attach manual-test FAIL rows
   (as-built finding AB-R14). Ordering is not the guard; the condition is.

   Budget follows the same split. In the consolidated cases the existing shared accounting
   applies unchanged, satisfying decision 3's clause that `MAX_KICKBACKS_PER_GATE`,
   `manualTestSelfHeals`, and `remediationRounds` keep their per-gate accounting. Only on the
   as-built-only path is decision 4's gate-local durable budget the sole authority — which is
   why the process-local `remediationRounds` pre-cap was removed from that branch and from
   that branch alone.

9. **Findings owned by existing plan tasks append nothing and charge no growth (added
   2026-08-31 by #2119).** The remediation planner may disposition a `REMEDIABLE` (or
   prd_audit `FIXABLE`) finding as **`existing-task`**, binding it to one or more task ids
   already present in the active plan, each resolved fail-closed through the shared
   reference resolver (adr-2026-08-30-shared-plan-task-reference-resolver D1/D2/D3); an
   unresolvable id invalidates the disposition. `existing-task` is excluded from the
   plan-append contract exactly as `publication` is
   (adr-2026-08-06-publication-progress-is-its-own-disposition shape discipline: the union,
   the fail-closed validator, `remediationDispositionStep`, and
   `remediationDispositionAppendsToPlan` widen in the same change), routes to `build`, and
   consumes ONLY this gate's lap allowance under decision 4's lap cap — `growth.added` is
   not incremented and `prdAuditAppendCap` is never consulted for it, so decision 4's
   "appended tasks draw on the shared plan-growth allowance" now governs appending
   dispositions only. Decision 3's "admitted through the existing `appendRemediationTasks`
   appender" is likewise qualified: `existing-task` bypasses the appender by construction
   and introduces no second appender (decision 5 unchanged). Decision 7's pending entry for
   such a finding is authorized by the successful resolution of its task binding rather
   than by an append, and is persisted, validated, and cleared identically. Decision 8's
   condition applies unchanged. **Every `existing-task` kickback MUST re-stage its bound task
   ids to `pending` in `.pipeline/task-status.json` (the same re-seed seam the appender uses)
   before the rewind, fail-closed — a route that cannot re-stage halts rather than dispatching
   a BUILD with no pending work.** Without this the next dispatch sees the bound tasks still
   `done` and the kickback delivers nothing (the prior restage bug class). The no-op escalation pair (decision 3) stays armed for this
   disposition — its lap has no plan-text progress witness, so the tree-hash baseline is
   its only termination evidence. A cap terminal still halts `kickback-cap`, its prose
   naming the budget actually exhausted as diagnostics only
   (adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D2); the typed
   ledger remains the authority.

## Consequences

### Positive
- The four-halts-in-a-day class converges without an operator; halts are reserved for genuine
  design decisions, with the reason recorded per finding.
- No second appender and no new halt class — the bounded-kickback machinery is reused under a
  new gate key. The single durable-state addition is the optional
  `pendingAsBuiltRemediationFindings` array of decision 7; the ledger version is unchanged and
  older ledgers remain readable.

### Negative
- One more BUILD traversal per remediable BLOCKED report before the gate re-runs.
- A misclassified DESIGN-as-REMEDIABLE finding burns the lap before reaching a human (bounded
  by the cap at one lap).
- The ledger now carries state whose lifetime spans a BUILD traversal, so a ledger deleted
  mid-lap (for example with a discarded worktree) loses the per-finding record even though the
  repair itself is committed on the branch.
- Two remediation entry points into the validation group now coexist, separated by an explicit
  condition rather than by ordering. A future edit that widens either one must re-check the
  other, or the AB-R14 class returns.

### Follow-up Actions
- [ ] Parser + outcome widening; both halt writers branch on the widened outcome.
- [ ] `planRemediation` admission + caps + ledger key; escalation pair re-armed.
- [ ] Skill §12 table contract; docs (gates, steps, skills) updated.
