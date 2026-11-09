# Architecture Review: As-built review re-raises reworded findings as new obligations
**Date:** 2026-10-28
**Inputs reviewed:**
- the explore output and technical intent for jstoup111/ai-conductor#3127 (technical track);
- `.docs/track/as-built-review-re-raises-reworded-findings-as-new.md` (binding scope boundary);
- the approved diagram `.docs/architecture/as-built-review-re-raises-reworded-findings-as-new.md`;
- the governing ADRs listed under Alignment.

**Mode:** lightweight (tier M): Feasibility and Alignment only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | TypeScript engine changes only. No new package, service, or provider capability. `gap-plan` already uses native output schema enforcement (`step-runners.ts` remediate `gap-plan` branch). |
| Prerequisites | None outstanding. #2748 (typed as-built contract and gap-plan) and #2522 (engine-stamped finding ids) are merged. The shared case store already holds two domains. |
| Integration surface | Four modules plus one skill: the remediation case store and artifact types, the remediation projection, the remediation plan contract, `conductor.ts` `planRemediation` and the as-built gate-pass projection, `types/events.ts`, and `skills/remediate/SKILL.md`. All sit inside the existing remediation seam. |
| Data implications | One new collection, `asBuiltCases`, in a `v4` envelope of `.pipeline/remediation-cases.json`, upgraded at the mutation seam with every existing collection and the outbox carried unchanged. An older engine rejects a `v4` store as an unknown version (ADR A4). That matters only for an engine downgrade mid-feature. |
| Performance risk | Prior as-built cases add bounded bytes to an existing projection. Overflow faults rather than truncating. No extra dispatch. |
| Worktree isolation | The store is per-worktree under `.pipeline/` (excluded from the live boundary) and lock-guarded. Nothing is shared across worktrees. |

Technical-intent items:
- **Reconcile each finding as same, recurrence, materially changed, or new, with a reason.**
  Feasible inside `gap-plan` (ADR decisions 3 and 4).
- **Rewording alone mints no task.** `same` and `recurrence` must bind prior repair tasks through
  `existing-task`, which already exists under 08-25 D9 and appends nothing.
  - **Verified gap:** bindings resolve only against the projected task context, and
    `projectActiveTasks` projects only owner tasks today. Decision 2 adds the prior cases' repair
    tasks to that context.
- **Reopen with a reason.** `recurrence` restages the prior repair, and the reason is persisted
  (decisions 4 and 6).
- **Authority kept.** The verdict contract and routing are untouched (decision 5).
- **Every source traceable, including human-decision findings.** DESIGN and planner-`halt`
  findings are recorded as `needs-human` cases (decision 6), and each source emits an event
  (decision 7).

## Alignment

- **`adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: applied, not amended.**
  - Classes, routing, the single appender (D5), the lap cap (D4 as amended by #2413), and the D7
    pending record are unchanged.
  - `same` and `recurrence` use the D9 `existing-task` disposition as written: task ids "already
    present in the active plan". A `rem-*` block is in the active plan.
  - D3.1's "must bind that task" still holds, because the owner task stays in the binding. Only the
    validator's code-level rule rejecting every non-owner id is relaxed, and only for the prior
    case's repair tasks.
  - No decision text is falsified, so no amendment note is added.
- **`adr-2026-09-07-durable-prd-widening-decision-reconciliation`: applied, not amended.**
  - D2 (extend the existing store machinery) is followed: a new domain goes through the same
    tagged parser.
  - D6.4 (one static gap-plan schema) is followed: the reconciliation field extends that schema.
  - D5's reconciliation mode and the build_review case mode are untouched.
- **`adr-2026-08-29-build-review-remediate-case-adjudication`: precedent.** Bounded prior-case
  input with no truncation (D3) is reused. Its case authority and effects are not shared:
  `as_built` records carry no disposition or effect.
- **`adr-2026-10-21-remediation-closure-judgement`: unaffected.** A restaged `rem-as-built-*` task
  is judged again at its next close, as for any reopened task.
- **Event spine.** Case records are durable state in the existing store, which is exception C for
  state rather than an occurrence. Each reconciliation occurrence is a new `ConductorEvent`
  variant. It is written atomically with its case through the store's existing outbox and
  delivered by the existing crash-safe drain. No sidecar log is added.
- **Cross-gate consolidation (#2441).**
  - No new store, channel, or remediate mode is added.
  - The domain-tagged record and the per-reference reconciliation field are the extension points
    #3126 reuses.
  - Cross-domain linking stays out of scope.
- **State modeling.** The relation and status are closed enums. `priorCaseId` presence is tied to
  the relation by the validator, so `new` with a prior case and `same` without one are both
  unrepresentable after validation.
- **Departure from the approved diagram:** the separate recurrence limit is dropped. The tier lap
  cap already bounds laps, and a second counter would duplicate it. The diagram was revised in
  place, since it is not on main.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `v4` envelope, `asBuiltCases` collection and `as_built` parser in the remediation case store | Read by the gap-plan projection builder and written by `conductor.ts` `planRemediation` after an accepted plan, on the as-built DESIGN halt path, and at as-built gate success (where `projectPendingAsBuiltRemediationFindings` runs today) |
| `priorAsBuiltCases` and repair-task context in `buildRemediationProjection` | Consumed by the existing remediate `gap-plan` dispatch in `step-runners.ts` through the rendered projection |
| `reconciliation` field in `REMEDIATION_PLAN_SCHEMA` and its rules in `validateRemediationPlan` | Enforced natively by the `gap-plan` dispatch and validated by the existing `validateRemediationPlan` call in `step-runners.ts` |
| `as_built_finding_reconciled` event variant | Appended to the case-store outbox where `conductor.ts` records cases, and delivered by `drainRemediationCaseOutbox` through `emitOrThrow` to the existing `EventPersister` |
| `skills/remediate/SKILL.md` gap-plan reconciliation guidance | Loaded by the existing remediate skill invocation |

**Overlap scan (advisory):** only `conductor.ts` overlaps, with four unrelated in-flight spec
branches. No open spec or PR touches the store, projection, plan contract, or remediate skill.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Planner labels distinct defects `same` or `recurrence` to avoid work | Technical | Medium | Medium | Binding must include a prior repair task, so the work is restaged rather than dropped. The fresh as-built verdict still decides completion, and the lap cap bounds loops. |
| Restaging an already-closed `rem-*` task dispatches BUILD with no real work (ADR A3) | Technical | Low | Medium | Uses the existing D9 restage seam and the reopened-task resolution ADR. The no-op escalation stays armed. |
| Reconciliation-shape rejections exhaust remediate's retry allowance | Technical | Low | Medium | The rejections name the field. The existing no-plan halt applies, and is observable on the spine. |
| Older engine reads a store with an `as_built` record | Integration | Low | Low | `foreign-domain` refusal is fail-closed. This only arises on an engine downgrade mid-feature. |
| Prior cases overflow projection bytes on long features | Performance | Low | Medium | Named-dimension preparation fault, with no silent truncation. |

## ADRs Created

- `adr-2026-10-28-as-built-finding-reconciliation` (APPROVED by operator 2026-10-28). This is a
  durable state and state-transition decision: a new case domain and reconciliation lifecycle in
  the shared store. No existing APPROVED ADR covers it.

## Conditions

- **Assumptions A2 and A3** of the new ADR need operator approval before it is APPROVED.
- **Stories must cover:**
  - binding through `existing-task` for both plan-task-cited and ADR-cited findings;
  - recording of DESIGN-halt and planner-`halt` findings;
  - unchanged prd_audit references;
  - resolution of cases at gate pass.
- **Missing or corrupt history** in the store keeps today's fail-closed store read. Explicit
  recovery stays with #3128.
