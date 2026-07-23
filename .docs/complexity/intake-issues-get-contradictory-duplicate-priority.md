# Complexity: intake-issues-get-contradictory-duplicate-priority

Tier: M

## Rationale

- No new integration, dependency, auth flow, state machine, or data model. The `gh` REST
  label endpoints (`POST .../labels`, `DELETE .../labels/{name}`) already exist as
  `restAddLabelArgs` / `restRemoveLabelArgs` in `pr-labels.ts`; nothing new is invented.
- But the change is **not** a one-liner and spans four coupled surfaces plus a data
  migration: the shared `syncIssueLabels` seam (semantics change: additive → scoped,
  authority-aware convergence), its three callers (`intake-label-sync-apply.mts`,
  `bin/intake-file`, `bin/intake-backfill`), the workflow header comment that currently
  documents behavior the code does not implement, and a one-time sweep over 23 live
  issues.
- Genuine design content that must be settled before code: **who wins** between an
  explicitly-chosen value and an automation default, how a namespace-scoped replace avoids
  the collateral damage of a true REST full-replace (which would strip `engineer:handled`
  and `blocked_by:#N`), and how to eliminate the open/apply race between the CLI and the
  workflow rather than merely narrowing it.
- Test surface is real but bounded: the existing acceptance suite
  (`test/acceptance/intake-form-label-sync.test.ts`) has an idempotency test that passes
  today **while the bug is live**, because it only re-runs identical values. It must be
  strengthened, not just extended.
- Matches the issue's own `size: S`/`size: M` ambiguity by landing in the middle; clearly
  beyond S (multi-file semantics change + migration + a false-green test to fix), well
  short of L (no new subsystem, single seam, no product surface).
