# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T00:43:21.840Z
Slug: pi-runs-report-token-usage-and-cost-into-harness-t
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-pi-runs-report-token-usage-and-cost-into-harness-t
Head SHA: b69e1dc5fb2e213a264e174387344d01d9958bee
Halted at: 2026-10-03T23:49:50.614Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given a Pi dispatch exits 0 with a terminal assistant message whose `message` carries no `usage` object, when its recorded usage is read, then the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A conductor-level test asserts the `provider_attempt` event emitted for a no-usage dispatch carries no `tokenUsage` property at all (never input 0 / output 0), so the story's event-level claim is asserted end to end.
Missing assertion: the `provider_attempt` event has no `tokenUsage` at all rather than input 0 and output 0

Criterion: Story 1 negative: Given a Pi assistant turn whose `message.usage.input` is a string or is missing, when the dispatch is recorded, then that turn contributes no tokens, and if no turn carried well-formed usage the event has no `tokenUsage`.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A conductor-level test asserts the `provider_attempt` event emitted for a no-usage dispatch carries no `tokenUsage` property at all (never input 0 / output 0), so the story's event-level claim is asserted end to end.
Missing assertion: if no turn carried well-formed usage the event has no `tokenUsage`

Criterion: Story 1 negative: Given a Pi stream that carries a top-level `usage` object on an event and none on any `message.usage`, when the dispatch is recorded, then the top-level object is ignored and the event has no `tokenUsage`.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A conductor-level test asserts the `provider_attempt` event emitted for a no-usage dispatch carries no `tokenUsage` property at all (never input 0 / output 0), so the story's event-level claim is asserted end to end.
Missing assertion: the event has no `tokenUsage`

Criterion: Story 1 negative: Given a Pi dispatch exits 0 whose only assistant turn reports usage with input, output, cacheRead and cacheWrite all 0, when the dispatch is recorded, then the `provider_attempt` event has no `tokenUsage` rather than zero usage.
Task ids: 3
Done when checks: For a terminal assistant `message_end` without `message.usage`, `PiProvider.invoke` succeeds and its result has no `tokenUsage` key, asserted with `not.toHaveProperty('tokenUsage')` in pi-provider-usage.test.ts. | A turn whose `message.usage.input` is a string or missing contributes no tokens, and when it is the only turn the result has no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A stream with a top-level `usage` object and no `message.usage` returns no `tokenUsage` key, so the top-level object is ignored, as asserted in pi-provider-usage.test.ts. | An exit-0 stream whose only assistant turn reports all-zero input, output, cacheRead and cacheWrite returns no `tokenUsage` key, as asserted in pi-provider-usage.test.ts. | A conductor-level test asserts the `provider_attempt` event emitted for a no-usage dispatch carries no `tokenUsage` property at all (never input 0 / output 0), so the story's event-level claim is asserted end to end.
Missing assertion: the `provider_attempt` event has no `tokenUsage` rather than zero usage
```
