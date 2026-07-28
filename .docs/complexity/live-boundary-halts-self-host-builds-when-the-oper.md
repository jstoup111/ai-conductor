# Complexity: live-boundary halts self-host builds when the operator edits their own checkout

Tier: S

## Rationale

- **Models/integrations:** none new. Uses `git` (already a first-class dependency of
  this repo, invoked elsewhere in the engine) to classify a diff; no new external
  service or API.
- **Auth:** unaffected. No change to credential handling, sandbox provisioning, or
  the provider-state surface.
- **State machine:** none added. `verifyLiveBoundary` stays a pure
  fingerprint-compare function; classification is an added branch inside its
  existing halt path, not a new control-flow state.
- **Surface area:** contained to `self-host/live-boundary.ts` (the classification
  logic) and its one call site in `conductor.ts` (~line 2158, `runSelfBuildDispatch`).
  No new files beyond tests.
- **Story count:** ~3 (operator-edit suppresses halt; sandbox-escape-shaped diff
  still halts with paths named; git-classification failure fails closed).

Conflict-check and architecture-diagram/-review are skipped per the Small tier.
