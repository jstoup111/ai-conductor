# Complexity: Git-side veto for ref-moving destructive git that bypasses the build guard (#2693)

Tier: M

## Rationale

Signals driving the Medium tier:

- **Two new engine hook assets on an existing channel.** A `reference-transaction` hook and a
  `pre-push` hook join the commit-time hooks that worktree preparation already writes fail-closed
  into `.pipeline/git-hooks/` (`worktree-prepare.ts`, `git-hook-assets.ts`). No new channel, no
  provider adapter change: git runs the hooks for any caller of the worktree's config, so every
  provider and run mode is covered by construction.
- **Load-bearing git-semantics assumptions that need executable proof.** The design relies on
  `reference-transaction` exposing old/new values at `prepared` so an unreachable-tip deletion can
  be refused (observed by the #1354 filer on git 2.53.0), and on `pre-push` receiving the remote's
  advertised current value so a lease-equivalent check is possible (inferred from git's documented
  hook interface, ~85%). Both need real-git tests in fixture repositories.
- **Legitimate-use carve-outs.** Engine ref writes inside a feature worktree (rebase, quarantine,
  `update-ref` recovery, shipped-record and spec-landing commits, lease pushes) must pass with no
  bypass variable, as must agent lease pushes, merged-branch deletion and branch rename. That needs
  careful negative-path coverage.
- **An approved ADR is amended.** adr-2026-09-23-engine-git-guard-on-agent-path names this backstop
  as a follow-up and records absolute-path `git` as a limit; the amendment adds the git-side layer
  and updates the D10 control inventory. A lightweight architecture review applies.
- **Not Large.** No schema, persistence, provider, or cross-repo change. Local non-fast-forward
  moves, worktree discards (#1354), remote rulesets and OS sealing (#1352) are out of scope.
