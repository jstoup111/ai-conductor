# Architecture Review: Daemon log lines are unreadable to operators (#2867, covers #2367)
**Date:** 2026-10-09
**Mode:** Lightweight (Tier M) — Technical Feasibility and Architectural Alignment, plus the required Wiring Surface
**Input:** technical intent from jstoup111/ai-conductor#2867 and #2367; track scope boundary in `.docs/track/daemon-log-lines-are-unreadable-to-operators.md`; diagrams in `.docs/architecture/daemon-log-lines-are-unreadable-to-operators.md` and its sequence
**Verdict:** APPROVED

## Evidence base

Measured on the root checkout's `.daemon/daemon.log` + `.daemon/daemon.log.1` (11,233 lines, 2026-10-08..10), with source read at local `main` e6b56fe3da (identical to `origin/main`). Basis labels per `verify-claims`.

| Claim | Basis | Confidence |
|---|---|---|
| 3,811 lines are `progress re-kick: <slug> retained — halt disposition <class>`, emitted every tick by `buildProgressReKickDeps`' `isProgressReKickEligible` (`src/conductor/src/daemon-cli.ts:899`). Siblings: `episode-end sweep: … retained` (`engine/daemon-rekick.ts:143`) and `re-kick <slug>: skipped — halt disposition` (`engine/daemon-rekick.ts:493`). | verified | 99% |
| The raw git output (`To /…origin.git`, `* [new branch]`, `Switched to a new branch`, `core.fsyncObjectFiles` warnings — ~1,550 lines) and vitest failure text (`FAIL`, `❯`, `- Expected`, `⎯⎯⎯`) are continuation lines of one multi-line `step_failed.error` (test_suite failure output), split per physical line by `createFeatureDaemonLogger` / `createDaemonModeLogger` (`engine/daemon-log.ts`). Example: log.1 lines 697-1047 all stamped `20:36:36.579Z` after `· ✗ test_suite failed (try 1)`. | verified | 95% |
| The same splitting produces #2367's "bare leading space" shape: a forwarded line keeps its own leading padding directly after the `[daemon][<tag>] ` prefix (`  ! [rejected]   …`). | verified | 95% |
| `step_failed` is persisted (`engine/event-sinks.ts:103` `persist: true`), so the full multi-line error survives in the worktree's `.pipeline/events.jsonl` when the log shows one line. `loop_halt` is persisted too (`:175`) and the halt reason is also in `.pipeline/HALT`. | verified | 95% |
| Provider lifecycle lines `· <step> provider preparing|running|settled (attempt <id>, recovery n)` come from the `provider_attempt` case with `lifecycle` set (`daemon-cli.ts`, renderer); the attempt id is a UUID or `d-<uuid>:<step>:<n>`. | verified | 95% |
| `Provider <p>: replaced caller-supplied session <uuid> with fresh session <uuid> …` is written by `enforceFreshSessionOptions` (`execution/fresh-session.ts`) to `options.diagnosticLog` on every invocation; 72 such lines, none of which say "suppressed resume". | verified | 95% |
| `self_host_containment_verdict`, `self_host_boundary_fingerprint` and `session_policy` render one line per occurrence (~85, ~87, ~61 lines). | verified | 95% |
| Effective-FAIL completion reason is `build_review effective FAILed: unresolved findings: <ids>` from `effectiveBuildReviewFailureDetails` (`engine/artifacts.ts`), and `projectBuildReviewAggregateSources` (`engine/build-review-aggregate.ts`) already yields each finding's `rubric`, `findingId` and human `summary`. No code parses the reason text. | verified | 90% |
| The contradictory four lines of #2867 (a) are: `step_failed` for build_review (emitted at the conductor's step-failure point), then the conductor's build_review branch reads the FAIL aggregate and, when an aggregate parses and adjudication is enabled, calls `applyBuildReviewOutcome`; `remediation_adjudication_completed` renders `build_review adjudication completed (n settled case)`; a `settled` outcome then writes `this.log?.(outcome.trace)` — the raw `route: pass\n<uuid> [reject/resolved] …` text (`engine/conductor.ts`, build_review branch; `engine/build-review-adjudication-coordinator.ts` trace). | verified | 90% |
| Whether a given `step_failed` for build_review will enter adjudication is decidable before the event is emitted from the same inputs the later branch reads (step name, daemon/auto/custom-policy mode, verdict file FAIL, aggregate parse, `buildReviewAdjudicationEnabled()`). | inferred (from the branch conditions read in `conductor.ts`) | 85% — Task 9 extracts one shared predicate used by both sites, so the label cannot disagree with the branch even if an input is missed |
| `renderDaemonEvent` is called per dispatch through `beginFeatureRun`'s `renderEvent` closure, through the slug-scoped recovery bus, and through the daemon-wide global subscriber (`daemon-cli.ts`). A per-dispatch presenter can therefore be constructed in `beginFeatureRun` and in the recovery bus factory. | verified | 95% |
| `config.daemon_verbose` (boolean, default false; `engine/config.ts` validation) is loaded before `createDaemonModeLogger` is constructed in `runDaemonMode`. | verified | 95% |
| `recoveryProcedure(haltClass)` (`engine/monitor/session.ts`) already maps every canonical halt disposition to its operator recovery text, and `ai-conductor monitor <project|all>` is the guided halt-resolution command (CLI help). | verified | 95% |

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | TypeScript only; no new package. |
| Prerequisites | None. `daemon_verbose` exists. |
| Integration surface | Daemon renderer + logger (daemon-cli.ts, daemon-log.ts), halt-retention emitters (daemon-cli.ts, daemon-rekick.ts), fresh-session enforcement, build_review completion reason (artifacts.ts), conductor build_review exit, event union + sink registry. Bounded to the daemon/engine package. |
| Data implications | Additive: one `ConductorEvent` member and one optional `step_failed` field. `.pipeline/events.jsonl` readers that switch on `type` ignore unknown members; no backfill. |
| Performance | Per-dispatch presenter memory is a handful of keys; the retention gate holds one entry per halted slug. Multi-line collapse is O(message). |
| Worktree isolation | No new ports, files, or shared state. The retention gate is per daemon process. |

## Alignment

**Event spine** (`.agents/skills/event-spine/SKILL.md`):

```
Event spine
  Channel?    no                      — presentation of existing occurrences; one union member + one optional field
  Concern:    occurrence              — the adjudicated build_review verdict is an occurrence in time
  Verdict:    extend the union
  Exception:  none
```

The final-verdict line is an occurrence, so it rides a new `build_review_adjudicated` variant emitted through `ConductorEventEmitter`, declared in `EVENT_SINKS` (`render: true, persist: true, audit: false, otel: false`, matching `remediation_adjudication_completed`). It is not stamped into an artifact and not written as raw log text. The provisional label is an optional field on the existing `step_failed` variant (additive, backward compatible). The raw `this.log?.(outcome.trace)` write is removed in favor of the event. Verbosity, dedup and collapse are presentation applied after the spine; nothing is dropped from `.pipeline/events.jsonl`.

The halt-retention lines are raw daemon log calls, not events, and stay raw: they report a recurring evaluation of durable state (`.pipeline/HALT.class`), not an occurrence. Deduplicating their rendering does not create a channel.

**Governing decisions applied (no new ADR):**

- `adr-2026-07-26-event-sink-registry-exhaustiveness` — the new variant gets an `EVENT_SINKS` row; rendering stays opt-in through `render: true`. The registry continues to decide *whether* the daemon renders an event; the new presentation table decides *how* (depth, level, next action) for exactly the rendered set, keyed by the same type union so it is compile-time exhaustive over `render: true` types.
- `adr-2026-07-04-kickback-event-emission-and-log-prominence` — the `KICKBACK` line keeps its undimmed bold, uppercase, depth-0 form and its grep anchor. `daemon-render.test.ts` remains the byte-exact contract; its expectations are updated for changed lines.
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — unchanged; halt events still persist; only their rendered line gains a next action and a one-line summary of a multi-line reason.
- `adr-2026-07-10-intra-step-build-progress-events` — `build_progress` heartbeat stays at default level.
- `adr-2026-07-30-provider-preparation-lifecycle-supervision` — its decisions (supervisor, deadlines, one replacement attempt) are untouched. Its consequence "status and logs distinguish preparing, running, recovering, and terminal halt with attempt identity" still holds: `daemon status` is unchanged, `recovering` and terminal halt lines stay at default, and `preparing`/`running`/`settled` lines with attempt identity render under `daemon_verbose: true`. The accepted story of that feature that required the routine phases in the default log is corrected in this DECIDE pass (see the conflict report).

**ADR creation (§7):** the change does not establish or revise a system boundary, component decomposition, integration pattern, state/data architecture, or foundational technology. A rendering presentation table and a logger line-shape rule are ordinary implementation detail inside an existing component; the event addition extends the existing spine. No ADR is created; the reuse check above cites the governing ADRs.

**Focused local pattern basis:**

- *Render-once memory:* the existing `renderedReclaimRetentions` map in the daemon renderer suppresses a repeated `worktree_reclaim_failed` retention until its detail changes. Traits to keep: keyed by slug, re-renders on a changed detail, forgets the key on a terminal transition. Variation allowed: the new memories are instance-scoped (per dispatch for the presenter, per daemon process for the retention gate) rather than module-level, so tests need no reset seam. Rediscovery hint: `renderedReclaimRetentions` in `src/conductor/src/daemon-cli.ts`.
- *Recovery text:* `recoveryProcedure` in `src/conductor/src/engine/monitor/session.ts` is the one owner of per-disposition recovery wording; halt and retention next actions reuse it rather than restating runbook text.
- *Verbose echo precedent:* `engine/worktree-prepare.ts` summarizes `bin/setup` output on success and prints `(set daemon_verbose: true to echo them)`; the multi-line collapse hint follows the same wording family.

**Line-shape rule (#2367):** after the `[daemon][«tag»] ` prefix, depth 0 text starts in column 0, depth 1 after `· `, depth 2 after `·   `; forwarded subprocess lines start with `│ ` and appear only at verbose level. Depth is therefore readable from the text column alone, and a forwarded line's own padding sits after its marker. Each rendered event type has exactly one declared depth.

**State management:** level is a closed union (`default | once-per-dispatch | verbose`); severity is a closed union (`info | warning | halt`) and the presenter's warning/halt constructor requires a `NextAction` (`{ kind: 'none', why } | { kind: 'operator', action }`), so a warning without a next action does not type-check.

**Security:** dropping UUIDs and raw subprocess text from the default log reduces what a shared log reveals; nothing new is exposed.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Per-dispatch event presenter (replaces direct `renderDaemonEvent` calls for feature events) | Constructed in `runDaemonMode`'s `beginFeatureRun` for each dispatch and in `createSlugScopedProviderExecution` / `subscribeRecoverySessionOccurrences` for recovery dispatches; the daemon-wide global subscriber gets a daemon-lifetime instance. |
| Presentation table (depth, level per rendered type) | Read by the presenter for every rendered event. |
| `daemon_verbose` as the daemon log verbose level | Read from the loaded config in `runDaemonMode` and passed to `createDaemonModeLogger` and every presenter instance. |
| Daemon logger line shape, multi-line and JSON collapse | `createDaemonModeLogger` (live tmux + `.daemon/daemon.log` sinks) and `createFeatureDaemonLogger`, both already constructed in `runDaemonMode`. |
| Severity helper with next action for raw daemon lines | Called by the raw warning/halt sites in `daemon-cli.ts`, `engine/daemon-rekick.ts`, `engine/daemon-runner.ts`, `engine/daemon-command.ts`, `engine/halt-pr-rehabilitation.ts`, `engine/halt-pr-reconciliation.ts`, `engine/step-runners.ts`, `engine/conductor.ts`. |
| Daemon-scoped retention log gate | Constructed once in `runDaemonMode`; passed to `buildProgressReKickDeps`, the episode-end sweep (`recoverEpisodeHalts`) and the re-kick sweep (`rekickSweep`) logging. |
| `step_failed.provisional` | Set by the conductor's step-failure emission through the shared adjudication predicate; read by the presenter. |
| `build_review_adjudicated` event | Emitted by the conductor after `applyBuildReviewOutcome` returns, for every outcome kind; rendered by the presenter; persisted by `EventPersister` via `EVENT_SINKS`. |
| Finding titles in the effective-FAIL reason | `effectiveBuildReviewFailureDetails` callers in the build_review completion check (`artifacts.ts`), which already hold the parsed aggregate. |
| Fresh-session notice gating | `enforceFreshSessionOptions` at the provider adapter boundary (unchanged callers). |

**Early overlap scan** (`ai-conductor overlap-scan` over the wiring paths, 2026-10-09): overlap reported only with `origin/spec/daemon-self-host-guardrails` (`daemon-rekick.ts`, `conductor.ts`) and `origin/spec/self-host-phase6-wiring` (`daemon-cli.ts`, `conductor.ts`) — both long-lived spec branches, not open implementation PRs. Advisory only. Open spec PR #2879 (log export) and issue #2368 (dispatch slot identity) are addressed in the conflict report.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Many byte-exact renderer tests change expected strings | Technical | High | Medium | Each task updates the tests for the lines it changes; the presentation-table exhaustiveness test catches a forgotten type. |
| A suppressed line was the only signal an operator used for some diagnosis | Knowledge | Medium | Medium | `daemon_verbose: true` restores every suppressed line; full payloads remain in `.pipeline/events.jsonl`; every collapse names where the rest is. |
| Provisional label disagrees with the actual adjudication route | Technical | Low | Medium | One shared predicate feeds both the label and the branch; a legacy-lane FAIL is a negative-path test. |
| #2879's export tap is later placed downstream of this presentation filter and loses suppressed records | Integration | Medium | Medium | Recorded as a cross-spec note in the conflict report: this spec makes no claim about export input; the presentation filter is local to the daemon log and console sinks. |

## ADRs Created

None — the §7 structural prerequisite is not met; governing ADRs are cited and reused above.
