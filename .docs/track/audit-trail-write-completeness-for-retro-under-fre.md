# Track: Audit-trail write-completeness for retro under fresh sessions

Track: technical

Engine-internal telemetry plumbing (audit-trail records for retro reconstruction); no
user-facing behavior or product requirements — acceptance criteria live in stories.
Source: jstoup111/ai-conductor#328. Approach: engine event-sink writer (single
deterministic TS module appending JSONL at existing engine seams), operator-approved
2026-07-07.
