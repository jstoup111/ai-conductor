# Complexity: noevidenceattempts-persists-across-unpark-so-re-di

Tier: S

## Rationale

- Single-seam fix: the unpark branch of `dispatchDaemonPark` (src/conductor/src/engine/daemon-park-cli.ts:143-172)
  plus a localized halt-message change (conductor.ts auto-park block, daemon-auto-park.ts reason string).
- No new models, integrations, auth, or state machines. The reset primitive
  (`resetNoEvidenceAttempts`, task-evidence.ts:259-264) already exists — the fix broadens when it is called
  and makes the halt reason truthful about an inherited budget.
- Small story count (3 stories); every change is covered by existing test files
  (daemon-park-cli.test.ts, daemon-auto-park.test.ts, task-evidence.test.ts) that need targeted
  additions/updates, not new harnesses.
- Signals match the S band conduct uses: single subsystem, deterministic behavior change, no
  cross-repo or schema surface.
