# Architecture Review: Tasks close with boilerplate Done-when evidence; missing tests surface as prd_audit laps
**Date:** 2026-10-02
**Mode:** Lightweight (Medium tier) — Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** `.docs/track/tasks-close-with-boilerplate-done-when-evidence-mi.md`, `.docs/complexity/tasks-close-with-boilerplate-done-when-evidence-mi.md`, `.docs/architecture/sequences/tasks-close-with-boilerplate-done-when-evidence-mi.md` (technical track; no PRD; stories not yet written)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Test references are verified by text: the existing batched HEAD reader (`readGitBlobs` in `git-blob-batch.ts`) reads the cited file at HEAD, and `parseCoversMarkers` (`covers-marker.ts`) is a text-only regex with no language or framework knowledge. Verified. |
| Prerequisites | None for the close, land, and nudge parts. The `prd_audit` input part depends on the in-flight feature `prd-audit-receives-bounded-inputs-and-returns-vali` (#2890), which replaces `prd_audit`'s inputs with an engine-owned versioned projection; this feature adds one field to that projection and must build after it ships (Condition 1). |
| Integration surface | Engine: plan Done-when parsing and the land shape gate, task close, the BUILD completion predicate and retry hint, remediation append, the `prd_audit` input projection, one `ConductorEvent`. Skills: `plan`, `pipeline`. Four engine areas, all already coupled through the plan task contract. |
| Data implications | Additive only: a `source` value (`verified`, `unverified`) on existing Done-when close records in `task-status.json`, a per-check reason on unverified records, and a nudge-spent flag in engine state. No migration; records written before this change read as today. |
| Performance | One HEAD blob read per tagged check at close. At most one extra BUILD turn per lap, only when unverified checks exist. |
| Worktree isolation | No new ports, services, or shared files. Paths resolve from the repository top level of the feature worktree, not the process working directory (`index.ts` passes `process.cwd()` as `projectRoot` today). |

**Verified seams.** `task-cli.ts` parses `--done-when <n>=<evidence>` with `^(\d+)=(.+)$`, so a `test:<path>::<title>` value needs no grammar change; `--reason` belongs to `--plan-gap` and cannot be combined with `--done-when`, so the unverified form is `--unverified <n>=<reason>`. `parsePlanTaskDoneWhen` keeps each check verbatim, so a leading `[test]` tag survives and the substring consumers (`coherence-validator.ts`, `architecture-obligation-coverage.ts`) keep matching. `validatePlanDoneWhen` checks only count and blank lines and is called from land. The completion predicate is `CUSTOM_COMPLETION_PREDICATES.build` in `artifacts.ts`; retry hints come from `buildRetryHint` in `conductor.ts`; no in-step nudge exists, so the nudge is a new predicate outcome over the ordinary retry hint. Task-to-criterion resolution is new but composes from existing parsers (`parsePlanTaskStoryIds` plus `extractStoryCriterionIds`). Remediation tasks for a `prd_audit` criterion are rendered by `buildRemediationDoneWhenChecks` in `remediation-append.ts`.

## Alignment

**Governing ADRs reused.** `adr-2026-08-22-done-when-evidence-at-task-close` owns task-close evidence and is amended additively (D5–D9). Constraints honored without amendment:

- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D1: land stays shape-only; the tag is planner judgement, never engine-classified.
- `adr-2026-07-21-demote-task-stamping-to-telemetry`, `adr-2026-07-22-per-task-work-happened-floor`: no trailer floor is added; verification reads the plan check and the cited file, never `Task:` trailers.
- `adr-2026-07-23-trailer-union-build-step-routing` D1/D4/D5: verification state does not enter `resolveTaskIds`; the predicate stays fail-closed on absent data.
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion`: the nudge withholds completion as routing only; a nudge turn that writes tests must commit them like any other turn.
- `adr-2026-07-12-progress-aware-build-halt` D1: unchanged for every other miss; the nudge is a distinct predicate outcome that does not increment `noEvidenceAttempts`, so an all-resolved build is never parked by it.
- `adr-2026-07-13-retry-classify-rerun-vs-route` D2: `build` stays outside the classifier.
- `adr-2026-09-06-reopened-task-resolution` D3/D4: the nudge-spent flag persists through the serialized engine-state seam; reopened tasks re-pass the tagged-check validation.
- `adr-2026-08-22-one-owner-per-review-question` D1: BUILD task close owns "did BUILD finish each task"; this feature stays inside that owner and adds no question to `build_review`.
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` D5 and `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: no new appender or plan-growth source; only the existing criterion-bound append gains the tag.
- `adr-2026-08-24-evidentiary-defects-are-not-waivable`: a malformed tag fails land with no waiver path.
- `adr-2026-09-06-engine-owned-test-quality-scope` D4: the file-level `Covers:` check is an acceptance bound for closing, not a test binding; test-quality scoping is untouched.
- `adr-2026-07-28-total-halt-classification-legacy-boundary`: no halt class is added.

**Event spine.** The still-unverified set at BUILD completion is an occurrence in time, so it is a new `ConductorEvent` variant with an `EVENT_SINKS` row, emitted in-process by the engine. The `task done` CLI is a separate process (spine exception A) and emits nothing; the durable close record stays in engine-owned task status (exception C). No sidecar or log line is added.

**Domain integrity.** The close-record `source` is a closed set (`verified`, `reported`, `verify-only`, `unverified`) matched exhaustively; the tag is a single literal, not a free-form attribute.

**Portability.** Every verification step is text over git blobs: no TypeScript AST (the `build-review-test-bindings` binder imports `typescript` and is not reused), no repository-specific path, and no test-framework assumption, so consumer projects get the same behavior.

**Rejected during review.** Routing still-unverified checks into the `build_review` testQuality rubric: the rubric is default-off for consumers (`adr-2026-08-22-build-review-opt-in-rubric-container` D1), skips on an empty test scope (D3), anchors findings only to changed test content (`adr-2026-08-16-closed-build-review-finding-vocabularies`), and excludes task-status data from its frozen inputs (`adr-2026-08-13-engine-managed-build-review-rubric-branches`). Making it work needs four further amendments and a Large tier; the operator moved it, with defaulting the rubric on, to a follow-up intake.

## Wiring Surface

| New production surface | Called from in production |
|---|---|
| `[test]` tag validation | The engineer `land` gate, beside `validatePlanDoneWhen` in `land-spec.ts` |
| Test-reference verification and the `unverified` close | `completeTaskDoneWhen`, reached from the `conduct task done` command in `task-cli.ts` |
| Task-to-criterion resolver | Test-reference verification (above) |
| Nudge outcome of the BUILD completion predicate | `CUSTOM_COMPLETION_PREDICATES.build`, consumed by the conductor retry loop and `buildRetryHint` |
| Unverified-checks `ConductorEvent` | Emitted by the conductor when BUILD completes with unverified checks; persisted by `EventPersister`; `EVENT_SINKS` row |
| Unverified records in `prd_audit` input | The engine-owned `prd_audit` input projection from #2890, assembled by the `prd_audit` step runner |
| Tagged remediation check | `buildRemediationDoneWhenChecks`, called by the existing criterion-bound remediation append in the conductor |
| Skill guidance | `skills/plan/SKILL.md` Done-when authoring; `skills/pipeline/SKILL.md` task close |

**Early overlap scan:** `ai-conductor overlap-scan` reported no overlap and no open blockers (renames and name-only diffs may not be detected). Known in-flight neighbours found by hand: #2890 (`prd_audit` inputs, Condition 1) and #2014 (`build-step-completes-with-every-plan-task-still-pe`, same completion predicate, Condition 2).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A planner forgets a `[test]` tag and a check still closes on boilerplate | Technical | Medium | Medium | Plan skill guidance; untagged checks behave exactly as today, so this is no regression; `prd_audit` remains the backstop |
| Agents use `unverified` as a new boilerplate escape | Technical | Medium | Medium | Per-check reason required; one nudge names each; the event and `prd_audit` input surface every use |
| The nudge collides with #2014's change to the same completion predicate | Integration | High | Medium | Condition 2: conflict-check orders the specs or merges the predicate change |
| `prd_audit` projection shape changes before this builds | Integration | Medium | Medium | Condition 1: build after #2890 ships; additive field only |
| Tagging criterion-bound remediation tasks blocks a repair whose gap is missing production code rather than a missing test | Technical | Low | Medium | The repair still needs a covering test for the criterion under the tdd `Covers:` rule; the unverified close remains available, so it cannot halt |

## ADRs Created

None. `adr-2026-08-22-done-when-evidence-at-task-close` is amended additively with D5–D9; decisions 1–4 stand.

## Conditions

1. The `prd_audit` input task depends on the shipped `prd-audit-receives-bounded-inputs-and-returns-vali` feature (#2890); the plan orders it last and adds only an additive projection field.
2. `/conflict-check` must resolve the interaction with #2014 on `CUSTOM_COMPLETION_PREDICATES.build` and on reopened-task close evidence before `/plan`.
