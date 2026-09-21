# Track: Monitor daemon HALTs through a guided resolution queue

Track: product

Scope boundary: Balanced — the operator resolution loop, done properly. In scope: HALT discovery
across all registered daemon projects or one selected project; stable priority ordering with a
defined tie-break; dedup so each HALT is offered once; skip that ends the current session and
re-enqueues for a later pass; an auto-started provider session per HALT that runs the existing
`daemon-triage` skill; advancing to the next HALT when that session exits without restarting the
monitor; and spine events for each queue transition. Explicitly excluded: any headless or
unattended mode (a human is always in the loop); autonomous issue filing; daemon supervision,
attach, or restart; a durable queue artifact with cross-run attempt history; and generalising
`rekick-lifecycle.sh` auto-rekick. `ai-conductor halt-issues sweep` is invoked unchanged on the
monitor's loop, not absorbed or modified.

Source: jstoup111/ai-conductor#1228. Parent thread: #355 (productize the operator-local halt
monitor); related operator-experience thread: #1332 (dashboard redesign).

A new operator-facing command whose behaviour — ordering, dedup, skip semantics, and session
lifecycle — is specifiable independently of its mechanism, so the desired outcomes in #1228 are
product requirements rather than implementation detail.
