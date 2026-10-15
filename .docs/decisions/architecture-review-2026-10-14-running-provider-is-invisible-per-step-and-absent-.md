# Architecture Review: Live provider identification per attempt (#1268)
**Date:** 2026-10-14
**Mode:** Lightweight (Tier M) — Sections 2 and 4 only
**Input reviewed:** PRD `.docs/specs/running-provider-is-invisible-per-step-and-absent-.md` (FR-1–FR-11);
diagram `.docs/architecture/running-provider-is-invisible-per-step-and-absent-.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new package or service. Adds one `ConductorEvent` variant plus renderer cases. |
| Prerequisites | None. |
| Integration surface | types → engine (`provider-execution.ts`, `step-runners.ts`, `event-sinks.ts`) → two renderers. Crosses three layers along an existing path; no external API. |
| Data implications | Additive event variant in `.pipeline/events.jsonl`. Historical files lack it, and readers that switch on `type` ignore unknown variants (consumers such as `daemon-dashboard.ts` and `timing-rollup.ts` filter by exact type). No migration. |
| Performance | One event per invoked candidate (per model rung). Bounded by the fallback ladder length. |
| Worktree isolation | No ports, databases or shared files. Events stay in the per-worktree `.pipeline/`. |

**Grounded claims:**
- *Per-candidate start point exists, after the skip decision and with provider and model in hand.* 95%, verified. In the candidate loop of `engine/provider-execution.ts` (`executeProviderCandidates`), `candidate = { step, providerKey, model: resolved.model, effort }` is built per candidate. Skipped candidates (`setupUnavailable` / `runWideUnavailable`) are reported through the existing `provider_attempt` with `invoked: false`. The real launch goes through `invokeProvider` → `invokeProviderCandidate`, and within-provider model rungs pass through `onModelRung({ providerKey, model })`.
- *Every dispatch path crosses `executeProviderCandidates`, but not every path crosses `StepRunners`.* 95%, verified. The project prelude (`engine/project-prelude.ts`) calls the executor directly, forwarding only `onAttempt` and `warn`. Recovery dispatches build a slug-scoped `ProviderExecutionContext` in `daemon-cli.ts` and run it through a `DefaultStepRunner`. The start callback therefore belongs at the executor/context boundary beside `onAttempt`, and every executor caller forwards it.
- *A per-rung cache can skip invocation.* 95%, verified. The build-review rubric `onModelRung` in `step-runners.ts` can return a cached result without calling `invoke()`. The callback therefore fires inside `invokeProviderCandidate`'s `invokeModel`, immediately before `runtime.provider.invoke`, never before the cache decision.
- *`executionContext` is in scope at the emission site.* 95%, verified. `executeProviderCandidates` already takes `executionContext` as an input and passes it to `onAttempt`. `StepRunners.dispatchProviderWithLifecycleSupervision(step, baseOptions, run, dispatchRunId, executionContext)` already stamps `executionContext` onto lifecycle `provider_attempt` events through `this.providerAttempt`. Built-in validation and build_verification members are distinct `StepName`s (`subject.kind: 'lifecycle-step'`). Configured parallel members carry `subject.kind: 'configured-member'` with `parentGroup` and `member`.
- *The interactive (REPL) path has no stream observer.* 97%, verified. `candidateObserver = ownedCandidateOptions.interactive ? undefined : providerStreamObserverForCandidate?.(providerKey)`. The start signal must therefore not ride on the observer (Condition 1).
- *The daemon log renders `render: true` sink rows automatically for feature dispatches.* 95%, verified. `daemon-cli.ts` subscribes `renderedEventTypes()` → `renderDaemonEvent` for each feature dispatch. The slug-scoped recovery execution (`createSlugScopedProviderExecution`) instead subscribes `provider_attempt`, `provider_fallback` and `session_policy` **by name** (Condition 3).
- *The terminal renderer picks up `render: true` types.* 95%, verified. `TerminalRenderer` builds `fallbackEventTypes` from `renderedEventTypes()` minus `DEDICATED_EVENT_TYPES`. The new type needs a dedicated case to format the member label (FR-3).

## Alignment

- **Event spine (CLAUDE.md Design Principle; `.agents/skills/event-spine/SKILL.md`).** The design adds one variant to the existing `ConductorEvent` union, emitted through `ConductorEventEmitter` and persisted by `EventPersister`. There is no second channel. This is aligned.
- **Sink registry exhaustiveness (`adr-2026-07-26-event-sink-registry-exhaustiveness`, APPROVED).** It governs this change and is reused: the new variant takes one `EVENT_SINKS` row (`render: true, persist: true`). `audit` and `otel` are set by the implementer following the `provider_attempt` row. No new ADR.
- **Provider contract (`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`, APPROVED).** That ADR keeps the `LLMProvider` adapter contract to one dispatch member, with live observation as a seam on it. This feature's callback belongs to the **engine's** candidate executor, not to the adapter. Putting it on `LLMProvider` or on adapter-facing invoke options would widen the contract that ADR narrowed (Condition 1).
- **Live stream observation (`adr-2026-08-19-live-provider-stream-observation`).** Not reused for the start signal. Stream progress is throttled and token-driven, so it cannot satisfy FR-1, FR-2 or FR-8. Its observation-only boundary is unchanged.
- **Domain boundaries.** The engine emits and the UI renders. No UI import enters the engine, consistent with the recent engine/UI cycle break (`2026-10-12-break-the-engine-ui-import-cycle-and-stop-types-im`).
- **State.** The provider field is a non-empty string. The explicit unknown (FR-8) must be a distinct, typed representation, not an empty string or `undefined` that renderers could confuse with "absent" (Condition 2).
- **ADR need.** No structural decision is made here (no boundary, decomposition, integration pattern, persistence model or technology). Governing ADRs above are reused, so no new ADR is created.
- **Diagram accuracy.** The approved component and sequence diagram matches the verified call path.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| `provider_attempt_started` `ConductorEvent` variant | Emitted by the shared `providerExecutionEventCallbacks(eventTarget).onCandidateStart`, which both production contexts spread: `daemon-cli.ts` `createProviderExecution` (feature and slug-scoped recovery dispatches) and the `providerExecution` object in `src/conductor/src/index.ts` (interactive runs). It sits beside the existing `onAttempt` → `provider_attempt` mapping. |
| `subscribeScopedProviderRendering` (`daemon-cli.ts`) | Called by `createSlugScopedProviderExecution` in place of its inline by-name subscriptions. |
| `onCandidateStart` on `ExecuteProviderCandidatesInput` / `ProviderExecutionContext` | Invoked by `executeProviderCandidates` in `engine/provider-execution.ts` once per actually invoked candidate and model rung, before the provider process runs. `StepRunners` forwards the context's callback into every executor input it builds, and `project-prelude.ts` forwards it next to `onAttempt`. |
| `formatProviderStartLine` (`ui/provider-start-line.ts`) | Called by the `renderDaemonEvent` case and the `TerminalRenderer` dedicated case. |
| `EVENT_SINKS` row | Consumed by the existing `renderedEventTypes()` subscription in `daemon-cli.ts`, the `TerminalRenderer` constructor, and `EventPersister`. |
| `renderDaemonEvent` case | Existing per-feature `renderedEventTypes()` loop in `daemon-cli.ts`, plus the slug-scoped recovery subscription (Condition 3). |
| `TerminalRenderer` dedicated case | Existing `TerminalRenderer.handle` switch; type added to `DEDICATED_EVENT_TYPES`. |

**Overlap scan (advisory):** `src/conductor/src/daemon-cli.ts` overlaps unmerged `origin/spec/self-host-phase6-wiring`. This is not blocking; expect a rebase in `renderDaemonEvent` / the subscription block.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Start line printed into a terminal the interactive provider then owns | Technical | Low | Low | Emit before the provider process launches. `LiveRegion.log` writes plainly while suspended. |
| Recovery-scoped daemon path misses the new event | Integration | Medium | Medium | Condition 3. |
| Callback leaks onto the adapter contract | Technical | Low | Medium | Condition 1. |
| Rebase conflict in `daemon-cli.ts` with self-host phase 6 | Integration | Medium | Low | Advisory only. Resolve at rebase. |
| A provider-execution context that does not map `onCandidateStart` silently shows no line | Integration | Low | Medium | Both production contexts map it (plan Task 3). Recovery dispatch is proven by plan Task 5. |

## ADRs Created

None. Governing ADRs reused: `adr-2026-07-26-event-sink-registry-exhaustiveness`,
`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`.

## Conditions

1. The candidate-start callback lives on the engine's candidate-execution input (`executeProviderCandidates` / `ExecuteProviderCandidatesInput`) and on `ProviderExecutionContext` beside `onAttempt`, and is never forwarded to an `LLMProvider` adapter. It fires on the interactive path too, independent of `providerStreamObserverForCandidate`.
2. The event represents an undeterminable provider as an explicit, typed unknown value. Renderers print `provider unknown` for it and never substitute a prior attempt's provider. Steps that dispatch no provider emit no event (FR-9).
3. `createSlugScopedProviderExecution` in `daemon-cli.ts` subscribes the new event type alongside `provider_attempt` (through the extracted `subscribeScopedProviderRendering`), so recovery-session dispatches also render it.
