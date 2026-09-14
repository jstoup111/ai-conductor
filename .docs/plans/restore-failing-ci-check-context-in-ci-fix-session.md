# Implementation Plan: Reliable CI repair dispatch

**Date:** 2026-09-11
**Stories:** .docs/stories/restore-failing-ci-check-context-in-ci-fix-session.md
**Design:** .docs/decisions/architecture-review-2026-09-11-restore-failing-ci-check-context-in-ci-fix-session.md
**Conflict check:** PASS, 2026-09-11; .docs/conflicts/restore-failing-ci-check-context-in-ci-fix-session.md
**Source:** jstoup111/ai-conductor#2153
**Tier:** M

## Summary

Twelve scoped implementation tasks repair failure context, inherit build provider configuration, preserve truthful publication outcomes and reconcile bounded attempts. This is the operator-approved expanded scope; no independent repair settings, routing redesign or underlying PR repair is included.

## Technical Approach

Carry the selected typed GitHub rollup into a bounded hint builder through the existing sweep callback. Keep DefaultStepRunner's build execution policy and propagate a direct result instead of synthesizing success. Add narrowly scoped affirmative no-start evidence to InvokeResult and conservatively aggregate it through both model and provider fallback. The repair wrapper owns committed-change detection, preservation guards, configured verification and lease publication. The sweep owns reservation/refund and only resets on later GitHub green. Root-bus diagnostics are observational.

Reuse the canonical tracker client, shared provider executor, existing repair worktree lifecycle, configured test-suite dispatcher, lease push and watch registry. Source searches: prMergeState, resolveCiFailure, invokeWithLadderResolved, executeProviderCandidates, runCiFix, sweepMergeableLabels, startDaemonEventPersistence. These are semantic patterns, not an exact-copy declaration. Changes to the shared result and tracker options are additive; existing provider/fallback policy and tracker defaults remain intact. The named context/diagnostic budgets below are deliberate finite design choices for approval, not claims about existing limits.

## Prerequisites

- Accepted six-story artifact, approved architecture and clean conflict report above.
- #2164 terminal-check eligibility has landed; its mixed-status and nonterminal boundary fixtures remain authoritative.
- All tests use faithful external fakes; real local Git is permitted only for commit/lease behavior. No ordinary test starts a provider, gh, network client or real daemon loop.
- Each task performs scoped RED/GREEN using ai-conductor scoped-run. BUILD entry owns any needed acceptance specifications; configured aggregate verification and SHIP own feature completion. No terminal validation task is included.

## Tasks

### Task 1: Preserve typed rollup data and read failures

**Story:** 1 happy 1–2; 1 negative 1–2
**Type:** infrastructure

**Steps:**
1. Add adapter tests in pr-labels.test.ts using actual flat statusCheckRollup check-run and StatusContext fixtures, plus rejected GitHub calls, invalid JSON, non-array rollups and invalid entry field types. Assert typed failures remain distinct from successful empty reads.
2. Use RED/GREEN through scoped-run. Extend the existing PrMergeState read result with optional typed read/context failure information and typed name/context/detailsUrl/targetUrl fields. Preserve UNKNOWN versus NOTFOUND handling and canonical GhCapabilityError classification; do not parse capability failures again in callers. Validate the supplied rollup before helper consumers can crash. Preserve global checksOutcome policy.
3. Reuse makeProductionGh and prMergeState: additive data on the existing read, no second listing command and no independent tracker adapter. Search tracker-client and pr-labels tests for injected GhRunner fixtures. Commit: "fix(ci-fix): retain rollup context and classified read errors".

**Done when:**
- prMergeState adapter tests retain flat check-run and external-status identities and links, and return distinct classified read/parse failures for rejected calls, invalid JSON, non-array rollups and invalid entry fields rather than successful empty context.
- prMergeState tests preserve existing NOTFOUND pruning and UNKNOWN retry semantics, including typed GitHub capability errors; the production sweep-to-provider consumption of this data is owned by Task 11.

**Files:**
- `src/conductor/src/engine/pr-labels.ts`
- `src/conductor/test/engine/pr-labels.test.ts`

**Dependencies:** none

### Task 2: Build required context from the selected rollup

**Story:** 1 happy 1–2; 1 negative 2–3
**Type:** happy-path

**Steps:**
1. Write failing ci-fix.test.ts cases for FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE, STALE, and external FAILURE/ERROR statuses, plus SUCCESS/NEUTRAL/SKIPPED exclusion, missing link, unnamed entry and empty failed subset. Scope terminal failure selection to already eligible failed PRs; do not change global eligibility to dispatch on every listed state.
2. Replace buildCiFixHint's fictional checkSuites traversal with typed required-context preparation from the selected PrMergeState snapshot. Return usable context or a concrete context error, never an empty success. Prefer name then context; use an explicit indexed unnamed-check label. Keep supplied links only; do not invent URLs. Preserve the existing nonTerminalCheckNames gate.
3. Use RED/GREEN through scoped-run. Keep normalization pure and injectable following current ci-fix helper tests; Task 11 owns delivery at the production boundary. Commit: "fix(ci-fix): prepare hints from selected check rollup".

**Done when:**
- buildCiFixHint tests select terminal failures from the typed snapshot, retain check-run names/external contexts and available links, exclude successful entries, and explicitly identify unnamed checks without inventing a URL.
- Required-context preparation returns a context-error for malformed or empty failing context; Task 11 proves this refusal starts no repair and consumes no attempt.

**Files:**
- `src/conductor/src/engine/ci-fix.ts`
- `src/conductor/test/engine/ci-fix.test.ts`

**Dependencies:** Task 1

### Task 3: Bound optional enrichment and preserve context on log failure

**Story:** 2 all criteria
**Type:** negative-path

**Steps:**
1. Write failing helper/adapter tests for shared run IDs, missing/denied/timed-out logs, oversized metadata, oversized UTF-8 log output and no resolvable run link. Assert request count, byte budgets and explicit omission markers.
2. Implement these fixed internal limits: final hint at most 24,576 UTF-8 bytes including markers; metadata at most 12,288 bytes and 64 failed entries; names at most 256 bytes; retain only complete supplied links of at most 2,048 bytes, otherwise omit with a marker. Allocate metadata first, explicitly count omitted entries, and use remaining context space for log excerpts. Never cut a UTF-8 code point. These are chosen design limits, not existing behavior.
3. Perform at most three distinct workflow-run log reads, deduplicated by repository/run identity, each with a 10,000 ms subprocess timeout and 65,536-byte capture limit. Use canonical GhRunner with optional timeout/maxBuffer overrides forwarded by makeProductionGh; defaults for all other callers remain unchanged. Bound the actual subprocess, not a Promise.race that leaves it running. Preserve every retained failed-check identity when logs are unavailable and collect classified degradation facts for Task 12. Do not retrieve arbitrary supplied URLs.
4. Reuse injected GhRunner/execFile adapter patterns, assert the mock process boundary is reached for permitted arguments before testing refusal, and never call real gh. Verify RED/GREEN through scoped-run; Task 11 owns enriched provider delivery. Commit: "fix(ci-fix): bound log enrichment and expose degradation".

**Done when:**
- buildCiFixHint tests enforce the 24,576-byte total, 12,288-byte metadata, 64-entry and per-field limits with explicit omission markers, including multibyte text, while retaining useful check identities before allocating log space.
- Optional enrichment tests issue no more than three unique repository/run requests, do not duplicate shared-run retrieval, and preserve names/links plus classified degradation after denied, timed-out or unavailable logs.
- makeProductionGh adapter tests forward the 10,000 ms timeout and 65,536-byte capture limit to the mocked process boundary for enrichment and preserve existing defaults and typed capability errors for other callers.

**Files:**
- `src/conductor/src/engine/ci-fix.ts`
- `src/conductor/src/engine/tracker-client.ts`
- `src/conductor/test/engine/ci-fix.test.ts`
- `src/conductor/test/tracker-client.test.ts`

**Dependencies:** Task 2

### Task 4: Return affirmative no-start evidence from refusing boundaries

**Story:** 3 negative 3–4; 4 negative 1
**Story:** 4 (supporting criteria already named above)
**Type:** negative-path

**Steps:**
1. Write adapter tests for affirmative Codex readiness refusal, inconclusive readiness proceeding to invocation, cached provider unavailability, and legacy/custom results without a no-start declaration.
2. Add an optional direct InvokeResult executionDisposition value of not-started, meaning the owning control boundary affirmatively prevented repair invocation. Missing evidence is unknown and conservative. Keep providerInvocationSkipped with its existing cached-skip meaning. Set the new evidence on Codex readinessFailure, cached unavailability, and existing executor-owned refusal paths that structurally do not invoke the candidate. Do not infer it from auth text, output, onSpawn, timing or attempt telemetry. A returned success can never authorize a refund even with contradictory evidence.
3. Keep normal Claude execution conservative unless its existing adapter has affirmative pre-invocation proof; no new Claude readiness probe or generic provider probe is required. Keep thrown or ambiguous preparation errors conservative. Reuse direct InvokeResult and existing spawn-permit authority without redesigning lifecycle supervision. Verify RED/GREEN through scoped-run. Commit: "fix(providers): expose affirmative no-start results".

**Done when:**
- CodexProvider adapter tests return not-started on affirmative readiness refusal and allow the existing inconclusive-probe path to reach the fake invocation without a false no-start result.
- Provider executor tests mark cached and structurally refused candidates as not-started, while legacy/custom results, thrown preparation and contradictory success never constitute proof for a refund; no observer callback supplies that authority.

**Files:**
- `src/conductor/src/execution/llm-provider.ts`
- `src/conductor/src/execution/codex-provider.ts`
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/execution/codex-provider.test.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** none

### Task 5: Preserve no-start proof across model and provider fallback

**Story:** 3 negative 1–4; 4 happy 1; 4 negative 2–3
**Story:** 4 (supporting criteria already named above)
**Type:** negative-path

**Steps:**
1. Write failing ModelAvailabilityTracker and executeProviderCandidates tests for all-candidates-refused, attempted-then-refused, unknown-then-refused, model-unavailable fallback within a provider and multi-provider fallback. Include failures from observational telemetry handlers.
2. Aggregate direct no-start evidence conjunctively across every candidate/model result actually considered, including the final all-unavailable result: only unsuccessful results with affirmative evidence throughout retain not-started. An earlier attempted/unknown result permanently prevents that proof for the logical invocation. Preserve fresh sessions, native settings and current auth/rate-limit/session/permission/ordinary-failure precedence. Never use attempts[].invoked or observer completion as authority.
3. Use the existing model ladder and provider selection loop, not a repair-specific fallback loop. Repeat the direct-result pattern from Task 4 inside both aggregation sites. Verify RED/GREEN through scoped-run. Commit: "fix(providers): retain conservative start evidence across fallback".

**Done when:**
- ModelAvailabilityTracker and executeProviderCandidates tests preserve no-start only when every unsuccessful candidate has affirmative proof; earlier attempted or unknown execution survives a later refusal across both model and provider fallback.
- Provider executor tests retain existing candidate order and auth/permission/ordinary-failure dispositions, and telemetry failures do not change the final execution result or fallback selection.

**Files:**
- `src/conductor/src/engine/model-availability.ts`
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/model-availability.test.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** Task 4

### Task 6: Return build-configured repair execution results

**Story:** 3 all criteria; 5 happy 2; 5 negative 1
**Story:** 5 (supporting criteria already named above)
**Type:** happy-path

**Steps:**
1. Write DefaultStepRunner.resolveCiFailure integration tests with real shared executor wiring and fake provider adapters: Codex-only, Claude-only, a build preference different from run order, permitted fallback, affirmative auth/permission failure, ordinary failure, inconclusive Codex readiness and custom/legacy provider results.
2. Replace CiFailureAttempt's unconditional attempted:true with a direct discriminated repair-execution result representing not-started, failed, or completed session, carrying safe provider attribution. Inspect success in both provider-aware and scalar model-ladder paths. completed means session success only, never committed changes or publication. Keep executeProviderAwareOneShot(build), effective model/effort, fresh session policy and daemon-owned verifier/push instructions. Update StepRunner interface consumers without changing rebase behavior.
3. Use the existing shared provider execution seam and fake runtime/session registry patterns; do not mock resolveCiFailure itself for this proof. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): preserve build policy and repair execution results".

**Done when:**
- DefaultStepRunner.resolveCiFailure integration tests capture provider-native build model/effort, selected-first fallback order and fresh sessions for Codex-only, Claude-only and overridden preference, with no independent Claude probe.
- DefaultStepRunner.resolveCiFailure tests propagate no-start/failure/session-completed through provider-aware and legacy paths, preserve inconclusive-readiness and forbidden-fallback dispositions, and leave absent custom-provider evidence conservative.
- Both repair execution paths supply diagnosis-and-commit instructions with daemon ownership of verification/publication, asserted at the fake provider invocation boundary.

**Files:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/step-runners.test.ts`

**Dependencies:** Task 5

### Task 7: Detect committed changes without inventing provider success

**Story:** 5 negative 1; 4 negative 4
**Story:** 4 (supporting criteria already named above)
**Type:** negative-path

**Steps:**
1. Write runCiFix boundary tests for successful session with unchanged HEAD, uncommitted-only edits, a successful new commit, failed provider with a changed HEAD and affirmative no-start. Use real local Git only where commit semantics are the subject; inject provider and external process boundaries.
2. Carry explicit session results through productionCiFixRunner. Capture pre/post repair HEAD using the existing worktree-local Git runner; only successful execution with a changed committed HEAD reaches guards. Return noop for unchanged committed HEAD, failed for unsuccessful execution even if files/HEAD changed, and not-started only on affirmative evidence. Preserve the existing worktree lifecycle and branch-gone behavior.
3. Adopt a final CiFixOutcome union of not-started, noop, failed, published and branch-gone; failed carries a stage/reason, published means local verified publication. Existing branch-gone control is a proven pre-provider refusal; ambiguous exceptions remain conservative. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): require committed repair before verification".

**Done when:**
- runCiFix boundary tests return noop for unchanged HEAD/uncommitted-only edits and failed for provider failure even with changed HEAD; none reaches verifier or publication.
- runCiFix forwards affirmative no-start and branch-gone refusals without inventing a completed repair, and only a successful session with changed committed HEAD reaches the existing preservation guards.

**Files:**
- `src/conductor/src/engine/ci-fix.ts`
- `src/conductor/test/engine/ci-fix.test.ts`
- `src/conductor/test/integration/ci-fix-resolver-autofix.test.ts`

**Dependencies:** Task 6

### Task 8: Stop repair publication on guard or verifier failure

**Story:** 5 negative 2–3
**Type:** negative-path

**Steps:**
1. Write runCiFix boundary tests for each preservation-guard refusal and configured verifier nonzero/throw/unavailable result; assert ordering and absence of push.
2. Return failed with guard or verification stage rather than the runner's changed result. Continue to use runAcceptanceGuards and dispatchTestSuiteCommand as configured verifier; do not substitute an arbitrary shell suite or reuse unrelated build proof. Keep provider instructions from Task 6 unchanged.
3. Use existing injected verifier and repair-Git fixtures with faithful failure results. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): retain guard and verification failures".

**Done when:**
- runCiFix integration tests assert preservation refusal returns failed at the guard stage before verification/push, and configured verifier nonzero, throw or unavailable proof returns failed at verification before push.
- runCiFix still invokes the configured test-suite dispatcher only after a committed successful repair passes preservation guards; provider completion cannot replace that gate.

**Files:**
- `src/conductor/src/engine/ci-fix.ts`
- `src/conductor/test/engine/ci-fix.test.ts`
- `src/conductor/test/integration/ci-fix-resolver-autofix.test.ts`

**Dependencies:** Task 7

### Task 9: Report verified publication and lease refusal distinctly

**Story:** 5 happy 1; 5 negative 4
**Type:** happy-path

**Steps:**
1. Write repair-boundary tests for successful guards/verifier/push and a concurrent remote branch update refusing the lease; use fixture-owned local bare Git only for the lease semantics, with no hosted remote.
2. Return published only after pushRefreshedBranch reports pushed. Return failed with publication stage on refusal or throw. Preserve remote concurrent work and existing cleanup; never translate local publication to GitHub green.
3. Reuse the current lease-push implementation and fixture-owned Git pattern; no replacement publication protocol. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): distinguish published repair from refused push".

**Done when:**
- runCiFix integration tests return published only in guards-then-configured-verifier-then-lease-push order after a committed repair.
- A fixture-owned concurrent branch update makes pushRefreshedBranch refuse publication; runCiFix returns publication failure and the remote competing commit remains intact.

**Files:**
- `src/conductor/src/engine/ci-fix.ts`
- `src/conductor/test/engine/ci-fix.test.ts`
- `src/conductor/test/integration/ci-fix-resolver-autofix.test.ts`

**Dependencies:** Task 8

### Task 10: Reconcile repair reservation using direct outcomes

**Story:** 1 negative 4; 4 all criteria; 5 negative 5
**Story:** 4 (supporting criteria already named above)
**Story:** 5 (supporting criteria already named above)
**Type:** negative-path

**Steps:**
1. Extend mergeable-sweep-ci-fix integration fixtures to record pre-dispatch reservation and final watch-registry state for not-started, branch-gone, noop, failed, published, unknown and thrown results. Include an absent prior counter/timestamp, an existing cooldown and a later green sweep.
2. Pass the selected PrMergeState into dispatch alongside the entry, retaining one candidate per tick. Keep reservation before git work. Restore the exact prior attempt count and lastCiFixAt only for affirmative not-started/branch-gone outcomes; keep ciFailureDetected intact. Every other outcome retains the reservation. Remove local green-verified reset; observed remote green remains the only reset. No new registry or crash protocol.
3. Reuse the watch registry fixture and injected clock from mergeable-sweep-ci-fix tests. Retain existing TR-2 green reset, TR-3 reserve-before-dispatch, at-most-once, disabled, conflict and sticky tests; extend actual boundary fixtures for draft, cooldown, serial guard and cap exhaustion where needed. Task 11 supplies real dispatcher outcomes, while this task solely owns sweep transition proof. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): refund only proven unstarted reservations".

**Done when:**
- sweepMergeableLabels integration tests observe reservation before dispatch and exactly one consumed attempt for noop, failed, published, unknown or thrown results; affirmative no-start/branch-gone restores the prior count and cooldown while retaining failure-detection state.
- A later GitHub-green fixture resets attempts/failure detection through the existing sweep transition, while local publication followed by failed CI retains cooldown/cap and reaches existing sticky escalation when exhausted.
- Sweep eligibility fixtures cover draft, conflicting, pending/running checks, cooldown, sticky remediation, serial guard and disabled repair with zero new attempts; the existing at-most-once-per-tick fixture continues to dispatch only one candidate.

**Files:**
- `src/conductor/src/engine/mergeable-sweep.ts`
- `src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts`
- `src/conductor/test/engine/mergeable-sweep.test.ts`

**Dependencies:** Task 9

### Task 11: Wire selected context and truthful outcomes into daemon repair

**Story:** 1 all criteria; 2 all criteria; 3 configuration delivery; 4 integration; 5 negative 5
**Story:** 2 (supporting criteria already named above)
**Story:** 3 (supporting criteria already named above)
**Story:** 4 (supporting criteria already named above)
**Story:** 5 (supporting criteria already named above)
**Type:** happy-path

**Steps:**
1. Replace the source-text-only daemon CI-fix wiring proof with behavioral integration at the actual production callback/factory used by daemon startup. Extract a focused createDaemonCiFixDispatch factory into engine/daemon-ci-fix.ts if needed to inject GitHub/provider/worktree boundaries without launching a daemon loop. Daemon startup must construct this same factory, not duplicate its logic.
2. Use the sweep-supplied snapshot for required context and enrichment; remove the independent buildCiFixHint listing. Route headRefName lookup through canonical GhRunner rather than shell interpolation. Return explicit not-started context/branch preparation results before repair when required context or branch read fails; do not infer refund from empty text. Preserve typed error categories from Task 1.
3. Remove the Claude-only startup preflight veto from daemon wiring; readiness belongs to the shared build-provider execution used by DefaultStepRunner. Leave any now-unused preflight helper available for separately scoped cleanup, with no directory deletion. Forward session/final repair results without unconditional changed or green-verified conversion.
4. Exercise real prMergeState → sweep → daemon dispatch → hint builder/DefaultStepRunner with fake GitHub and provider adapters. Assert mixed flat rollup identities/links, optional enrichment limits/degradation, malformed/read-error refusal with zero final attempt delta, Codex-only startup without Claude, effective build config and final failed/published outcome propagation. Limit fixtures to one sweep tick plus observed boundary; no full Conductor run.
5. Use RED/GREEN through scoped-run. Update obsolete Claude-preflight wiring assertions to the surviving build-policy behavior, not absence-of-symbol tests. Commit: "fix(daemon): wire provider-aware CI repair context and outcomes".

**Done when:**
- The production daemon CI-fix callback integration sends the selected GitHub rollup names/contexts/links and bounded enriched hint to the fake provider, including mixed statuses and missing/unnamed metadata, with no second check listing.
- Production sweep/dispatch fixtures distinguish authentication, permission, timeout/API, malformed and empty-context failures and leave provider calls and net attempt deltas at zero; optional log failure instead retains usable context and permits repair.
- Daemon startup/callback integration honors Codex-only and Claude-only effective build configuration without the independent Claude veto, and forwards direct provider/guard/verifier/publication failures or published results unchanged to sweep reconciliation.
- The daemon callback passes the three-request/24,576-byte enrichment boundary with explicit omissions to the provider; tests establish that Tasks 1–3 normalization and budgets are reached from production wiring, not only by direct helper calls.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/engine/daemon-ci-fix.ts`
- `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts`
- `src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts`

**Dependencies:** Task 3, Task 6, Task 10

### Task 12: Persist and render attributed repair diagnostics on the root bus

**Story:** 6 all criteria; 1–3 failure diagnostics
**Story:** 1 (supporting criteria already named above)
**Story:** 2 (supporting criteria already named above)
**Story:** 3 (supporting criteria already named above)
**Type:** happy-path

**Steps:**
1. Add behavioral tests for typed CI-repair diagnostics through the root daemon emitter, startDaemonEventPersistence, existing event reader and renderer. Exercise context-read, context-validation, log-enrichment, provider-readiness/execution, guard, verification and publication stages; include restarted-reader and failing sink/renderer cases.
2. Add a ci_repair_diagnostic ConductorEvent variant with PR URL, slug, stage, closed reason code (auth, permission, timeout, api, capability, malformed-context, missing-context, missing-branch, log-unavailable, context-truncated, provider-unavailable, readiness-degraded, flag-invalid, spawn-env, unknown, guard-refused, verification-failed, publication-refused or verified-publication), optional provider and factual disposition (deferred, degraded, failed or published). Register render/persist true in event-sinks and handle the type in existing exhaustive consumers. Do not reclassify existing ci_failed phases or migrate unrelated telemetry. Supply a best-effort root-emitter diagnostic callback to the selected-state read/sweep and production CI-fix factory so pre-dispatch failures also reach persistence.
3. Bound serialized diagnostic records to 8,192 UTF-8 bytes. Allowlist stage/reason/disposition facts, constrain provider and slug to bounded identifiers and omit/truncate oversized attribution with explicit markers. Never copy raw provider output, credential payloads, stack traces or complete hints into the event; generic unknown is preferable to unsanitized text. Preserve classifyFixError's flag-invalid/auth/spawn-env/unknown categories and shared provider precedence; do not inspect raw payloads again in event consumers. Reuse redactSafetyText where textual safe facts are needed but do not rely on redaction to make arbitrary raw output permissible.
4. Use the root bus pattern in daemon-provider-event-persistence.integration.test.ts; the private createSlugScopedProviderExecution emitter alone is insufficient. Catch diagnostic emission/render failures outside control decisions; direct results remain authoritative. Verify RED/GREEN through scoped-run. Commit: "fix(ci-fix): persist bounded repair diagnostics on daemon bus".

**Done when:**
- Root daemon emitter/persister/reader integration retains and renders PR/slug, stage, classified reason and known provider for context, log, readiness/execution, guard, verification and publication diagnostics, including reading the same records after restarting the reader.
- Sink/renderer failure fixtures preserve direct fallback, attempt, verification and publication outcomes; no-start is never rendered as an attempted successful repair and published is never rendered as remote green.
- Diagnostic boundary tests keep serialized records at or below 8,192 UTF-8 bytes and exclude raw credential-bearing/oversized provider payloads while preserving bounded permitted facts and explicit attribution truncation.
- Root-bus diagnostic tests preserve resolver flag-invalid/auth/spawn-env/unknown classifications and permission denial as distinct safe reasons, with configuration faults distinguishable from a per-PR execution failure.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/engine/daemon-ci-fix.ts`
- `src/conductor/src/engine/mergeable-sweep.ts`
- `src/conductor/test/integration/daemon-provider-event-persistence.integration.test.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts`

**Dependencies:** Task 11

## Task Dependency Graph

1 → 2 → 3 ───────────────────────┐
4 → 5 → 6 → 7 → 8 → 9 → 10 ────┴→ 11 → 12

Task 11 also directly consumes Task 6's step-runner contract. Overlapping file sets further serialize ready tasks; dependencies express real contract needs, not arbitrary order.

## Integration Points and Coverage Ownership

| Changed boundary | Sole integration owner | Lower-layer support |
| --- | --- | --- |
| Selected GitHub state and enriched context reach repair; preparation failure prevents repair | Task 11, production daemon callback in a bounded sweep flow | Tasks 1–3 adapter/normalization/budget permutations |
| Effective build policy and direct session result reach provider invocation | Task 6, DefaultStepRunner.resolveCiFailure | Tasks 4–5 no-start and fallback permutations |
| Committed work qualifies for verification | Task 7, runCiFix | Local Git HEAD assertions |
| Guard/configured verifier failure stops publication | Task 8, runCiFix | Existing guard and verifier adapters |
| Successful/lease-refused publication reaches final repair outcome | Task 9, runCiFix | Fixture-owned local lease semantics |
| Repair outcomes reconcile persisted count/cooldown/remote reset | Task 10, sweepMergeableLabels | Existing eligibility helpers |
| Diagnostic reaches durable stream and renderer without gaining control authority | Task 12, root daemon event persistence | Sink registry and bounded payload tests |

Coverage remains at these scoped integration and lower layers: no additional distinct system flow requires an acceptance spec beyond them. BUILD entry must retain this disposition rather than duplicating every permutation at system level. Existing sufficient proof: mergeable-sweep-ci-fix.test.ts's TR-2 green reset, TR-3 reserve-before-dispatch, at-most-once, disabled/conflict/sticky fixtures, and failed-rollup-with-running-check / pending-commit-status deferrals; Task 10 retains and extends their assertions where results change.

## Coverage Check

> **Amended 2026-09-11 by #2153:** Coherence review found that individual primary-owner rows below do not always name every contributing completion check. The original rows remain; the composite criterion mappings in `.docs/coherence/restore-failing-ci-check-context-in-ci-fix-session.md` govern complete proof, including diagnostic delivery, boundary decoding and attempt reconciliation. Separate Story citation lines have been added to the affected tasks so the parser records their already-approved cross-story responsibilities. Task 12 additionally makes the existing ADR-required resolver error categories explicit in Done when; its approved Steps already require those categories. These corrections add no implementation scope.

Each row quotes the extracted criterion verbatim and an owning task's exact completion check. “diff-local” means the implementation and deterministic fake-boundary proof are delivered here; it does not promise an external service will remain available. All negative-path permutations have an explicit disposition in the cited task.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an otherwise eligible PR with completed failed check runs, when repair starts, then its supplied context contains the failed check names and available detail links from the check state used to select that PR. | 11 | "The production daemon CI-fix callback integration sends the selected GitHub rollup names/contexts/links and bounded enriched hint to the fake provider, including mixed statuses and missing/unnamed metadata, with no second check listing." | diff-local |
| Story 1 happy: Given an eligible mixed rollup containing failed check runs and completed external commit statuses, when repair context is prepared, then it includes the relevant failing names or contexts and available links, including terminal failure states already supported by CI-fix eligibility beyond the literal FAILURE value. | 11 | "The production daemon CI-fix callback integration sends the selected GitHub rollup names/contexts/links and bounded enriched hint to the fake provider, including mixed statuses and missing/unnamed metadata, with no second check listing." | diff-local |
| Story 1 negative: Given the check listing cannot be read because of authentication, permission, timeout, or other API failure, when eligibility/context preparation runs, then no repair starts, no repair attempt is consumed, and an attributed diagnostic distinguishes the retrieval failure from an empty successful result. | 11 | "Production sweep/dispatch fixtures distinguish authentication, permission, timeout/API, malformed and empty-context failures and leave provider calls and net attempt deltas at zero; optional log failure instead retains usable context and permits repair." | diff-local |
| Story 1 negative: Given required check data is malformed or no usable failed-check context is available, when repair preparation runs, then it defers with a concrete context error and neither starts a blind repair nor consumes an attempt. | 11 | "Production sweep/dispatch fixtures distinguish authentication, permission, timeout/API, malformed and empty-context failures and leave provider calls and net attempt deltas at zero; optional log failure instead retains usable context and permits repair." | diff-local |
| Story 1 negative: Given a failed check has a usable name but no detail link, when context is prepared, then the name remains present and no URL is invented; an unnamed entry is identified explicitly rather than silently omitted or assigned another check's name. | 2 | "buildCiFixHint tests select terminal failures from the typed snapshot, retain check-run names/external contexts and available links, exclude successful entries, and explicitly identify unnamed checks without inventing a URL." | diff-local |
| Story 1 negative: Given any rollup entry is still pending or running, when the sweep considers the PR, then the existing terminal-check gate prevents repair and leaves the attempt count unchanged. | 10 | "Sweep eligibility fixtures cover draft, conflicting, pending/running checks, cooldown, sticky remediation, serial guard and disabled repair with zero new attempts; the existing at-most-once-per-tick fixture continues to dispatch only one candidate." | diff-local |
| Story 2 happy: Given failed checks with available job logs, when repair context is enriched, then relevant excerpts accompany the known check identities and links within a finite total context budget. | 11 | "The daemon callback passes the three-request/24,576-byte enrichment boundary with explicit omissions to the provider; tests establish that Tasks 1–3 normalization and budgets are reached from production wiring, not only by direct helper calls." | diff-local |
| Story 2 happy: Given multiple failed checks refer to the same workflow run, when optional logs are gathered, then enrichment does not repeat the same full-run retrieval for each check and the relevant failed checks remain identifiable. | 3 | "Optional enrichment tests issue no more than three unique repository/run requests, do not duplicate shared-run retrieval, and preserve names/links plus classified degradation after denied, timed-out or unavailable logs." | diff-local |
| Story 2 negative: Given log retrieval times out, is denied, or the log is unavailable, when enrichment completes, then the usable names and links remain in the repair context and an attributed degradation diagnostic identifies the optional-log failure. | 11 | "Production sweep/dispatch fixtures distinguish authentication, permission, timeout/API, malformed and empty-context failures and leave provider calls and net attempt deltas at zero; optional log failure instead retains usable context and permits repair." | diff-local |
| Story 2 negative: Given logs or check metadata exceed the documented enrichment/context limits, when context is built, then retrieval work and output size stay within those limits and any omitted context is marked explicitly rather than presented as complete. | 3 | "buildCiFixHint tests enforce the 24,576-byte total, 12,288-byte metadata, 64-entry and per-field limits with explicit omission markers, including multibyte text, while retaining useful check identities before allocating log space." | diff-local |
| Story 3 happy: Given a working Codex-only or Claude-only build configuration, when CI repair runs, then it uses that provider and the effective build model and effort; Codex-only repair does not depend on a Claude executable being installed. | 6 | "DefaultStepRunner.resolveCiFailure integration tests capture provider-native build model/effort, selected-first fallback order and fresh sessions for Codex-only, Claude-only and overridden preference, with no independent Claude probe." | diff-local |
| Story 3 happy: Given build has an explicit provider preference different from the first run-level provider, when CI repair runs, then build's preferred provider is tried first and allowed fallback follows the existing configured order with provider-native model and effort settings. | 6 | "DefaultStepRunner.resolveCiFailure integration tests capture provider-native build model/effort, selected-first fallback order and fresh sessions for Codex-only, Claude-only and overridden preference, with no independent Claude probe." | diff-local |
| Story 3 happy: Given the selected Codex readiness probe is inconclusive in a case where the existing provider policy permits ordinary dispatch, when CI repair runs, then it reports degraded readiness and permits the actual invocation to determine the outcome. | 6 | "DefaultStepRunner.resolveCiFailure tests propagate no-start/failure/session-completed through provider-aware and legacy paths, preserve inconclusive-readiness and forbidden-fallback dispositions, and leave absent custom-provider evidence conservative." | diff-local |
| Story 3 negative: Given the preferred provider is explicitly unavailable in a way the existing fallback policy allows, when a configured fallback is usable, then repair uses that fallback with a fresh provider-native session and does not require the unavailable provider to pass an independent global probe. | 6 | "DefaultStepRunner.resolveCiFailure integration tests capture provider-native build model/effort, selected-first fallback order and fresh sessions for Codex-only, Claude-only and overridden preference, with no independent Claude probe." | diff-local |
| Story 3 negative: Given affirmative authentication failure, permission denial, or an ordinary execution failure, when the shared provider policy forbids fallback for that result, then repair retains the classified failure rather than selecting another provider or reporting a successful repair. | 6 | "DefaultStepRunner.resolveCiFailure tests propagate no-start/failure/session-completed through provider-aware and legacy paths, preserve inconclusive-readiness and forbidden-fallback dispositions, and leave absent custom-provider evidence conservative." | diff-local |
| Story 3 negative: Given all eligible providers are affirmatively prevented from starting a repair, when dispatch finishes, then the operator receives the relevant provider/reason and the result does not claim an attempted successful session. | 6 | "DefaultStepRunner.resolveCiFailure tests propagate no-start/failure/session-completed through provider-aware and legacy paths, preserve inconclusive-readiness and forbidden-fallback dispositions, and leave absent custom-provider evidence conservative." | diff-local |
| Story 3 negative: Given a supported custom or legacy provider has no Claude/Codex-specific readiness probe or no affirmative no-start evidence, when repair is dispatched, then no new provider-specific probe is required and the absence of evidence cannot authorize an attempt refund. | 6 | "DefaultStepRunner.resolveCiFailure tests propagate no-start/failure/session-completed through provider-aware and legacy paths, preserve inconclusive-readiness and forbidden-fallback dispositions, and leave absent custom-provider evidence conservative." | diff-local |
| Story 4 happy: Given a repair proceeds past preparation, when its reserved attempt is reconciled, then an attempted repair consumes exactly one attempt regardless of the number of provider/model fallback candidates used within it. | 10 | "sweepMergeableLabels integration tests observe reservation before dispatch and exactly one consumed attempt for noop, failed, published, unknown or thrown results; affirmative no-start/branch-gone restores the prior count and cooldown while retaining failure-detection state." | diff-local |
| Story 4 happy: Given a later sweep observes GitHub CI green, when it reconciles the watched PR, then the existing attempt reset and failure-detection reset occur. | 10 | "A later GitHub-green fixture resets attempts/failure detection through the existing sweep transition, while local publication followed by failed CI retains cooldown/cap and reaches existing sticky escalation when exhausted." | diff-local |
| Story 4 negative: Given direct execution evidence proves no repair started, when the reserved attempt is reconciled, then the previous attempt count and repair cooldown timestamp are restored while the PR's failure-detection state remains intact. | 10 | "sweepMergeableLabels integration tests observe reservation before dispatch and exactly one consumed attempt for noop, failed, published, unknown or thrown results; affirmative no-start/branch-gone restores the prior count and cooldown while retaining failure-detection state." | diff-local |
| Story 4 negative: Given an earlier candidate actually attempted repair and a later candidate is skipped or fails before execution, when the result is reconciled, then the consumed attempt remains; the final refusal cannot erase the earlier attempt. | 5 | "ModelAvailabilityTracker and executeProviderCandidates tests preserve no-start only when every unsuccessful candidate has affirmative proof; earlier attempted or unknown execution survives a later refusal across both model and provider fallback." | diff-local |
| Story 4 negative: Given a dispatch throws or returns an unknown/ambiguous result without affirmative no-start proof, when accounting completes, then the reserved attempt is retained and neither a refund nor a green reset occurs. | 10 | "sweepMergeableLabels integration tests observe reservation before dispatch and exactly one consumed attempt for noop, failed, published, unknown or thrown results; affirmative no-start/branch-gone restores the prior count and cooldown while retaining failure-detection state." | diff-local |
| Story 4 negative: Given repair produces no committed change, fails, or verifies and publishes locally while GitHub is not yet green, when accounting completes, then the consumed attempt remains and the existing cooldown/cap still applies. | 10 | "sweepMergeableLabels integration tests observe reservation before dispatch and exactly one consumed attempt for noop, failed, published, unknown or thrown results; affirmative no-start/branch-gone restores the prior count and cooldown while retaining failure-detection state." | diff-local |
| Story 4 negative: Given a PR is draft, conflicting, still has running checks, is cooling down, has sticky remediation, or is blocked by the existing serial guard, when the sweep runs, then it does not start that repair or consume a new attempt; at most one repair dispatch occurs per tick. | 10 | "Sweep eligibility fixtures cover draft, conflicting, pending/running checks, cooldown, sticky remediation, serial guard and disabled repair with zero new attempts; the existing at-most-once-per-tick fixture continues to dispatch only one candidate." | diff-local |
| Story 4 negative: Given attempts are exhausted and CI remains failed, when the existing escalation path runs, then its sticky escalation behavior remains in force and local publication or a missing diagnostic cannot reset the counter. | 10 | "A later GitHub-green fixture resets attempts/failure detection through the existing sweep transition, while local publication followed by failed CI retains cooldown/cap and reaches existing sticky escalation when exhausted." | diff-local |
| Story 5 happy: Given a provider successfully commits a repair, when preservation checks and the configured verifier pass and publication succeeds, then the daemon reports verified publication while leaving GitHub's later CI verdict distinct. | 9 | "runCiFix integration tests return published only in guards-then-configured-verifier-then-lease-push order after a committed repair." | diff-local |
| Story 5 happy: Given a repair session is started, when it receives its instructions, then the session is responsible for diagnosis and committing the repair while the daemon retains ownership of tests and publication. | 6 | "Both repair execution paths supply diagnosis-and-commit instructions with daemon ownership of verification/publication, asserted at the fake provider invocation boundary." | diff-local |
| Story 5 negative: Given the provider returns failure or produces no committed change, when the wrapper evaluates the result, then it reports failure or no change rather than inventing a changed success and does not publish a repair. | 7 | "runCiFix boundary tests return noop for unchanged HEAD/uncommitted-only edits and failed for provider failure even with changed HEAD; none reaches verifier or publication." | diff-local |
| Story 5 negative: Given preservation checks refuse the proposed repair, when the wrapper completes, then it reports the failed stage and does not run publication or claim verified success. | 8 | "runCiFix integration tests assert preservation refusal returns failed at the guard stage before verification/push, and configured verifier nonzero, throw or unavailable proof returns failed at verification before push." | diff-local |
| Story 5 negative: Given the configured verifier fails or cannot establish required verification, when the wrapper completes, then it reports verification failure and does not publish or claim verified success. | 8 | "runCiFix integration tests assert preservation refusal returns failed at the guard stage before verification/push, and configured verifier nonzero, throw or unavailable proof returns failed at verification before push." | diff-local |
| Story 5 negative: Given verification passes but the lease-protected push is refused, including a concurrent branch update, when the wrapper completes, then it reports publication failure, preserves remote work, and does not claim verified publication. | 9 | "A fixture-owned concurrent branch update makes pushRefreshedBranch refuse publication; runCiFix returns publication failure and the remote competing commit remains intact." | diff-local |
| Story 5 negative: Given an earlier repair stage fails, when the failure passes through dispatcher and sweep handling, then no caller converts it into a green or successful-publication result and the consumed attempt is retained unless no-start was affirmatively established. | 11 | "Daemon startup/callback integration honors Codex-only and Claude-only effective build configuration without the independent Claude veto, and forwards direct provider/guard/verifier/publication failures or published results unchanged to sweep reconciliation." | diff-local |
| Story 6 happy: Given context retrieval, optional-log enrichment, readiness, verification, or publication reports a failure, when the daemon handles it, then the existing persisted event stream and operator rendering identify the PR/feature, stage, bounded classified reason, and provider when known. | 12 | "Root daemon emitter/persister/reader integration retains and renders PR/slug, stage, classified reason and known provider for context, log, readiness/execution, guard, verification and publication diagnostics, including reading the same records after restarting the reader." | diff-local |
| Story 6 happy: Given the daemon is restarted after a recorded repair diagnostic, when its existing event reader reads the retained event data, then the same diagnostic remains readable without consulting a separate CI-repair log format or reconstructing it from current state. | 12 | "Root daemon emitter/persister/reader integration retains and renders PR/slug, stage, classified reason and known provider for context, log, readiness/execution, guard, verification and publication diagnostics, including reading the same records after restarting the reader." | diff-local |
| Story 6 negative: Given an event sink or renderer fails, when a repair outcome is reconciled, then fallback selection, attempt accounting, verification, and publication outcomes remain determined by execution results rather than by diagnostic delivery. | 12 | "Sink/renderer failure fixtures preserve direct fallback, attempt, verification and publication outcomes; no-start is never rendered as an attempted successful repair and published is never rendered as remote green." | diff-local |
| Story 6 negative: Given failure payloads contain oversized details or credential-bearing provider diagnostics, when the diagnostic is recorded, then the retained record stays bounded and uses the permitted classified facts without copying raw credential-bearing payloads. | 12 | "Diagnostic boundary tests keep serialized records at or below 8,192 UTF-8 bytes and exclude raw credential-bearing/oversized provider payloads while preserving bounded permitted facts and explicit attribution truncation." | diff-local |
| Story 6 negative: Given a provider refusal or successful local publication is observed, when diagnostics are emitted, then the record cannot mislabel the former as an attempted successful repair or the latter as remote CI green. | 12 | "Sink/renderer failure fixtures preserve direct fallback, attempt, verification and publication outcomes; no-start is never rendered as an attempted successful repair and published is never rendered as remote green." | diff-local |

## Architecture Obligation Coverage

The only changed land-accepted ADR is the startup-preflight/error-classification ADR; its adjacent amendment is part of this DECIDE change, never a BUILD mutation. The architecture review is a review artifact, not a new ADR.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification#D1 | task | task-6, task-11 | Daemon startup/callback integration honors Codex-only and Claude-only effective build configuration without the independent Claude veto, and forwards direct provider/guard/verifier/publication failures or published results unchanged to sweep reconciliation. |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification#D2 | task | task-12 | Root daemon emitter/persister/reader integration retains and renders PR/slug, stage, classified reason and known provider for context, log, readiness/execution, guard, verification and publication diagnostics, including reading the same records after restarting the reader. |

## Verify-Claims Ledger

Verified from source: prMergeState reads the rollup already; buildCiFixHint currently expects a different shape; resolveCiFailure uses the build execution path but drops success; model and provider fallback can replace earlier results; runCiFix returns changed after failed gates; sweep resets on green-verified; the root daemon bus already persists registered events. Source names and relevant traits appear in Technical Approach and the owning tasks. These are static findings, not live-provider test results.

Confirmed input: expanded reliability scope and inheritance of existing build provider/model/effort/fallback were approved by the operator. No new external API, service availability or provider lifecycle is assumed. Exact finite budgets and optional no-start result shape are plan design choices submitted for approval. All behavioral outcomes are conditional on explicit fake inputs or observed returned results; no outside-diff truth is required and no coherence waiver is proposed.

## Verification

- [x] All 37 happy/negative criteria map to a task and exact completion quote.
- [x] Every task has explicit dependencies, precise files, scoped RED/GREEN and 2–5 one-line falsifiable completion checks.
- [x] Every changed production boundary has one integration owner; negative permutations are assigned to behavior-owning tasks.
- [x] No terminal catch-all validation task, unrelated artifact mutation or ordinary documentation task is included.
- [x] Changed ADR decisions have explicit implementation coverage.


## Authoring checks

Protected-target scan: no violations. Both architecture diagrams render. Final advisory overlap scan with the source issue supplied:

```text
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts
Note: renames or name-only diffs may not be detected by this scan.
```

The retry completed without the initial network error and reported no dependency blocker. This is shared-file coordination information, not an assertion that the branches conflict semantically. The named branch concerns self-host guardrail wiring; the current work keeps those guardrails intact.
