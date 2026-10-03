# Implementation Plan: Pi runs report token usage and cost into harness telemetry

**Date:** 2026-10-02
**Design:** .docs/decisions/architecture-review-2026-10-02-pi-runs-report-token-usage-and-cost-into-harness-t.md
**Stories:** .docs/stories/pi-runs-report-token-usage-and-cost-into-harness-t.md
**Conflict check:** Clean as of 2026-10-02

## Summary

Fix the Pi adapter so that a completed Pi dispatch records the tokens Pi actually used, a cost from Pi or the committed rate card, and the model that ran. A dispatch with no usage records nothing rather than zeros. Pi also declares `costSelfReporting`. 12 tasks.

## Technical Approach

- **Parser (catalog D19).** `parsePiJsonl` in `src/conductor/src/execution/pi-provider.ts` sums `message.usage` over `message_end` events whose role is `assistant` or `toolResult`. Pi repeats each message on `message_start`, `message_update`, `turn_end` and `agent_end`, so those are never summed. This was verified in two live captures on 2026-10-02 and matches Pi's own `core/usage-totals.js`. `cacheWrite` maps to `cacheCreation` and `reasoning` maps to `reasoningOutput`. The zero-fill is removed: no usage-bearing message, or all-zero totals, means no `tokenUsage`, so the dispatch is `unmetered`.
- **Cost (catalog D20).** Resolution is all-or-nothing per dispatch. If every non-zero-token message has a finite positive `cost.total`, their sum is used with `costSource: 'provider'`. Otherwise each message is priced from the committed rate card by its model that ran (`responseModel ?? model`, bare), with `costSource: 'rate-card'`. Otherwise cost is absent, which is `cost-unmetered`. A `toolResult` message is never card-priced.
- **Rate card seam.** `PiProvider` gains an injected `RateCardLoader` defaulting to `loadRateCard`, called with `options.cwd ?? process.cwd()`. This mirrors `CodexProvider` (`src/conductor/src/execution/codex-provider.ts`, search `applyRateCard(` and `loadRates`). `loadRateCard` prefers the global `~/.ai-conductor/rate-card.json`, so tests that use the real loader redirect `$HOME` and call `clearRateCardCache()`.
- **Attribution (catalog D21).** `TokenUsage` gains an optional `attributedModel` (`src/conductor/src/execution/llm-provider.ts`). Only the Pi adapter sets it. The cost rollup, metering, the `## Cost` block and OTel are unchanged and still key on the requested `event.model`.
- **Catalog (catalog D22).** The pi descriptor declares `costSelfReporting: true` and the `#1889` owner entry is removed. `rateCardModelIds()` is unaffected because Pi ships no built-in model ids.
- **Tests.** Adapter behavior is tested in a new `src/conductor/test/execution/pi-provider-usage.test.ts` against fixtures copied from the real 2026-10-02 captures. Integration goes through `executeProviderCandidates`, `EventPersister`, `computeCostRollup` and `renderShippedRecordWithCost` in `src/conductor/test/engine/pi-cost-rollup.test.ts`. Tasks 1-9 all edit `pi-provider.ts`, so they run in sequence.

## Prerequisites

- None. #1884 and #1885 have shipped, and the catalog ADR amendment D19–D22 is APPROVED in this spec.

## Tasks

### Task 1: Sum Pi usage from message_end events only
**Story:** 1
**Type:** happy-path

**Steps:**
1. Add fixtures under `src/conductor/test/fixtures/pi/`: `worked-stream.jsonl`, a two-assistant-turn run encoding the worked stream (turn one input 120, output 40, cacheRead 300, cacheWrite 50, cost.total 0.0021; turn two input 80, output 25, cacheRead 400, cacheWrite 0, cost.total 0.0014; both `openai`/`gpt-5.6-luna`). It follows the real 2026-10-02 capture's event sequence: `session`, `agent_start`, `turn_start`, user `message_start`/`message_end`, then per assistant turn `message_start`, `message_update` events whose partial `message.usage` carries smaller numbers, `message_end`, `turn_end`, and a final `agent_end` whose `messages` array repeats both assistant messages, then `agent_settled`. Usage lives only on `message.usage`, never top-level.
2. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts` that drive `PiProvider.invoke` through the injected fake subprocess factory (the existing `src/conductor/test/execution/pi-provider.test.ts` pattern: a resolved `{ stdout, stderr, exitCode }` promise with a `kill` mock) and assert the returned `tokenUsage`.
3. Verify RED: the current parser reads a top-level `event.usage` and returns `{ input: 0, output: 0, numTurns: 2 }`.
4. Implement in `src/conductor/src/execution/pi-provider.ts`: `parsePiJsonl` sums `message.usage` over `message_end` events whose `message.role` is `assistant` or `toolResult` and whose usage has finite numeric `input` and `output` (catalog D19). Map `cacheWrite` to `cacheCreation`. `numTurns` counts assistant `message_end` events. Ignore every other event type for usage. Delete the top-level `usage` field from `PiJsonEvent`.
5. Replace the hand-authored top-level usage lines in `src/conductor/test/fixtures/pi/terminal-assistant.jsonl` with the real `message.usage` shape, and update the existing `src/conductor/test/execution/pi-provider.test.ts` usage assertions (including the "cumulative usage as cost-unmetered" test) to the summed per-message values.
6. Verify GREEN and commit.

**Done when:**
- For `worked-stream.jsonl` with exit 0, `PiProvider.invoke` returns `tokenUsage` with input 200, output 65, cacheRead 700, cacheCreation 50 and numTurns 2, as asserted in pi-provider-usage.test.ts.
- The partial `message.usage` on the fixture's `message_update` events is not counted: the asserted totals equal the two `message_end` sums exactly (input 200), as asserted in pi-provider-usage.test.ts.
- The repeated assistant messages on `message_start`, `turn_end` and `agent_end` are not counted: input is exactly 200, not 400 or 600, as asserted in pi-provider-usage.test.ts.
- No fixture under src/conductor/test/fixtures/pi/ carries a top-level `usage` key, and no test in pi-provider.test.ts asserts usage parsed from a top-level `event.usage`.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/fixtures/pi/worked-stream.jsonl`, `src/conductor/test/fixtures/pi/terminal-assistant.jsonl`

**Dependencies:** none

### Task 2: Count tool-result usage and map reasoning tokens
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts`: (a) the worked stream plus one `toolResult` `message_end` whose `message.usage` reports input 10, output 5, cacheRead 0, cacheWrite 0; (b) a single assistant turn whose usage reports output 40 and `reasoning` 30.
2. Verify RED.
3. Implement in `src/conductor/src/execution/pi-provider.ts`: tool-result usage joins the sums but not `numTurns`; `usage.reasoning`, when a finite number, is summed into `reasoningOutput` and never added to `output`.
4. Verify GREEN and commit.

**Done when:**
- For the worked stream plus the `toolResult` message, the returned `tokenUsage` has input 210, output 70 and numTurns 2, as asserted in pi-provider-usage.test.ts.
- For the turn reporting output 40 and reasoning 30, the returned `tokenUsage` has reasoningOutput 30 and output 40, as asserted in pi-provider-usage.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`

**Dependencies:** Task 1

### Task 3: Return no usage when Pi reported none
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add `src/conductor/test/fixtures/pi/error-stop-live-capture.jsonl`, the real 2026-10-02 OpenCode free-tier capture, normalized only in session id, `cwd`, timestamps and request id. It keeps its all-zero `message.usage` and its repeated `turn_end`/`agent_end` events.
2. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts` for exit-0 streams with a terminal assistant `message_end` that has: no `message.usage`; `message.usage.input` as a string; `message.usage.input` missing; a top-level `usage` on an event and none on `message.usage`; and usage with input, output, cacheRead and cacheWrite all 0 and stopReason `stop`. Assert the absence of the `tokenUsage` key, never a zero value.
3. Verify RED: today each case returns `{ input: 0, output: 0, numTurns: 1 }`.
4. Implement in `src/conductor/src/execution/pi-provider.ts`: remove the zero-fill. `parsePiJsonl` returns no `tokenUsage` when no usage-bearing message exists or the summed input, output, cacheRead and cacheWrite are all zero (catalog D19).
5. Verify GREEN and commit.

**Done when:**
- For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts.
- A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
- A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts.
- An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
- A conductor-level test asserts the `provider_attempt` event emitted for a no-usage dispatch carries no `tokenUsage` property at all (never input 0 / output 0), so the story's event-level claim is asserted end to end.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`, `src/conductor/test/fixtures/pi/error-stop-live-capture.jsonl`

**Dependencies:** Task 1

### Task 4: Failed Pi runs record no usage; malformed lines are skipped
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/execution/pi-provider-usage.test.ts`: the worked stream with exit code 1; `error-stop-live-capture.jsonl` with exit 0 (stopReason `error`); and the worked stream with a malformed JSONL line inserted between the two assistant turns.
2. Verify RED where the current code passes: the malformed-line case currently sums nothing because usage is read top-level.
3. Implement in `src/conductor/src/execution/pi-provider.ts` only what the tests require: the existing `exitCode === 0 ? parsed.tokenUsage : undefined` and error-stop returns stay, and the error-stop return carries no `tokenUsage`.
4. Verify GREEN and commit.

**Done when:**
- For the worked stream with exit code 1, `PiProvider.invoke` returns `success: false` and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
- For `error-stop-live-capture.jsonl` with exit 0, `PiProvider.invoke` returns `success: false` with the captured error message and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
- A conductor-level test asserts that for the exit-1 and `stopReason`-`error` dispatches the step fails and the `provider_attempt` event carries no `tokenUsage`.
- For the worked stream with a malformed line between the assistant turns, the returned `tokenUsage` has input 200 and output 65, as asserted in pi-provider-usage.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`, `src/conductor/test/fixtures/pi/error-stop-live-capture.jsonl`

**Dependencies:** Task 3

### Task 5: Use Pi-reported cost when every token-bearing message is priced
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts`: the worked stream; the worked stream with turn one's `cost.total` set to -1, then to `"NaN"` as a string; and the worked stream plus a third assistant turn with all-zero tokens and `cost.total` 0.
2. Verify RED.
3. Implement in `src/conductor/src/execution/pi-provider.ts` a Pi cost resolver (catalog D20(a)). It sums `cost.total` over usage-bearing messages with non-zero tokens when every one is a finite number greater than 0, and sets `costUsd` and `costSource: 'provider'`. A zero-token message is skipped. A negative, non-finite or non-numeric `cost.total` counts as unpriced.
4. Verify GREEN and commit.

**Done when:**
- For the worked stream the returned `tokenUsage.costUsd` is 0.0035 (toBeCloseTo, 12 digits), `costSource` is `provider`, and `classifyMetering` returns `fully-metered`, as asserted in pi-provider-usage.test.ts.
- When turn one reports `cost.total` -1 or a non-numeric value and no test card is supplied, the result carries no `costUsd` and no `costSource`, so the Pi figure was treated as absent, as asserted in pi-provider-usage.test.ts.
- With an added zero-token assistant turn reporting `cost.total` 0, `costUsd` is still 0.0035 with `costSource` `provider`, as asserted in pi-provider-usage.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`

**Dependencies:** Task 2

### Task 6: Fall back to the committed rate card for the model that ran
**Story:** 2
**Type:** happy-path

**Steps:**
1. Local pattern: follow the codex adapter's dispatch-time pricing (`src/conductor/src/execution/codex-provider.ts`, search `applyRateCard(` and the `RateCardLoader` constructor parameter). Keep these traits: pricing happens inside the adapter at dispatch time; the loader is injected with `loadRateCard` as the default; it is called with `options.cwd ?? process.cwd()`; an unknown model leaves usage unchanged. Allowed variation: Pi prices per message by the model that ran, not by the requested model.
2. Add a `loadRates: RateCardLoader = loadRateCard` constructor parameter to `PiProvider` after `subprocessFactory`. Leave the pi descriptor's `createAdapter` call relying on the default.
3. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts` with a test card carrying the committed `.ai-conductor/rate-card.json` rates for `gpt-5.6-luna` and `gpt-5.6-terra`: the worked stream with every `cost.total` 0, and with only turn two's `cost.total` 0. For the absent-card and unparseable-card cases, use the real `loadRateCard`: point `$HOME` at a temp directory, call `clearRateCardCache()`, and pass a temp `cwd` that has no `.ai-conductor/rate-card.json` in one case and a file containing `{not json` in the other.
4. Verify RED.
5. Implement catalog D20(b) in `src/conductor/src/execution/pi-provider.ts`. When D20(a) does not apply, and every non-zero-token usage-bearing message is an assistant message whose model that ran (`responseModel ?? model`, bare model part) is priced by the loaded card, sum `applyRateCard(messageUsage, model, card).costUsd` per message and set `costSource: 'rate-card'`. Otherwise leave cost absent.
6. Verify GREEN and commit.

**Done when:**
- With every `cost.total` 0 and the test card, the returned `costUsd` is 0.0001445 (toBeCloseTo, 12 digits), `costSource` is `rate-card`, and `classifyMetering` returns `fully-metered`, as asserted in pi-provider-usage.test.ts.
- With only turn two's `cost.total` 0 and the test card, `costUsd` is 0.0001445 with `costSource` `rate-card`, not 0.0021 plus a card price, as asserted in pi-provider-usage.test.ts.
- With every `cost.total` 0, $HOME redirected and no project card, `PiProvider.invoke` returns `success: true` with tokens but no `costUsd`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts.
- With every `cost.total` 0 and an unparseable project card, `PiProvider.invoke` resolves without throwing, returns `success: true`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts.
- For each of three variants of turn one's `cost.total` (-1, the JSON number `1e400` which parses to Infinity, and the string `"NaN"`) with the test card supplied, `costUsd` is 0.0001445 with `costSource` `rate-card`, so the Pi figure was treated as absent and resolution fell through to the rate card, as asserted in pi-provider-usage.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`

**Dependencies:** Task 5

### Task 7: Leave cost absent when any token-bearing message cannot be priced
**Story:** 2
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts` with a test card carrying the committed `.ai-conductor/rate-card.json` rates for `gpt-5.6-luna` and `gpt-5.6-terra`: (a) the worked stream with every `cost.total` 0 and provider `cline`, model `google/gemma-4-31b-it:free`; (b) the worked stream with turn two's `cost` object removed and turn two's model `unlisted-model`; (c) the worked stream plus a `toolResult` `message_end` with input 10, output 5 and `cost.total` 0, all other costs 0.
2. Verify RED where the behavior differs.
3. Implement in `src/conductor/src/execution/pi-provider.ts`: the all-or-nothing rule of catalog D20(c). Any non-zero-token message that is neither Pi-priced nor card-priced leaves `costUsd` and `costSource` absent. A `toolResult` message is never card-priced.
4. Verify GREEN and commit.

**Done when:**
- For case (a) the returned `tokenUsage` keeps input 200 and output 65, has no `costUsd` and no `costSource`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts.
- For the worked stream with turn two's `cost` object missing and turn two's model `unlisted-model` absent from the test card, the result has no `costUsd` key at all (not 0.0021), as asserted in pi-provider-usage.test.ts.
- For the worked stream with its own reported costs (0.0021 and 0.0014) plus one `toolResult` `message_end` with input 10, output 5 and `cost.total` 0, and the test card carrying the committed rates, the result has no `costUsd` key and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts.
- For case (a) `tokenUsage.attributedModel` is `cline/google/gemma-4-31b-it:free` although the dispatch is cost-unmetered, as asserted in pi-provider-usage.test.ts.
- A conductor-level test asserts the `provider_attempt` event for the cost-unmetered case retains `tokenUsage` with `attributedModel` set despite `cost.total` 0 on an unlisted model.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`

**Dependencies:** Task 6, Task 8

### Task 8: Record the attributed model on Pi usage
**Story:** 3
**Type:** happy-path

**Steps:**
1. Add optional `attributedModel?: string` to `TokenUsage` in `src/conductor/src/execution/llm-provider.ts`, with a doc comment citing catalog D21.
2. Write failing tests in `src/conductor/test/execution/pi-provider-usage.test.ts` with a test card carrying the committed `.ai-conductor/rate-card.json` rates for `gpt-5.6-luna` and `gpt-5.6-terra`: the worked stream; the worked stream with `responseModel` `gpt-5.6-terra` on each assistant message and every `cost.total` 0; turns reporting `openai`/`gpt-5.6-luna` then `openai`/`gpt-5.6-terra`, both with `cost.total` 0; and turn two with `message.provider` removed and `cost.total` 0 on both turns.
3. Verify RED.
4. Implement in `src/conductor/src/execution/pi-provider.ts`: `attributedModel` is `provider/(responseModel ?? model)` of the last assistant usage-bearing message that names both a provider and a model, and is absent when none does. Rate-card fallback uses each message's own model that ran. A message missing `provider` or `model` is not card-priced.
5. Verify GREEN and commit.

**Done when:**
- For the worked stream `tokenUsage.attributedModel` is `openai/gpt-5.6-luna`, as asserted in pi-provider-usage.test.ts.
- With `responseModel` `gpt-5.6-terra` on each message and costs 0, `attributedModel` is `openai/gpt-5.6-terra` and `costUsd` is 0.001445 (the terra rate), as asserted in pi-provider-usage.test.ts.
- For luna then terra turns with costs 0, `attributedModel` is `openai/gpt-5.6-terra` and `costUsd` is 0.0006305 (luna turn one plus terra turn two), as asserted in pi-provider-usage.test.ts.
- For each of four variants of turn two (`message.provider` missing, `message.model` missing, `message.provider` a number, `message.model` a number) with costs 0, the result has no `costUsd`, `classifyMetering` returns `cost-unmetered`, and `attributedModel` is `openai/gpt-5.6-luna` from turn one, as asserted in pi-provider-usage.test.ts.

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider-usage.test.ts`

**Dependencies:** Task 6

### Task 9: Price by the model that ran and keep other providers unchanged
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/execution/pi-provider-usage.test.ts`: invoke with `model: 'openai/gpt-5.6-sol'` on the worked stream with every `cost.total` 0 and a test card carrying the committed `.ai-conductor/rate-card.json` rates for `gpt-5.6-luna` and `gpt-5.6-terra` plus the committed `gpt-5.6-sol` rate. Also cover the exit-1 worked stream for absence.
2. Write a test in `src/conductor/test/execution/claude-provider-token-usage.test.ts` and `src/conductor/test/execution/codex-provider-cost.test.ts` asserting the existing fixtures' returned `tokenUsage` has no `attributedModel` key.
3. Verify RED for the sol case if pricing used the requested model; then GREEN.
4. Commit.

**Done when:**
- Invoked with `model: 'openai/gpt-5.6-sol'` while the turns report `gpt-5.6-luna` and costs 0, the result has `attributedModel` `openai/gpt-5.6-luna` and `costUsd` 0.0001445 (the luna rate, not sol), as asserted in pi-provider-usage.test.ts.
- For the exit-1 worked stream the result has neither a `tokenUsage` key nor any `attributedModel`, as asserted in pi-provider-usage.test.ts.
- The claude and codex adapter usage tests assert their returned `tokenUsage` has no `attributedModel` key, in claude-provider-token-usage.test.ts and codex-provider-cost.test.ts.

**Files:** `src/conductor/test/execution/pi-provider-usage.test.ts`, `src/conductor/test/execution/claude-provider-token-usage.test.ts`, `src/conductor/test/execution/codex-provider-cost.test.ts`

**Dependencies:** Task 8

### Task 10: Pi declares costSelfReporting
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `src/conductor/test/execution/provider-catalog.test.ts`, the pi descriptor's capability set and `PROVIDER_CAPABILITY_OWNERS`; in `src/conductor/test/engine/provider-model-policy.test.ts`, `COST_SELF_REPORTING_PROVIDERS` and a `rateCardModelIds()` literal equal to its current output.
2. Verify RED.
3. Implement in `src/conductor/src/execution/provider-catalog.ts`: set `costSelfReporting: true` on the pi descriptor and remove `costSelfReporting: '#1889'` from `PROVIDER_CAPABILITY_OWNERS`. Update the existing #1886 test in `src/conductor/test/execution/provider-catalog.test.ts` that lists `costSelfReporting` among pi's false capabilities.
4. Verify GREEN and commit.

**Done when:**
- `supportsProviderCapability` on the pi descriptor returns true for `costSelfReporting` and false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `readiness` and `interactiveLaunch`, as asserted in provider-catalog.test.ts.
- `[...COST_SELF_REPORTING_PROVIDERS].sort()` equals `['claude', 'pi']`, so it contains `claude` and `pi` and not `codex`, as asserted in provider-model-policy.test.ts.
- `PROVIDER_CAPABILITY_OWNERS` deep-equals a literal copy of the pre-change table, written into the test when this task is built, with only the `costSelfReporting` key removed, so every other owner entry including `reviewPolicyCatalog` keeps its value, as asserted in provider-catalog.test.ts.
- `rateCardModelIds()` equals the literal list it returned before this change, asserted in provider-model-policy.test.ts.

**Files:** `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, `src/conductor/test/engine/provider-model-policy.test.ts`

**Dependencies:** none

### Task 11: Pi dispatches reach the cost rollup through provider execution
**Story:** 4
**Story:** 3
**Type:** happy-path

**Steps:**
1. Integration point. Follow `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` (search `executeProviderCandidates` with a `PiProvider` built on a fake subprocess factory): drive a real `executeProviderCandidates` call whose candidate is `PiProvider` with the injected test card. Capture the emitted `provider_attempt` events, persist them with the real `EventPersister` into a temp worktree's `.pipeline/events.jsonl` next to a claude `provider_attempt` with `tokenUsage` costUsd 0.10, and call `computeCostRollup(worktreeDir)`.
2. Write the failing tests in `src/conductor/test/engine/pi-cost-rollup.test.ts`. Cover three cases: the worked stream configured as `openai/gpt-5.6-sol`; the exit-1 worked stream; and the worked stream with costs 0, priced by the card.
3. Verify RED, then GREEN; no production change is expected beyond Tasks 1-10.
4. Commit.

**Done when:**
- With the Pi worked-stream dispatch and a claude dispatch costing 0.10, `computeCostRollup` returns `costUsd` 0.1035 and `providers.pi` with input 200, output 65 and costUsd 0.0035, as asserted in pi-cost-rollup.test.ts.
- For an invoked Pi attempt from the exit-1 worked stream, `computeCostRollup` counts it in `dispatches` and `unmetered.count`, and its tokens and cost add 0 to the totals, as asserted in pi-cost-rollup.test.ts.
- For the card-priced Pi dispatch, the `byDimension` entry for its step has `source` `rate-card` and no `provider`-sourced entry for that step exists, as asserted in pi-cost-rollup.test.ts.
- For the Pi step configured as `openai/gpt-5.6-sol` whose turns report `gpt-5.6-luna`, the `byDimension` entry's `model` is `openai/gpt-5.6-sol`, as asserted in pi-cost-rollup.test.ts.
- `git diff` of this feature leaves `src/conductor/src/engine/cost-rollup.ts` and `src/conductor/src/engine/metering.ts` unchanged, so neither gains a `pi` branch.

**Files:** `src/conductor/test/engine/pi-cost-rollup.test.ts`

**Dependencies:** Task 7, Task 9, Task 10

### Task 12: Shipped-record Cost block renders Pi usage additively
**Story:** 4
**Story:** 3
**Type:** negative-path

**Steps:**
1. In `src/conductor/test/engine/pi-cost-rollup.test.ts`, persist one `provider_attempt` produced by the Task 11 harness for a cost-unmetered Pi dispatch (worked stream, model `cline/google/gemma-4-31b-it:free`, costs 0). Render it with `renderShippedRecordWithCost` over `computeCostRollup`.
2. Add a second test: a legacy claude-plus-codex `events.jsonl` with no `attributedModel` anywhere. Render it and compare it to a literal expected `## Cost` block string committed in the test.
3. Verify RED, then GREEN; then commit.

**Done when:**
- For the single cost-unmetered Pi dispatch, the rendered `## Cost` block contains the lines `input: 200`, `output: 65`, `cost_usd: 0` and `cost_unmetered: count: 1`, as asserted in pi-cost-rollup.test.ts.
- That block's `pi` provider line contains `input: 200`, `output: 65` and `cost_unmetered: 1`, as asserted in pi-cost-rollup.test.ts.
- For the legacy claude-plus-codex event log, the rendered `## Cost` block string equals the committed literal byte for byte (`toBe`), and `classifyMetering` of each legacy attempt is unchanged, as asserted in pi-cost-rollup.test.ts.

**Files:** `src/conductor/test/engine/pi-cost-rollup.test.ts`

**Dependencies:** Task 11

## Task Dependency Graph

```text
Task 1 -> Task 2 -> Task 5 -> Task 6 -> Task 8 -> Task 9
Task 1 -> Task 3 -> Task 4
Task 6, Task 8 -> Task 7
Task 7, Task 9, Task 10 -> Task 11 -> Task 12
Task 10 (independent)
```

## Integration Points

- After Task 11, a Pi dispatch run through `executeProviderCandidates` reaches the persisted spine and `computeCostRollup` with its usage, cost and metering class.
- After Task 12, the shipped-record `## Cost` block renders Pi usage additively.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Pi dispatch exits 0 with the worked stream, when its recorded usage is read, then it carries input 200, output 65, cacheRead 700, cacheCreation 50, and numTurns 2. | 1 | "For `worked-stream.jsonl` with exit 0, `PiProvider.invoke` returns `tokenUsage` with input 200, output 65, cacheRead 700, cacheCreation 50 and numTurns 2, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 happy: Given a Pi assistant turn reports `reasoning` 30 within output 40, when its recorded usage is read, then reasoningOutput is 30 and output is still 40, with the reasoning tokens not added to output a second time. | 2 | "For the turn reporting output 40 and reasoning 30, the returned `tokenUsage` has reasoningOutput 30 and output 40, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 happy: Given a Pi dispatch whose stream also contains `message_update` events with partial assistant messages, when its recorded usage is read, then only the `message_end` assistant turns are counted, so the totals equal the worked-stream totals. | 1 | "The partial `message.usage` on the fixture's `message_update` events is not counted: the asserted totals equal the two `message_end` sums exactly (input 200), as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 happy: Given the worked stream plus one `toolResult` `message_end` whose usage reports input 10, output 5, cacheRead 0, cacheWrite 0, when its recorded usage is read, then input is 210 and output is 70, while numTurns stays 2. | 2 | "For the worked stream plus the `toolResult` message, the returned `tokenUsage` has input 210, output 70 and numTurns 2, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi dispatch exits 0 with a terminal assistant message whose `message` carries no `usage` object, when its recorded usage is read, then the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0. | 3 | "For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi assistant turn whose `message.usage.input` is a string or is missing, when the dispatch is recorded, then that turn contributes no tokens, and if no turn carried well-formed usage the event has no `tokenUsage`. | 3 | "A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi dispatch exits non-zero after emitting one assistant turn with usage, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage`. | 4 | "For the worked stream with exit code 1, `PiProvider.invoke` returns `success: false` and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi dispatch exits 0 but its terminal assistant message has `stopReason` `error`, when the dispatch is recorded, then the step fails and the `provider_attempt` event has no `tokenUsage`. | 4 | "For `error-stop-live-capture.jsonl` with exit 0, `PiProvider.invoke` returns `success: false` with the captured error message and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi stream that carries a top-level `usage` object on an event and none on any `message.usage`, when the dispatch is recorded, then the top-level object is ignored and the event has no `tokenUsage`. | 3 | "A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi stream with a malformed JSONL line between two well-formed assistant turns, when the dispatch is recorded, then the malformed line is skipped and both turns' usage is summed. | 4 | "For the worked stream with a malformed line between the assistant turns, the returned `tokenUsage` has input 200 and output 65, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given the worked stream, whose assistant messages also appear on `message_start`, `turn_end` and `agent_end` events, when its recorded usage is read, then input is 200 and not a multiple of 200. | 1 | "The repeated assistant messages on `message_start`, `turn_end` and `agent_end` are not counted: input is exactly 200, not 400 or 600, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 1 negative: Given a Pi dispatch exits 0 whose only assistant turn reports usage with input, output, cacheRead and cacheWrite all 0, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage` rather than zero usage. | 3 | "An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 happy: Given a Pi dispatch with the worked stream, when its recorded usage is read, then costUsd is 0.0035, costSource is `provider`, and the dispatch classifies as `fully-metered`. | 5 | "For the worked stream the returned `tokenUsage.costUsd` is 0.0035 (toBeCloseTo, 12 digits), `costSource` is `provider`, and `classifyMetering` returns `fully-metered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 happy: Given the worked stream with every turn's cost.total set to 0 and the committed rate card, when the dispatch is recorded, then costUsd is 0.0001445, costSource is `rate-card`, and the dispatch classifies as `fully-metered`. | 6 | "With every `cost.total` 0 and the test card, the returned `costUsd` is 0.0001445 (toBeCloseTo, 12 digits), `costSource` is `rate-card`, and `classifyMetering` returns `fully-metered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 happy: Given the worked stream with turn two's cost.total set to 0 and the committed rate card, when the dispatch is recorded, then costUsd is the rate-card price of both turns, 0.0001445, with costSource `rate-card` and not a mix of Pi and rate-card figures. | 6 | "With only turn two's `cost.total` 0 and the test card, `costUsd` is 0.0001445 with `costSource` `rate-card`, not 0.0021 plus a card price, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given the worked stream with every turn's cost.total set to 0, provider `cline`, model `google/gemma-4-31b-it:free`, which is not on the rate card, when the dispatch is recorded, then the usage carries tokens but no costUsd and no costSource, and the dispatch classifies as `cost-unmetered`. | 7 | "For case (a) the returned `tokenUsage` keeps input 200 and output 65, has no `costUsd` and no `costSource`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given the worked stream with turn two's `cost` object missing and turn two's model absent from the rate card, when the dispatch is recorded, then no costUsd is set, rather than turn one's 0.0021 alone. | 7 | "For the worked stream with turn two's `cost` object missing and turn two's model `unlisted-model` absent from the test card, the result has no `costUsd` key at all (not 0.0021), as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given the worked stream with every turn's cost.total set to 0 and no `.ai-conductor/rate-card.json` in the project, when the dispatch is recorded, then the dispatch classifies as `cost-unmetered` and the step itself still succeeds. | 6 | "With every `cost.total` 0, $HOME redirected and no project card, `PiProvider.invoke` returns `success: true` with tokens but no `costUsd`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given the worked stream with every turn's cost.total set to 0 and a rate card that is unparseable JSON, when the dispatch is recorded, then the dispatch classifies as `cost-unmetered` and no error is raised to the step. | 6 | "With every `cost.total` 0 and an unparseable project card, `PiProvider.invoke` resolves without throwing, returns `success: true`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given a Pi turn reports a negative or non-finite cost.total, when the dispatch is recorded, then that figure is treated as absent and resolution falls through to the rate card. | 6 | "For each of three variants of turn one's `cost.total` (-1, the JSON number `1e400` which parses to Infinity, and the string `"NaN"`) with the test card supplied, `costUsd` is 0.0001445 with `costSource` `rate-card`, so the Pi figure was treated as absent and resolution fell through to the rate card, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given a Pi assistant turn with zero tokens and cost.total 0 alongside a priced turn, when the dispatch is recorded, then costUsd is the priced turn's Pi cost with costSource `provider`, because a zero-token turn has nothing to price. | 5 | "With an added zero-token assistant turn reporting `cost.total` 0, `costUsd` is still 0.0035 with `costSource` `provider`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 2 negative: Given the worked stream plus one `toolResult` `message_end` with input 10, output 5 and cost.total 0, and the committed rate card, when the dispatch is recorded, then no costUsd is set and the dispatch classifies as `cost-unmetered`, because a tool result names no model to price. | 7 | "For the worked stream with its own reported costs (0.0021 and 0.0014) plus one `toolResult` `message_end` with input 10, output 5 and `cost.total` 0, and the test card carrying the committed rates, the result has no `costUsd` key and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 happy: Given a Pi dispatch with the worked stream, when its recorded usage is read, then attributedModel is `openai/gpt-5.6-luna`. | 8 | "For the worked stream `tokenUsage.attributedModel` is `openai/gpt-5.6-luna`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 happy: Given the worked stream with each assistant message also carrying `responseModel` `gpt-5.6-terra` and every cost.total 0, when the dispatch is recorded, then attributedModel is `openai/gpt-5.6-terra` and the cost is priced at the `gpt-5.6-terra` rate. | 8 | "With `responseModel` `gpt-5.6-terra` on each message and costs 0, `attributedModel` is `openai/gpt-5.6-terra` and `costUsd` is 0.001445 (the terra rate), as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 happy: Given a Pi step whose configured model is `openai/gpt-5.6-sol` but whose assistant turns report provider `openai` and model `gpt-5.6-luna`, when the dispatch is recorded with every cost.total 0, then attributedModel is `openai/gpt-5.6-luna` and the cost is priced at the `gpt-5.6-luna` rate. | 9 | "Invoked with `model: 'openai/gpt-5.6-sol'` while the turns report `gpt-5.6-luna` and costs 0, the result has `attributedModel` `openai/gpt-5.6-luna` and `costUsd` 0.0001445 (the luna rate, not sol), as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 happy: Given a Pi dispatch whose turns report `openai/gpt-5.6-luna` then `openai/gpt-5.6-terra`, both with cost.total 0, when the dispatch is recorded, then attributedModel is `openai/gpt-5.6-terra` and costUsd is turn one priced at the luna rate plus turn two priced at the terra rate. | 8 | "For luna then terra turns with costs 0, `attributedModel` is `openai/gpt-5.6-terra` and `costUsd` is 0.0006305 (luna turn one plus terra turn two), as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 negative: Given a Pi dispatch whose turns report tokens and cost.total 0 for a model not on the rate card, when the dispatch is recorded, then attributedModel is still set even though the dispatch is `cost-unmetered`. | 7 | "For case (a) `tokenUsage.attributedModel` is `cline/google/gemma-4-31b-it:free` although the dispatch is cost-unmetered, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 negative: Given a Pi dispatch with no recorded usage, when its event is read, then there is no `tokenUsage` and therefore no attributedModel. | 9 | "For the exit-1 worked stream the result has neither a `tokenUsage` key nor any `attributedModel`, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 negative: Given a Pi assistant turn whose `message.provider` or `message.model` is missing or not a string, when the dispatch is recorded with cost.total 0, then that turn is not priced from the rate card, the dispatch is `cost-unmetered`, and attributedModel names the last turn that carried both fields. | 8 | "For each of four variants of turn two (`message.provider` missing, `message.model` missing, `message.provider` a number, `message.model` a number) with costs 0, the result has no `costUsd`, `classifyMetering` returns `cost-unmetered`, and `attributedModel` is `openai/gpt-5.6-luna` from turn one, as asserted in pi-provider-usage.test.ts." | diff-local |
| Story 3 negative: Given claude and codex dispatches in the same run, when their recorded usage is read, then neither carries an attributedModel field. | 9 | "The claude and codex adapter usage tests assert their returned `tokenUsage` has no `attributedModel` key, in claude-provider-token-usage.test.ts and codex-provider-cost.test.ts." | diff-local |
| Story 3 negative: Given a Pi step configured as `openai/gpt-5.6-sol` whose turns report `openai/gpt-5.6-luna`, when the per-dimension cost rollup is computed, then the dimension's model is the configured `openai/gpt-5.6-sol` and is not replaced by the attributed model. | 11 | "For the Pi step configured as `openai/gpt-5.6-sol` whose turns report `gpt-5.6-luna`, the `byDimension` entry's `model` is `openai/gpt-5.6-sol`, as asserted in pi-cost-rollup.test.ts." | diff-local |
| Story 4 happy: Given a feature's event log has one `fully-metered` Pi dispatch carrying the worked stream's usage and one `fully-metered` claude dispatch costing 0.10, when the cost rollup is computed, then the total costUsd is 0.1035 and the `pi` provider entry shows input 200, output 65, and costUsd 0.0035. | 11 | "With the Pi worked-stream dispatch and a claude dispatch costing 0.10, `computeCostRollup` returns `costUsd` 0.1035 and `providers.pi` with input 200, output 65 and costUsd 0.0035, as asserted in pi-cost-rollup.test.ts." | diff-local |
| Story 4 happy: Given a feature's event log has one `cost-unmetered` Pi dispatch carrying the worked stream's tokens and no other dispatch, when the shipped-record `## Cost` block is rendered, then it reads `input: 200`, `output: 65`, `cost_usd: 0`, and `cost_unmetered: count: 1`, and its `pi` provider line carries `input: 200`, `output: 65` and `cost_unmetered: 1`. | 12 | "For the single cost-unmetered Pi dispatch, the rendered `## Cost` block contains the lines `input: 200`, `output: 65`, `cost_usd: 0` and `cost_unmetered: count: 1`, as asserted in pi-cost-rollup.test.ts." | diff-local |
| Story 4 negative: Given a feature's event log has an invoked Pi `provider_attempt` with no `tokenUsage`, when the cost rollup is computed, then that dispatch counts as `unmetered` and adds zero tokens and zero cost rather than being dropped from the dispatch count. | 11 | "For an invoked Pi attempt from the exit-1 worked stream, `computeCostRollup` counts it in `dispatches` and `unmetered.count`, and its tokens and cost add 0 to the totals, as asserted in pi-cost-rollup.test.ts." | diff-local |
| Story 4 negative: Given a feature's event log has a `fully-metered` Pi dispatch with costSource `rate-card`, when the per-dimension rollup is computed, then the dispatch's cost appears under source `rate-card` and not under `provider`. | 11 | "For the card-priced Pi dispatch, the `byDimension` entry for its step has `source` `rate-card` and no `provider`-sourced entry for that step exists, as asserted in pi-cost-rollup.test.ts." | diff-local |
| Story 5 happy: Given the pi catalog descriptor, when `costSelfReporting` is queried, then it returns true, while `selfHost`, `reviewPolicyCatalog`, `writeFence`, `readiness`, and `interactiveLaunch` still return false. | 10 | "`supportsProviderCapability` on the pi descriptor returns true for `costSelfReporting` and false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `readiness` and `interactiveLaunch`, as asserted in provider-catalog.test.ts." | diff-local |
| Story 5 happy: Given the built-in catalog, when `COST_SELF_REPORTING_PROVIDERS` is read, then it contains `claude` and `pi` and not `codex`. | 10 | "`[...COST_SELF_REPORTING_PROVIDERS].sort()` equals `['claude', 'pi']`, so it contains `claude` and `pi` and not `codex`, as asserted in provider-model-policy.test.ts." | diff-local |
| Story 5 negative: Given the provider capability owner table, when it is read, then it has no `costSelfReporting` entry, and every other owner entry is unchanged. | 10 | "`PROVIDER_CAPABILITY_OWNERS` deep-equals a literal copy of the pre-change table, written into the test when this task is built, with only the `costSelfReporting` key removed, so every other owner entry including `reviewPolicyCatalog` keeps its value, as asserted in provider-catalog.test.ts." | diff-local |
| Story 5 negative: Given the built-in model policies, when the `rate-card refresh` model id list is computed, then it equals the list computed before this change, because Pi ships no built-in model ids. | 10 | "`rateCardModelIds()` equals the literal list it returned before this change, asserted in provider-model-policy.test.ts." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | no-change | none | This feature adds no provider id literal outside execution/provider-catalog.ts; the pi capability flag is set inside the catalog descriptor. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | task | task-10 | `supportsProviderCapability` on the pi descriptor returns true for `costSelfReporting` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | no-change | none | Boot-time discovery in engine/provider-discovery.ts is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | no-change | none | The not-installed configuration error is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | task | task-1 | For `worked-stream.jsonl` with exit 0, `PiProvider.invoke` returns `tokenUsage` with input 200, output 65, cacheRead 700, cacheCreation 50 and numTurns 2 |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | task | task-10 | with only the `costSelfReporting` key removed |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | no-change | none | engine/live-e2e-providers.ts and its Pi smoke leg are not edited; default-suite tests use a fake Pi subprocess. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | no-change | none | Discovery and fail-fast scope are not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D9 | no-change | none | The compose launcher is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D10 | no-change | none | Compose launcher host selection is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D11 | no-change | none | The compose launcher non-probing rule and nesting refusal are not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D12 | no-change | none | The Pi model and thinking argv from #1885 is not altered; no task edits argv construction. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D13 | task | task-10 | `rateCardModelIds()` equals the literal list it returned before this change |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D14 | task | task-4 | For `error-stop-live-capture.jsonl` with exit 0, `PiProvider.invoke` returns `success: false` with the captured error message and no `tokenUsage` key |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D15 | no-change | none | The harness Pi extension asset from #1886 is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D16 | no-change | none | Pi nativeSchema handling from #1886 is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D17 | no-change | none | Pi read-only review argv from #1886 is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D18 | no-change | none | Pi `-na` and trust_project_files handling from #1886 is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D19 | task | task-1, task-3 | returns no `tokenUsage` key |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D20 | task | task-5, task-6, task-7 | `costSource` is `provider`, and `classifyMetering` returns `fully-metered` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D21 | task | task-8 | `tokenUsage.attributedModel` is `openai/gpt-5.6-luna` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D22 | task | task-10 | `[...COST_SELF_REPORTING_PROVIDERS].sort()` equals `['claude', 'pi']` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [x] Dependencies are explicit and acyclic
