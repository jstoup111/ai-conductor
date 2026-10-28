Waives: outcome-1

Rationale: jstoup111/ai-conductor#1174 asked that an eligible feature begin dispatch within 2 seconds
of provider readiness. During this DECIDE pass the live daemon's backlog discovery measured 2.2–3.3 s
on its own (`pollDurationMs` in `.daemon/events.jsonl`, 2026-10-15), so moving reconciliation off the
dispatch path cannot reach 2 s at the current scale. On 2026-10-14 the operator restated the target
as recorded in `.docs/track/daemon-reconciliation-delays-first-feature-dispatc.md`: no reconciliation
or maintenance runs between scan start and the first claim, so the first dispatch begins within the
startup origin refresh plus one discovery plus 1 s (Story 1, Story 8's `first-claim` duration makes it
observable). The operator chose not to open a tracker follow-up for discovery speed; this waiver
records that decision as the outcome's disposition.
