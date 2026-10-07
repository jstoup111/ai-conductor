# ADR: prune base-inherited deletions from the protected-artifact seal

**Date:** 2026-10-07
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer DECIDE session
**Issue:** jstoup111/ai-conductor#1752 (absorbs #1676)
**Stem:** `base-inherited-artifact-deletion-deadlocks-both-se`
**Builds on:** `adr-2026-07-26-protected-artifact-seal-rebaseline` (Decision item 4, lineage),
`adr-2026-08-09-seal-rotation-authorship-predicate` (authorship probe, fail-closed),
`adr-2026-08-09-operator-only-scoped-artifact-reseal`

## Context

`inspectSeal` (`src/conductor/src/engine/protected-artifact-seal.ts`) checks three kinds of drift
between the seal and the workspace:

- **Added:** a protected path is in the workspace but not in the seal. Tolerated when it came from
  the base branch.
- **Changed:** the fingerprint differs. Tolerated when it came from the base branch or is the
  feature's own self-amendment.
- **Deleted:** a sealed path is missing from the workspace. This refuses unconditionally with
  `Protected artifact deleted: <path>`.

The deletion check is the only one that never calls the authorship probe (`inheritedFromBase` →
`matchesBaseTip` / `branchUntouchedInheritance`) that `adr-2026-08-09-seal-rotation-authorship-predicate`
made authoritative.

As a result, deleting a sealed `.docs/` artifact on `main`, which is routine spec retirement, halts
every in-flight feature whose seal includes it:

- **#1676 (2026-08-17):** two features halted at re-kick after #1573 deleted the abandoned
  re-kick-sentinel specs.
- **#1752:** a feature rebased across `89ad672f9`, and `conduct reseal` then refused with
  `Protected artifact deleted: .docs/plans/the-engine-cannot-detect-its-own-spinning-operator.md`.
  `git log origin/main..HEAD -- <path>` returned 0 branch commits for that path.

Every supported recovery is blocked:

- Rotation only fires when the seal baseline is not an ancestor of HEAD, so it does not run after a
  plain re-kick (#1676), and in #1752 a separate refusal stopped it.
- `conduct reseal` runs `inspectSeal` first and refuses on the unrelated deletion. Naming the
  deleted path instead fails `createScopedProtectedArtifactSeal` with "reseal target is deleted".

Both incidents were recovered by hand-running `rotateProtectedArtifactSeal` from a script.

Verified by reading the source (about 90% confidence; BUILD tests will settle it):
`branchUntouchedInheritance` already returns `inherited` for this exact shape. The path is unchanged
in `git diff <base>...HEAD`, missing from the HEAD tree (`ls-tree` succeeds with empty output), and
missing from disk (`ENOENT`). A deletion the feature committed shows up in the three-dot diff and
returns `not-inherited`. An uncommitted deletion leaves the path in HEAD, so `git show HEAD:<path>`
succeeds while the workspace is missing it, which also returns `not-inherited`.

## Options Considered

### Option A: tolerate inherited deletions on every verify
- **Pros:** the smallest change, and it mirrors the added/changed checks.
- **Cons:** dead paths stay in the seal forever and are re-probed (three to four git calls each) on
  every BUILD/SHIP attempt. It leaves no durable record of which base commit removed the path, which
  #1676's outcome requires.

### Option B: `conduct reseal` drops a base-deleted target
- **Pros:** explicit and operator-audited.
- **Cons:** the feature still halts before anyone can act. That fails the "never halts a
  non-authoring feature" outcome and costs an operator intervention on every main-side cleanup.

### Option C: tolerate, then prune with an audited lineage entry (chosen)
- **Pros:** builds straight through, records a durable audit trail, re-probes nothing afterwards,
  and fixes reseal as a side effect.
- **Cons:** it adds a second engine path that mutates the seal without an operator. This is the
  trust decision this ADR records.

## Decision

1. **The deletion check asks authorship.** For each sealed path missing from the workspace that the
   caller has not excluded, `inspectSeal` runs the same `inheritedFromBase` probe the added and
   changed checks use. `inherited` means a **base-inherited deletion**. Anything else refuses.
2. **The probe fails closed, unchanged from `adr-2026-08-09-seal-rotation-authorship-predicate` D2.**
   No base ref, no merge-base, or a failed git probe refuses with the existing
   `Protected artifact provenance undeterminable: <path>` reasons. Uncertainty never produces a
   base-inherited deletion.
3. **Base-inherited deletions are pruned from the seal, not just skipped.** Subject to D4, the
   verifying caller removes those paths from `protectedArtifacts` and persists
   the result through the existing atomic seal write (`persistProtectedArtifactSealRotation`):
   - `baselineCommit` stays the same, so every surviving path stays pinned to its original baseline.
   - A `rebaselines` entry is appended with `{ fromCommit: baseline, toCommit: baseline, trigger:
     'inherited-base-deletion', paths, deletedBy }`. `deletedBy` maps each pruned path to the
     base-branch commit that deleted it, found with `git log -1 --diff-filter=D --format=%H
     <baseRef> -- <path>`.
   - The existing `protected_artifact_rebaseline` event is emitted with the same trigger and the
     additive `deletedBy` field.
   This adds no new event variant, sidecar, or channel, and keeps the seal at `version: 2`. The
   seal reader accepts `deletedBy` as an optional `Record<string, string>`.
4. **No partial mutation.** A prune is persisted only when the final composed verdict is `ok`: the
   inspection passed and any rotation evaluation either was permitted or is a non-escalating
   refusal. If any path refuses, including an escalating rotation refusal, the seal is left
   byte-for-byte unchanged and the prune is not written. When rotation is permitted, the prune entry
   is persisted in the same atomic write, immediately before the rotation's own `rebaselines`
   entry.
5. **The deleting commit is required evidence.** If a base-inherited deletion's deleting commit
   cannot be resolved, inspection refuses with `Protected artifact provenance undeterminable:
   <path>` and the line `Deleting base commit not found.`. An unaudited prune is never persisted.
6. **A feature-authored deletion still halts and names the artifact.** The refusal stays
   `Protected artifact deleted: <path>` and gains an attribution line: `Attribution:
   feature-authored (committed on this branch since merge-base <sha>)` or `Attribution:
   uncommitted workspace change`.
7. **Every seal refusal states its attribution.** Each `inspectSeal` and rotation refusal reason
   names the path and one attribution from a closed set: `feature-authored`,
   `uncommitted workspace change`, `base-inherited`, or `provenance undeterminable`. Changed and
   deleted refusals use the same line format. `reseal_refused` already carries the reason verbatim
   as its `condition`, so operators see the attribution with no further change.
8. **Reseal shares the pruning inspection.** `resealProtectedArtifactSeal` uses the same inspection,
   so a base-inherited deletion elsewhere in the seal no longer blocks a scoped reseal. Its persisted
   seal carries the prune entry before its own `operator-reseal` entry. If a reseal names a target
   that is a base-inherited deletion, that target is pruned and accepted, not refused with "reseal
   target is deleted". A feature-authored deleted target is still refused, with attribution.
9. **Out of scope:** rotation's exactly-append-only test for a feature's own plan
   (`isEngineAppendedRemediationAmendment`) is unchanged. `conduct reseal <own-plan>` is the
   documented recovery for that shape, and Decision 8 makes it reachable.

## Consequences

### Positive
- A `.docs/` deletion on `main` no longer halts any in-flight feature that did not author it, on
  either the re-kick path (#1676) or the rebase path (#1752).
- `conduct reseal` is once again a working recovery after such a rebase. No operator hand-runs
  engine internals.
- Each prune leaves durable lineage (paths plus deleting commit) in the seal and on the event spine.

### Negative
- A second engine-initiated seal mutation sits alongside rotation. It is bounded by the same
  fail-closed authorship probe and can only ever **shrink** the protected set by paths the base
  branch removed.
- After a prune, re-verification costs one `git log` per pruned path, once.
- Consumers that render `protected_artifact_rebaseline` (`daemon-cli.ts`, conductor log line) will
  print `toCommit` equal to `fromCommit` for prune entries. That is acceptable, and the
  `inherited-base-deletion` trigger disambiguates it.
