# Track: hard-delete-the-retired-wiring-check-step-name-fro

Track: technical

Scope boundary: Complete excision of the `wiring_check` step name — registry, BUILD verification
group (test_suite becomes the sole verification; dissolve the group unless the join/gate-file
layout requires a one-member group), `types/events.ts` member-union narrowing, all engine call
sites, test files, and doc pages. Operator-decided exclusions: NO dead-config-key warning — a
leftover `wiring_check` key in consumer settings.json takes the same fail-closed path as any
unknown key; NO stale-state tolerance — an unknown recorded step in conduct-state.json still
throws, so the 3 in-flight worktrees recording the step must ship or have state reset before this
merges (landing precondition, not machinery).

Second half of adr-2026-08-11-deprecated-no-op-step-retirement; internal step retirement with no
user-facing product capability, so no PRD.
