# Intake origin: daemon-mode-kickbacks-route-human-judgment-gaps-in

Source-Ref: jstoup111/ai-conductor#551
Owner: jstoup111

## Desired outcome

- Engine-enforced (not prompt-classified): in daemon mode, any kickback/remediation disposition whose target step is DECIDE-phase (architecture_review, plan, stories, conflict_check, prd) produces a HALT carrying the gap ledger — observable by injecting an architectural-gap disposition in a daemon-mode test and watching HALT, not a step dispatch.
- BUILD-phase targets (build, acceptance_specs re-runs) remain autonomous — code-level gaps stay machine-fixable.
- Interactive /conduct kickbacks unchanged (human is present; amendment passes are legitimate there).
- The existing kickback caps/anti-ping-pong behavior is preserved for the interactive path.
- Negative path: a HALTed DECIDE-kickback, once resolved by a human (edited artifacts + cleared), resumes at the right step without re-walking (composes with #532's verdict-aware resume).
