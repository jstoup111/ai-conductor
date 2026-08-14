# Architecture Review: build_review rubric dispositions and independent evaluation

**Date:** 2026-08-13
**Stories reviewed:** PRD FR-1 through FR-25 and accepted Stories 1 through 25
**Tier:** Large
**Verdict:** APPROVED

## Feasibility

The design is feasible in the current Node.js/TypeScript engine without a new dependency, external
service, database, network API, port, or container. It reuses the existing concurrency semaphore,
provider-aware candidate executor, provider-local session scopes, host-specific skill invocation,
machine identity, atomic filesystem writes, and external-process event ledger.

The key implementation constraint is that rubrics are not lifecycle steps. The existing dispatched
group member path casts a member name to `StepName`; build review must add a typed auxiliary branch
adapter rather than fabricate five steps or write synthetic conduct-state keys. This is bounded and
compatible with the group core's existing callback/native seams.

Data changes are versioned `.pipeline` JSON only. Legacy aggregate verdicts remain readable under
their current fail-closed contract and cannot be treated as disposition-aware. No backfill is
required.

Default execution can increase one grader call to five simultaneous calls. The default cap of five,
shared rate-limit episode, branch-specific recovery budgets, and provider-attributed usage make this
bounded and observable. Lower configured caps preserve semantics.

The preceding content-addressed `test_suite` proof already establishes current HEAD as green, so a
second HEAD-scoped run is unnecessary. The Tautology-only RED counterfactual is feasible through a
disposable engine-owned checkout with changed tests retained and merge-base production substituted.
The implementation must inject checkout materialization and scoped execution, verify that neither
live checkout changes, and classify setup/cleanup failure as infrastructure rather than a rubric
finding.

The concrete provider-neutral boundary is a disposable Git worktree nested below the configured
scoped-test working directory's ignored `.pipeline/build-review-preflight/` path. This preserves
ordinary upward dependency discovery into the already-installed live environment while isolating
tracked source bytes. A pure diff-path classifier derives changed-test selectors and the
complementary production patch; unknown/empty selection never widens to the aggregate runner.
Exact-input preflight caching is required before rubric-cache lookup because the RED evidence
participates in the Tautology projection.

Per-rubric caching is feasible as bounded feature-local state. Its safe boundary is a semantic
judged result keyed by closed contract/projection versions, canonical permitted-input digest, and
resolved execution policy. A hit is re-materialized as a fresh current-lap branch artifact and
rejoined; therefore provider work may short-circuit without reusing a stale verdict artifact.

Worktree isolation is sound: branch artifacts and dispositions live under the feature worktree's
`.pipeline`; no shared database, server, socket, or fixed port is added. Provider-local scratch and
session rules remain governed by their approved ADRs.

## Complexity

Implementation complexity is **High**, matching the confirmed **Large** lifecycle tier. The feature
crosses configuration, provider execution, concurrency, artifact/state, CLI authorization, event,
reporting, and publication boundaries. Splitting it into separate product features would leave either
unconfigurable fan-out or dispositions without stable branch identity; the architecture instead
splits the implementation into two explicit ADR-owned domains.

## Alignment

- Supersedes the single-grader execution topology in
  `adr-2026-07-07-build-review-judgement-gate` while preserving its engine-owned input and verdict
  trust boundary.
- Partially supersedes only the execution-topology and unconditional-enable clauses in the approved
  Completeness and Wiring ADRs; their rubric meanings remain authoritative.
- Reuses `adr-2026-07-10-concurrent-group-core`; no second semaphore or concurrency engine.
- Reuses `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`; every rubric/provider
  attempt remains isolated and provider-native.
- Reuses `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`; rubric skills remain one
  provider-agnostic catalog with candidate-local host syntax.
- Reuses `adr-2026-07-01-machine-scoped-operator-identity` and
  `adr-2026-08-09-operator-only-scoped-artifact-reseal` for identity and the TTY boundary.
- Reuses `adr-2026-08-08-pipeline-owned-closeout-timestamps` for separate-process same-schema event
  writes and `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` for standalone command
  event routing.
- Preserves session-fresh and code-valid verdict rules. Dispositions never turn a missing, malformed,
  stale, or infrastructure-failed verdict into a pass.
- Preserves the scoped-test and full-suite contracts: `test_suite` remains the single green
  checkpoint, while build review runs only Tautology's isolated reverted-production counterfactual.
- Leaves the operator-identified future Tautology/Scope claim-or-bypass work undesigned. Stable raw
  finding anchors and a typed post-judgement reducer boundary are the only compatibility commitments;
  claims cannot enter rubric prompts or raw-result cache keys.
- Satisfies repository scope placement: five consumer-facing provider-agnostic skills belong in
  `skills/`; engine mechanics remain repository implementation.

The approved diagrams are accurate with one reviewed refinement: the operator command reuses
`.pipeline/pipeline-events.jsonl`; it does not introduce an operator-specific third event file.

## Domain Integrity

- Use closed semantic types for `RubricId`, `RubricContractVersion`, `LapId`, `FindingId`,
  `FeatureIdentity`, and `OperatorIdentity`; do not pass these as interchangeable raw strings.
- Model branch completion as the exhaustive union `skipped | judged | infrastructure-failure`, not
  pass/fail/error boolean combinations. `skipped` itself has the closed reasons `disabled` and
  Wiring-only `missing-entry-points`; neither is a pass.
- A judged result derives pass from an empty finding collection; it cannot represent `pass` with
  blocking findings.
- Model finding identity as rubric-specific discriminated anchor payloads. A free-form identity key,
  summary hash, or catch-all anchor type is vetoed.
- Parse config, branch artifacts, legacy aggregate evidence, and disposition state once at their
  boundaries. Downstream code consumes trusted domain values.
- Exhaustively match every rubric, branch outcome, disposition refusal, and event variant; no
  default branch may silently accept a future variant.
- Keep raw judgement and effective disposition state distinct. Accepted is neither skipped nor
  passed by the grader.

## Wiring Surface

| New or changed production surface | Production entry and caller commitment |
|---|---|
| `build_review.rubrics` and `maxParallel` config | Parsed by `validateConfig`, resolved by the build-review resolver, and consumed by the existing `build_review` dispatch path |
| Five shipped rubric skills | Installed through the canonical skill installer/model-table catalog and invoked by the rubric adapter through candidate-local skill rendering |
| Rubric registry and immutable snapshot | Called only from `DefaultStepRunner`'s existing `runBuildReview` entry after fresh-base/input assembly |
| Tautology RED preflight | Called by the coordinator after current `test_suite` proof validation and before Tautology projection; uses an injected isolated-checkout/scoped-runner boundary |
| Closed rubric projections and semantic cache | Coordinator derives the only model-visible inputs, checks bounded per-rubric state, and re-materializes current-lap artifacts on hits |
| Typed auxiliary group branch adapter | Called by the build-review coordinator; internally uses the shared group-core semaphore and provider-aware execution resolver |
| Per-lap rubric result artifacts | Written by exactly one rubric session each and read/validated by the single-writer build-review join |
| Stable finding canonicalizer | Called by the join before aggregate publication and by no model-facing path |
| Disposition store and state lock | Called by aggregate completion/failure rendering, the operator CLI, reporting publication, and shipped-record projection |
| `build-review findings` / `accept` CLI family | Detected and dispatched from `conduct-ts`'s pre-boot command table; resolves feature worktrees and machine identity before mutation |
| Rubric/disposition/effective-verdict events | Emitted by coordinator or CLI, declared in `ConductorEvent`/event sinks, rendered by daemon/UI/OTel subscribers as configured |
| General external-event writer and tail | Replaces the closeout-only type restriction, retains `.pipeline/pipeline-events.jsonl`, and is started for the feature event-bus lifetime |
| Merged feature-event reader | Called by report, KPI, dashboard, and build-tail consumers instead of direct one-file reads where these events matter |
| Accepted-risk publication renderer | Called by finish publication for retained-PR upsert and by shipped-record construction from the same disposition data |
| User-facing documentation | Config, CLI, skill, step, and gate reference pages updated from their existing indexes; README unchanged unless its landing contract changes |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Two materially different concerns canonicalize to one accepted identity | Data | Low | High | Rubric-specific typed anchors, contract versions, full-payload comparison, duplicate-ID fail-closed tests |
| Operator accepts a finding after the inspected lap was replaced | Data | Medium | High | Shared exclusive state lock and exact lap/finding compare before atomic write |
| Cross-provider model/session state leaks between rubric branches | Technical | Low | High | Existing provider-aware resolver and fresh branch/provider scope; no rubric-local provider stack |
| External event writers interleave or readers omit operator events | Integration | Medium | High | General locked external writer plus one merged feature-event reader; malformed lines fail closed |
| Five default calls amplify cost or rate limiting | Performance | Medium | Medium | Default cap five, configurable lower cap, shared rate-limit episode, per-rubric attribution |
| Reverted-production preflight mutates a live checkout or leaks a subprocess | Data | Low | High | Disposable checkout only, injected runner, bounded cleanup, and byte-invariance tests for feature/root worktrees |
| Preflight selector derivation misses a changed test or widens to the aggregate suite | Data | Low | High | Closed affected-test path rules, explicit unknown/empty outcome, scoped-run empty guard, and no aggregate fallback |
| An incomplete cache projection reuses a result after a relevant input changed | Data | Low | High | Skills receive only closed versioned projections; every permitted field is canonicalized into the digest; unknowns miss closed |
| Cache reuse violates per-attempt verdict freshness | Technical | Low | High | Cache only semantic results; stamp and validate new current-lap branch and aggregate artifacts on every hit |
| Accepted risk is omitted from PR or shipped record | Integration | Medium | High | One deterministic renderer/upsert from disposition state; known unrenderable acceptance blocks publication |
| New skills or config drift from generated documentation | Technical | Medium | Medium | Model-table generation, skill/frontmatter integrity checks, canonical docs in the same PR |
| Core-file collision with active spec branches causes rebase churn | Integration | High | Medium | Isolate new modules, keep shared-file edits narrow, re-run overlap scan before plan/implementation batches |

## Early Overlap Scan

The advisory `conduct-ts overlap-scan` completed. It reported broad overlap across active spec
branches on the shared configuration, conductor, provider/group, event, finish, and documentation
surfaces. Representative reported branches include `spec/647-kickback-evidence-invalidation`,
`spec/651-park-all-dispatch-paths`, and
`spec/7b-adr-approved-before-writing-system-tests-is-onl`. This does not block DECIDE, but the plan
must isolate new modules, stage shared-file edits deliberately, and re-run the scan before BUILD.

The required post-plan rescan completed over the exact 40-task file union and reported advisory
overlap with 30 unmerged spec branches. The plan satisfies the mitigation by putting rubric domain,
projection, preflight, cache, identity, disposition, and accepted-risk policy in isolated modules;
shared config/group/event/CLI/publication files are separated into narrow dependency-ordered tasks
and rescanned at every batch boundary.

## ADRs Created

- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — APPROVED
- `adr-2026-08-13-stable-build-review-finding-dispositions` — APPROVED

No new event-channel ADR is needed: the approved external-process ledger pattern already governs the
standalone CLI writer. No new provider or concurrency ADR is needed: the existing resolver and group
core remain authoritative.

## Approval Resolution

The operator approved both ADRs and the later Tautology-preflight/cache amendments on 2026-08-13,
and the original 2026-07-07 single-grader ADR is now
superseded. The implementation plan must preserve the typed auxiliary branch boundary; fabricating
rubric `StepName`s or grader-owned subagents reopens architecture. It must also include fail-closed
identity-collision, stale-lap, legacy-verdict, infrastructure-failure, and publication-omission tests.
It must additionally cover live-checkout invariance, RED/green classification, cache invalidation,
zero-provider cache hits/skips, and current-lap rematerialization. The future Tautology/Scope
claim-or-bypass feature is a compatibility dependency, not implementation scope.

## Blocking Issues

None. The verify-claims pass found no unconfirmed load-bearing technical assumption.

## Post-Plan Architecture Re-review

**Date:** 2026-08-13
**Verdict:** APPROVED

The 40-task plan preserves both approved decision boundaries. Tasks 1-28 implement the engine-owned
source snapshot, closed projections, isolated/cached RED preflight, typed auxiliary group execution,
write-disjoint branch artifacts, stable finding identity, and fresh aggregate join without creating
rubric `StepName`s. Tasks 29-33 keep operator disposition state behind one exact-lap transaction.
Tasks 34-39 extend the existing event, reporting, PR, and shipped-record seams, and Task 40 proves
composition with faithful fakes.

The re-review corrected two plan-level details before approval: Task 10 now names the real generated
model-table test paths, and Tasks 14-15 now own closed selector/production-patch derivation plus a
bounded exact-input preflight cache. Those changes eliminate the only uncovered wiring assumptions.
No task writes a parallel event ledger, exposes disposition/claim state to graders, reuses an old
aggregate verdict, mutates a live checkout for RED evidence, or designs the future Tautology/Scope
claim-or-bypass mechanism. The post-plan overlap scan is advisory-high but explicitly mitigated by
new isolated modules, narrow shared-file tasks, and batch-boundary rescans.
