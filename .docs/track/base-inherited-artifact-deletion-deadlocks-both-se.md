# Track: base-inherited protected-artifact deletion deadlocks seal rotation and reseal (#1752, absorbs #1676)

Track: technical

Scope boundary: Tolerate protected artifacts deleted on the base branch (never touched by the feature)
across seal verification, rotation, and `conduct reseal`; prune them from the seal with an audited
rebaseline record naming the paths and the base commit that deleted them; keep halting on
feature-authored deletions, naming the artifact; attribute every seal refusal as feature-authored or
base-inherited. Excluded: relaxing rotation's own-plan exact-append-only test for #1743 slug-stem
pointer lines — `conduct reseal` remains the documented recovery for that shape.

Engine-internal seal bugfix plus operator-facing refusal text; no product surface, so acceptance
criteria live in stories and no PRD is authored.
