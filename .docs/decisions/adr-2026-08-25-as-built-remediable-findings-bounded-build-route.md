# ADR: As-built BLOCKED findings are classified per finding, and remediable ones take a bounded route to BUILD
**Date:** 2026-08-25
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1874
**Supersedes:** adr-2026-08-22-as-built-review-runs-always-with-plan-gap (decision 3 only)
**Amends:** adr-2026-08-22-one-owner-per-review-question, adr-2026-07-13-kickback-build-no-op-escalation

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

## Consequences

### Positive
- The four-halts-in-a-day class converges without an operator; halts are reserved for genuine
  design decisions, with the reason recorded per finding.
- No second appender, no new halt class, no new ledger schema — the bounded-kickback machinery
  is reused under a new gate key.

### Negative
- One more BUILD traversal per remediable BLOCKED report before the gate re-runs.
- A misclassified DESIGN-as-REMEDIABLE finding burns the lap before reaching a human (bounded
  by the cap at one lap).

### Follow-up Actions
- [ ] Parser + outcome widening; both halt writers branch on the widened outcome.
- [ ] `planRemediation` admission + caps + ledger key; escalation pair re-armed.
- [ ] Skill §12 table contract; docs (gates, steps, skills) updated.
