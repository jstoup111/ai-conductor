# Complexity Assessment: rate-limit wait signal for conduct-ts

Tier: S

## Signals

| Signal | Assessment |
|--------|------------|
| New data models | None — no schema/type additions beyond an optional `waitSeconds` field already present on the result contract path |
| External integrations | None — parses text already returned by the `claude` CLI invocation |
| Auth / identity | None |
| State machines | None — a pure parse function plus one wiring change |
| Story count | ~3 (happy parse, fallback default, hook-independence) |
| Blast radius | Localized to `src/conductor/src/execution/claude-provider.ts` and the rate-limit branch of `conductor.ts`; hook left as bash-legacy |

## Rationale

The fix is a single well-bounded change: extract the wait/reset seconds from the
rate-limit error text that `claude-provider` already captures, return it on the
invoke result, and have the conductor use it directly instead of the hook-written
`.pipeline/rate-limit-hit` marker. Pure function + one call-site rewire + unit tests.
No architecture decision, no cross-story conflict surface.

Small tier ⇒ architecture-diagram, architecture-review, and conflict-check are skipped.
