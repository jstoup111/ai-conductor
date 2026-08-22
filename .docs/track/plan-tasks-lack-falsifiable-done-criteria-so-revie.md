# Track: plan-tasks-lack-falsifiable-done-criteria-so-revie

Track: technical

Scope boundary: Approach B — (1) a land-time validator rejecting any plan task without a
well-formed `Done when:` block (2-5 falsifiable lines; unbounded quality words closed on the same
line); (2) build_review rubric verdicts carry a required per-finding `boundTo` field naming the
`Done when:` check failed or `beyond`; engine treats `beyond` as non-blocking, persists it, and
the daemon files one intake issue per distinct `beyond` finding id via `fileIntakeIssue`. Absorbs #1718's
shrink-or-file outcome. Excludes inter-lap diffing / lap-monotonic engine (Approach C), #1630
arbitration and #1635 advisory tiers. Builds after PRs #1734 and #1750 merge.

Internal harness machinery; no product requirements — acceptance criteria live in stories.
