# Architecture Review: Remediation tasks close on a reported commit that never implemented them
**Date:** 2026-10-21
**Stories reviewed:** none yet (pre-stories, technical track); input is the explore decision, the
track scope boundary, and the approved sequence
`.docs/architecture/sequences/remediation-tasks-close-on-a-reported-commit-that-.md`
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Reuses the auxiliary provider boundary (`executeAuxiliaryProviderCandidates`), skill-name resolution, the repair obligation store, the engine-state serialized update seam, and detached-worktree materialization. |
| Prerequisites | None. The dispatch port is optional, as `dispatchRebaseRegradeJudgement` is, so runners without it hand off unjudged. |
| Integration surface | Engine-internal: conductor BUILD completion region, step runner port, stall detector, retry hints, event union and sinks, model-table metadata, one shipped skill. No CLI, hook, settings or persisted task-status format change. |
| Data implications | Additive versioned engine-state section for verdicts; one new obligation source authority. No migration. |
| Performance risk | One batched provider call per BUILD exit that has newly closed `rem-*` tasks, plus one detached worktree add/remove; diff input bounded at 48,000 bytes. No call when there are no candidates. |
| Worktree isolation | The judge's disposable checkout lives under the feature's own scratch area and is removed after dispatch; no shared port, DB or file. |

## Alignment

- **Design principle.** "Is this repair present?" is a judgement; machinery owns candidate
  selection, input scoping, bounds, persisted verdicts and the reopen, with a closed-schema verdict.
- **Local pattern basis — auxiliary judgement.** Precedent: `rebase-regrade-judgement.ts`
  (`judgeRebaseRegrade`, `parseRebaseRegradeJudgement`) dispatched via
  `StepRunner.dispatchRebaseRegradeJudgement`. Traits to preserve: injected judge boundary returning
  raw output; engine-rendered prompt behind a shipped skill invocation; closed-key schema parse;
  bounded delta with a truncation flag; one spine event per judgement. Allowed variation: the
  failure policy is retry-once-then-hand-off (operator decision) rather than reopen-all, and the
  provider policy is `build_review`'s rather than `rebase`'s.
- **Local pattern basis — BUILD-internal reopen.** Precedent: the `plan_amendment` admission in
  `task-seed.ts` (`planAmendmentObligationId`, `admitOrReplay`, `markSettled`). Traits: settled at
  admission, no lap, no governing review of its own. Variation: admitted from the conductor's BUILD
  completion region rather than seeding.
- **Local pattern basis — once-per-lap BUILD retry.** Precedent: the unverified Done-when nudge
  (`unverifiedDoneWhenNudgeSpent`, the `unverified Done-when checks require one BUILD review pass:`
  prefix exempted in `isNoTaskProgressBuildStall`). Traits: fixed reason prefix, stall exemption,
  durable engine-state marker, retry only while an attempt remains.
- **Local pattern basis — disposable checkout.** Precedent: `build-review-materialization.ts`
  (`git worktree add --detach`). Trait: the judged code is read from a throwaway checkout of an exact
  SHA.
- **ADRs.** No APPROVED ADR is contradicted. `adr-2026-09-06-reopened-task-resolution` decisions 1–6
  govern the new obligation unchanged; its decision 8 "no new retry counter" sentence scopes that
  ADR's own repair loop, and this feature's bounded reopen count is decided in its own ADR.
  Plan-growth ADRs are untouched (no appended task). `build_review` remains completion authority.
- **Event spine.** One new `ConductorEvent` variant for the occurrence; verdict records are
  durable state under exception C. No sidecar, poller or stamped artifact.
- **Scope check.** A: consumer-facing (the remediation flow runs in every engine build, not behind
  `isSelfBuild()`). B: shipped `skills/` (engine-dispatched lifecycle judgement in BUILD, like
  `rebase-regrade`). C: provider-agnostic through the auxiliary provider boundary; the skill needs
  its `agents/openai.yaml` with `allow_implicit_invocation: false`.
- **State management.** Verdict is a closed enum (`resolved | persists | partial`) plus engine-only
  `unjudged`; outcome is `judged | unjudged`; no boolean-flag state.
- **Security / DI.** No endpoint or user input. The judge cannot mutate the feature worktree by
  construction (detached checkout); the persistent engine-state store is the production default.

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| Remediation-closure judgement module (candidate selection, prompt render, closed-schema parse, retry-once) | The conductor's BUILD completion region, where `completion.done && step.name === 'build'`, before the unverified-nudge handling |
| `StepRunner.dispatchRemediationClosureJudgement` optional port and its `step-runners.ts` implementation | Injected into the judgement module by the conductor, as the rebase-regrade judge is |
| `skills/remediation-closure/SKILL.md` (+ `agents/openai.yaml`) | Invoked by that dispatch via `resolveSkillName` + `renderAuxiliarySkillInvocation`; installed by `bin/install` |
| Auxiliary model-table row | `model-table-metadata.ts` → `bin/generate-model-table` → `ARCHITECTURE.md` |
| `remediation_closure` obligation authority | Admitted by the judgement module through `createRepairObligationStore`; read by the existing resolver, seeding and startup hint recovery |
| Engine-state verdict section | Read and written by the judgement module through the engine-state serialized update seam |
| Fixed completion-reason prefix | Exempted in `build-progress-watcher.ts`'s stall check; branch in `remediation-hints.ts` build retry hint |
| `remediation_closure_judged` event | Emitted by the conductor through `this.events.emit`; declared in `event-sinks.ts` |

Advisory overlap scan: `conductor.ts` overlaps unmerged `spec/daemon-self-host-guardrails` and
`spec/self-host-phase6-wiring`; `step-runners.ts` overlaps
`spec/untracked-root-node-modules-symlink-gets-committed`. Line-level conflicts only; no shared
design surface.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A wrong `persists` verdict spends BUILD attempts | Technical | Medium | Medium | Two reopens per task; reopen only while an attempt remains; then hand off |
| Persistent provider fault silently disables the check | Integration | Low | Medium | Retry once; `unjudged` outcome on the event spine; downstream gates unchanged |
| Vague plan blocks give weak verdicts | Knowledge | Medium | Low | Downstream gates remain the backstop; A1 approved |
| Re-judging loops on unchanged closes | Technical | Low | Medium | Verdict keyed to close identity; no re-judge until a new close |

## ADRs Created

- `adr-2026-10-21-remediation-closure-judgement` — APPROVED (operator, 2026-10-21).

## Plan size estimate

About 8–10 tasks; well under the 20-task split threshold. No split proposed.
