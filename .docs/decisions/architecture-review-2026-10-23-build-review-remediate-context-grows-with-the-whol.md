# Architecture Review: build_review remediate context scoped to the findings
**Date:** 2026-10-23
**Inputs reviewed:** no stories yet. This is the pre-stories lightweight review (Tier M, technical
track). Its inputs are:
- `.docs/track/build-review-remediate-context-grows-with-the-whol.md`
- `.docs/complexity/build-review-remediate-context-grows-with-the-whol.md`
- the approved sequence diagram `.docs/architecture/build-review-remediate-context-grows-with-the-whol.md`

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Plain TypeScript in the existing engine, with no new dependency. Task selection reuses the existing plan parsers `parsePlanTaskBodies`, `parsePlanTaskTitles` and `parsePlanTaskPaths` (`engine/plan-task-parse.ts`), plus the dependency parser in `engine/plan-dependencies.ts` (verified). |
| Prerequisites | #3271 shipped (#3358, #3367), and its amendments to both governing ADRs are on main. #3298 (severity, PR #3374, in flight) edits the same modules but not the plan-contract assembly (verified in the #3374 diff). Operator decision 2026-10-23: land with a dependency on #3298 so the build starts on top of it. #3294 is blocked by #3291 (native link added 2026-10-23). |
| Integration surface | One module family (`engine/build-review-adjudication-*`, `remediation-case-validator.ts`), the conductor's remediate `judge` closure, the step-runner result, one event variant and `skills/remediate/SKILL.md`. Everything is in-process. |
| Data implications | None persisted. The context is a per-lap, in-memory projection that is not stored. Case records, the work order and the remediation-case store are unchanged. |
| Performance risk | The intent is a reduction: the context's plan share scales with the findings, not the plan. The worst case adds one extra judge round in a lap, and only after a round-1 judgement whose only defect is an index-only admission. |
| Worktree isolation | No new ports, services or shared files. |

**Verified facts behind the design (2026-10-23):**

- The coordinator calls the judge exactly once per lap (`build-review-adjudication-coordinator.ts`, `input.judge(freshContext.context)`), and no validation-retry path exists. Confidence 95%, verified.
- Admission closure is already mechanical. The validator is handed `admittedTaskIds` derived from the supplied `admittedTaskContracts`, and it rejects any case-v2 act whose admitted id is outside that set, with the code `unknown-admission-task` (`remediation-case-validator.ts`). Scoping the bodies therefore scopes admission without new validation logic. Today the rejection does not name the offending ids. Confidence 95%, verified.
- Case-v1 act tasks carry no admission ids, so closure and the expansion round apply only to case-v2. A built-in-only (case-v1) lap gets the scoped bodies and the index as context only. Confidence 90%, verified (`remediation-case-artifact.ts` task shapes).
- The context travels in the prompt (`retryReason` is prefixed to the prompt in `step-runners.ts`). Claude in print mode, Codex and Pi all deliver the prompt over stdin, and #3290 moved Claude's system prompt to a file. No argv ceiling remains, so the existing `maxSerializedBytes` (256 KiB) is deliverable by every provider and no per-transport ceiling is needed. Confidence 90%, verified in `claude-provider.ts`, `codex-provider.ts` and `pi-provider.ts`.
- The providers already derive bounded `ProviderExitFacts` (`execution/llm-provider.ts`, `provider-diagnostics.ts`), and the Claude provider returns them on an unclassified failure. No engine module reads them: the conductor's judge closure throws `remediate dispatch failed`, and the coordinator's `catch {}` reports only `remediate judgement failed`. Confidence 90%, verified.
- `maxAdmittedTaskContracts: 128` makes any plan with more than 128 tasks a `field-overflow` stop today. Scoping removes that failure for plans whose findings touch at most 128 tasks. Confidence 90%, verified.

## Alignment

- **Governing ADRs reused; no new ADR.** No new boundary, component, integration pattern,
  persistence model or technology is introduced (§7 structural prerequisite not met). The
  change refines two existing decisions, so each gets an amendment note.
  - `adr-2026-09-10-portable-build-review-policy` D8 supplies "the full admitted task contracts
    needed to judge repairs" and states that "Missing scope evidence or overflow stops with a
    reason". Scoped bodies plus an index fits "needed". The amendment records that the
    engine-selected bodies plus the index form the admitted set, that admission outside the
    supplied bodies is invalid, and that one engine-run expansion round is the only way to widen
    the set. D8's "One `remediate` judgment" still holds: round 1's judgement is discarded, never
    merged, so exactly one judgement is authoritative.
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2, as amended by #1986,
    says "The shared operation serves attended and daemon execution exactly once per lap". A second
    judge round contradicts that literal text. **Operator decision 2026-10-23:** amend D2 to allow at
    most one expansion re-dispatch of the same `remediate` judgement inside the one shared
    operation. It uses the same skill, member, mode and context contract, discards round 1, and
    charges no kickback. No new step, skill, provider member or second adjudicator is introduced, so
    D2's other clauses and portable-policy D10 ("invokes the existing adjudication coordinator once")
    are unchanged.
- **Frozen projection preserved.** Every round's context is a self-contained engine projection. The
  judge never reads plan bodies itself (approach C was rejected).
- **Event spine.** The expansion round is an occurrence in time, so it rides the bus. It adds an
  optional `expansionTaskIds` field to the existing `remediation_adjudication_started` variant
  (`types/events.ts`), with no new channel. Additive optional fields are backward-compatible
  (`.agents/skills/event-spine/SKILL.md` §2).
- **Machinery by default.** Selection, closure, the expansion trigger and its bound are all
  mechanical. The only judgement is the existing one: which tasks admit a repair.
- **State management.** The round is a closed two-state sequence (initial, expansion) bounded in
  code. There is no persisted flag.

### Focused local pattern basis

- **Role:** finding-to-task selection. **Precedent:** `planContractPointers` in
  `engine/remediation-context-pointers.ts` maps a finding's file anchor to plan tasks through
  `parsePlanTaskPaths`. **Traits to keep:** deterministic, plan-text-only, path-exact matching.
  **Allowed variation:** selection keeps every matching task, whereas the pointers keep only a
  unique match. The pointer output itself stays unchanged. **Rediscovery hints:**
  `planContractPointers` and `sourcePlanContract` in `build-review-adjudication-coordinator.ts`.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Task selection (scoped bodies plus index) | Called by the existing `sourcePlanContract`, which `applyBuildReviewOutcome` → the coordinator already calls on every adjudicated lap |
| Plan-contract `index` field | Assembled by the existing `assembleBuildReviewAdjudicationContext`, serialized into the existing remediate prompt by the conductor's `judge` closure |
| Validator ids on `unknown-admission-task` | Read by the coordinator immediately after `validateRemediationCaseGraph`, the existing call site |
| Expansion round | Inside the coordinator around the existing `input.judge` call, reached from the conductor's build_review outcome path |
| Exit facts on a failed remediate dispatch | Step-runner result → the conductor's `judge` closure → the coordinator's judgement-failed halt reason → the existing `writeHaltMarker` |
| `expansionTaskIds` on `remediation_adjudication_started` | Emitted by the coordinator's existing `input.emit`, persisted by `EventPersister` |
| `skills/remediate/SKILL.md` index and expansion text | Loaded by the existing `remediate` step dispatch |

**Early overlap scan (advisory, 2026-10-23):** `ai-conductor overlap-scan` reports `conductor.ts`
overlap only, with five unmerged spec branches, which is expected for that file. A separate check
found that open PR #3374 (#3298) touches the coordinator, context, validator and remediate skill.
The land dependency covers it.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Selection misses a task the judge needs, so admission quality regresses | Technical | Medium | Medium | The index lists every task. One expansion round admits it, and a second miss halts naming the ids. Existing adjudication tests must stay green (track outcome). |
| Expansion doubles judge cost on a lap | Performance | Low | Low | It runs only on an index-only admission and is capped at one round. The event field makes the frequency observable. |
| A finding with no file anchor selects no task | Technical | Medium | Low | Open-case admitted ids and the pointers still apply, the index covers the rest, and the expansion round recovers. |
| Code collision with #3374 in the same modules | Integration | Medium | Low | Land dependency on #3298. The spec builds after #3374 merges. |
| Expansion context still overflows the ceiling | Technical | Low | Low | The same `serialized-byte-overflow` stop applies to round 2 and names actual and limit. |

## ADRs Created

None. Amendment notes are added to
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and
`adr-2026-09-10-portable-build-review-policy` D8, each with operator approval on 2026-10-23.

## Conditions

1. The plan carries Architecture Obligation Coverage rows for every decision of both amended ADRs.
2. The existing build_review adjudication tests stay green, unchanged except where their fixtures
   assert that every plan task body is supplied.
3. The expansion round is case-v2 only, at most once per lap, discards round 1, and charges no
   kickback.
