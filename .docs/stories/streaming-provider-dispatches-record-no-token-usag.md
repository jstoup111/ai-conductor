**Status:** Accepted

# Stories: Streaming provider dispatches record no token usage or cost

**Issue:** jstoup111/ai-conductor#1857
**Track:** technical (no PRD — acceptance criteria live here)
**Governing decisions:** `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`,
`adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`
**Scope boundary:** per `.docs/track/streaming-provider-dispatches-record-no-token-usag.md` — close
the usage-capture gap on the streaming dispatch path for both providers. Reworking the reported
totals line is out of scope and is tracked as jstoup111/ai-conductor#1863.

**Outcomes referenced below** (from the issue's Desired outcome):
`outcome-1` a completed feature's reported cost and token totals account for every dispatch that
actually ran, regardless of which dispatch path the step used;
`outcome-2` a dispatch whose usage genuinely cannot be measured is visibly reported as unmeasured
and never silently folded into a figure presented as a total;
`outcome-4` steps that already report usage keep reporting it unchanged, and no dispatch acquires a
fabricated or estimated cost as a side effect.

## Story 1: A streaming step's dispatch records its token usage

**Requirement:** outcome-1

As an operator reading a completed feature's cost, I want every streaming step's dispatch to record
its token usage so that the reported figure covers the work that actually ran.

### Acceptance Criteria

#### Happy Path
- Given a step outside `AUTONOMOUS_STEPS` dispatched through the engine, when the dispatch completes successfully, then its emitted `provider_attempt` event carries a `tokenUsage` object with input, output, and cache token counts.
- Given a claude-routed streaming dispatch that completes, when its usage is read, then `costUsd` is populated from the provider's reported cost.
- Given a codex-routed streaming dispatch that completes, when its usage is read, then token counts are populated and cost follows the rate-card pricing already in force.
- Given a feature whose steps are all streaming steps, when the feature finishes, then the count of dispatches recording no usage at all is zero.

#### Negative Paths
- Given a streaming dispatch whose provider exits non-zero before emitting a terminal result, when the dispatch is classified, then the result records no `tokenUsage` and the dispatch is classified `unmetered` rather than recorded as zero-cost.
- Given a streaming dispatch whose stdout is not parseable as the expected envelope, when the dispatch is classified, then the failure is surfaced as a provider/parse failure and no fabricated usage is attached.
- Given a streaming dispatch that is killed by a signal mid-stream, when the dispatch is classified, then partial observations do not become a completed usage record.

### Done When
- [ ] A test dispatching a streaming step through the engine asserts a non-undefined `tokenUsage` on the resulting `provider_attempt` event.
- [ ] A test asserts that a non-zero-exit streaming dispatch yields no `tokenUsage` and classifies as `unmetered`.
- [ ] A test asserts an unparseable streaming stdout produces a parse/provider failure rather than a usage record.

## Story 2: The engine reaches every provider through one dispatch member

**Requirement:** outcome-1

As a maintainer, I want the engine to call exactly one provider dispatch member so that a future
change to dispatch cannot land on one path and silently miss the other.

### Acceptance Criteria

#### Happy Path
- Given the engine source, when every provider dispatch call site is enumerated, then each one calls `invoke` and none calls a second dispatch member.
- Given an autonomous step and a streaming step, when both are dispatched, then both reach the provider through the same adapter entry point.
- Given the recovery menu's interactive-fix path, when it dispatches, then it reaches the provider through that same entry point with the REPL option set.
- Given each built-in adapter, when its dispatch implementation is inspected, then argument construction and completion classification are each reached by one path rather than duplicated per mode.

#### Negative Paths
- Given a source-level check over the engine, when it finds any engine call to a dispatch member other than `invoke`, then the check fails and names the call site.
- Given a streaming dispatch, when the engine dispatches it, then no wrapper substitutes a different provider method in place of `invoke`.

### Done When
- [ ] `grep` over `src/conductor/src` (excluding tests) returns no engine call to `invokeInteractive`.
- [ ] The `streamingProviderRuntimes` invoke-substituting wrapper is deleted, or retained with its substitution removed and its remaining delegation duty stated in a comment.
- [ ] A test asserts an autonomous step and a streaming step both reach the adapter through the same entry point.

## Story 3: The provider contract requires one dispatch member

**Requirement:** outcome-1

As a provider-plugin author, I want the contract to require only `invoke` so that the obsolete
second member is neither required of me nor silently invoked.

### Acceptance Criteria

#### Happy Path
- Given the `LLMProvider` type, when its members are inspected, then it declares no `invokeInteractive`.
- Given an `llm_provider` plugin entrypoint exporting only `invoke`, when the plugin loader validates it, then it loads successfully.
- Given an `llm_provider` plugin entrypoint exporting both `invoke` and an extra `invokeInteractive`, when the plugin loader validates it, then it still loads successfully and the extra member is never called.
- Given the reference provider plugin in `plugins/`, when it is compiled against the current contract, then it compiles and its tests pass.

#### Negative Paths
- Given an `llm_provider` plugin entrypoint exporting no `invoke`, when the plugin loader validates it, then loading fails with an error naming the missing `invoke` member.
- Given an `llm_provider` plugin entrypoint whose `invoke` is not a function, when the plugin loader validates it, then loading fails rather than registering an unusable provider.
- Given a plugin that exports only `invokeInteractive`, when the plugin loader validates it, then loading fails naming `invoke` — the removed member does not satisfy the requirement.

### Done When
- [ ] `LLMProvider` in `src/conductor/src/execution/llm-provider.ts` declares no `invokeInteractive` member.
- [ ] `plugin-loader.ts` validates `invoke` only; a test asserts an `invoke`-only plugin loads.
- [ ] A test asserts a plugin missing `invoke` fails to load with an error naming `invoke`.
- [ ] `plugins/recorder-provider` compiles against the revised contract and its existing tests pass.

## Story 4: Live observation is supplied as a seam on the dispatch

**Requirement:** outcome-1

As a maintainer, I want live observation to be carried by an optional consumer on the dispatch
options so that a later feature can extend it without another interface change.

### Acceptance Criteria

#### Happy Path
- Given a dispatch supplied with a stream consumer, when the provider emits stream observations, then the consumer receives them carrying running uncached input, cached input, and output token counts.
- Given a dispatch supplied with no stream consumer, when it runs, then it behaves exactly as the buffered dispatch does today and emits no observations to any consumer.
- Given a claude dispatch and a codex dispatch each supplied with a consumer, when each runs, then both deliver observations through that same consumer.

#### Negative Paths
- Given a dispatch supplied with a consumer whose callback throws, when an observation is emitted, then the dispatch continues to completion and the thrown error does not fail or terminate it.
- Given a dispatch supplied with a consumer, when the consumer attempts to influence the dispatch, then it has no timeout, kill, retry, or lifecycle authority and the dispatch is unaffected.
- Given a REPL dispatch, when it is constructed, then it supplies no stream consumer, and a dispatch that is both a REPL and carries a consumer is either unrepresentable or documented as leaving the consumer inert.

### Done When
- [ ] `InvokeOptions` carries one additive optional stream-consumer field, and every pre-existing caller omitting it compiles unchanged.
- [ ] A test asserts a consumer receives observations with non-zero token counts from a streaming dispatch on each provider.
- [ ] A test asserts a throwing consumer callback does not fail the dispatch.
- [ ] The REPL-plus-consumer combination is prevented in the type, or a comment on the field states why it is inert.

## Story 5: Every non-REPL dispatch requests the machine envelope

**Requirement:** outcome-1

As a maintainer, I want every non-REPL dispatch to request its provider's machine envelope so that
completion classification always has a parseable result to read.

### Acceptance Criteria

#### Happy Path
- Given a non-REPL claude dispatch, when its argument list is constructed, then it requests the stream-json envelope with the verbose flag.
- Given a non-REPL codex dispatch, when its argument list is constructed, then it requests the JSON envelope.
- Given a non-REPL dispatch on either provider, when completion is classified, then the classifier receives the envelope rather than the branch that discards usage.
- Given the installed codex CLI, when a real non-REPL dispatch runs against it in a smoke context, then its emitted envelope is parseable by the existing codex parser.

#### Negative Paths
- Given a non-REPL dispatch whose envelope is missing its terminal result record, when classification runs, then it reports a parse failure naming the missing record rather than silently returning empty output.
- Given a non-REPL dispatch whose envelope contains a terminal record with no usage fields, when classification runs, then the result carries no `tokenUsage` and classifies `unmetered`.
- Given a prompt large enough to exceed the argv length limit, when a non-REPL dispatch is constructed, then the prompt is delivered on stdin and the dispatch is not rejected before the provider starts.

### Done When
- [ ] A test asserts the constructed claude argument list for a non-REPL dispatch contains the stream-json and verbose flags.
- [ ] A test asserts the constructed codex argument list for a non-REPL dispatch contains the JSON flag.
- [ ] A test asserts a non-REPL dispatch never reaches the usage-discarding classification branch.
- [ ] A test asserts an oversized prompt is delivered on stdin rather than as an argument.

## Story 6: The REPL keeps plain text and its terminal

**Requirement:** outcome-4

As an operator using the recovery menu's interactive fix, I want the REPL to stay a readable
conversation so that the envelope change does not make it unusable.

### Acceptance Criteria

#### Happy Path
- Given a REPL dispatch, when its argument list is constructed, then it requests no machine envelope.
- Given a REPL dispatch, when it runs, then its standard input remains attached to the operator's terminal and its output is rendered as plain text.
- Given a REPL dispatch, when it completes, then the engine does not require a usage record from it.

#### Negative Paths
- Given a REPL dispatch, when its output is inspected, then it contains no machine-envelope records rendered to the operator.
- Given a REPL dispatch that produces no parseable usage, when the feature's totals are computed, then it is counted as unmetered and contributes no fabricated cost.

### Done When
- [ ] A test asserts the constructed REPL argument list contains no envelope flag on either provider.
- [ ] A test asserts a REPL dispatch keeps stdin attached to the terminal rather than receiving the prompt on stdin.
- [ ] A test asserts a REPL dispatch with no usage classifies as unmetered and adds no cost.

## Story 7: Unifying the dispatch preserves session and sandbox enforcement

**Requirement:** outcome-4

As a maintainer, I want the guarantees that live on the two dispatch bodies to survive their merge
so that unification does not silently drop an enforcement.

### Acceptance Criteria

#### Happy Path
- Given any dispatch through the unified path, when the adapter entry is reached, then fresh-session enforcement is applied and the dispatch carries a freshly minted session id.
- Given an unattended codex dispatch, when its argument list is constructed, then the workspace-write sandbox, network access, approval policy, and reviewer configuration are all present.
- Given any dispatch through the unified path, when the provider is selected, then the model-availability cache is consulted before dispatch and a model already marked dead is substituted with the first live ladder model.
- Given an autonomous step dispatched after unification, when its behavior is compared with before, then its text output and its recorded usage are unchanged.
- Given a dispatch supplied with a branch session id, when it is dispatched, then it reaches the provider through the same unified entry point as every other dispatch.

#### Negative Paths
- Given a dispatch that attempts to reuse a prior provider session, when it reaches the adapter entry, then fresh-session enforcement overrides it and no session is resumed.
- Given a dispatch whose resolved model is marked dead and whose ladder has no live model, when it is dispatched, then the substitution does not silently hand over a dead model.
- Given an interactive codex dispatch, when its argument list is constructed, then the unattended sandbox configuration is not applied to it.
- Given the unified path, when a self-host dispatch runs, then executable resolution and self-host auth handoff still occur and are not lost with the removed method.

### Done When
- [ ] A test asserts fresh-session enforcement is applied on the unified path for both providers.
- [ ] A test asserts the unattended codex argument list still contains every sandbox and approval configuration entry it contains today.
- [ ] A test asserts an autonomous step's recorded text output and usage are unchanged after unification.
- [ ] A test asserts self-host executable resolution still occurs on a streaming dispatch.
- [ ] A test asserts the model-availability cache is consulted before dispatch on the unified path and substitutes a live model for one marked dead.
- [ ] A test asserts a branch-session dispatch reaches the same entry point as a non-branch dispatch.

## Story 8: No dispatch acquires a fabricated cost

**Requirement:** outcome-2, outcome-4

As an operator making a budgeting decision, I want restored measurements to be real so that no
figure is invented to make the totals look complete.

### Acceptance Criteria

#### Happy Path
- Given a dispatch whose envelope reports tokens and a cost, when it is classified, then it is fully metered and its reported cost is the provider's own figure or the committed rate-card price, never an estimate.
- Given a dispatch whose envelope reports tokens but no cost and whose model is absent from the rate card, when it is classified, then it is `cost-unmetered`, contributing tokens and no cost.
- Given a dispatch that records no usage at all, when it is classified, then it is `unmetered` and contributes neither tokens nor cost.
- Given a completed feature, when its totals line is produced, then dispatches that recorded no usage are still counted and reported as unmetered.

#### Negative Paths
- Given a dispatch with no usage record, when totals are computed, then it does not contribute a zero-dollar entry counted as measured.
- Given a dispatch whose envelope reports a non-finite or non-numeric cost, when it is classified, then it is not treated as fully metered.
- Given a streaming dispatch whose observations reported running token counts but which never completed, when totals are computed, then those partial observations do not become a usage record.

### Done When
- [ ] A test asserts a usage-absent dispatch classifies `unmetered` and adds neither tokens nor cost.
- [ ] A test asserts a non-finite reported cost does not classify as fully metered.
- [ ] A test asserts partial stream observations from an incomplete dispatch produce no usage record.
- [ ] No code path introduced by this feature writes a cost value the provider or the committed rate card did not supply.

## Story 9: The operator can still watch a streaming step run

**Requirement:** outcome-4

As an operator watching an unattended step, I want live visibility to survive the move from
inherited output to observer-rendered output so that the telemetry fix does not cost me the view.

### Acceptance Criteria

#### Happy Path
- Given a streaming step running under the unified dispatch, when the operator observes it in progress, then progress is visible before the step completes rather than only at its end.
- Given a streaming step in progress, when its live token burn is read from the daemon status surface, then it reports running uncached input and output token counts for that step.
- Given a streaming step on a provider that can observe child activity, when it is running, then the active child count is reported rather than reported as unknown.

#### Negative Paths
- Given a streaming step whose provider emits no observations for an extended period, when the operator observes it, then the step is still shown as running and is not reported as stalled solely because no observation arrived.
- Given a streaming step on a provider that cannot observe child activity, when its status is read, then child observability is reported as unsupported rather than as a count of zero.
- Given a comparison of the operator-visible output of one streaming step before and after this change, when the two are reviewed, then any loss of information is recorded and accepted, or the rendering is corrected.

### Done When
- [ ] A documented before/after comparison of one streaming step's operator-visible output is recorded in the feature's evidence, with any accepted loss stated explicitly.
- [ ] A test asserts live token counts are reported for a streaming step while it is still running.
- [ ] A test asserts a provider without child observability reports `unsupported` rather than zero.
