# ADR: Single-sourced evidence-range anchor resolution (branch base, never genesis)

**Date:** 2026-07-10
**Status:** APPROVED
**Deciders:** James Stoup (operator-directed fix for #456/#463; approval via spec PR merge)

## Context

`deriveCompletion(projectRoot, planPath)` — the completion predicate behind the build gate
(`artifacts.ts` `checkStepCompletion`), the build auto-heal hook (`conductor.ts:1644`), and the
post-rebase pre-verify (`rebase.ts` `applyRebaseVerdicts` → `preVerify('build')`) — resolves its
evidence anchor when the caller passes none. The current fallback (`autoheal.ts:704-724`) takes
the first line of `git log --format=%H --reverse HEAD`, i.e. the **repo genesis commit**, so the
evidence range becomes the entire project history (~800 commits in this repo). Any historical
commit anywhere on main carrying a coincidental `Task: N` trailer enters corroboration against
the wrong plan (#456). Combined with suffix-based path matching, the poisoned range can also
*stamp false evidence*, which is one leg of the gate/pre-verify disagreement in #463.

Verified facts (all read directly from source on 2026-07-10):
- `getEvidenceRange` (`autoheal.ts:306+`) already fail-closes to zero commits when `origin/main`
  is missing, and already falls back to `merge-base --fork-point origin/main HEAD` when the
  anchor is *unreachable*. The genesis anchor is reachable-but-wrong, so the fallback never fires.
- `merge-base --fork-point` depends on reflog state and commonly fails in fresh clones/worktrees
  (daemon worktrees are created fresh per feature); plain `merge-base` does not.
- `listCommits` (`autoheal.ts:409-427`) already anchors at plain `merge-base origin/main HEAD`.
- `origin/main` is hardcoded in `getEvidenceRange` (twice) and `listCommits`, against the repo
  convention of deriving origin's default branch; an `originDefaultBranch()` helper already
  exists (`daemon-backlog.ts`).

## Options Considered

### Option A: Patch the fallback in `deriveCompletion` to compute `merge-base origin/main HEAD`
- **Pros:** Smallest diff; mirrors `listCommits` directly.
- **Cons:** Leaves TWO anchor-resolution sites (deriveCompletion + getEvidenceRange's own
  unreachable-anchor fallback) that can drift apart again; keeps the hardcoded branch name.

### Option B: Delete the genesis computation; single-source anchor resolution in
`getEvidenceRange` with a hardened ladder
- **Pros:** One place computes the range for every completion verdict — the structural guarantee
  #463 asks for. Ladder: (1) explicit reachable `anchorArg`; (2) `merge-base --fork-point
  origin/«default» HEAD`; (3) plain `merge-base origin/«default» HEAD`; (4) fail-closed zero
  commits with a logged anomaly. Replaces hardcoded `origin/main` with the derived default
  branch (shared helper). `deriveCompletion` passes `''` when no anchor is given.
- **Cons:** Slightly larger diff; the rung-4 fail-closed change alters behavior for the
  degenerate no-merge-base case (previously an unanchored `-n 100 HEAD` window).

### Option C: Anchor at the plan-file introduction commit
- **Pros:** Semantically "this feature's start" even without a remote.
- **Cons:** In the daemon flow the plan file arrives via the merged spec PR on main, so the
  plan-introduction commit predates the branch base — a strictly looser range than merge-base.
  Adds a second derivation mechanism for no benefit in the flows that matter.

## Decision

**Option B.** Anchor resolution is single-sourced in `getEvidenceRange` with the ladder above;
the genesis fallback in `deriveCompletion` is deleted outright. All completion verdict callers
(build gate, auto-heal, post-rebase pre-verify) therefore compute over the identical range by
construction. Every rung is deterministic; when no branch base is derivable while a remote
default branch exists, the range is **empty (fail-closed: nothing completes, anomaly logged)**
— never the whole history and never an arbitrary `-n 100` window. Repos with no remote default
branch keep the existing documented fail-closed behavior (zero commits).

The hardcoded `origin/main` in `getEvidenceRange` and `listCommits` is replaced with the derived
origin default branch (reusing the existing helper), per the repo-wide convention.

## Consequences

### Positive
- The evidence range can never span foreign history: #456's false corroboration inputs and
  false-stamp vector are structurally eliminated.
- Gate and pre-verify verdicts share one range — removes one leg of the #463 divergence.
- Fail-closed degenerate cases: a broken range yields pending tasks (safe re-work), never
  false completion.

### Negative
- Features whose worktree lacks a usable merge-base (unrelated histories, exotic setups) now
  derive zero evidence and will re-run tasks — accepted: fail-closed beats false-green.
- Tests that relied on the genesis fallback or the `-n 100 HEAD` window must be rewritten to
  set up a real branch base.

### Follow-up Actions
- [ ] Implement the ladder in `getEvidenceRange`; delete the genesis block in `deriveCompletion`.
- [ ] Extract/reuse `originDefaultBranch()`; replace hardcoded `origin/main` in
      `getEvidenceRange` and `listCommits`.
- [ ] Negative-path tests: foreign-history trailers must not corroborate; no-merge-base yields
      zero commits with anomaly; fork-point-failure falls through to plain merge-base.
