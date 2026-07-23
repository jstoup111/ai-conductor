# examples/fixtures/intake/ — seeded intake queue (plan Task 12)

Seeds the sandbox engineer store's durable inbox (`$AI_CONDUCTOR_ENGINEER_DIR/inbox/`,
`src/conductor/src/engine/engineer/intake/queue.ts`'s `createFileQueue` file layout) so
`conduct-ts intake-loop --once` (`examples/intake-loop.sh`, Story 8) has a pending
`Envelope` (`src/conductor/src/engine/engineer/intake/port.ts`) to process without
spawning a real `github-issues` poll.

## Layout

- `envelope.json` — a single pending `Envelope` (status `"pending"`), the fixture's
  source of truth.
- `seed.sh` — copies `envelope.json` into
  `$AI_CONDUCTOR_ENGINEER_DIR/inbox/<receivedAt>__<id>.json`, matching
  `createFileQueue`'s pending-file naming (`<sanitised-receivedAt>__<sanitised-id>.json`,
  ISO-8601 `:` replaced with `_`). Requires `sandbox_up` (or an equivalent
  `AI_CONDUCTOR_ENGINEER_DIR`) to already be exported.

## Usage

```bash
source lib/common.sh
sandbox_up
fixtures/intake/seed.sh
# $AI_CONDUCTOR_ENGINEER_DIR/inbox/ now has one pending envelope for
# `conduct-ts intake-loop --once` to pick up.
```
