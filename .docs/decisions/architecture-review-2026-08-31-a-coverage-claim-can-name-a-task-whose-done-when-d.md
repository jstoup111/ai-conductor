# Architecture Review: coverage claims bound to `Done when` (#2088)

**Date:** 2026-08-31
**Mode:** lightweight (tier M) — §2 Feasibility and §4 Alignment in full
**Stories reviewed:** none yet (pre-stories review); input is `.docs/track/<slug>.md`, the explore
decision (`.memory/decisions/coverage-claim-done-when-binding-2088.md`), and the diagram
`.docs/architecture/<slug>.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Every seam exists: `parsePlanTaskDoneWhen` (`plan-task-parse.ts:168`), `checkCriterionCoverage` (`coherence-validator.ts:390`), `parseCoverageCheckTableRows` (`coherence-validator.ts:890`), the one-shot grader dispatch (`step-runners.ts:1907` `runRubricBuildReview` → `dispatchBuildReviewRubric` → `executeAuxiliaryProviderCandidates`), `writeHaltMarker` with the `needs-human` class, the `refused` step status, and the exhaustive `ConductorEvent` sink registry. Verified by reading each. |
| Prerequisites | A new config key (`coverage_binding.judge.enabled`, default false) with a registered consumer; a new `ALL_STEPS` entry; a new `skills/coverage-binding/SKILL.md` plus its `model-table-metadata.ts` row (integrity check 5 fails otherwise); `docs/reference/steps.md`, `configuration.md`, `skills.md`, and `docs/explanation/gates.md` updates. |
| Integration surface | Touches four modules — land validator, step registry/runner, config, events — all inside `src/conductor`. No external API. The judge's only external call is the existing provider dispatch. |
| Data implications | One new gitignored run artifact `.pipeline/coverage-binding.json`. One new committed shape: criterion-level rows in a tier-S plan's `## Coverage Check` table. No migration: legacy two-cell rows keep parsing (D1), merged plans without the table keep building (D3, D8). |
| Performance risk | When enabled: one dispatch per criterion, digest-cached. A 30-criterion spec is 30 short one-shots on first dispatch, zero on an unchanged re-run. Disabled (the shipped default): a no-op. |
| Worktree isolation | All state is per-feature-worktree `.pipeline/` or per-spec `.docs/`. No ports, services, or shared files. |

**Documentation-only?** No — engine, skill, and config behavior change.

## Alignment

- **Domain boundaries.** The judge answers one new review question and is added to
  `adr-2026-08-22-one-owner-per-review-question`'s map by amendment; `prd_audit` keeps completion
  authority (implementation vs criteria), BUILD task-close keeps `Done when` evidencing. No owner
  overlap.
- **Pattern consistency.** Engine-owned dispatch + skill-owned judgement policy + engine-stamped
  envelope replicates `adr-2026-08-13` / `adr-2026-08-19` exactly; the judge is not a
  `build_review` rubric because it runs before any diff exists. Default-off staging replicates
  `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` including a named exit.
- **Focused local pattern basis (judge dispatch).** Precedent: the `build_review` grader dispatch.
  Traits to preserve: fresh session id, `resume: false`, model fallback ladder, closed projection
  handed in the prompt, provider returns only the judged payload, engine stamps identity and
  persists atomically, malformed payload → mechanical-fault lane not a verdict. Why it applies:
  same question shape (schema-constrained judgement over engine-scoped inputs). Allowed variation:
  one dispatch per claim instead of per rubric; no diff or worktree read is needed, so the prompt
  must forbid reading files. Rediscovery hints: `step-runners.ts` `runRubricBuildReview`,
  `dispatchBuildReviewRubric`, `executeAuxiliaryProviderCandidates`; `build-review-coordinator.ts`
  for the cache-hit/dispatched branch shape.
- **State management.** Verdict vocabulary is closed (`asserts | does-not-assert`), plus an
  engine-side `not-applicable` for legacy tasks without `Done when` (D8) and `disabled` (D7).
  Step outcome uses the typed `refused`/`needs-human` state, not a boolean.
- **Diagram accuracy.** `.docs/architecture/<slug>.md` matches D1–D7 (both blocks render).
- **Placement contract.** `phase: 'BUILD'` is load-bearing: a `DECIDE` phase would be preseeded and
  never executed by the daemon (`adr-2026-07-26` D1). Verified in the ADR text; the step table doc
  must record the new row.
- **Security boundaries.** The judge prompt carries only criterion text and `Done when` lines; no
  new user input, no new credential.
- **Production DI defaults.** None introduced; the verdict store is the filesystem artifact.

## Wiring Surface

| New production surface | Called from |
|---|---|
| `coverage_binding` step (`steps.ts`) | `ALL_STEPS` order → conductor step loop; daemon executes (BUILD phase) |
| `runCoverageBinding` dispatch (`step-runners.ts`) | `DefaultStepRunner.run` branch on step name, beside the `build_review` branch |
| Completion predicate for `.pipeline/coverage-binding.json` (`artifacts.ts`) | `deriveCompletion` / `GATE_SURFACE` entry, like `build_review` |
| `coverage_binding.judge.enabled` (`types/config.ts`, `resolved-config.ts`) | read by the step runner at dispatch; registered in the consumer registry |
| `criterion:quote-not-done-when:<n>` and tier-S criterion layer (`coherence-validator.ts`) | `runCoherenceGate` inside `landSpec` (`engineer/land-spec.ts`) |
| Plan-table criterion-row parse (`coherence-parse.ts` shared core) | `runCoherenceGate` at S; `coverage_binding` input assembly at S |
| `coverage_binding_started/judged/halted` events (`types/events.ts`, `event-sinks.ts`) | emitted by the step runner; consumed by the existing render/persist/audit/otel sinks |
| `skills/coverage-binding/SKILL.md` | prompt policy embedded by the step runner's dispatch (never a user-invoked step) |
| `skills/coherence-check/SKILL.md` §4a(6), `skills/plan/SKILL.md` §7 | authored-by-operator DECIDE steps (composer / conduct) |

Advisory overlap scan output is appended below.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Judge marks an asserting `Done when` as `does-not-assert` (false halt) | Knowledge | Medium | Medium | Default off; halt names the check text so the operator resolves in one edit; digest cache prevents re-litigating an unchanged pair |
| Tier-S land requirement rejects in-flight S specs authored before this ships | Integration | Medium | High | Land-only (D3): merged specs unaffected; unlanded S specs add the table before re-landing — rejection names every omitted criterion |
| Parser accepts a criterion-level row as a legacy story row (cell-count ambiguity) | Technical | Low | High | D1 fixes the discriminator as cell count with a pinned corpus test over every merged plan's `## Coverage Check` table |
| Quote scoping rejects existing landed-but-unmerged M/L specs whose quotes came from Steps | Integration | Medium | Medium | Rejection is a waivable coverage gap with a stable id; the author re-quotes from `Done when` or adds the missing task — exactly the outcome #2088 asks for |
| New step forgotten in `docs/reference/steps.md` / tier tables | Knowledge | Medium | Low | Docs updates are named plan tasks; integrity suite checks the model table |

## ADRs Created

- `adr-2026-08-31-coverage-binding-judge-step` (new — structural: a new engine component and a new
  judgement integration seam before BUILD).
- Amendment notes (additive, dated 2026-08-31, #2088) on:
  `adr-2026-07-22-coherence-gate-placement-and-validation-split` (tier-S carve-out; judge placement),
  `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` (quote from `Done when`; judge row in
  the division of labour), `adr-2026-08-23-criterion-layer-is-structural-at-land` (S engagement;
  one non-requiring BUILD reader), `adr-2026-08-22-one-owner-per-review-question` (new map row).

## Conditions

1. Every plan task naming a parser, validator, step, or config change MUST cite the ADR decision
   (D1–D9) it implements in its Steps, and its `Done when` MUST assert the observable rule (e.g. "a
   quote present in Steps but absent from `Done when` is rejected as `criterion:quote-not-done-when:<n>`").
2. The corpus no-regression test named in Risks row 3 is a plan task, not an afterthought: every
   merged plan under `.docs/plans/` still parses with identical `claim-<row>` results.
3. The D7 default (`false`) is asserted by a test; the post-land flip PR is the only place it changes.
4. Stories must cover D8 (legacy task without `Done when` → `not-applicable`, no halt) as a negative
   path, or the judge will halt the legacy corpus the day it is enabled.

## Verify-claims ledger

| Claim | Confidence | Basis |
|---|---|---|
| Land grounds a quote against the whole task body, not `Done when` | 100% | verified `coherence-validator.ts:480-497` |
| Tier S disengages the coherence gate entirely, so instance 2's table was never parsed | 100% | verified `docs/reference/steps.md` tier table; `parseCoverageCheckTableRows` reads story→task only |
| A `phase: 'BUILD'` step is executed by the daemon, a `DECIDE` one is preseeded | 95% | verified adr-2026-07-26 D1 text; not re-verified against `daemon.ts` source |
| `acceptance_specs` is tier-S-skipped | 100% | verified `steps.ts:138` |
| One-shot grader dispatch is reusable for a non-diff judge | 90% | inferred from `dispatchBuildReviewRubric` shape; its prompt assumes a worktree diff, so the judge prompt must be new text |
| Existing gap-id vocabulary tolerates a new `criterion:*` id without renames | 95% | verified adr-2026-07-22-coherence-waiver gap-id stability rule; new id only |
