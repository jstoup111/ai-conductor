# Conflict Check: daemon-false-ship-guard (ai-conductor#337)

**Date:** 2026-07-06
**New stories:** .docs/stories/daemon-false-ship-guard.md (6 stories)
**Result:** PASS — 1 degrading state-conflict found and resolved; zero blocking conflicts remain.

## Conflict: DONE+HALT marker ambiguity (RESOLVED)

**Stories involved:** "daemon ship guard" (Story 3, new) vs daemon-halt-reconciliation
(dashboard precedence, downtime re-kick)
**Files:** .docs/stories/daemon-false-ship-guard.md vs .docs/stories/daemon-halt-reconciliation.md
**Type:** state-conflict
**Severity:** degrading

**Description:** The ship guard writes a HALT after the conductor already wrote
`.pipeline/DONE`, creating a worktree state (`{done:true, halted:true}`) the reconciliation
stories never contemplated: dashboard precedence only covers HALT+conduct-state, and a
re-kicked worktree still carrying DONE would re-trip the guard ambiguously.

**Resolution (operator-selected, 2026-07-06):** Option 1 — the guard deletes `.pipeline/DONE`
in the same operation that writes HALT. Done/halted stay disjoint; reconciliation and re-kick
stories hold byte-for-byte. Story 3 updated with the criterion + a Done When test assertion.

**Options considered:** (2) document halted>done precedence across dashboard/re-kick/outcome
semantics — wider blast radius; (3) rely on daemon-runner branch order — fragile. Rejected.

## Examined-clean pairs (reasoned, not assumed)

- **make-daemon-build-push-pr-timing-a-configurable-st** (the spec whose build was
  false-shipped): its stories keep the finish-time publish load-bearing in BOTH `pr_timing`
  modes and state "early-draft mode never leaves a build PR-less"; the evidence gate asserts
  exactly that invariant. Its "markReadyForReview fails → pr_url still recorded, build
  completes" scenario stays legal: PR exists and the branch is pushed, so gate + ship guard
  both pass. Compatible / mutually reinforcing.
- **content-aware-shipped-work-dedup** (#204/#205): "merge-local writes a shipped record"
  describes the interactive flow; the daemon auto-prompt can only emit `pr` or `keep`
  (step-runners.ts:656-661), so daemon-mode merge-local non-convergence contradicts nothing.
  `keep`/`discard` write no record there — consistent with the guard treating them as
  non-ships. Dedup's degrade-to-ledger note is strengthened: the ledger can no longer hold a
  false `shipped` entry.
- **halt-pr-rehabilitation-at-finish**: the reused halt-PR URL stays legal — finish still
  pushes (force-with-lease), so tracking-ref ancestry passes; the gh halt-title check stays
  fail-open while the new evidence check is offline/fail-closed. Complementary layers, no
  ordering dependency.
- **finish-force-with-lease-after-sanctioned-rebase**: its push is precisely what advances
  the tracking ref the new gate reads. Reinforcing.
- **retry-as-escalation / daemon-pr-labels**: the guard adds one new `escalateBuildFailure`
  call site (same contract, worktree cwd); clear-on-success (FR-16) and enroll (FR-9) are
  explicitly skipped on the halt path, matching their on-success scoping.
- **manual-test-fail-routing (#367)**: separate gate in the same file; the new
  CompletionContext injectable follows its `getHeadSha` seam. No interaction.

## Re-check

After the Story 3 update, all pairs re-examined: zero blocking, zero remaining degrading
conflicts.
