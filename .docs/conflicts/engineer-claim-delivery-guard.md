# Conflict Check: Engineer Claim Delivery Guard (#243)

**Date:** 2026-07-04
**New stories:** `.docs/stories/engineer-claim-delivery-guard.md` (7 stories, TR-1..TR-4)
**Scanned against:** all `.docs/stories/*.md`, with focused pairwise checks on the
intake/ledger family: `phase-9.3b-github-intake-writeback.md`,
`dependency-ordered-intake-and-dispatch.md`, `background-intake-conduct-loop.md`,
`content-aware-shipped-work-dedup-never-re-dispatch.md`, `intake-issue-pr-link-autoclose.md`,
`engineer-worktree-isolation.md`.

**Result: PASSED — zero blocking conflicts, zero degrading conflicts. Two benign
overlaps noted for the record (no story changes required).**

## Overlap notes (not conflicts)

### 1. Re-eligibility now enforced at two sites (behavioral overlap, benign)
9.3b's FR-39/40 stories place closed-unmerged reopen (+ churn cap) in poll-side
`maybeReopen`, which only fires for `done` entries. The new TR-1 story adds claim-time
handling for entries stuck pre-`done` with recorded `prUrl`. Both sites route through the
SAME ledger `reopen` primitive and the same attempts cap (ADR requirement: "no new bypass"),
so the two cannot diverge semantically. Recorded so a future refactor keeps them shared.

### 2. "Double-poll enqueues nothing new" (9.3b/background-intake) vs the poll TOCTOU
The 9.3b dedup guarantee holds for sequential polls; adr-2026-07-04 documents that
*concurrent* polls (launcher pre-poll vs background intake loop) can race `known()`→
`record()` and double-enqueue. The new guard is a downstream defense that makes the race
harmless; it does not contradict or weaken any existing story's assertion. The race itself
remains open (out of scope here; guard subsumes its damage).

## Conflict types checked
- Contradiction: none — no existing story asserts a claimed/stranded entry MUST be re-served.
- Behavioral overlap: the two benign notes above.
- State conflict: none — no new statuses; `done` remains the single terminal delivered state.
- Resource contention: none — guard reads/writes the existing engineer ledger only; daemon-side
  shipped-work dedup uses a separate ledger; queue atomic-claim primitive untouched.
- Sequencing: none — guard is a decorator beneath `claimUnblocked`; dependency-walk ordering,
  all-blocked outcome, and stateless deferral are preserved (deferred entries stay `pending`
  and pass the guard).
