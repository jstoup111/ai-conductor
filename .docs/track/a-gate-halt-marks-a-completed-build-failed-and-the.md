# Track: a-gate-halt-marks-a-completed-build-failed-and-the

Track: technical

Scope boundary: Comprehensive (operator-selected Approach A). Close the residual gaps of #1753 on
post-#1824 main: a typed `refused` step outcome recorded on the spine for the three remaining
refusal paths (protected-artifact seal violations, step-written needs-human halts,
validation-group/plan-gap halts), and a prerequisite-naming needs-human HALT on gate-blocked loop
exits. Excludes: paths already fixed on main (live-boundary deferral, missing-worktree preflight,
finish-gate stale restaging, resume runnable-prerequisite clamp), build_review rubric machinery
(retired by #1824), and any change to genuine-failure semantics.

Engine-internal halt/state semantics respec of issue #1753; no product requirements — acceptance
criteria live in stories.
