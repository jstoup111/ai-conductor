# Track decision: Rebase orphans every sha-anchored evidence citation

**Source:** jstoup111/ai-conductor#535 (priority: critical)
**Track:** technical
**Date:** 2026-07-12

## Problem statement (WHAT, not the filer's HOW)

Both engine-owned rebases (rekick pre-loop, finish-time) rewrite commit SHAs. Every
**sha-anchored** evidence form that referenced a rewritten commit then dangles:

- `Evidence: satisfied-by <sha>` trailers on empty commits point at a rewritten target SHA.
- The task-evidence sidecar (`.pipeline/task-evidence.json`) stores per-task commit SHAs.
- Engine-owned task-status (`.pipeline/task-status.json`) stores a `commit` SHA per completed task.
- #520/#581 judged-attribution stamps are sha-anchored and their memo keys on HEAD, so every
  rebase invalidates them and can force a redundant opus re-judge.

Aggravator: dangling citations do **not** fail cleanly. Pre-rebase objects linger in the object
store, so a stale (or forged) citation passes the current **object-existence** validation while
pointing off-branch. Rebase makes sha-anchored evidence *unfalsifiable* under today's validation.

Trailer-*form* evidence (`Task: N` in the commit body) already survives, because the build gate's
`deriveCompletion` re-derives from commit messages over `merge-base..HEAD` on every evaluation and
rebase preserves commit messages (adr-2026-07-08). This feature targets exactly the forms that
store a raw SHA, which re-derivation does not repair.

## Desired outcomes (observable acceptance signals)

1. After an engine-owned rebase, every stamp/citation that referenced a rewritten commit references
   its post-rebase equivalent — observable by diffing sidecar/status/trailer contents before/after
   a file-changing rebase; no operator re-pointing, no re-derivation gap.
2. Citations that cannot be mapped (commit dropped in rebase, conflicted replay) surface as an
   explicit **residue list**, never as silently-dangling stamps.
3. Negative path (no laundering): a citation pointing at a commit that never existed on the branch
   is still **refused** — translation maps only SHAs in git's own old→new rewrite set; it never
   invents a mapping for an unknown SHA.
4. Works for **both** rebase sites (rekick pre-loop and finish-time) and **all** sha-anchored stores
   (task-evidence sidecar, satisfied-by trailers on empty commits, task-status `commit` fields, and
   the #520 judged-stamp memo).

## Why technical track (no PRD)

No user-facing product requirement — this is engine-internal correctness of the evidence/gating
machinery. Acceptance lives in stories + acceptance specs against the conductor engine, not a PRD.
Per the engineer loop, `/prd` is skipped on the technical track.

## Filer's hypotheses (candidates, NOT the chosen approach)

Carried into DECIDE for weighing, explicitly as candidates:

- **H1 (primary):** git exposes the exact old→new mapping at rewrite time (post-rewrite hook stdin /
  rebase rewritten-list); the engine performs the rebase, so it can translate all stores in the same
  operation — fully deterministic, no LLM.
- **H2 (complement/alt):** content-addressed citations via `git patch-id` (stable across replay when
  the diff is unchanged; a changed patch-id is exactly the case warranting re-verification).

## Sibling / cluster context

- #532 (verdict-aware resume; spec PR #543) is the complementary cluster sibling. This spec's
  conflict-check cites `.docs/conflicts/2026-07-11-verdict-aware-resume-entry.md`.
- #520 / #581 (judged-attribution persistence) own the memo/stamp forms this feature must translate.
- Governing prior ADRs (all APPROVED): adr-001-rebase-insertion-mechanism,
  adr-2026-07-03-post-rebase-force-with-lease, adr-2026-07-08-post-rebase-gate-first-mechanical-reverify,
  adr-2026-07-09-deterministic-evidence-attribution-enforcement,
  adr-2026-07-10-evidence-range-anchor-resolution.
