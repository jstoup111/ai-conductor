# Conflict Check: git-side veto for ref-moving destructive git (#2693)

**Date:** 2026-10-03
**New stories:** `.docs/stories/ref-moving-destructive-git-that-bypasses-the-build.md` (Stories 1–6)
**Result:** PASSED — 0 blocking, 2 degrading (accepted by the operator), 0 resolutions required

## Corpus

- **Stories:** all 536 files in `.docs/stories/` were keyword-swept (branch deletion, rename, force push, lease, push, git hooks, `core.hooksPath`, pack-refs, gc, quarantine, `update-ref`, worktree removal, reclaim, prune, teardown, `prepareWorktree`, hook mode and re-verification). Every candidate story was then read in full, about 75 files. The other files matched no keyword.
- **ADRs:** `conflict_check.adr_corpus: repo_wide`. The Decision sections of all 328 ADRs were read in the architecture review's sweep on the same date. The examined ADRs are recorded in `architecture-review-2026-10-03-ref-moving-destructive-git-that-bypasses-the-build.md` § Alignment.
  - Nine non-APPROVED ADRs were excluded.
  - About 228 ADRs had no bearing.
  - Every relevant ADR was resolved by the D7/D10 notes and D11–D15 of `adr-2026-09-23-engine-git-guard-on-agent-path` before stories were written, so no ADR-versus-story conflict remains.

## Conflict: Explicit-value lease is allowed by the guard and refused by the hook

**Stories involved:** #1354 Story 1 vs Story 3 (this feature)
**Files:** [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md] vs [.docs/stories/ref-moving-destructive-git-that-bypasses-the-build.md]
**Type:** overlap
**Severity:** degrading

**Description:** The `PATH` guard and the operator Bash hook pass `git push --force-with-lease=«ref»:«sha»` (#1354 Story 1: "the push reaches the real git unchanged and its exit status and output are git's own"; `block-bare-force-pushes-inside-compound-commands` H1). The new `pre-push` hook refuses that push when the stated value differs from the local remote-tracking ref (Story 3, third happy path). Both statements hold together, because the guard passes the push to git and git's hook then refuses it. The layers are deliberately unequal: the hook cannot see the lease flag, so it applies the stricter tracking-ref check (D13).

**Resolution Options:**
1. Accept the stricter git-side behaviour. Its refusal names fetching and a bare `--force-with-lease` as the alternative. No engine code pushes an explicit-value lease.
2. Make the guard also refuse explicit-value leases against a stale tracking ref.

**Recommendation:** Option 1. D13 is approved, and option 2 widens #1354 beyond this feature's scope.

## Conflict: An unguarded multi-branch `branch -D` deletes the safe branches and keeps the unsafe one

**Stories involved:** #1354 Story 2 vs Story 1 (this feature)
**Files:** [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md] vs [.docs/stories/ref-moving-destructive-git-that-bypasses-the-build.md]
**Type:** overlap
**Severity:** degrading

**Description:** #1354 Story 2 says that `git branch -D «reachable» «unreachable»` "is refused and both branches still exist". That holds through the guard, which refuses the whole argv. Unguarded git deletes each branch in its own ref transaction. The hook refuses only the unique-tip branch, and the reachable branch is deleted. No commit becomes unreachable, so the backstop's purpose holds, but the unguarded outcome is partial rather than all-or-nothing.

**Resolution Options:**
1. Accept partial deletion on the unguarded path. BUILD tests for this feature must not copy #1354's "both still exist" assertion.
2. Require all-or-nothing behaviour on the unguarded path. This is not achievable from a per-transaction hook.

**Recommendation:** Option 1.

## Checked and compatible

- **Engine branch deletions (reclaim, park reconciliation, worktree cleanup).**
  - These run from the root checkout, which has no worktree `core.hooksPath`.
  - Squash-merged non-ancestor branches are already refused by reclaim's own policy (`branch-delete-failed`, no force delete).
  - Story 5 pins the working-directory constraint.
- **Resolve and CI-fix worktree lease pushes.**
  - Remote-tracking refs are shared by every worktree of the repository.
  - A bare `--force-with-lease` succeeds only when the tracking ref equals the remote value, and that is exactly the condition the hook passes. A stale lease is rejected by git first, with git's own text.
- **Engineer (compose) worktrees.**
  - They are not engine-prepared. Verified 2026-10-03: `git config --worktree --get core.hooksPath` is unset in `.worktrees/engineer-«slug»`, so they get no new hooks.
  - Handoff never force-pushes.
- **Setup-triage quarantine and rebase flatten recovery.**
  - `branch -f`, `update-ref`, `commit-tree` and `rebase` are ref updates, not deletions.
- **Hook set and provisioning.**
  - No story asserts an exact count of files in `.pipeline/git-hooks/`.
  - Fail-closed provisioning matches `codex-lacks-preventive-hook-parity-protected-artif`. The older fail-open text in `deterministic-evidence-attribution` was already superseded.
  - `CONDUCT_ENGINE_COMMIT` stays commit-only everywhere.
- **Fixtures and smoke tests.**
  - Temporary repositories and the root checkout have no worktree hooks.
  - The bin/setup smoke deletes a branch created at HEAD, so its tip is contained by another ref.
- **Maintenance.**
  - No story requires `gc` or `pack-refs`. Fixtures that disable auto-gc do not interact with Story 2.
