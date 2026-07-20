# Track: autoheal-path-corroboration-rejects-valid-build-co (#707)

Track: technical

Internal build-engine correctness bug in the path-corroboration matcher
(src/conductor/src/engine/autoheal.ts). No user-facing product behavior — acceptance
criteria live in the stories. Scope (post-DECIDE correction): add a BOUNDED deterministic
dirname/subsystem overlap pass to path-corroboration so a valid Task:-trailered commit that
lands in the same immediate directory as a plan-declared path is credited. The semantic judge
fallback already exists/is armed and its resume-dispatch gap was closed by #700 — #707 does
NOT re-implement it. The dirname match is bounded to the immediate parent dir to avoid
reopening #445's inheritance false-positive.
