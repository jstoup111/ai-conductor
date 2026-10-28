# ADR: As-built findings are reconciled against prior as-built cases in the gap plan

**Date:** 2026-10-28
**Status:** APPROVED
**Deciders:** operator (composer DECIDE for jstoup111/ai-conductor#3127)

<!-- Filename convention: adr-2026-10-28-<kebab-slug>.md (no sequential numbers). -->

## Context

As-built review stamps every finding with an id tied to its attempt,
`as-built:«attempt»:«ordinal»` (`as-built-contract.ts`, `stampAsBuiltFindingIds`). That id is never
matched against an earlier lap, by design: `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
D1.2 keeps identical findings distinct across attempts. The remediate `gap-plan` dispatch answers each
current REMEDIABLE finding exactly once (D3.1 of that ADR). It sees the still-pending prior findings
as context, but its contract has no field that relates a current finding to a prior one. The
appender reuses a task only when both the planner-chosen id and the exact title match
(`remediation-append.ts`), so a reworded finding mints a new `rem-*` task. On #2924 the plan grew
from 13 to 30 tasks across 13 as-built laps. On #3053 the same five findings were restated on two
laps.

The pending-finding record (`pendingAsBuiltRemediationFindings`, D7) is cleared when the gate
passes. It carries no disposition, repair task, or repair outcome, so no durable as-built history
exists to reconcile against.

The shared remediation case store already holds two domains (`RemediationCaseDomain =
'build_review' | 'prd_widening'`), under `adr-2026-09-07-durable-prd-widening-decision-reconciliation`
D2. The cross-gate end state in #2441 requires shared case bookkeeping with authority owned per
domain, and forbids a second independent channel. The PRD-audit sibling, #3126, needs the same
mechanism later.

## Options Considered

### Option A: Reconcile inside the existing remediate gap-plan, persisted as an `as_built` domain
- **Pros:**
  - No new dispatch, step, or remediate mode.
  - The planner that already answers each finding also relates it to prior cases.
  - The history lives in the shared store, where #3126 and #2441 can extend it.
- **Cons:**
  - The gap-plan contract and its validator grow.
  - The planner might label findings "same" to avoid work. Engine binding rules check this.

### Option B: A separate reconciliation mode before gap-plan, as PRD widening does
- **Pros:** Matching stays separate from planning.
- **Cons:** An extra dispatch per BLOCKED lap, and a fourth remediate mode that #2441 would later
  have to merge back.

### Option C: The reviewer links each finding to a prior case inside its own verdict
- **Pros:** No extra dispatch.
- **Cons:**
  - The reviewer grades its own consistency, and the as-built verdict contract changes.
  - Cross-gate reuse would require every reviewer to read every gate's history.

### Option D: A mechanical key on class plus governing reference
- **Pros:** Deterministic and free.
- **Cons:** It splits the issue's own example (a contract gap re-raised as dead code under a
  different clause) and merges distinct defects that cite one ADR decision. This is the string
  matching the repository's design principle rejects for equivalence questions.

## Decision

Adopt **Option A**.

1. **The shared case store gains an `as_built` domain.**
   - **Record:** an `as_built` record carries:
     - an engine-stamped case id;
     - its sources;
     - a status from the closed set `open | resolved | needs-human`;
     - the `rem-*` and plan task ids bound or appended as its repair;
     - an optional `changedFrom` case id;
     - a recurrence count.
   - **Source entry:** each source is one engine-stamped as-built finding id with:
     - its class, typed governing reference, and summary;
     - the relation and reason that admitted it (decision 3);
     - the attempt that raised it.
   - **Collection and envelope:** the store keeps one collection per domain (`cases` for
     build_review, `prdWideningCases` for PRD widening), and each collection's parser rejects other
     domains. `as_built` records get their own collection, `asBuiltCases`, in a new `v4` envelope.
     - **Upgrade:** like the earlier v2 to v3 step, a `v1`, `v2` or `v3` state is upgraded at the
       mutation seam. Its existing collections, suppressions and outbox are carried unchanged, and
       `asBuiltCases` starts empty.
     - **Reading:** reads accept every version. A pre-`v4` state reads as having no as-built cases.
   - **Parsing:** `asBuiltCases` is parsed by its own exact-keys parser through the domain-tagged
     reader. A non-`as_built` record in it is rejected as `foreign-domain`, as the existing
     collections already do. The store lock and the `build_review` and `prd_widening` records are
     unchanged.
   - **Authority:** an `as_built` record carries no operator disposition and no build_review
     effect. Other domains never read it as authority.
2. **The gap-plan projection carries prior as-built cases.**
   - **Contents:** when an as-built verdict contributes required references, the projection adds
     every `as_built` case in the store scope where the as-built verdict lives. Each case's repair
     task ids also join the projected task context, which today holds only owner tasks, so that a
     binding can resolve them. A repair task id the active plan no longer declares is a preparation
     fault. Each case shows:
     - its status and recurrence count;
     - its sources (summary, reference, relation, reason);
     - each repair task id with its current resolution.
   - **Bound:** the cases are bounded under the projection's existing named byte limits. Overflow is
     a preparation fault that halts `needs-human`, naming the dimension. Cases are never truncated,
     following the build_review precedent in `adr-2026-08-29-build-review-remediate-case-adjudication` D3.
3. **Each as-built disposition carries a reconciliation result.**
   - **Shape:** every `as-built-finding` disposition in the `gap-plan` result carries
     `reconciliation: { relation, priorCaseId?, reason }`.
     - `relation` is from the closed set `same | recurrence | materially-changed | new`.
     - `reason` is non-empty.
   - **Scope:** `prd-criterion` and other reference kinds carry no reconciliation field. Their
     contract is unchanged until #3126.
   - **Prior case id:** `same`, `recurrence` and `materially-changed` require a `priorCaseId` that
     names an `as_built` case in the projection. `new` forbids it.
   - **Meanings:**
     - `same`: the finding restates the prior case's defect, and that case's repair has not yet
       been attempted.
     - `recurrence`: the prior case's repair was attempted and the defect persists.
     - `materially-changed`: the finding descends from the prior case but names a substantively
       different defect, site, or cause.
     - `new`: it relates to no prior case.
   - **Same lap:** several current findings may name one prior case.
   - **Schema and rejection:** the shape is part of the single static engine schema
     (`adr-2026-09-07-durable-prd-widening-decision-reconciliation` D6.4). Any violation is a
     field-specific mechanical rejection of the whole plan, retried within remediate's existing
     allowance (`adr-2026-08-25-as-built-remediable-findings-bounded-build-route` D3.1).
4. **The relation decides the admissible effect.** The engine enforces it.
   - **`same` and `recurrence`:**
     - **Disposition:** must take `existing-task` (D9 of the 08-25 ADR) binding at least one
       repair task of the prior case, or `halt`.
     - **Owner binding:** when the finding cites a plan task, the binding still includes that owner
       task (D3.1). The prior case's repair tasks are additionally admitted as bound task ids. Any
       other non-owner id stays rejected.
     - **Plan growth and lap:** nothing is appended and no growth is drawn. The round charges only
       the gate's lap, as D9 already does.
     - **Restage:** the bound tasks are restaged `pending` through the existing restage seam,
       fail-closed.
   - **`materially-changed` and `new`:** take any disposition admitted today (append,
     `existing-task` of the owner, or `halt`), under today's growth and lap accounting.
   - **No dismissal:** no relation dismisses a finding. Every current REMEDIABLE finding still yields
     repair work or a halt.
5. **Reconciliation never changes as-built authority.**
   - **Verdict:** the as-built verdict, its classes, and its routing are unchanged. The gate
     establishes completion only from a fresh verdict of an approved kind.
   - **No pass from history:** an `as_built` case, a prior relation, or another domain's record
     never makes the gate pass, never resolves a current finding, and never grants approval.
   - **Lap cap is the bound:** the gate's existing tier lap cap (S2, M3, L4, operator-configurable)
     remains the bound on repeated laps. A recurrence costs a lap and no plan growth. No separate
     recurrence limit or halt class is added.
6. **Every source finding is recorded with its result.**
   - **Accepted plan:** after an accepted gap-plan and its successful append or binding, the engine
     writes each as-built finding to the store:
     - a `same` or `recurrence` finding joins the prior case as a source, and that case is set
       `open`;
     - `recurrence` also increments the case's recurrence count;
     - `materially-changed` creates a new case with `changedFrom`;
     - `new` creates a new case.
   - **BLOCKED verdict with a DESIGN finding:** no gap-plan runs. Before the existing `needs-human`
     halt, the engine records every finding of that verdict as a source of a new case with status
     `needs-human`.
   - **Planner `halt`:** a finding answered `halt` is recorded the same way.
   - **Gate pass:** when the as-built gate succeeds, at the point where pending findings are
     projected today, every `open` `as_built` case is set `resolved`. Resolved cases stay in the
     store as history.
   - **Unchanged:** `pendingAsBuiltRemediationFindings` (D7) keeps its write, validation and clear
     rules.
7. **One spine event per source finding.**
   - **Event:** each recorded source emits a new `ConductorEvent` variant,
     `as_built_finding_reconciled`. It carries:
     - the finding id, the case id, and the attempt;
     - the outcome, `same | recurrence | materially-changed | new | needs-human`;
     - `priorCaseId` when present, and the reason.
   - **Delivery:** the event is appended to the case store's existing outbox in the same mutation
     that records its source, so case state and event are written atomically.
   - **Drain:** it is delivered through `drainRemediationCaseOutbox` with the emitter's
     `emitOrThrow`. The drain runs right after the recording mutation and again before the next
     as-built recording or projection.
   - **Crash safety:** a crash between write and delivery replays the same `eventId`, which the
     spine deduplicates. A replayed recording whose finding id is already recorded adds no source
     and no second outbox entry.
   - **No parallel channel:** no sidecar log or second channel is added.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `existing-task` bindings resolve only against the projected task context, which today holds only owner tasks; plan-task references must bind exactly their owner (`remediation-plan-contract.ts` owner checks, `remediation-projection.ts` `projectActiveTasks`) | verified | 95% | yes | Decisions 2 and 4 would not be enough to admit prior repair tasks | n/a |
| A2 | Appended `rem-*` blocks are declared in the active plan text that `projectActiveTasks` parses, so a prior case's repair task resolves once it joins the projected task context | inferred | 90% | yes | Binding a prior repair task would fail resolution and the plan would be rejected | APPROVED by operator 2026-10-28 |
| A3 | Restaging a resolved engine-appended `rem-*` task to pending through the existing-task restage seam rebuilds it correctly under `adr-2026-09-06-reopened-task-resolution` | inferred | 80% | yes | A recurrence round could dispatch BUILD with no real pending work; the no-op escalation stays armed as backstop | APPROVED by operator 2026-10-28 |
| A4 | The case store keeps one exact-keys collection per domain in a versioned envelope (`v3`: `cases`, `prdWideningCases`, `suppressions`, `outbox`), upgrades older versions at the mutation seam (`appendRemediationCaseOutbox`), and an engine without `v4` rejects a `v4` store as an unknown version (`remediation-case-store.ts`) | verified | 95% | no | Only affects an engine downgrade mid-feature | n/a |
| A6 | The case-store outbox and `drainRemediationCaseOutbox` deliver any `ConductorEvent` variant added to `RemediationCaseOutboxEvent`, with crash-safe `eventId` replay deduplicated by the spine | verified | 90% | yes | Decision 7 would need its own durable channel | n/a |
| A5 | The existing remediate retry allowance is enough to absorb reconciliation-shape rejections without new halt classes | inferred | 80% | no | More `needs-human` no-plan halts than today; observable on the spine | n/a |

## Consequences

### Positive
- A reworded or recurring as-built finding binds its prior repair instead of minting a new task,
  so it no longer draws plan growth.
- Every as-built finding is traceable to a case, a relation, and a reason, including findings that
  halt for a human.
- PRD audit (#3126) can add a `prd_audit` domain and reconciliation field the same way, and #2441
  can link cases across domains without a new store.

### Negative
- The gap-plan contract, its validator, and the remediate skill guidance grow.
- A recurring finding still costs a lap. The lap cap, not a recurrence limit, ends a loop.
- A provider can still mislabel a relation. The engine checks only structural consistency; it does
  not re-judge equivalence.

### Follow-up Actions
- [ ] Add the `v4` envelope with `asBuiltCases`, its mutation-seam upgrade, and the `as_built` record parser
- [ ] Extend the gap-plan projection with bounded prior as-built cases
- [ ] Extend `REMEDIATION_PLAN_SCHEMA` and `validateRemediationPlan` with the reconciliation field and relation rules
- [ ] Record cases at plan acceptance, DESIGN halt, planner halt, and gate pass; append `as_built_finding_reconciled` to the case-store outbox and drain it
- [ ] Update `skills/remediate/SKILL.md` gap-plan judgement guidance
