# Track: custom-steps-crash-the-conductor-with-step-artifac

Track: technical

Scope boundary: balanced (Approach B). Guard every `STEP_ARTIFACT_CONTRACTS[step]` read so an
absent key behaves as an empty contract list, and realign the conductor's artifact-review gate
to "declares reviewable artifacts" instead of "is completion-checked". Excludes making custom
`completion_artifact` markers reviewable artifacts (adr-2026-07-25 stands) and any daemon-path
change (the daemon runs `mode: 'auto'` and never enters the block).

Engine bug fix in `src/conductor/src/engine/{artifacts,conductor}.ts`: no new command, flag,
config key, or product behavior; acceptance criteria live in stories, no PRD.
