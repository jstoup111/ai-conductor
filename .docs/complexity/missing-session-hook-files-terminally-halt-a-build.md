# Complexity: missing-session-hook-files-terminally-halt-a-build

Tier: M

## Rationale

- **Surfaces touched:** `worktree-prepare.ts` (extract + export an idempotent
  `ensureSessionHooks` repair primitive from the currently-private `writeSessionHooks` +
  `wireSessionHookSettings`), `conductor.ts` (`checkAttributionMachineryIntact` /
  `seedAndCheckAttributionMachinery` repair-then-recheck seam), plus docs
  (`docs/daemon-operations.md`, `src/conductor/README.md`) and CHANGELOG.
- **Safety-affecting semantics.** The change alters when a build **terminally HALTs**, and the
  branch under change sits directly upstream of `writeBuildStepMarker`, which arms the #505
  Surface B mutation gate. Getting the ordering wrong silently disarms a fail-closed enforcement
  surface. That interplay is what pushes this above S despite a small diff.
- **Contract change on a shared helper.** `writeSessionHooks` is fail-open by design (never blocks
  worktree provisioning) but the repair path needs a success/failure *outcome*. Both callers must
  keep their existing posture — `prepareWorktree` fail-open, the guard outcome-aware.
- **No new integrations, auth, models, or schema migrations. No CLI/hook/settings-schema surface
  change** (the hook *scripts* and their wiring are byte-identical; only who writes them and when
  changes). No product track.
- **Estimated stories:** ~4 (repair primitive, repair-then-recheck at the guard, ordering/arming
  invariant, degraded paths).

Not S: safety-affecting HALT semantics coupled to an enforcement-arming marker, plus a
contract change on a helper shared with worktree provisioning — warrants an ADR and a
conflict check against concurrent work.

Not L: one seam, one extracted primitive, no new subsystem, no state machine, no migration.
