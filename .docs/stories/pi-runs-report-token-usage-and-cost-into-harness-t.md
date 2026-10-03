**Status:** Accepted

# Stories: Pi runs report token usage and cost into harness telemetry

Technical track (no PRD). Requirements come from issue jstoup111/ai-conductor#1889 and the
operator-confirmed scope boundary in `.docs/track/pi-runs-report-token-usage-and-cost-into-harness-t.md`.
The governing decisions are the 2026-10-02 #1889 amendment to
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D19–D22) and the conditions C1–C3 in
`.docs/decisions/architecture-review-2026-10-02-pi-runs-report-token-usage-and-cost-into-harness-t.md`.

Terms used below:
- An **assistant turn** is one `message_end` event in Pi's `--mode json` stream whose `message.role`
  is `assistant`. Its usage is `message.usage`. The model that ran is `message.provider` plus
  `message.responseModel` when present, else `message.model`.
- Pi repeats each assistant message, usage included, on its `message_start`, `turn_end` and
  `agent_end` events. The worked stream includes those repeats, as a real Pi run does.
- The **worked stream** has two assistant turns, both with provider `openai` and model
  `gpt-5.6-luna`. Turn one reports input 120, output 40, cacheRead 300, cacheWrite 50, and
  cost.total 0.0021. Turn two reports input 80, output 25, cacheRead 400, cacheWrite 0, and
  cost.total 0.0014.
- The **committed rate card** prices `gpt-5.6-luna` at input 2e-7, output 1.2e-6, cache read 2e-8,
  and cache creation 2.5e-7 per token, as `.ai-conductor/rate-card.json` does today.
- A Pi dispatch's **recorded usage** is the `tokenUsage` on its `provider_attempt` event in
  `.pipeline/events.jsonl`.

## Story 1: A Pi dispatch records the tokens Pi actually used

**Requirement:** TI-1. A completed Pi dispatch's usage is the sum of every assistant turn's
`message.usage`, split per the `TokenUsage` contract, and is never invented (catalog D19).

As an operator, I want each Pi step to record the tokens it really consumed, so that per-feature token totals include Pi work.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch exits 0 with the worked stream, when its recorded usage is read, then it carries input 200, output 65, cacheRead 700, cacheCreation 50, and numTurns 2.
- Given a Pi assistant turn reports `reasoning` 30 within output 40, when its recorded usage is read, then reasoningOutput is 30 and output is still 40, with the reasoning tokens not added to output a second time.
- Given a Pi dispatch whose stream also contains `message_update` events with partial assistant messages, when its recorded usage is read, then only the `message_end` assistant turns are counted, so the totals equal the worked-stream totals.
- Given the worked stream plus one `toolResult` `message_end` whose usage reports input 10, output 5, cacheRead 0, cacheWrite 0, when its recorded usage is read, then input is 210 and output is 70, while numTurns stays 2.

#### Negative Paths
- Given a Pi dispatch exits 0 with a terminal assistant message whose `message` carries no `usage` object, when its recorded usage is read, then the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0.
- Given a Pi assistant turn whose `message.usage.input` is a string or is missing, when the dispatch is recorded, then that turn contributes no tokens, and if no turn carried well-formed usage the event has no `tokenUsage`.
- Given a Pi dispatch exits non-zero after emitting one assistant turn with usage, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage`.
- Given a Pi dispatch exits 0 but its terminal assistant message has `stopReason` `error`, when the dispatch is recorded, then the step fails and the `provider_attempt` event has no `tokenUsage`.
- Given a Pi stream that carries a top-level `usage` object on an event and none on any `message.usage`, when the dispatch is recorded, then the top-level object is ignored and the event has no `tokenUsage`.
- Given a Pi stream with a malformed JSONL line between two well-formed assistant turns, when the dispatch is recorded, then the malformed line is skipped and both turns' usage is summed.
- Given the worked stream, whose assistant messages also appear on `message_start`, `turn_end` and `agent_end` events, when its recorded usage is read, then input is 200 and not a multiple of 200.
- Given a Pi dispatch exits 0 whose only assistant turn reports usage with input, output, cacheRead and cacheWrite all 0, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage` rather than zero usage.

### Done When
- [ ] The repository Pi fixtures that model usage carry it on `message_end.message.usage`, and no test asserts usage parsed from a top-level `event.usage`.
- [ ] The repository Pi fixtures include the 2026-10-02 live error-stop capture, normalized only in session id, cwd, timestamps and request id, and a multi-turn fixture with the same event sequence, including the repeating `turn_end` and `agent_end` events.
- [ ] A Pi dispatch with no parseable assistant usage produces a `provider_attempt` event with no `tokenUsage` key, and a test asserts the key's absence rather than a zero value.

## Story 2: A Pi dispatch's cost comes from Pi, then the rate card, never a guess

**Requirement:** TI-2. A Pi dispatch's cost resolves in fixed precedence, all-or-nothing per
dispatch: Pi's own reported cost, then the committed rate card for the model that ran, then no cost
(catalog D20).

As an operator, I want every Pi step to carry a dollar figure whenever one can honestly be established, so that feature cost rollups include Pi spend without inventing any.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch with the worked stream, when its recorded usage is read, then costUsd is 0.0035, costSource is `provider`, and the dispatch classifies as `fully-metered`.
- Given the worked stream with every turn's cost.total set to 0 and the committed rate card, when the dispatch is recorded, then costUsd is 0.0001445, costSource is `rate-card`, and the dispatch classifies as `fully-metered`.
- Given the worked stream with turn two's cost.total set to 0 and the committed rate card, when the dispatch is recorded, then costUsd is the rate-card price of both turns, 0.0001445, with costSource `rate-card` and not a mix of Pi and rate-card figures.

#### Negative Paths
- Given the worked stream with every turn's cost.total set to 0, provider `cline`, model `google/gemma-4-31b-it:free`, which is not on the rate card, when the dispatch is recorded, then the usage carries tokens but no costUsd and no costSource, and the dispatch classifies as `cost-unmetered`.
- Given the worked stream with turn two's `cost` object missing and turn two's model absent from the rate card, when the dispatch is recorded, then no costUsd is set, rather than turn one's 0.0021 alone.
- Given the worked stream with every turn's cost.total set to 0 and no `.ai-conductor/rate-card.json` in the project, when the dispatch is recorded, then the dispatch classifies as `cost-unmetered` and the step itself still succeeds.
- Given the worked stream with every turn's cost.total set to 0 and a rate card that is unparseable JSON, when the dispatch is recorded, then the dispatch classifies as `cost-unmetered` and no error is raised to the step.
- Given a Pi turn reports a negative or non-finite cost.total, when the dispatch is recorded, then that figure is treated as absent and resolution falls through to the rate card.
- Given a Pi assistant turn with zero tokens and cost.total 0 alongside a priced turn, when the dispatch is recorded, then costUsd is the priced turn's Pi cost with costSource `provider`, because a zero-token turn has nothing to price.
- Given the worked stream plus one `toolResult` `message_end` with input 10, output 5 and cost.total 0, and the committed rate card, when the dispatch is recorded, then no costUsd is set and the dispatch classifies as `cost-unmetered`, because a tool result names no model to price.

### Done When
- [ ] Tests cover each resolution outcome against the worked stream: Pi-reported, rate-card fallback, mixed turns falling back as a whole, and no cost, with the exact costUsd and costSource asserted.
- [ ] A Pi dispatch whose tokens are non-zero never records costUsd 0.
- [ ] The rate card is loaded through an injectable loader on the Pi adapter, so tests supply a card without touching the project's committed one.

## Story 3: A Pi dispatch records which model its usage and cost belong to

**Requirement:** TI-3. A Pi dispatch's recorded usage names the `provider/model` that actually ran in
an additive optional `attributedModel` field, and rate-card pricing uses each turn's own model
(catalog D21).

As an operator, I want to see which underlying model a Pi step's tokens and dollars were charged to, so that cost reflects the model that ran, not a generic Pi rate.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch with the worked stream, when its recorded usage is read, then attributedModel is `openai/gpt-5.6-luna`.
- Given the worked stream with each assistant message also carrying `responseModel` `gpt-5.6-terra` and every cost.total 0, when the dispatch is recorded, then attributedModel is `openai/gpt-5.6-terra` and the cost is priced at the `gpt-5.6-terra` rate.
- Given a Pi step whose configured model is `openai/gpt-5.6-sol` but whose assistant turns report provider `openai` and model `gpt-5.6-luna`, when the dispatch is recorded with every cost.total 0, then attributedModel is `openai/gpt-5.6-luna` and the cost is priced at the `gpt-5.6-luna` rate.
- Given a Pi dispatch whose turns report `openai/gpt-5.6-luna` then `openai/gpt-5.6-terra`, both with cost.total 0, when the dispatch is recorded, then attributedModel is `openai/gpt-5.6-terra` and costUsd is turn one priced at the luna rate plus turn two priced at the terra rate.

#### Negative Paths
- Given a Pi dispatch whose turns report tokens and cost.total 0 for a model not on the rate card, when the dispatch is recorded, then attributedModel is still set even though the dispatch is `cost-unmetered`.
- Given a Pi dispatch with no recorded usage, when its event is read, then there is no `tokenUsage` and therefore no attributedModel.
- Given a Pi assistant turn whose `message.provider` or `message.model` is missing or not a string, when the dispatch is recorded with cost.total 0, then that turn is not priced from the rate card, the dispatch is `cost-unmetered`, and attributedModel names the last turn that carried both fields.
- Given claude and codex dispatches in the same run, when their recorded usage is read, then neither carries an attributedModel field.
- Given a Pi step configured as `openai/gpt-5.6-sol` whose turns report `openai/gpt-5.6-luna`, when the per-dimension cost rollup is computed, then the dimension's model is the configured `openai/gpt-5.6-sol` and is not replaced by the attributed model.

### Done When
- [ ] `TokenUsage` carries an optional `attributedModel` string, and `provider_attempt` events written before this change still parse and classify as before.
- [ ] The committed `## Cost` block format and the cost rollup's per-dimension model keys are byte-identical to before for a feature with no Pi dispatches.

## Story 4: Pi-dispatched steps count in metering and the shipped cost rollup

**Requirement:** TI-4. Pi dispatches flow through the existing metering classification and the
per-feature cost rollup committed at ship, with no Pi-specific path.

As an operator, I want a feature built partly or wholly on Pi to ship with a cost rollup that includes those Pi steps, so that the daemon's spend reporting covers every provider.

### Acceptance Criteria

#### Happy Path
- Given a feature's event log has one `fully-metered` Pi dispatch carrying the worked stream's usage and one `fully-metered` claude dispatch costing 0.10, when the cost rollup is computed, then the total costUsd is 0.1035 and the `pi` provider entry shows input 200, output 65, and costUsd 0.0035.
- Given a feature's event log has one `cost-unmetered` Pi dispatch carrying the worked stream's tokens and no other dispatch, when the shipped-record `## Cost` block is rendered, then it reads `input: 200`, `output: 65`, `cost_usd: 0`, and `cost_unmetered: count: 1`, and its `pi` provider line carries `input: 200`, `output: 65` and `cost_unmetered: 1`.

#### Negative Paths
- Given a feature's event log has an invoked Pi `provider_attempt` with no `tokenUsage`, when the cost rollup is computed, then that dispatch counts as `unmetered` and adds zero tokens and zero cost rather than being dropped from the dispatch count.
- Given a feature's event log has a `fully-metered` Pi dispatch with costSource `rate-card`, when the per-dimension rollup is computed, then the dispatch's cost appears under source `rate-card` and not under `provider`.

### Done When
- [ ] An engine-level test drives a Pi dispatch through the fake Pi subprocess with the worked stream and asserts the resulting cost rollup totals, not only the adapter's return value.
- [ ] No cost-rollup or metering module gains a branch on the provider id `pi`.

## Story 5: The Pi catalog entry declares that Pi reports its own cost

**Requirement:** TI-5. The pi descriptor declares `costSelfReporting`, and the capability owner table
no longer assigns it to #1889 (catalog D22).

As an operator, I want the provider catalog to state truthfully that Pi reports cost, so that capability checks and diagnostics do not point at an issue that has shipped.

### Acceptance Criteria

#### Happy Path
- Given the pi catalog descriptor, when `costSelfReporting` is queried, then it returns true, while `reviewPolicyCatalog`, `writeFence`, `readiness`, and `interactiveLaunch` still return false.
- Given the built-in catalog, when `COST_SELF_REPORTING_PROVIDERS` is read, then it contains `claude` and `pi` and not `codex`.

#### Negative Paths
- Given the provider capability owner table, when it is read, then it has no `costSelfReporting` entry, and every other owner entry is unchanged.
- Given the built-in model policies, when the `rate-card refresh` model id list is computed, then it equals the list computed before this change, because Pi ships no built-in model ids.

### Done When
- [ ] The provider catalog structural test asserts Pi's capability set including `costSelfReporting`.
- [ ] `rateCardModelIds()` output is unchanged, asserted by test.
