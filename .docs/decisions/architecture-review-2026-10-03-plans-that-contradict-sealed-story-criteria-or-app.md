# Architecture Review: coverage_binding refuses plans that contradict sealed criteria or ADR decisions

**Date:** 2026-10-03
**Mode:** Lightweight (Tier M), pre-stories, technical track
**Source:** intake #2750 and its 2026-10-02 ADR-conflict comment
**Diagram:** `.docs/architecture/plans-that-contradict-sealed-story-criteria-or-app.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Reuses `executeAuxiliaryProviderCandidates`, `renderAuxiliarySkillInvocation('coverage-binding')`, the coverage-binding envelope and payload parser, `parseAdrDecisions`, and the story-criteria extractor (verified, 95%). |
| Prerequisites | None. `coverage_binding` already exists and is enabled in this repo's `.ai-conductor/config.yml` since 2026-09-19 (verified). |
| Integration surface | One engine step (`runCoverageBinding`), its input assembly and envelope modules, the `ConductorEvent` union and sink registry, and the `coverage-binding` skill text. |
| Data implications | The envelope gains a third entry kind. Existing envelopes stay readable: absent conflict entries are a cache miss, not an error. |
| Performance risk | One extra batched judge session per ≤ `batch_size` conflict claims. The task table is sent once per batch, not once per claim, which bounds prompt growth to O(tasks + batch claims). A feature with 30 criteria and 15 decisions adds about 6 sessions on the first run; the digest cache makes later runs free unless the plan changes. |
| Worktree isolation | No new port, database, or shared state. All writes stay under the feature worktree's `.pipeline/`. |

**Root cause (verified, 95%):** `assembleCoverageBindingClaims` (`src/conductor/src/engine/coverage-binding-inputs.ts`)
joins each claim only to the `Done when` of the tasks the carrier row cites. In case 1, S1.5 cites
Tasks 3/20, which assert that the forbidden candidate is absent, so the judge sees `asserts`. Task 8,
which records the forbidden attempt, never reaches it. `.daemon/events.jsonl` shows all three
evidence features ran `coverage_binding` on 2026-09-24/25 with the judge enabled; #2750 records their later
SHIP halts (verified for the events, inferred 85% that the affected criterion claims passed the judge). The ADR layer (D17) is a mechanical row check and is `not-applicable` at tier S, so the
reporting_app conflicts with Tier S ADRs had no reader at all.

## Alignment

- **Ownership (adr-2026-08-22-one-owner-per-review-question):** this adds a new review question
  rather than overlapping an existing one. Coverage asks "is the criterion asserted by its cited
  task"; conflict asks "can the plan as a whole satisfy it". The map is amended additively (#2750
  amendment). The new question halts only; it never appends or routes to `plan`.
- **Gate placement (adr-2026-07-22-coherence-gate-placement-and-validation-split):** land stays
  model-free. The judgement runs in the existing BUILD-phase judge step, before any task code. The
  filer's hypothesis of an LLM judge at land was rejected in explore because it contradicts this ADR.
- **Criterion layer (adr-2026-08-23-criterion-layer-is-structural-at-land):** no BUILD consumer
  starts requiring a criterion row. Conflict claims read criteria from the sealed stories file.
- **coverage_binding ADR:** extended by additive amendment D21–D24, following the D18 precedent
  (amendment claims are already judged against every plan task). No new ADR is warranted: this
  creates no new boundary, component, integration, or persistence model. It adds a claim class to
  an existing step.
- **Machinery vs judgement (CLAUDE.md):** "can these two requirements both hold?" is a judgement
  call. Machinery owns claim enumeration, subject-ADR resolution, digesting, closed-schema
  validation, and the halt.
- **Event spine:** one new event on the existing union. No sidecar.
- **Diagram accuracy:** the per-feature diagram matches this design.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Conflict-claim assembly (criteria from sealed stories, subject ADR decisions, full task table) | Called from `runCoverageBinding` in `step-runners.ts`, alongside `assembleCoverageBindingClaims` / `assembleAmendmentClaims` |
| Subject-ADR resolution (DECIDE set ∪ APPROVED stems cited in plan text) | Called by the conflict-claim assembly. Reuses the D16 DECIDE-set builder in `coverage-binding-decide-set.ts` |
| Conflict batch prompt + closed payload parser | Dispatched by `runCoverageBinding` through `executeAuxiliaryProviderCandidates`; parsed in `coverage-binding-envelope.ts` beside `parseAmendmentBatchPayload` |
| Conflict entries in `.pipeline/coverage-binding.json` | Written by the existing envelope writer; read by the existing cache pass |
| `coverage_binding_conflict_judged` event | Emitted by `runCoverageBinding` through `ConductorEventEmitter`; declared in `types/events.ts` and the sink registry |
| Conflict judgement policy | `skills/coverage-binding/SKILL.md`, already loaded via `renderAuxiliarySkillInvocation('coverage-binding')` |

The advisory overlap scan over these paths reported no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| False-positive conflicts halt correct plans (the judge reads "covers a different criterion" as a conflict) | Technical | Medium | High | D22 makes uncovered = `consistent`. The skill policy demands a stated incompatible requirement. Fixtures pin a non-conflicting plan as passing. A refusal names the tasks, so an operator can verify it in one read. |
| Judge-off repos (the engine default) get no protection, including the reporting_app class | Knowledge | High | Medium | Accepted scope: rides `coverage_binding.judge.enabled` (operator decision). The default flip stays its own follow-up (D7). |
| Plan-text stem citation misses an ADR that a plan obeys without naming it | Technical | Low | Medium | Accepted scope. The DECIDE set still covers branch-changed ADRs. A repo-wide sweep is excluded. |
| Prompt size on large plans | Performance | Low | Low | Task table sent once per batch; `batch_size` bounds claims. |
| Evidence-case fixtures reconstructed from quoted halt text, not original artifacts (reporting_app is external) | Knowledge | Medium | Low | Fixtures reproduce each conflict's two sides verbatim from #2750 and its comment. Proof is at the assembly + stub-judge level (operator decision); no live-LLM test. |

## ADRs Created

None. Amended (additive, operator-approved 2026-10-03):

- `adr-2026-08-31-coverage-binding-judge-step`: D21–D24 (conflict claims, closed verdict, refusal, event).
- `adr-2026-08-22-one-owner-per-review-question`: D1 map gains the joint-satisfiability question.

## Conditions

1. Conflict claims never reopen, append, or route, even on a D16 re-run (D23).
2. A non-conflicting plan whose tasks cover different criteria passes with no new refusal and no
   new required plan or coherence shape.
3. Six fixtures reproduce the evidence cases: three story-criterion conflicts from #2750, and three
   ADR-decision conflicts from the comment, including a Tier S plan and an ADR with no citable
   decision. Each must prove that the criterion or decision and the conflicting task reach the judge
   in one claim, and that a `conflicts` verdict refuses naming both.
4. With the judge disabled, conflict claims record `unjudged` and the step's behavior is otherwise unchanged.
