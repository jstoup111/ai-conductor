# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-03T22:22:08.418Z
Slug: pi-runs-report-token-usage-and-cost-into-harness-t
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-pi-runs-report-token-usage-and-cost-into-harness-t
Head SHA: 33b4df13e936923c8b0c75e16ab7dcb5e64cd9b7
Halted at: 2026-10-03T21:05:14.859Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given a Pi dispatch exits 0 with a terminal assistant message whose `message` carries no `usage` object, when its recorded usage is read, then the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
Missing assertion: the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0.

Criterion: Story 1 negative: Given a Pi assistant turn whose `message.usage.input` is a string or is missing, when the dispatch is recorded, then that turn contributes no tokens, and if no turn carried well-formed usage the event has no `tokenUsage`.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts.
Missing assertion: the event has no `tokenUsage`.

Criterion: Story 1 negative: Given a Pi dispatch exits non-zero after emitting one assistant turn with usage, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage`.
Task ids: 4
Done when checks: For the worked stream with exit code 1, `PiProvider.invoke` returns `success: false` and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | For `error-stop-live-capture.jsonl` with exit 0, `PiProvider.invoke` returns `success: false` with the captured error message and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | For the worked stream with a malformed line between the assistant turns, the returned `tokenUsage` has input 200 and output 65, as asserted in pi-provider-usage.test.ts.
Missing assertion: the `provider_attempt` event has no `tokenUsage`.

Criterion: Story 1 negative: Given a Pi dispatch exits 0 but its terminal assistant message has `stopReason` `error`, when the dispatch is recorded, then the step fails and the `provider_attempt` event has no `tokenUsage`.
Task ids: 4
Done when checks: For the worked stream with exit code 1, `PiProvider.invoke` returns `success: false` and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | For `error-stop-live-capture.jsonl` with exit 0, `PiProvider.invoke` returns `success: false` with the captured error message and no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | For the worked stream with a malformed line between the assistant turns, the returned `tokenUsage` has input 200 and output 65, as asserted in pi-provider-usage.test.ts.
Missing assertion: the step fails and the `provider_attempt` event has no `tokenUsage`.

Criterion: Story 3 negative: Given a Pi dispatch whose turns report tokens and cost.total 0 for a model not on the rate card, when the dispatch is recorded, then attributedModel is still set even though the dispatch is `cost-unmetered`.
Task ids: 7
Done when checks: For case (a) the returned `tokenUsage` keeps input 200 and output 65, has no `costUsd` and no `costSource`, and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts. | For the worked stream with turn two's `cost` object missing and turn two's model `unlisted-model` absent from the test card, the result has no `costUsd` key at all (not 0.0021), as asserted in pi-provider-usage.test.ts. | For the worked stream with its own reported costs (0.0021 and 0.0014) plus one `toolResult` `message_end` with input 10, output 5 and `cost.total` 0, and the test card carrying the committed rates, the result has no `costUsd` key and `classifyMetering` returns `cost-unmetered`, as asserted in pi-provider-usage.test.ts. | For case (a) `tokenUsage.attributedModel` is `cline/google/gemma-4-31b-it:free` although the dispatch is cost-unmetered, as asserted in pi-provider-usage.test.ts.
Missing assertion: "turns report tokens and cost.total 0 for a model not on the rate card"
```
