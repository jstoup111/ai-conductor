# Track: Monitor guided session triage-complete quit cue

Track: technical

Scope boundary: Prompt-level only (operator-confirmed). The monitor's guided-session opening prompt declares the session monitor-hosted and carries the active provider's quit instruction; the `daemon-triage` skill gains a closing step that, only when the session is monitor-hosted and only after the triage report is written and every approved action has finished or been declined (none pending or awaiting approval), tells the operator triage is complete and that quitting returns them to the monitor queue. Excluded: monitor-side detection of `.daemon/triage/` reports, auto-ending or auto-advancing the provider session, and any change to queue ordering or session launch mechanics. Triage sessions started outside the monitor show no monitor-queue wording.

Internal operator tooling text with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2986).
