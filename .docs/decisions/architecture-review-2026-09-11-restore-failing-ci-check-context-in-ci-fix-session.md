# Architecture Review: Reliable CI repair dispatch

**Date:** 2026-09-11
**Mode:** Lightweight, Medium complexity; technical feasibility and architectural alignment
**Source:** jstoup111/ai-conductor#2153
**Inputs:** operator-approved technical scope, build-configuration inheritance, and CI-repair flow diagram
**Stories reviewed:** None; this is the canonical pre-stories review.
**Verdict:** APPROVED WITH CONDITIONS

> **Amended 2026-09-11 by #2153:** The operator approved this architecture in chat. Condition 1 is satisfied. Condition 2 is satisfied by the in-place amendment to the older startup-preflight ADR in this spec. Condition 3 is the required downstream stories/plan coverage, not an unresolved architecture decision. The review's architecture is approved; the original verdict and conditions remain preserved for provenance.

## Feasibility

The expanded correction fits the current TypeScript engine, GitHub adapter, provider-aware step runner, watch registry, and existing repair worktree lifecycle. No dependency, external service, configuration key, database migration, or independent provider dispatcher is required.

The principal implementation risk is confusing three different facts: a repair was attempted, a repair was verified and published locally, and GitHub subsequently reported green CI. The current return types collapse these facts. Typed control-flow results and exhaustive handling at the existing boundaries are sufficient; telemetry must not become execution authority.

The operator-approved scope includes hint delivery, explicit retrieval failures, truthful repair outcomes, attempts not consumed by a prevented repair session, and build provider/model/effort/fallback inheritance. It excludes independent repair-provider configuration, general provider-selection redesign, fixing individual PR failures, changing the attempt cap, and replacing the watch registry or worktree lifecycle.

## Alignment and governing decisions

- `adr-2026-07-07-ship-ci-feedback-loop`, decisions 3–5: reserve attempts before git work, cap repair attempts at two, keep one repair dispatch per sweep, reset on a later green observation, and use the existing repair pipeline with sticky escalation.
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner`: reuse DefaultStepRunner; daemon guards, configured verification, and lease-protected publication remain authoritative.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`: preserve selected-first configured-order fallback, provider-native settings, isolated fresh sessions, and no fallback for authentication or ordinary failures. This later provider-neutral contract governs the older Claude-specific dispatch wording.
- `adr-2026-07-29-codex-readiness-probe-failure-disposition`: a probe failure is not an authentication failure. Ordinary dispatch may proceed on an inconclusive probe; affirmative missing/unusable credentials and the actual invocation retain their existing authority.
- `hotfix-ci-repair-daemon-tests`: repair sessions diagnose and commit; the daemon owns testing and publication. The expanded fix preserves that ownership.

The older startup-preflight ADR's requirement to probe the Claude CLI is incompatible with the approved build-configuration inheritance and later shared provider policy. It must be clarified during this DECIDE pass before landing, preserving the fail-loud diagnostic outcome while placing readiness at the selected provider's existing execution boundary. BUILD must not receive a task to amend the old decision.

## Reviewed design

### 1. Check context comes from an explicit GitHub result

Reuse the existing `gh pr view` status-check-rollup contract used by the sweep rather than inventing a nested check-suites response or relying on `gh pr checks` exit status. Carry check names/context, conclusions/status states, and detail/target links through a typed check-context result. The builder must cover the failed terminal states that already make a PR eligible, not only the literal FAILURE string.

Prefer passing the already-read eligibility snapshot to the repair preparation boundary, avoiding a second check listing that can disagree with eligibility. The GitHub adapter must preserve retrieval/parse failure as a distinct result; missing or malformed required check data must not become a successful empty list. A failed eligibility read cannot authorize repair. At repair preparation, absent usable failed-check context defers the repair with an explicit reason and no consumed attempt.

Optional failing-job log excerpts may enrich that context. Failure to obtain a log must retain known names and links and record degraded context; it must not turn an otherwise usable hint into an empty string. Bound enrichment work, excerpt size, and total hint size. Do not repeat a full workflow-log request for every check sharing a run. Do not change the global check-classification policy as part of this work; preserve its existing accepted failure vocabulary and handle supported check-run and status-context identities at the context boundary.

### 2. Readiness and execution inherit build policy

Keep repair dispatch through `DefaultStepRunner.resolveCiFailure` and its existing build-step provider-aware executor. Resolve `steps.build.llm_provider` ahead of the configured run-level provider list, then use the existing provider-native model and effort resolution and fallback rules. No separate ci-fix provider/model/effort setting is introduced.

Eliminate the independent Claude-only startup veto. Provider readiness remains owned by the selected adapter/execution boundary; do not pre-probe every provider through a generic CLI or create another fallback loop. Codex-only operation must not require Claude. A preferred-provider override must be honored even when it differs from the first run-level provider. Custom providers retain existing capability behavior rather than gaining a mandatory Claude/Codex probe.

Retain actual provider failure results rather than converting every return from `resolveCiFailure` into an attempted success or changed outcome. Authentication, permission, configuration, and ordinary execution failures retain their existing classifications; only the shared executor may decide whether provider fallback is allowed. An inconclusive Codex doctor result cannot be used by ci-fix to disable a provider that the existing readiness contract permits to run.

### 3. Attempt accounting uses explicit execution outcomes

Preserve the existing reservation before repair git work. The dispatch result distinguishes a proven not-started repair from an attempted repair. On a proven not-started result, the sweep restores the prior attempt count and repair cooldown timestamp; on an attempted failure, noop, or successful publication, it retains the consumed attempt. An unknown result or thrown error is conservative and never authorizes a refund or a success reset.

Proof that no repair started must originate in the control-flow boundary that refused dispatch. For provider-owned pre-execution refusal, carry that fact in the direct provider result through the executor and step runner; maintain it correctly across candidate/model fallback so a final skip cannot erase an earlier real attempt. The existing `providerInvocationSkipped` flag currently describes cached skips only, so it must not be treated as universal start evidence without explicitly extending and verifying its producer/consumer contract. A narrowly scoped control-result extension is allowed where current results cannot express this fact.

Never infer refunds from an empty hint, log text, absence of usage, emitted provider-attempt metadata, observed timing, `onSpawn`, or any other best-effort observer. In particular, `InvokeOptions.onSpawn` explicitly grants no retry authority. Existing custom/legacy providers without affirmative no-start evidence remain conservative. Multiple fallback candidates within one repair invocation consume at most one CI-repair attempt.

Preserve the existing one-dispatch-per-sweep, conflict precedence, draft exclusion, serial guard, cooldown, and cap. This work does not redesign crash persistence or add an independent retry ledger. Failure-detection state must survive a not-started refund so detection events and labels do not churn. Persist the reconciled watch entry through its existing owner.

### 4. Local verification/publication is distinct from remote green

Replace the ambiguous repair result with exhaustive outcomes for not started, attempted failure/noop, and verified publication, preserving stage/reason where a failure occurred. Concrete type names remain implementation choices; these distinctions are mandatory at every caller.

Provider success alone is not proof of changes. The repair wrapper must detect whether committed work changed before treating it as a repair to verify and publish. A provider failure cannot become a changed success merely because the wrapper returned normally. A guard refusal, failed configured verifier, or lease-push failure returns an unsuccessful outcome; it must not return the runner's changed marker.

A verified-publication result is reachable only after preservation guards and the configured verifier succeed and the existing lease-protected push reports success. The daemon must not synthesize `green-verified` from a changed result. Even verified publication retains the attempt count: only a later green GitHub rollup resets it under the governing CI-feedback ADR. Sticky exhaustion and existing human authority remain unchanged.

### 5. Failure diagnostics use the event spine

Add a narrowly typed CI-repair diagnostic event, or extend an appropriate existing event only if its semantics fit. Required diagnostic data are PR/feature attribution, failed preparation or repair stage, a bounded classified reason, and available provider identity. Context-read failure, optional-log degradation, provider not-started disposition, and verification/publication failure must be distinguishable.

The root daemon emitter and `startDaemonEventPersistence` already provide a durable same-schema ledger at `.daemon/events.jsonl`. Wire these daemon-origin diagnostics to that emitter, enable persistence/rendering in the event-sink registry, and use the existing consumer path. Do not send them only to the private provider-rendering emitter or only to an ad-hoc log. Do not broaden this feature into a migration of unrelated recovery telemetry.

Event-spine verdict: occurrences; reuse/extend ConductorEvent and its registered sinks; no separate schema, watcher, sidecar, or exception. Diagnostics are observational and cannot alter provider fallback, attempt refund, verification, or publication decisions. Retain safe bounded context without dumping credentials or raw provider diagnostic payloads.

## Focused local pattern basis

`step-runners.ts: resolveCiFailure` and `executeProviderAwareOneShotCore`, with `provider-selection.ts: resolveProviderCandidates` and `provider-execution.ts: executeProviderCandidates`, are the existing build-policy integration. Preserve shared candidate ordering, native settings, cold sessions, and classified fallback. Extending the CI-specific result is allowed; bypassing the shared executor is not.

`ci-fix.ts: runCiFix` and `autoresolve.ts` own the existing isolated-worktree, guards, configured-verifier, and lease-push pattern. Preserve that sequence and ownership; change misleading result propagation rather than introducing another repair service. `mergeable-sweep.ts: sweepMergeableLabels` remains the sole owner of watch-entry attempt reconciliation.

`event-persister.ts: startDaemonEventPersistence`, the root daemon emitter, and `event-sinks.ts` are the applicable diagnostic pattern. The existing non-persisted `ci_failed` event alone is not sufficient evidence of durable reporting.

These are rediscovery hints, not fixed source coordinates or a project-wide pattern mandate.

## Wiring Surface

| Surface | Production caller / consumer | Candidate paths |
|---|---|---|
| Typed check context and explicit read failure | PR-state read in the sweep, then CI-repair preparation | `src/conductor/src/engine/pr-labels.ts`, `src/conductor/src/engine/ci-fix.ts`, `src/conductor/src/engine/mergeable-sweep.ts` |
| Build-configured repair result and no-start propagation | Daemon CI-fix dispatcher → DefaultStepRunner → shared provider executor | `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/conductor.ts` interface |
| Narrow provider no-start evidence, if required | Provider-owned refusal returned through the shared executor; consumed only as direct control result | `src/conductor/src/execution/llm-provider.ts`, built-in provider adapters, `src/conductor/src/engine/provider-execution.ts` |
| Repair-stage outcomes and attempt reconciliation | runCiFix returns to daemon dispatch, then sweep updates the watch entry | `src/conductor/src/engine/ci-fix.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/mergeable-sweep.ts` |
| Durable CI-repair diagnostic | Root daemon event emitter → registered render/persist sinks | `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, applicable daemon event renderer and contract consumers |
| Operator documentation | Existing CI-repair/provider configuration guidance and README | `README.md`, relevant existing guide under `docs/`, `src/conductor/README.md` where affected |

## Risks and required proof

The advisory `ai-conductor overlap-scan --files` over the listed dispatcher, check-context, provider-contract/adapter, event-union, and sink paths reported: “No overlap detected; no open blockers.” The tool notes that renames or name-only diffs may not be detected. This is advisory evidence, not a guarantee against future concurrent changes.

- **False refunds or unlimited retries:** test proven refusal, unknown failure, real attempt followed by fallback failure, noop, and verified publication through the real sweep/dispatch result boundary. Only remote green resets the counter.
- **Provider asymmetry:** exercise Codex-only without Claude, Claude-only, build preference differing from run-level order, allowed unavailable-provider fallback, forbidden auth fallback, and inconclusive Codex readiness behavior with faithful adapter fakes.
- **Another false hint contract:** replace nested check-suite fixtures with realistic GitHub rollup shapes and assert the real internal dispatch receives the expected names/links. Cover malformed data, unavailable listing, optional log failure, and terminal failures beyond FAILURE.
- **Publication authority:** prove guard failure, verifier failure, and refused push cannot reach a success outcome or reset attempts. The provider does not run tests or push.
- **Invisible diagnostics:** exercise emission through the root daemon bus and persisted event schema, not just a mocked logger. Diagnostic sink failure must not change control results.
- **Shared-source contention:** candidate paths include central dispatcher/provider files; the advisory scan must be repeated with the final task-owned paths during planning.

Unit tests fake third-party adapters; boundary tests run real internal flow with faithful fake GitHub/provider/process boundaries. No live provider, GitHub mutation, or full daemon run is required to prove this correction. Tests remain with the behavior-owning tasks; aggregate verification is owned by the configured later gate.

## Complexity

Medium remains appropriate. Several existing boundaries change together, but no new service, persistence architecture, provider configuration, or generalized routing mechanism is introduced. The optional direct no-start result must remain bounded to a fact existing execution boundaries already know; it must not grow into a new lifecycle controller.

## ADRs created

None. The structural prerequisite/reuse check found existing authoritative decisions for dispatch integration, watch-state ownership, provider selection, session isolation, readiness behavior, and verification/publication. Discriminated result types and corrected propagation are implementation contracts within those existing boundaries, not a new state store or integration pattern. The older Claude-only startup wording needs an in-place DECIDE amendment, not a duplicate ADR.

## Conditions

1. Operator accepts this review's concrete interpretation: no independent Claude startup veto; affirmative no-start evidence is required for refunds; locally verified publication retains the attempt until GitHub turns green.
2. Before landing, add the provider-neutral clarification beside the older startup-preflight assertion in `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`, preserving its original text. Do this in DECIDE, never as a BUILD task.
3. Stories and plan assign the named boundary proofs, final event-sink wiring, and bounded control-result propagation. Any implementation proposal requiring a new lifecycle or persistence subsystem returns to architecture instead of silently expanding scope.

## Verify-claims ledger

Verified by source/ADR reads: the hint builder's incorrect response contract; lost guard/verifier/push failures; unconditional attempted/changed wrappers; build-step candidate resolution; Claude-only startup veto; sweep reservation/reset behavior; observer-only onSpawn contract; providerInvocationSkipped's currently cached-only meaning; root daemon event persistence and non-persisted ci_failed sink; remote-green-only reset in the governing ADR. No live repair behavior is claimed.

The reviewed mechanisms above are proposed decisions, not claims that their new behavior already exists. There is no unresolved external dependency assumption. Operator approval of the concrete review remains pending under the composer checkpoint.

> **Amended 2026-09-11 by #2153:** Operator approval is now received; the decisions above are accepted design inputs. Their implementation has not yet been built or verified.
