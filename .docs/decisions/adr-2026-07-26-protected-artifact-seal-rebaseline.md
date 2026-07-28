# ADR: rebaseline the protected-artifact seal on proven base inheritance

**Status: APPROVED**
**Date:** 2026-07-26
**Issue:** jstoup111/ai-conductor#976
**Stem:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`

## Context

`.pipeline/protected-artifact-seal.json` pins the committed content of `.docs/architecture`,
`.docs/plans`, `.docs/specs`, and `.docs/stories` at the moment of the first BUILD-phase step
attempt (`conductor.ts` ~3730-3753). Every subsequent BUILD or SHIP step attempt re-fingerprints
the workspace copies and refuses to dispatch if any differ
(`protected-artifact-seal.ts:264` → `Protected artifact changed: <path>`). At attempt ≥ 2 the
conductor writes `.pipeline/HALT`. The seal is deliberately immutable:
`createProtectedArtifactSeal` returns the existing seal even when handed a newer commit, and a
test pins that ("reuses the original durable baseline instead of resealing a later commit").

The SHIP-phase `rebase` step (daemon-only) runs `git rebase --autostash origin/<default>` and then
`translateAfterRebase`, which already rewrites sibling `.pipeline` state — `task-evidence.json`,
`task-status.json`, `rebase-rewrites.json`. It does **not** touch the seal.

The consequence, observed in the #254 canary on 2026-07-26: the rebase pulls the base branch's
newer `.docs/**` content into the worktree while the seal still holds pre-rebase fingerprints. The
next BUILD/SHIP attempt reports `Protected artifact changed:
.docs/architecture/2026-06-30-harness-self-host-guardrails.md` even though `git diff
origin/main..HEAD` for that path is empty. Because the seal is immutable, re-entry cannot recover;
the only remedy is an operator deleting generated state by hand.

Empirically confirmed on that worktree: the seal's `baselineCommit` is **not** an ancestor of the
rebased HEAD, while every other active worktree's baseline is.

## Decision

Introduce a single, narrow rebaselining path with **provable inheritance from the base branch** as
the permission predicate.

1. **Trigger (cheap, deterministic).** A seal is *unevaluable* when `git merge-base --is-ancestor
   <seal.baselineCommit> HEAD` is false. Because the baseline is always the worktree HEAD at first
   BUILD, and ordinary work only appends commits, non-ancestry can arise only from a history
   rewrite (rebase, amend, reset).

2. **Permission (the actual gate).** Non-ancestry alone NEVER authorises a rotation. Rotation is
   permitted only when *both* hold for every protected path whose fingerprint no longer matches:
   - the workspace bytes equal the committed blob at the current HEAD (nothing uncommitted), and
   - that blob is byte-identical to the same path's blob at the base-branch tip
     (`origin/<default>`) — i.e. the new content was **inherited from the base**, not authored by
     this feature.

   If any differing path fails either test, the change is feature-authored and the existing
   `Protected artifact changed: <path>` refusal stands, now qualified as feature-authored.

3. **Proactive rotation.** `performRebase` verifies the seal *before* rebasing (an already-violated
   seal blocks exactly as today) and, after a clean rebase, rotates it to the post-rebase HEAD.
   This is the normal path; step 2 is the recovery path for worktrees rewritten outside the
   engine, including those already halted before this change ships.

4. **Lineage and observability.** The seal moves to `version: 2` with an append-only
   `rebaselines[]` of `{ fromCommit, toCommit, trigger, paths[] }`. v1 seals are read and upgraded
   in place. Rotations and rotation-refusals emit telemetry so `.daemon/daemon.log` distinguishes a
   stale pre-rebase seal from a real mutation, and the HALT for a genuine violation is written with
   an explicit `haltClass` instead of today's `unclassified`.

## Alternatives considered

**Delete the seal when verification fails.** Trivially self-healing and trivially a bypass: the
guardrail would evaporate the moment an agent edited a plan. Rejected.

**Rotate on non-ancestry alone.** Attractive because the signal is clean and empirically
discriminating. Rejected: an agent that commits a tampered artifact and then rebases would have its
tampering adopted as the new baseline. Non-ancestry is kept only as the trigger.

**Re-seal on every BUILD attempt at current HEAD.** Removes the boundary outright — the seal would
always agree with whatever the agent last committed. Rejected.

**Key the seal to the merge-base instead of HEAD.** Would make the artifact stable across rebases,
but the merge-base moves too, and it would stop detecting mutations the feature commits to its own
DECIDE artifacts — the primary thing the seal is for. Rejected.

**Have the rebase step delete the seal and let the next BUILD recreate it.** Simple and confined to
the rebase path, but recreation is unconditional: a protected artifact tampered with *before* the
rebase would be silently re-sealed. Also does not recover already-halted worktrees, since the halt
precedes the rebase step. Rejected in favour of verify-then-rotate.

**Prompt/operator discipline (document the manual seal deletion).** Directly contrary to this
repo's Design Principle — machinery must enforce what machinery can enforce. Rejected.

## Consequences

- The pinned immutability test is **narrowed, not deleted**: resealing at a later commit on the
  same history remains forbidden. Only a non-ancestor rewrite with fully-inherited differences
  rotates.
- Two additional read-only git invocations on the verification path, and only when the ancestry
  check has already failed — the common path adds one `merge-base --is-ancestor`.
- The base-branch tip must be resolvable for recovery-path rotation. When it is not (no remote,
  detached), rotation is refused and the existing failure stands — fail-closed.
- Worktrees already halted by this bug recover on their next resumed attempt without operator
  intervention, satisfying #976's fourth desired outcome.
