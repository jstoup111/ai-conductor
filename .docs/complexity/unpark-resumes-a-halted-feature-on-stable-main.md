# Complexity: unpark-resumes-a-halted-feature-on-stable-main

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None; no dispatch, re-kick, park, or HALT state changes (output only) |
| Story count | 1 story (live-HALT warning on unpark, happy + negative criteria) |
| Files touched | 1 engine file (`daemon-park-cli.ts`) + its unit tests |
| New runtime code | ~40 lines: one live-HALT probe and a class→remedy mapping, reusing `readRawHaltClass` |

## Rationale

The change is confined to the `unpark` branch of `dispatchDaemonPark` in
`src/conductor/src/engine/daemon-park-cli.ts`. It reads `.worktrees/<slug>/.pipeline/HALT` and its
raw `HALT.class` sidecar through the existing `readRawHaltClass` (`daemon-rekick.ts`) and changes
only printed text. The park marker, no-evidence counter, HALT files, `pickEligible`, `rekickSweep`,
and every dispatch path are untouched. → **Small.** Architecture-diagram, architecture-review,
conflict-check, and coherence-check are skipped for this tier.

## Issue label corroboration

Issue #822 is filed `size: M` against its original scope (unpark resumes the feature). The operator
narrowed that scope in explore to unpark-output-only; this reassessment is Small for the narrowed
scope.
