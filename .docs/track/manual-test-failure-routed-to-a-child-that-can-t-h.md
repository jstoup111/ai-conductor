# Track: Manual-test failure routed to a child that can't hold the fix, no way out (#3605)

Track: technical

Scope boundary: all four desired outcomes of #3605. (1) A routed taskless obligation (a manual_test FAIL or a post-region custom-step kickback) dispatches BUILD at its host with its retry hint instead of deriving "already complete" from zero routed tasks. (2) Taskless placement is judged with the FAIL evidence and each child's changed paths, then raised mechanically until the host contains every path the judgement names, falling back to the leaf when none are named. (3) `stack rounds --close` accepts an admitted host with no dispatchable work, under an explicit operator reason, and a sole round closes into the leaf return. (4) The stack-commit-guard refusal names only recovery commands valid for the round kind. Negative path: a host with dispatchable work still refuses close. Excluded: splitting FAIL rows into per-row routed items, changes to receipt charging, operator reroute/supersede to an arbitrary child, and #3597's whole-feature-gate fence.

Engine routing and operator-CLI recovery; no end-user product requirements, so acceptance criteria live in stories (operator-confirmed 2026-11-07).
