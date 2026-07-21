# Track: no-diff-task-evidence-stamp

Track: technical

Acceptance criteria live in the stories (no PRD). This is harness-internal engine
machinery — the completion-evidence gate and its stamping paths in `autoheal.ts`,
consumed by the build gate in `artifacts.ts` and the attribution lane in
`conductor.ts`. No product/user-facing feature surface; the only operator-visible
change is that builds with no-diff verification/skip tasks stop auto-parking.
