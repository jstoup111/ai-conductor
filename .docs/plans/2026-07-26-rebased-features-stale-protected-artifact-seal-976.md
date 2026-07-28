# Implementation Plan: rebaseline the protected-artifact seal on proven base inheritance (#976)

**Date:** 2026-07-26
**Stem:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
**Track:** technical (no PRD)
**Tier:** M
**Stories:** `.docs/stories/2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`
**ADR:** `.docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md` (APPROVED)
**Architecture review:** `.docs/decisions/architecture-review-2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`
**Conflict check:** `.docs/conflicts/2026-07-26-rebased-features-stale-protected-artifact-seal-976.md`

## Summary

Give `.pipeline/protected-artifact-seal.json` a narrow rebaselining lifecycle so a rebased feature
stops halting on a pre-rebase baseline, without weakening the boundary that stops a BUILD/SHIP agent
from editing DECIDE artifacts. Rotation is triggered by the seal's baseline no longer being an
ancestor of HEAD and permitted only when every differing protected path is provably inherited from
the base branch. 10 tasks.

## Technical Approach

**The trigger and the permission are separate.** `git merge-base --is-ancestor <baselineCommit>
HEAD` failing tells us only that the seal can no longer be evaluated against this history — the
baseline is always the worktree HEAD at first BUILD, so non-ancestry implies a rewrite. It never
authorises a rotation on its own, because an agent can commit a tampered artifact and then rebase.
Permission requires, for every protected path whose fingerprint no longer matches: workspace bytes
== that path's blob at HEAD, **and** that blob == the same path's blob at `origin/<default>`. One
unexplained path refuses the whole rotation.

**One rotation implementation, two callers.** The proactive caller is `performRebase` (verify
before rebasing, rotate after a clean rebase); the defensive caller is
`verifyProtectedArtifactSeal` itself, which recovers worktrees rewritten outside the engine and
those already halted before this ships. Both go through a single exported entry point so the
permission rule cannot drift between them.

**Fail closed everywhere the comparison cannot be made.** An unresolvable baseline object, an
unresolvable base tip, or an indeterminate path each preserve the existing failure rather than
rotating.

## Task Dependency Graph

```
T1 ──┬── T2 ── T3 ──┬── T4 ── T7
     │              └── T5
     └── T6                    T8 ── T9 ── T10
```

---

### Task 1 — RED: acceptance specs for rotation and refusal

Author the failing acceptance tests for all four stories before any implementation: clean-rebase
rotation, non-ancestor recovery, feature-authored refusal, and the observability assertions.
Include a fixture reproducing the #254 canary shape (seal baseline off-history, reported path
identical to base tip).

**Files:**
- `src/conductor/test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts` — new
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — new non-ancestor cases alongside existing ones

**Story:** ST-976-1
**Story:** ST-976-2
**Story:** ST-976-3
**Story:** ST-976-4
**Dependencies:** none

---

### Task 2 — Seal schema v2 with append-only rotation lineage

Add `version: 2` carrying `rebaselines: { fromCommit, toCommit, trigger, paths[] }[]`. Read v1
seals and upgrade in place on first write; keep the existing `Protected artifact seal is invalid`
throw for anything unparseable.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — interface, `parseSeal`, `readExistingSeal`

**Story:** ST-976-4
**Dependencies:** T1

---

### Task 3 — The rotation predicate

Implement the two-clause permission check as a pure, separately-testable function: given the seal,
HEAD, and the base tip, return either a permitted rotation (with the re-anchored path set) or a
refusal carrying the specific failing condition and path. Include the ancestry trigger and the
fail-closed branches for an unresolvable baseline object and an unresolvable base tip.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — new predicate + `git merge-base --is-ancestor` and base-tip `ls-tree`/`show` helpers

**Story:** ST-976-2
**Story:** ST-976-3
**Dependencies:** T2

---

### Task 4 — Atomic seal replacement

Add the single exported rotation entry point that applies a permitted rotation: recompute
fingerprints at the new baseline, append the lineage entry, and replace the file atomically
(write-temp-then-rename) so a crash cannot leave a truncated seal. `createProtectedArtifactSeal`
keeps its create-once semantics untouched.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — rotation entry point

**Story:** ST-976-1
**Story:** ST-976-2
**Dependencies:** T3

---

### Task 5 — Defensive rotation inside verification

Wire the predicate into `verifyProtectedArtifactSeal`: on a fingerprint mismatch, consult the
ancestry trigger; on non-ancestry, evaluate the predicate and either rotate and return `ok` or
return the qualified refusal. Same-history mismatches take the existing path unchanged.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — `verifyProtectedArtifactSeal`, `inspectSeal`

**Story:** ST-976-2
**Story:** ST-976-3
**Dependencies:** T3

---

### Task 6 — Classify the protected-artifact HALT

Write `.pipeline/HALT` for a genuine protected-artifact violation with an explicit halt class
instead of today's `unclassified`, so a real violation is machine-distinguishable from a stale seal.

**Files:**
- `src/conductor/src/engine/conductor.ts` — the BUILD/SHIP seal guard block
- `src/conductor/src/engine/halt-marker.ts` — halt class constant

**Story:** ST-976-4
**Dependencies:** T1

---

### Task 7 — Proactive rotation on a clean engine rebase

Verify the seal before rebasing (a pre-existing violation blocks and is never laundered) and rotate
it after a clean rebase, sequenced inside the existing post-rebase `.pipeline` translation block,
after the evidence/status rewrites and gated on the same clean-outcome classification. `noop` and
`conflict_halt` leave the seal untouched.

**Files:**
- `src/conductor/src/engine/rebase.ts` — `performRebase`
- `src/conductor/src/engine/rebase-translate.ts` — `translateAfterRebase` sequencing

**Story:** ST-976-1
**Dependencies:** T4

---

### Task 8 — Telemetry for rotations and refusals

Emit an event on every rotation (trigger, from, to, paths) and every rotation-refusal (failing
condition, path), and surface it in the daemon log so an operator can tell a stale seal from a real
mutation without reading the seal JSON.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — event emission seam
- `src/conductor/src/engine/conductor.ts` — log surfacing

**Story:** ST-976-4
**Dependencies:** T5, T7

---

### Task 9 — Reconcile the existing test fixtures

Re-run the pinned immutability assertions unchanged (they advance HEAD on the same history, so no
rotation triggers) and update the rebase fixtures that pre-seal at HEAD and then rebase to expect a
rotated seal. Delete nothing.

**Files:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts`
- `src/conductor/test/engine/rebase-translate-acceptance.test.ts`
- `src/conductor/test/engine/rebase-resolution-wiring.test.ts`
- `src/conductor/test/engine/merged-pr-guard-rebase.test.ts`
- `src/conductor/test/engine/daemon-lock-boundary.test.ts`

**Story:** ST-976-1
**Story:** ST-976-2
**Dependencies:** T8

---

### Task 10 — Documentation and changelog

Document the seal lifecycle, the rotation rule, and the new halt class in the daemon operations
guide, and replace the "delete the seal by hand" operator workaround. Add the changelog entry.

**Files:**
- `docs/daemon-operations.md`
- `CHANGELOG.md` — `[Unreleased]` entry

**Story:** ST-976-4
**Dependencies:** T9

---

## Verification

- `npm test` from `src/conductor` (the project's declared aggregate gate) passes.
- The #254 canary fixture verifies `ok` by the rotation path.
- The feature-authored-mutation-across-rebase fixture still refuses, naming the path.
- No `.pipeline/protected-artifact-seal.json` is ever deleted by the engine.

## Release gate

Internal engine change: no `bin/conduct` CLI, hook wiring, skill symlink, or `settings.json` schema
surface is touched, so no migration block is required. Notable reader-visible behaviour change, so a
`CHANGELOG.md` `[Unreleased]` entry **is** required (Task 10). VERSION is not bumped in this PR.
