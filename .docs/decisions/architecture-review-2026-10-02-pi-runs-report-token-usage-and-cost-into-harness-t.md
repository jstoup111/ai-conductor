# Architecture Review: Pi runs report token usage and cost into harness telemetry

**Date:** 2026-10-02
**Stories reviewed:** none yet. This is a pre-stories lightweight review for a Tier M technical
track. Inputs: `.docs/track/pi-runs-report-token-usage-and-cost-into-harness-t.md`, the diagrams in
`.docs/architecture/pi-runs-report-token-usage-and-cost-into-harness-t.md`, and issue
jstoup111/ai-conductor#1889.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The stack is compatible. The work is TypeScript engine changes only, with no new package, external
service, schema migration or infrastructure. Pi 0.84.3 is already a discovered built-in
(adr-2026-09-24-built-in-provider-catalog-and-boot-discovery).

Verified claims (confidence 90%, read on 2026-10-02 from the installed Pi 0.84.3 packages under
`@earendil-works/pi-coding-agent/node_modules/@earendil-works/`):
- `pi-agent-core/dist/types.d.ts`: the agent event union defines `message_update` as
  `{ message, assistantMessageEvent }` and `message_end` as `{ message }`. Neither has a top-level
  `usage`.
- `pi-ai/dist/types.d.ts` `AssistantMessage` carries `provider`, `model`, optional
  `responseModel`, and `usage: Usage`. `Usage` has `input`, `output`, `cacheRead`, `cacheWrite`,
  optional `cacheWrite1h` and `reasoning` (a subset of `output`), `totalTokens`, and `cost`
  (`input`, `output`, `cacheRead`, `cacheWrite`, `total`).
- `pi-ai/dist/api/openai-responses-shared.js` subtracts cached and cache-write tokens from
  `input_tokens`, so Pi's `input` is fresh-only. That matches the `TokenUsage.input` contract
  (`execution/llm-provider.ts`), so no re-normalization is needed.
- `pi-ai/dist/models.js` `calculateCost` prices from Pi's model registry, including tier
  thresholds and 1-hour cache writes. For a model with no registry price the figure is 0.

Defect confirmed (confidence 90%, verified from source):
- `parsePiJsonl` in `execution/pi-provider.ts` reads `event.usage`, which Pi never emits. It then
  zero-fills `{ input: 0, output: 0 }` when it has seen assistant turns, so every live Pi dispatch
  records fabricated zero usage as `cost-unmetered`. The fixture
  `test/fixtures/pi/terminal-assistant.jsonl` was hand-authored in the non-existent shape, which
  is why the suite is green.

Verified (confidence 95%): usage is per message, so a step total is the sum across messages.
`pi-coding-agent/dist/core/usage-totals.js` `getUsageCostBreakdown` sums `message.usage` per
assistant message, keyed by `provider/(responseModel ?? model)`, and also counts `toolResult`
messages that carry usage.

Live captures (2026-10-02, two `pi -p --no-session --mode json` runs that ended in provider error
stops: DeepSeek insufficient balance and the OpenCode free-tier refusal) confirmed:
- no event carries a top-level `usage`;
- usage sits on `message.usage` with `provider` and `model`;
- `message_start`, `turn_end` and `agent_end` repeat the same assistant message and its usage, so
  only `message_end` may be summed;
- a failed turn reports all-zero usage.

No funded credential was available for a successful multi-turn capture. The operator chose to
relax C2 accordingly, citing Pi readiness for real usage.

Prerequisites: none. #1884 and #1885, the declared blockers, have shipped. Integration surface:
the Pi adapter, the `TokenUsage` contract, the provider catalog, and a read-only use of the
existing rate-card module. That is three modules, all inside `execution/`. Worktree isolation:
there is no new port, database or shared resource. The rate card is read-only committed state.

## Alignment

- **Event spine.** No new channel. Usage and cost ride the existing `TokenUsage` on the existing
  `provider_attempt` event, which `cost-rollup.ts`, `metering.ts`, OTel and the feature usage line
  already consume (`.agents/skills/event-spine/SKILL.md`). The attributed model is a field on that
  same record, not a sidecar.
- **Metering model.** The three-valued model in adr-2026-07-27-cost-unmetered-is-a-first-class-state
  is kept exactly. Absent cost is represented by absence, and no usage means `unmetered` (D6 there).
  This feature removes a live violation of that ADR's Decision 1 spirit: a zero-filled usage
  reported as real.
- **Rate card.** adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot D1 makes
  the committed card an authoritative cost source, applied at dispatch time and never re-priced.
  The Pi fallback uses the same `applyRateCard` and `loadRateCard` at dispatch time, with the same
  fail-closed behavior. That D1 names codex does not make it exclusive; the module is
  provider-agnostic. Its D2 forbids an *estimated* cost inferred from the run. Pi's `cost.total`
  is a provider-reported figure in the same sense as Claude Code's `total_cost_usd`: the CLI
  computes it from its own price list and reports it. It is not a harness inference.
- **Additive contract.** The new optional `TokenUsage.attributedModel` follows
  adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates D1. Nothing is renamed or
  reinterpreted, and the committed `## Cost` block is untouched.
- **Capability catalog.** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D6 assigns
  `costSelfReporting` to #1889. This feature turns it on and removes the owner entry. That keeps
  the catalog honest and stops a dangling owner from outliving the issue that owns it.
- **Domain integrity.** Cost precedence is a closed three-way resolution (Pi, rate card, none), not
  stacked booleans. Zero-cost-with-tokens is defined as "no price", which removes the ambiguous
  real-$0 state.
- **Diagrams.** `.docs/architecture/pi-runs-report-token-usage-and-cost-into-harness-t.md` covers
  L2, L3 and the one-step sequence. No container or external integration is added.

**Local pattern basis (cost resolution).** The precedent is the codex adapter's dispatch-time pricing
(`execution/codex-provider.ts`, the `applyRateCard(…, model, loadRates(cwd))` call when the
usage is attached, and the injected `RateCardLoader` constructor seam). Traits to preserve: pricing
happens inside the adapter at dispatch time; the loader is injected so tests supply a card; an
unknown model leaves usage unchanged. Allowed variation: Pi tries its own reported cost first and
keys the card by the model that ran rather than the requested model. The variation is bounded to the
adapter, and `applyRateCard` itself is unchanged.

## Wiring Surface

- **`parsePiJsonl` (changed export, `execution/pi-provider.ts`).** Called from `PiProvider.invoke`.
  `PiProvider` is constructed by the pi descriptor's `createAdapter` in `BUILT_IN_PROVIDERS`, and the
  provider runtime invokes it for every Pi-dispatched step.
- **Pi cost resolution (new, inside `pi-provider.ts`).** Called from `PiProvider.invoke` when it
  builds the `InvokeResult.tokenUsage` that the provider runtime puts on `provider_attempt`.
- **Rate-card loader seam on `PiProvider`.** A constructor parameter defaulting to `loadRateCard`,
  passed from the descriptor's `createAdapter`, as codex does.
- **`TokenUsage.attributedModel` (new optional field, `execution/llm-provider.ts`).** Produced by
  the Pi adapter and persisted unchanged on `provider_attempt` by `EventPersister` into
  `.pipeline/events.jsonl`. No new consumer is required.
- **`costSelfReporting: true` on the pi descriptor (`execution/provider-catalog.ts`).** Read by
  `COST_SELF_REPORTING_PROVIDERS` in `engine/provider-model-policy.ts`, which `rate-card refresh`
  uses.

Early overlap scan (`ai-conductor overlap-scan --files` over `pi-provider.ts`, `llm-provider.ts`,
`provider-catalog.ts`, `rate-card.ts`): no overlap detected and no open blockers. Advisory: #2718
(Pi auth/rate-limit classification) is unspecced and will edit `pi-provider.ts` failure
classification near the same lines.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Summing a repeated message (`turn_end`, `agent_end`, `message_start`) double-counts usage | Integration | Medium | Medium | D19 counts `message_end` only; the fixtures copied from the real captures include the repeating events |
| Pi's registry price differs from the provider's actual bill (subscription or OAuth auth, stale registry) | Data | Medium | Low | Labelled `costSource: 'provider'` as for Claude; a distinct label was scoped out by the operator |
| Bare `message.model` ids collide across wrapped providers on the rate card (same id, different price) | Data | Low | Low | Fallback is used only when Pi reports no price; an unknown id fails closed to `cost-unmetered` |
| Concurrent #2718 edits to `pi-provider.ts` | Integration | Medium | Low | Merge-time conflict only; no shared design |

No risk is High impact.

## ADRs Created

None new. One additive amendment is made to the governing ADR,
`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`: an amendment block dated 2026-10-02
by #1889 that corrects the falsified D5 and D6 statements and adds D19–D22 (usage summing and no
zero-fill, cost precedence, `attributedModel`, and the `costSelfReporting` declaration). Cited and
reused unchanged: adr-2026-07-27-cost-unmetered-is-a-first-class-state,
adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot, and
adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.

## Conditions

- **C1.** The repository Pi fixtures that model usage are replaced with the real Pi 0.84.3 event
  shape: usage on `message_end.message.usage`, plus `message.provider`, `message.model` and
  `usage.cost`. No test may keep asserting usage parsed from a top-level `event.usage`.
- **C2.** (Relaxed by operator decision, 2026-10-02.) The repository Pi fixtures include the
  real 2026-10-02 error-stop capture, copied with only the session id, `cwd`, timestamps and
  `request_id` normalized. The multi-turn fixture follows the same event sequence, including the
  repeating `turn_end` and `agent_end` events, with usage values set per the Pi 0.84.3 `Usage`
  type.
- **C3.** Every negative path asserts *absence*, never zero: no usage arriving, a failed run, an
  error stop, and Pi cost 0 with tokens and no card entry.

  > **Amendment — 2026-10-07.** "A failed run" and "an error stop" no longer assert absence: per
  > [adr-2026-10-07-provider-cost-includes-failed-attempts](adr-2026-10-07-provider-cost-includes-failed-attempts.md)
  > they record the usage of their completed messages in the existing cost telemetry (no new
  > fields). Absence (never zero) still holds when no complete record exists, and for Pi cost 0
  > with tokens and no card entry.
