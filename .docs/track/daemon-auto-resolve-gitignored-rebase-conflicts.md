# Track: Daemon auto-resolve gitignored build-artifact rebase conflicts

Track: technical

Daemon rebase-resolution infrastructure — no user-facing product requirements; acceptance
criteria live in stories. This extends the FR-numbered engine-native `rebase` loopGate
(`src/conductor/src/engine/rebase.ts`, ADR-001 keystone) with two new autonomous
conflict-resolution capabilities and a re-dispatch route, all internal to the daemon.

Source: jstoup111/ai-conductor#319 (three open `needs-remediation` PRs — #267, #268, #269 —
each required manual operator intervention to unblock a mechanically-resolvable conflict).

## Chosen approach (confirmed in-session by host engineer; operator absent)

1. **Gitignored-artifact delete/modify auto-resolution.** When a rebase conflicts on a
   delete/modify where the base deleted a path AND that path is gitignored on the base,
   take the base's deletion (`git rm`) and continue — bounded strictly to base-ignored
   paths so real source is never silently dropped. New conflict class alongside the
   existing CHANGELOG-sole auto-resolve branch in `performRebase`.
2. **Orphaned unmerged-index auto-recovery.** Before the preexisting-conflict guard
   re-parks, detect the "unmerged paths present but NO rebase actually active" state (a
   leftover from a prior aborted/interrupted re-kick) and reset/abort it so the re-kick
   proceeds instead of dead-locking on "rebase already in progress".
3. **Re-dispatch route for a `processed` feature whose only open PR is
   `needs-remediation`.** A finish-halt whose worktree was torn down and slug marked
   processed currently has no autonomous path back; provide one bounded, dedup-safe route.

Why technical, not product: this is daemon-internal correctness with no operator-facing
surface of its own (unlike `auto-resolve-open-pr-conflicts`, which added operator-visible
PR refresh/escalation behavior and warranted a PRD). The observable outcome here is
"features that used to strand on a dist conflict now self-resolve" — a correctness
property, specified as stories, not a product requirement set.
