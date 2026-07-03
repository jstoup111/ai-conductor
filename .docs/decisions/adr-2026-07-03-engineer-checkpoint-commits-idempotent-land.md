# ADR: Engineer checkpoint commits + idempotent `land`

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session

## Context

With `pr_timing: early-draft`, the engineer flow pushes the `spec/<slug>` branch at DECIDE
skill boundaries so authoring progress is visible remotely. That requires **checkpoint
commits** during authoring — but today `land` (`land-spec.ts:87`) is the single commit
point: it stages only `.docs` and commits once (`land-spec.ts:297-302`, no
`--allow-empty`). If checkpoint commits have already committed every artifact, land's
`git commit` fails on an empty stage. Verified guards: land refuses dirty-outside-`.docs`
(`land-spec.ts:123-146`), has **no** guard against pre-existing commits on the spec branch
(commits in place, `land-spec.ts:13-18, 278-302`), and hard-requires real, non-DRAFT,
Accepted artifacts before committing (`land-spec.ts:197-276`). `handoff` creates the spec
PR **non-draft** via `gh pr create --head <branch> --fill` with no explicit push
(`handoff.ts:170`).

## Options Considered

### Option A: Idempotent land — "artifacts valid and committed" is success
- **Pros:** Checkpoint commits become first-class; land keeps every guard as the
  authoritative gate; land stays safe to re-run (already true for the commit-in-place
  design); no flag day — with `pr_timing: finish` behavior is byte-identical.
- **Cons:** Land's postcondition weakens from "made THE commit" to "the spec set is
  committed" — consumers (handoff, daemon) already key on branch content, not commit count.

### Option B: Squash checkpoint commits at land into one spec commit
- **Cons:** Rewrites pushed history on every land → forces routine force-pushes of the
  spec branch (contradicts the containment rule in
  adr-2026-07-03-post-rebase-force-with-lease); destroys the incremental history the mode
  exists to show.

### Option C: Skip checkpoint commits; early-push only what exists at land
- **Cons:** Nothing exists on the branch until land, so "early" collapses back to
  finish-time — the mode would be a no-op for the engineer flow.

## Decision

Option A, with these contract clarifications:

1. **Checkpoint commits** (early-draft only): after each DECIDE skill completes, the
   engineer flow commits that skill's new `.docs` artifacts (`git add .docs` scope, same
   path guard as land) and plain-pushes `spec/<slug>`. The draft spec PR is created
   lazily on the first push where the branch is ahead of base
   (adr-2026-07-03-pr-timing-config-key).
2. **`land` becomes explicitly idempotent about staging**: run every existing guard
   unchanged (dirty-outside-`.docs`, identity fail-closed, C2 non-empty, DRAFT-ADR gate,
   tier/artifact consistency, Accepted stories); then stage `.docs` and commit **iff the
   stage is non-empty**; if all artifacts are already committed and guards pass, land
   succeeds without a new commit. Guards remain the sole authority — a checkpoint commit
   never exempts an artifact from land's checks, because the checks read the worktree
   state, not the commit log.
3. **`handoff` gains mode awareness**: in early-draft, when an open draft PR for
   `spec/<slug>` already exists, handoff pushes and calls `markReadyForReview`
   (`pr-labels.ts:517`) instead of `gh pr create`; source-ref write-back, labelling, and
   ledger advance are unchanged. In finish mode (default), handoff is byte-identical to
   today. If the draft PR is missing (early pushes failed advisorily), handoff falls back
   to today's create path — the terminal publish is always load-bearing.
4. **Worktree lifecycle is unchanged**: remove-on-success, keep-on-failure, strict-abort.

## Consequences

### Positive
- Long DECIDE sessions are observable remotely; a crashed session leaves pushed, non-lost
  authoring work on the remote spec branch.
- Land re-runs (already possible) now have defined semantics instead of an accidental
  empty-commit failure.

### Negative
- Spec PR history shows per-skill checkpoints rather than one clean commit (accepted —
  visibility is the point; squash-merge at the operator's discretion remains available).
- `handoff` has two publish paths to test (create vs mark-ready + fallback).

### Follow-up Actions
- [ ] Implement checkpoint commit+push helper behind the `pr-labels.ts` seam
- [ ] Amend `land-spec.ts` commit step: commit iff stage non-empty; success otherwise
- [ ] Amend `handoff.ts`: draft-PR-aware publish with create fallback
- [ ] Negative-path test: guard failure at land still fails even when artifacts were checkpoint-committed
