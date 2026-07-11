# Track: retry-as-escalation

Track: technical

## Rationale

This feature changes the **engine's internal retry mechanics** — the step retry
loop in `conductor.ts`, the `HarnessConfig` step schema, escalation ordering
constants, the `step_retry` event shape, and HARNESS.md model-selection docs.
There is **no user-facing product surface**: no end-user feature, UI, or product
requirement. Acceptance criteria are expressed as engineering stories
(Given/When/Then over the retry loop's observable behavior), so there is **no PRD**
and `prd-audit` does not apply at SHIP.

Source issue: `jstoup111/ai-conductor#188` (part of the Fable rollout, #186–#194).
Depends on the merged #186 (model availability probe + fallback ladder).
