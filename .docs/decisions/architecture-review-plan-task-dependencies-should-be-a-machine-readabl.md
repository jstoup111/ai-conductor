# Architecture Review: Plan task structure becomes one strict compiled contract (#623)

**Date:** 2026-10-10
**Stories reviewed:** none yet (pre-stories full pass, Tier L, technical track)
**Inputs:** `.docs/track/plan-task-dependencies-should-be-a-machine-readabl.md`,
`.docs/complexity/plan-task-dependencies-should-be-a-machine-readabl.md`,
`.docs/architecture/plan-task-dependencies-should-be-a-machine-readabl.md`
**Verdict:** APPROVED WITH CONDITIONS

Two delegated read-only passes informed this review: a parse-site and ADR inventory, and an
adversarial feasibility attack on the approved design. Their findings are folded in below, and
the structural decisions they forced are recorded in
[adr-2026-10-10-single-two-mode-plan-compiler](adr-2026-10-10-single-two-mode-plan-compiler.md).

## Feasibility

- **Stack:** pure TypeScript inside `src/conductor/src/engine`; no new package, service, or
  infrastructure. (verified, 95%)
- **Prerequisites:** none. The shared id grammar (`TASK_ID_PATTERN`) and reference resolver
  (adr-2026-08-30-shared-plan-task-reference-resolver) stay as they are and are reused.
- **Integration surface:** wide. About 51 shared-parser call sites across about 33 engine files,
  plus about a dozen ad-hoc task-heading regexes that disagree with the shared grammar (listed in
  the ADR's Context). This crosses land, discovery, the seal, remediation, build progress,
  evidence and park, build_review, and the coherence, coverage, prd_audit, and as-built
  projections. (verified by grep, 90%; a site that dodges the greps could be missing)
- **Data:** no schema or persisted-state change. Persisted values derived from plan text today,
  such as the stored authored-task count `storedGrowth.authored` (`kickback-budget-cli.ts`),
  stay correct only because legacy mode reproduces today's count exactly (ADR decision 4).
- **Performance:** compilation is linear in plan size, and the in-process memo removes repeat
  parses. Not a risk.
- **Worktree isolation:** nothing is written to disk; each process memoizes independently. No
  shared state.

## Complexity

High (Tier L): a cross-cutting migration of every consumer onto one module, with an
exact-equivalence obligation per legacy consumer. Splitting into slices is recommended. A
reasonable cut is: the compiler with legacy views and pinning tests; then consumer migration;
then strict mode, the marker, and its refusal points; then the `/plan` skill contract.

## Alignment

- **Applies** adr-2026-08-30-shared-plan-task-reference-resolver: cited references still resolve
  through the one resolver, which now draws its id set from the compiler.
- **Applies** adr-2026-09-29-plan-slice-manifest and
  adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility: the `## Slices` manifest
  grammar and one-story-per-line rule are absorbed into the compiler unchanged, for both modes.
- **Applies** adr-2026-09-06-reopened-task-resolution: digests for unmarked plans stay
  byte-identical, so the reopen flow is unaffected by upgrade.
- **Respects** the protected-artifact seal ADRs (rebaseline, self-amendment visibility, operator
  reseal): the seal keeps its append-only, task-headings-only tail rule and only sources ids from
  the compiler.
- **Respects** adr-2026-08-02 and adr-2026-08-09 plan-scope containment: declared paths come from
  the compiler; containment semantics are unchanged.
- **Event spine:** no new channel. Legacy-mode use and strict compile errors are reported through
  existing halt, warn-skip, and blocked-reason paths. Any new observability must ride
  `ConductorEvent`.
- **Diagram accuracy:** the approved diagram shows the compiler, its two modes, the refusal points,
  and the build consumers. It omits the legacy *views* and the build-time halt; condition C5
  requires updating it.
- **Security boundaries:** no new input surface. Plans are already trusted repository artifacts.

## Domain Integrity

- **Invalid states unrepresentable:** the compile result is a discriminated union
  (`compiled` with frozen tasks, or `errors` with a non-empty list), never an empty map that
  means "failed". The mode is an enum (`strict` | `legacy`), not a boolean. A task's class is an
  enum (`authored` | `remediation`), and its required fields differ by class.
- **Parse, don't validate:** the compiler is the single parse point; consumers receive typed
  tasks and never re-check heading shape.
- **Semantic types:** task ids keep the existing H9 grammar type; dependency edges reference task
  ids, not raw strings.
- **Exhaustive matching:** consumers switch on the compile result kind and on the mode with no
  default branch.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| Plan compiler `compile(planText)` + typed result | Every consumer listed in the ADR's Context; nothing else recognizes a task heading |
| Legacy views (one per current consumer interpretation) | Called by the consumer whose behavior each preserves, for unmarked plans |
| Strict compile errors at land | `engineer/land-spec.ts`, replacing its separate Done-when, task-count, and slice validator calls |
| Strict compile errors at discovery | `daemon-backlog.ts` eligibility vetting, beside the existing `planHasDependencyTree` path kept for unmarked plans |
| Build-time compile-failure halt | Task seeding (`task-seed.ts`) reached from the `build` completion predicate in `artifacts.ts`, the dispatch-boundary seeding in `build-review-halt-render.ts`, and `repair-restage.ts`; the conductor turns the typed failure into one `needs-human` halt |
| Format marker stamp | `skills/plan/SKILL.md` authoring contract (shipped) |
| Remediation-class rendering + recompile | `remediation-append.ts` / `remediation-task-append.ts` append path called from `conductor.ts` |
| Seal id sourcing | `protected-artifact-seal.ts` `isEngineAppendedRemediationAmendment` |

**Overlap scan (advisory):** `ai-conductor overlap-scan` found only `conductor.ts` shared with
`origin/spec/daemon-self-host-guardrails` and `origin/spec/self-host-phase6-wiring`. No other
unmerged work touches the wiring paths.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A legacy view's output differs from today's consumer for some unmarked plan, flipping an in-flight verdict | Technical | Medium | High | C1: equivalence tests pin each legacy view against its pre-change implementation over the committed plan corpus |
| Task digests for unmarked plans move, reopening finished tasks | Data | Low | High | C1 includes byte-identical digest pinning over the corpus |
| A missed ad-hoc parse site keeps its own regex | Technical | Medium | Medium | C2: a mechanical audit test refuses task-heading regexes outside the compiler |
| Strict mode refuses a legitimate shape the current `/plan` skill produces (slices, verify-only, `**Type:** verification`, `rem-*` ids, `Files: none`, `same as Task N`) | Technical | Medium | Medium | C3: strict-mode acceptance tests over the skill's own examples |
| A consumer treats a compile failure as an empty plan, recreating #578-class false parks | Technical | Low | High | ADR decision 6; result type has no empty-on-failure shape |
| Marker removal by an operator reseal silently downgrades a plan to legacy | Knowledge | Low | Medium | Documented in the ADR; reseal shows the diff. Accepted |
| Consumer repos that skip engineer land meet strict errors only at discovery | Integration | Medium | Low | Discovery names every error in the blocked reason |

## ADRs Created

- [adr-2026-10-10-single-two-mode-plan-compiler](adr-2026-10-10-single-two-mode-plan-compiler.md),
  APPROVED by the operator (option C, legacy views preserved) in the composer session.

## Conditions

- **C1, legacy equivalence is pinned, not assumed.** For every legacy view, a test compares its
  output with the pre-change implementation of the consumer it replaces, over every committed
  plan under `.docs/plans/` plus fixtures for the known divergent shapes (multi-id headings,
  bare `Task N`, `T<n>`, em-dash separators, `## Task Dependency Graph`, fenced headings, and
  trailing plan-level sections). Digests are compared byte for byte.
- **C2, the single-owner rule is enforced mechanically.** A test fails if any engine source file
  other than the compiler module matches task headings or per-task plan fields.
- **C3, strict mode accepts what `/plan` produces.** Every task example in `skills/plan/SKILL.md`
  compiles cleanly in strict mode once marked. The shipped skill states the strict grammar and
  stamps the marker.
- **C4, every strict refusal names its errors.** Land, discovery, and the build-time halt each
  report line, task, and rule for every compile error.
- **C5, the diagram is updated** to show the legacy views and the build-time compile-failure halt
  before stories are approved.
- **C6, follow-up is filed.** An intake issue is filed to delete legacy mode once no unshipped
  unmarked plan remains. That deletion is out of this feature's scope.

## Blocking Issues

None.
