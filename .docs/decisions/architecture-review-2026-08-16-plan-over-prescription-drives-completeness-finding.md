# Architecture Review: Preservation-Anchored Completeness Exception (#1580)

**Date:** 2026-08-16
**Mode:** lightweight (Medium tier — Sections 2 and 4 full; 3 and 5 skipped per the tier rule)
**Input reviewed:** `.docs/track/plan-over-prescription-drives-completeness-finding.md` (technical
track, operator-confirmed), `.docs/complexity/plan-over-prescription-drives-completeness-finding.md`
(Tier M), `.docs/architecture/plan-over-prescription-drives-completeness-finding.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Yes. No new dependency, service, or runtime. The parser is TypeScript in an existing module; the rubric contract is Markdown in an existing SKILL.md. |
| **Prerequisites** | None outstanding. `deriveBuildReviewRemovals` already computes `removalContext` and `build-review-projections.ts:73` already ships it to the Completeness projection. Both blockers named on #1580 are cleared: #1579 closed 2026-08-16T14:08 (PR #1618), and both tautology siblings (`tautology-fails-are-unfixable-when-planned-behavio`, `tautology-rubric-grades-diff-required-fixture-relo`) are in `.docs/shipped/`. |
| **Integration surface** | Four modules, one boundary: `plan-task-parse.ts` → `build-review-inputs.ts` → `build-review-projections.ts` → `skills/build-review-completeness/SKILL.md`, plus the authoring form in `skills/plan/SKILL.md`. No module boundary is crossed that `verify-only` did not already cross in PR #1618. |
| **Data implications** | None persistent. One additive field on `BuildReviewSourceSnapshot` and the v2 Completeness projection. It enters `projectionDigest`, so it participates in the content-addressed rubric cache — see Risks. |
| **Performance risk** | Negligible. The parser is a single pass over plan text already read into memory. No new subprocess, no new git invocation, no new provider call. |
| **Worktree isolation** | Unaffected. No ports, services, databases, or shared files introduced. |

**Projection versioning.** The field is added additively and `projectionVersion` stays `'v2'`. This
is the move `adr-2026-08-15` made for `verifyOnlyContext`, verified against
`build-review-registry.ts:44-52` where all four rubrics still declare `projectionVersion: 'v2'`.

**Live-surface correction.** The rubric fan-out
(`adr-2026-08-13-engine-managed-build-review-rubric-branches`) made each rubric's SKILL.md the live
contract. `buildGraderPrompt` in `build-review-prompt.ts` is referenced only from tests and two
comments in `step-runners.ts` — it is off the dispatch path. Both sibling ADRs and the #1579
architecture diagram still describe `build-review-prompt.ts` as the exception surface; that is stale
and this feature must not follow it. Confidence 92%, basis: verified by grep for `buildGraderPrompt`
across `src/conductor/src`.

## Alignment

**Domain boundaries — respected.** Evidence derivation stays in the engine; judgement stays in the
rubric skill. The parser produces facts and never a verdict; the skill judges and never reads a file
the projection did not name. This is the same split `adr-2026-08-12` established and
`adr-2026-08-15` repeated.

**Pattern consistency — this is the third instance of an established pattern**, not a new one:
engine-derived evidence block + closed rubric exception + per-item predicate. The two prior instances
(`adr-2026-08-12` removal maintenance, `adr-2026-08-15` verify-only maintenance) are both APPROVED
and both shipped. `parsePlanTaskPreserves` is shaped after `parsePlanTaskVerifyOnly`
(`autoheal.ts:638`) and belongs beside `parsePlanTaskPaths` in `plan-task-parse.ts`.

**Governing-ADR conflict — identified, resolved, and recorded.**
`adr-2026-07-21-completeness-as-build-review-rubric` decision #1 forbids the Completeness grader from
"per-task SHA/reachability/corroboration reasoning". Every Tautology exception is a per-test
predicate, so copying that shape naively would breach the guardrail on the one rubric that carries
it. The resolution — the prohibition targets commit-chasing, not clause-reading, and the D3 predicate
consumes only plan text, diff content, and engine removal evidence — is recorded explicitly in the
new ADR's "load-bearing constraint" section rather than left implicit. This is the single most
likely way a future reader misreads this feature.

**Doctrine reversal is explicit, not incidental.** `skills/build-review-completeness/SKILL.md:24`
currently states `removalContext` is "never an exemption". D4 narrows that sentence rather than
deleting it. A silent edit here would be indistinguishable from drift.

**State management.** No new state, no flags, no state machine. The clause is either parsed into the
block or it is not; a malformed clause fails closed by absence.

**Security boundaries.** No new endpoint, input, or credential path. Plan text is already trusted
DECIDE-sealed input to this gate.

**Production DI defaults.** Not applicable — no injected store, no `InMemory*`/`Fake*`/`Stub*`
default introduced.

**Diagram accuracy.** `.docs/architecture/plan-over-prescription-drives-completeness-finding.md`
reflects the design and renders clean (`conduct-ts render-diagrams --check`, 1 diagram). It states
the `build-review-prompt.ts` exclusion explicitly so the stale sibling diagrams do not mislead.

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| `parsePlanTaskPreserves` (`src/conductor/src/engine/plan-task-parse.ts`) | Invoked from `build-review-inputs.ts`'s source-snapshot assembly, on the same read of plan text that already feeds `planBody` — the path `deriveBuildReviewRemovals` is called from today (`build-review-inputs.ts:302`). |
| `preservationContext` on `BuildReviewSourceSnapshot` (`build-review-inputs.ts`) | Populated in the frozen snapshot beside `removalContext` (`build-review-inputs.ts:317`); consumed by `buildBuildReviewProjections`. |
| `preservationContext` on the Completeness v2 projection (`build-review-projections.ts`) | Copied in the Completeness projection builder beside `removalContext: snapshot.removalContext` (`build-review-projections.ts:262`) and sealed into `projectionDigest`. |
| `**Preserves:**` clause contract (`skills/build-review-completeness/SKILL.md`) | Dispatched by the engine-managed rubric branch resolved through `BUILD_REVIEW_RUBRIC_REGISTRY.completeness` (`build-review-registry.ts:47`). |
| `**Preserves:**` authoring form (`skills/plan/SKILL.md`) | Consumed by DECIDE plan authoring; read back by `parsePlanTaskPreserves` above. |

**Early overlap scan.** `conduct-ts overlap-scan` over these paths returned a non-discriminating
result — it reported the complete queried file set against every spec branch enumerated, including
branches that cannot touch `plan-task-parse.ts`. Treated as **no signal** rather than as broad
overlap. Overlap was instead established by hand: both adjacent tautology features are shipped, and
no open PR touches these paths. The scan's behavior is a separate defect, noted for intake and out
of scope here.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Condition 3 is scoped too loosely; Completeness stops failing genuinely incomplete work | Technical | Medium | **High** | Condition 3 is written as "no equivalent survives **anywhere** post-diff", not locality-scoped. A dedicated negative-path story and acceptance spec are mandatory (see Conditions). **No downstream gate nets this** — `test-suite`, `/manual-test`, `/prd-audit` and the as-built §12 sweep all validate current behavior, which a lost assertion leaves intact; see the ADR's Negative consequences for the per-gate reasoning. |
| The exception is read as reintroducing per-task reasoning, and a later change "corrects" it back | Knowledge | Medium | High | Recorded explicitly in the ADR's load-bearing-constraint section with the distinction spelled out, mirroring the removal ADR's own near-miss record. |
| Implementation follows the stale sibling diagrams into `build-review-prompt.ts` | Technical | Medium | Medium | Named in Feasibility above and in the new architecture diagram's scope note; the plan must target the rubric SKILL.md. |
| `preservationContext` enters `projectionDigest`, invalidating cached Completeness verdicts on adoption | Performance | High | Low | Correct behavior — the judgement genuinely changed. Costs one re-judge lap per plan that adopts the clause. Accepted. |
| Equivalence misjudged toward false positive | Technical | Medium | Low | Rubric dispositions (`adr-2026-08-13`) are the existing per-finding operator valve. |
| `**Preserves:**` collides with #1602's general authorization form | Integration | Medium | Low | Operator direction 2026-08-16: design #1580 on its own merits; #1602's DECIDE owns the reconciliation. Recorded in D1 and the track marker. |

## ADRs Created

- `adr-2026-08-16-preservation-anchored-completeness-exemption.md` — **APPROVED**

**Structural prerequisite applied.** This revises the judgement boundary between engine-derived
evidence and rubric judgement, and narrows a doctrine set by an APPROVED governing ADR
(`adr-2026-07-21`, decision #1). That is a component-decomposition and integration-pattern decision,
not workflow policy or prompt wording. **Governing-ADR reuse check:** `adr-2026-07-21` governs this
rubric and is cited and applied rather than duplicated; it is narrowed by D4, not superseded — its
rubric meaning, holistic rule, and kickback ownership all stand. `adr-2026-08-12` and
`adr-2026-08-15` govern the *Tautology* rubric and cannot be extended to cover a Completeness
exception, so neither is reusable here; both are cited as the structural model.

## Conditions

1. **The negative path is a first-class story with its own acceptance spec.** A plan task declaring
   `**Preserves:** X` whose diff deletes X's carrier with no equivalent assertion retained anywhere
   MUST still produce a Completeness finding. This is the failure mode with High impact in the risk
   register; it is not satisfied by a unit test on the parser.
2. **The predicate is evaluated per preserved-behavior clause, never per diff.** A diff that
   relocates one behavior's coverage and drops another's must FAIL on the second. Acceptance
   coverage must include this mixed case, not only the two pure cases.
3. **Implementation targets `skills/build-review-completeness/SKILL.md`, not
   `build-review-prompt.ts`.** The latter is off the live dispatch path.
4. **D4's doctrine change is an explicit, reviewable edit** to the "never an exemption" sentence —
   narrowed to anchor exactly the D3 exception, not deleted.
5. **`parsePlanTaskPreserves` fails closed.** A malformed or ambiguous clause must be absent from
   the evidence block, never present-and-permissive.
