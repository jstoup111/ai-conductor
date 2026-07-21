# Intake: Fresh-dispatch backlog scan ignores operator park markers (#651)

Source: jstoup111/ai-conductor#651
Owner: jstoup111
Size (filed): S
Labels: bug, priority: high

See the GitHub issue for the full WHAT/impact/desired-outcomes/non-goals. Spec re-scopes to a single
shared operator-park predicate consulted **immediately before every build-start** (not at scan-selection
time), closing the selection→dispatch race in the pool.

Verified hole: the pool's park gate is `pickEligible` (`daemon.ts:137`) at *selection* time; the actual
`dispatch(next)` (`daemon.ts:896`) → `deps.runFeature(item)` (`daemon.ts:652`) does no park check, and is
separated from selection by `await rebuildAndMaybeRestartForStaleEngine()` (`daemon.ts:890`). A marker
written into the main-repo `.daemon/parked/<slug>` in that window is never re-consulted → the parked slug
is dispatched (2026-07-13 20:43Z incident). The re-kick path is already correct
(`daemon-rekick.ts:114-130`).

Store location (#534/#486) is explicitly out of scope — the predicate already reads the correct main-repo
`projectRoot` store (`daemon-cli.ts:1176`); this is a consumer-path fix. See
`.docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md`.
