# Architecture Review: Criterion-level coherence coverage

**Date:** 2026-08-23
**Intake:** jstoup111/ai-conductor#1799 (subsumes #1744)
**Tier:** L (full review) — technical track
**Stories reviewed:** none yet — this review runs before `/stories`, per
adr-2026-06-29-architecture-before-stories-convergent-kickback. Input is the intake's Desired
outcome bullets and the operator-confirmed scope boundary in
`.docs/track/coherence-rows-assert-story-task-coverage-that-not.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

All three defects named in #1799: an unsupported coverage claim, an accepted criterion owned by no
task, and a criterion pinned to state outside the feature's own diff — plus the halt-message
requirement. Subsumes #1744. Excludes re-judging whether the implementation satisfies its criteria,
which `prd_audit` owns.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. All work is inside `src/conductor/` TypeScript and two SKILL.md files. |
| Prerequisites | None. Every extractor the design needs already exists or is a small addition to an existing module. |
| Integration surface | Three engine modules (`coherence-validator.ts`, `plan-task-parse.ts`, `artifacts.ts`), one waiver module, two skills, and docs. Crosses no external boundary and makes no network call. |
| Data implications | None — no schema, no migration, no persisted state. The coherence artifact gains columns; the artifact is Markdown. |
| Performance risk | Negligible. The added work is string extraction over two Markdown files already read at land. |
| Worktree isolation | Unaffected. No ports, services, or shared state; `landSpec` already runs per-worktree. |

The one non-obvious feasibility claim, verified: `extractAuthoritativeStoryCriteria`
(`src/conductor/src/engine/artifacts.ts:1740`) already enumerates individual G/W/T criteria per
story and path type, and is currently called only by `acceptance_specs`'s disposition grounding.
Reusing it at land requires no change to the function itself, which is what makes the two sides
agree by construction rather than by convention. Confidence 95%, verified by reading the function
and its callers.

A task-body extractor does not exist yet but is a small addition to `plan-task-parse.ts`, reusing
the `TASK_HEADER_PATTERN` split that `parsePlanTaskDoneWhen` and `parsePlanTaskPaths` already
perform. Confidence 90%, inferred from reading both functions.

## Complexity

**High (4+ coupled surfaces, no external APIs).** Consistent with the L tier recorded in
`.docs/complexity/`. The complexity is in the constraint set, not the code: five APPROVED ADRs bound
the design, and one of them had to be amended rather than followed. Splitting is not advised — the
three defects share a single validation pass over the same trio of artifacts, and separating them
would mean three passes re-deriving the same criterion enumeration.

## Alignment

Checked against `.docs/decisions/` (repo-wide sweep of all 492 files), `.docs/architecture/`, and
CLAUDE.md.

**Governing ADRs applied, not duplicated:**

- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — honored. Every added land-side
  check is pure, offline, model-free. The judgement halves live at authoring.
- `adr-2026-08-22-one-owner-per-review-question` — honored. The new layer grades mapping shape only.
  `prd_audit` keeps "does the feature satisfy its criteria". This boundary is drawn explicitly in
  the component diagram's dotted edges so BUILD cannot drift into re-asking it.
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — honored. Every new refusal carries a
  stable, waivable gap id; a refusal with no waivable id would be a design defect under that ADR.
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` — precedent followed for land-only
  placement; its explicit warning against adding a new rung to daemon discovery or the conductor
  plan gate is respected.
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` — **amended, not silently contradicted**,
  by `adr-2026-08-23-criterion-layer-is-structural-at-land`. The amendment is narrow and reasoned:
  signal-gating fits a row class tracking a genuine variable; it cannot fit one tracking something
  every engaged spec always has, because the only available signal is circular.
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — relevant to the remedy path. When
  this gate rejects, the fix is a DECIDE-time amendment of the plan/stories/coherence artifact. No
  plan task may be emitted to mutate a DECIDE artifact.
- `adr-2026-07-26-daemon-decide-preseed-ownership` — respected. No new DECIDE *step* is introduced;
  the enforcement lands in `landSpec`, which the daemon does not execute.

**Pattern consistency:** the design introduces no new concept. Quote grounding reuses the citation-
grounding pattern already load-bearing in `acceptance_specs`; layer engagement reuses
`resolveRequiredLayers`; deferral reuses the existing waiver mechanism.

**Backwards compatibility at BUILD (operator-directed, binding):** all added strictness is confined
to `runCoherenceGate`, whose only non-test caller is `land-spec.ts:347`. The discovery-side check
`hasCoherenceTableDataRow` (`daemon-backlog.ts:1018`) is **not** modified, so merged and parked
specs carrying zero criterion rows remain valid and continue to build. `prd_audit` already consumes
the mapping conditionally and that tolerance is preserved. This is a condition on the
implementation, recorded below.

**Diagram accuracy:** `.docs/architecture/coherence-rows-assert-story-task-coverage-that-not.md` and
its sequence file were authored for this feature and reflect the approved design, including the
removal of the CLI primitive the operator declined. Both render clean under
`conduct-ts render-diagrams --check`.

## Domain Integrity

| Principle | Assessment |
|---|---|
| No primitive obsession | The disposition and verdict fields are closed vocabularies and must be modelled as unions, not bare strings. Recorded as a condition. |
| Parse, don't validate | The coherence artifact is parsed once into typed rows; downstream layers consume the parsed shape. Matches the existing `parseCoherenceArtifact` structure. |
| Invalid states unrepresentable | The existing `NEGATIVE_VERDICTS` set treats any unrecognized verdict string as affirmative — an invented verdict silently passes today. The new fields must not repeat this: an unrecognized disposition must be rejected, not defaulted. Recorded as a condition. |
| Semantic types | Row classes and dispositions answer "what IS this", not "what is this like". |
| Exhaustive matching | Layer dispatch must handle the new class explicitly with no catch-all default. |

## Wiring Surface

Every new production surface and where it will be called from:

| New surface | Production caller (design-time commitment) |
|---|---|
| `criterion` entry in the structural layer set | `resolveRequiredLayers` in `coherence-validator.ts`, already called by `runCoherenceGate` |
| `criterion` row class in the row parser | `parseCoherenceArtifact`, already called by `runCoherenceGate` |
| `checkCriterionCoverage` layer (one-to-one set difference) | `validateCoherence`, dispatched by layer name alongside the existing layers |
| Quote-grounding check | Invoked from the same `checkCriterionCoverage` layer |
| Diff-locality disposition check | Invoked from the same `checkCriterionCoverage` layer |
| Task-body extractor in `plan-task-parse.ts` | `checkCriterionCoverage`; the module is already imported by `coherence-validator.ts` for `parsePlanTaskPaths` |
| New gap ids | `evaluateCoherenceWaiver` in `coherence-waiver.ts`, already called by `runCoherenceGate` |
| Conditional `acceptance_specs` halt message | `groundDispositionOnlyEvidence` in `artifacts.ts`, already on the `acceptance_specs` completion path |

No surface is a new entry point: every one hangs off a function already reached from
`landSpec` or the `acceptance_specs` completion predicate. This is a design-time commitment and does
not substitute for the §12 as-built reachability sweep.

**Early overlap scan (advisory):** `conduct-ts overlap-scan` over the six candidate paths reports
overlaps on `coherence-validator.ts` with roughly 30 open and remote spec branches. The signal is
low — the breadth suggests base-diff noise rather than genuine concurrent edits to the validator.
Recorded, not acted on; it does not affect the verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A stricter land gate blocks specs sitting mid-DECIDE when this ships | Integration | Medium | Medium | Land-only placement bounds it to mid-DECIDE specs; rejection names the missing criteria; the existing waiver absorbs deliberate deferrals |
| Quote grounding is satisfied by quoting an irrelevant span of the correct task | Knowledge | Medium | Low | Accepted by design — the check bounds sloppiness, not bad faith; `prd_audit` remains the satisfaction authority |
| Diff-locality disposition is mislabelled by the author | Knowledge | Medium | Medium | Forcing an explicit per-criterion answer is the intervention; a mislabelled criterion still fails later, as it does today |
| Added ceremony (two fields per criterion row) degrades authoring throughput on M/L specs | Technical | High | Medium | Rows are mechanically enumerable from the stories file; the land rejection names exactly what is missing rather than requiring a re-read |
| The new verdict/disposition vocabularies inherit the existing silent-pass defect for unrecognized strings | Technical | Medium | **High** | Condition C2 below — unrecognized values must be rejected, never defaulted to affirmative |
| Plan edits during DECIDE invalidate previously valid quotes | Technical | Medium | Low | Re-running the gate reports the stale quote by criterion and task; no silent staleness |

## ADRs Created

Three, all APPROVED by the operator on 2026-08-23, each covering a distinct uncovered structural
decision:

1. `adr-2026-08-23-criterion-layer-is-structural-at-land` — layer engagement and the narrow
   amendment to adr-2026-08-09; binds all strictness to land and forbids touching the discovery check.
2. `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` — the authoring-judges /
   engine-verifies split that makes a coverage claim falsifiable with no model at land.
3. `adr-2026-08-23-diff-locality-is-an-authored-disposition` — diff-locality as an authored
   disposition rather than a detected property, with the deferral path through the existing waiver.

No existing ADR governs any of the three; each was checked against the full `.docs/decisions/`
corpus before drafting.

## Conditions

- **C1 — Backwards compatibility at BUILD is binding.** `hasCoherenceTableDataRow` and the
  discovery-side coherence check in `daemon-backlog.ts` must not be modified. A test must assert
  that a coherence artifact with zero `criterion` rows remains valid at discovery and that a merged
  spec lacking them is not blocked.

  > **Amended 2026-08-26 by #1881:** C1's intent (a merged spec valid at discovery keeps
  > building) is binding; its mechanism is not. `adr-2026-08-26-shared-coherence-parser-at-discovery`
  > deletes `hasCoherenceTableDataRow` and routes discovery through the shared parser after the two
  > predicates' divergence stranded a merged spec. The zero-`criterion`-rows test remains required.
- **C2 — No silent affirmative default.** The new verdict and disposition fields must reject
  unrecognized values rather than treating them as affirmative, unlike the existing
  `NEGATIVE_VERDICTS` behavior. Both vocabularies are closed unions.
- **C3 — Every new refusal is waivable.** Each rejection class introduced here must carry a stable
  gap id registered in the coherence waiver vocabulary, per
  adr-2026-07-22-coherence-waiver-and-duplicate-claim.
- **C4 — The `acceptance_specs` halt message is conditional.** It may name the DECIDE-time criterion
  check only when the spec's coherence artifact actually carries criterion rows; specs landed before
  this ships keep today's message.
- **C5 — No new rung in discovery or the conductor plan gate.** Per
  adr-2026-08-21-review-bound-by-plan-done-when-criteria D1, enforcement lands in `landSpec` only.
- **C6 — The remedy path stays in DECIDE.** No plan task may be emitted that mutates a DECIDE
  artifact to satisfy this gate, per adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.
- **C7 — #1744 subsumption is recorded.** The stories must state that this feature covers #1744's
  mechanism so the issue can be closed as covered when this ships.

## Assumptions surfaced (verify-claims protocol)

| Assumption | Confidence | Basis | Impact if wrong | Confirmation |
|---|---|---|---|---|
| `runCoherenceGate` has exactly one production caller (`land-spec.ts:347`) | 95% | verified — grep over `src/`, all other hits are tests | The whole backwards-compatibility argument collapses; a stricter layer would re-grade merged specs | Confirmed before implementation by re-running the caller grep |
| Discovery's coherence check is independent and shallow (`hasCoherenceTableDataRow`) | 95% | verified — read `daemon-backlog.ts:1015-1035` including its explanatory comment | Merged/parked specs could be blocked at BUILD | C1's test makes this executable rather than assumed |
| `extractAuthoritativeStoryCriteria` is reusable unchanged at land | 95% | verified — read the function; it is pure over `storiesText` | A second extractor would be needed, reintroducing the disagreement this design removes | Implementation imports it directly; no fork permitted |
| A task-body extractor is a small addition to `plan-task-parse.ts` | 90% | inferred — read `parsePlanTaskDoneWhen` and `parsePlanTaskPaths`, which already split on `TASK_HEADER_PATTERN` | Quote grounding gets more expensive but remains feasible | Settled in the first implementation task |
| `prd_audit` tolerates a coherence artifact with no criterion rows | 90% | verified — `skills/prd-audit/SKILL.md:35` reads "where a committed coherence mapping exists" | A SHIP-phase break on legacy specs | C1 covers discovery; prd_audit's conditional wording is prose and must not be tightened |

No unconfirmed load-bearing assumption remains. The one genuine fork — structural versus
signal-gated engagement, and its BUILD-phase compatibility requirement — was put to the operator and
resolved before any ADR was written.

## Blocking Issues

None.
