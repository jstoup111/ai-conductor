# Track: Daemon cannot switch to higher-priority queued work at step boundaries

Track: technical

Scope boundary: Minimal. When every daemon slot is busy and a backlog arrival's preemption rank is strictly higher than the lowest-ranked running feature, that one feature yields at its next operator-park-safe step/group boundary with a distinct `preempted` outcome (log/status/event distinguishable from operator park) and resumes automatically through normal backlog ordering. Preemption rank: critical > high > medium = unlabeled = no-issue > low, read from the backend-neutral priority resolver (no GitHub label parsing) so a future Jira ordering source participates unchanged. Equal-or-lower arrivals never interrupt. Child executor only (the in-process executor is deleted by #3403). Excluded: anti-thrash guard, config toggle, per-feature opt-out, dashboard counts, dedicated telemetry beyond the outcome event.

Internal daemon scheduling with no product requirements; acceptance criteria live in stories.
