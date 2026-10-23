# Architecture Review: Remediation tasks close on a reported commit that never implemented them
**Date:** 2026-10-21
**Stories reviewed:** none yet (pre-stories, technical track); input is the explore decision, the
track scope boundary, the approved sequence
`.docs/architecture/sequences/remediation-tasks-close-on-a-reported-commit-that-.md`, and the landed
#3200 citation judgement it is reconciled with (operator re-approval 2026-10-23)
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Reuses the auxiliary provider path (`executeAuxiliaryProviderCandidates` inside `dispatchProviderWithLifecycleSupervision`, with a policy resolved from a step's configuration as `dispatchRebaseRegradeJudgement` does), the read-only review capability, native output schema, the repair obligation store, and the engine-state serialized update seam. |
| Prerequisites | #3200's citation judgement boundary (merged, #3357). The dispatch port is optional, as `dispatchDoneWhenCitationJudgement` is, so runners without it record candidates unjudged. |
| Integration surface | Engine-internal: the conductor's BUILD session boundary, a step runner port, the stall detector, retry hints, the event union and sinks. No skill, CLI, hook, settings or persisted task-status format change. |
| Data implications | Additive versioned engine-state section for verdicts; one new obligation source authority. No migration. |
| Performance risk | One provider call per BUILD session end that has newly closed `rem-*` tasks; diff input bounded at 48,000 bytes. No call when there are no candidates or the worktree is dirty. |
| Worktree isolation | The judge reads the feature worktree under the provider's read-only review capability; no shared port, DB or file. |

## Alignment

- **Design principle.** "Is this repair present?" is a judgement; machinery owns candidate
  selection, input scoping, bounds, persisted verdicts and the reopen, with a closed-schema verdict.
- **Local pattern basis — BUILD-boundary judgement.** Precedent: the #3200 citation judgement
  (`done-when-citation-judgement.ts`, the `step.name === 'build'` block before `checkStepCompletion`
  in `conductor.ts`, `StepRunner.dispatchDoneWhenCitationJudgement`). Traits to preserve: an engine-built input projection; one engine-rendered dispatch with `readOnlyReview` and `nativeSchema`;
  retry once inside the port; closed-key validation that rejects missing or extra ids; a reopen
  through a repair obligation that overrides completion with a fixed reason prefix; one spine event
  per pass. Allowed variation: the provider policy is resolved from `build_review`'s configuration rather than BUILD's, so the builder does not grade its own work, while the dispatch stays supervised and attributed as BUILD activity (the `dispatchRebaseRegradeJudgement` policy pattern); the terminal disposition of an exhausted task is to stand
  closed (`bound-exhausted`) rather than demote to `unverified`, because remediation checks are
  untagged and `prd_audit` already re-grades them.
- **Local pattern basis — BUILD-internal reopen.** Precedents: `plan_amendment`
  (`adr-2026-09-06-reopened-task-resolution` decision 11) and `done-when-citation` (decision 13).
  Traits: settled at admission, no lap, no governing review of its own, one live obligation per task.
- **Local pattern basis — exempted BUILD retry.** Precedent: the `Done-when citation refused:` and
  `unverified Done-when checks require one BUILD review pass:` prefixes exempted in
  `isNoTaskProgressBuildStall`. Traits: fixed reason prefix, stall exemption, retry only while an
  attempt remains.
- **ADRs.** No APPROVED ADR is contradicted once this change's amendments land:
  `adr-2026-09-06-reopened-task-resolution` gains decision 14 for the new source;
  `adr-2026-08-22-done-when-evidence-at-task-close` gains D19, which places this judgement after D13
  and qualifies D8's completion sentence; `adr-2026-08-22-one-owner-per-review-question` records the
  reviewer on the *Did BUILD finish each task?* row. `adr-2026-10-07-per-child-build-region` D6
  defines the per-child task scope the predicate counts; this judgement withholds hand-off inside
  that scope exactly as the citation refusal does, so it needs no amendment. Plan-growth ADRs are
  untouched (no appended task). `prd_audit` at SHIP remains the completion authority.
- **Event spine.** One new `ConductorEvent` variant for the occurrence; verdict records are durable
  state under exception C. No sidecar, poller or stamped artifact.
- **Scope check.** A: consumer-facing behavior (the remediation flow runs in every engine build, not
  behind `isSelfBuild()`), but the change itself is engine code with no instruction-file or skill
  edit. B: no skill. C: provider-agnostic through the auxiliary provider path, gated on a declared native-schema capability.
- **State management.** Verdict is a closed enum (`resolved | persists | partial`) plus engine-only
  `unjudged`; outcome is `judged | unjudged`; no boolean-flag state.
- **Security / DI.** No endpoint or user input. The judge runs under the probed read-only review
  capability; the persistent engine-state store is the production default.

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| Remediation-closure judgement module (candidate selection, close identity, input build, closed-schema validation, verdict and reopen application) | The conductor's BUILD session boundary block, after the citation judgement and before `checkStepCompletion` |
| `StepRunner.dispatchRemediationClosureJudgement` optional port and its `step-runners.ts` implementation | Called by the conductor in that block, as `dispatchDoneWhenCitationJudgement` is |
| `remediation-closure` obligation authority | Admitted by the judgement module through `createRepairObligationStore`; read by the existing resolver, seeding and startup hint recovery |
| Engine-state verdict section | Read and written by the judgement module through the engine-state serialized update seam |
| Fixed completion-reason prefix `Remediation closure reopened:` | Exempted in `build-progress-watcher.ts`'s `isNoTaskProgressBuildStall`; carried in the BUILD retry hint and rebuilt on startup from open obligations |
| `remediation_closure_judged` event | Emitted by the conductor through `emitTracked`; declared in `event-sinks.ts` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A wrong `persists` verdict spends BUILD attempts | Technical | Medium | Medium | Two reopens per task; reopen only while an attempt remains; then hand off |
| Persistent provider fault silently disables the check | Integration | Low | Medium | Retry once; `unjudged` outcome on the event spine; downstream gates unchanged |
| Vague plan blocks give weak verdicts | Knowledge | Medium | Low | Downstream gates remain the backstop; A1 approved |
| Re-judging loops on unchanged closes, or after a rebase | Technical | Low | Medium | Verdict keyed to a close identity that excludes rebased SHAs; no re-judge until a new close |
| Both BUILD-boundary judgements reopen one task in one pass | Technical | Low | Medium | Candidates exclude tasks with a pending citation or open citation obligation |

## ADRs Created

- `adr-2026-10-21-remediation-closure-judgement` — APPROVED (operator, 2026-10-21; reconciled design
  re-approved 2026-10-23).

## Plan size estimate

14 tasks in the authored plan; under the 20-task split threshold. No split proposed.
