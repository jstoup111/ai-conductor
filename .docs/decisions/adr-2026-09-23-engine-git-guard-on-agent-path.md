# ADR: Engine-owned git argv guard on every agent PATH

**Date:** 2026-09-23
**Status:** APPROVED (operator, 2026-09-23)
**Deciders:** James Stoup (operator), composer DECIDE for #1354

## Context

Destructive-git prevention reaches a build only through the operator-installed Claude `PreToolUse`
hook `hooks/claude/block-destructive-git.sh`, registered in `~/.claude/settings.json` by
`bin/install`. Verified on main @ `cea497167`:

- Self-host Claude starts from an engine-owned empty `settings.json` plus the write-fence
  (`src/conductor/src/engine/self-host/sandbox-build-env.ts`, "Start from engine-owned empty
  settings"). The guard is absent.
- Codex has no hook wiring. `grep -c "PreToolUse\|hooks.json\|hooksPath"` on `codex-provider.ts`
  returns `0`. The guard is absent in every Codex run.
- The engine's per-worktree channels (`.pipeline/git-hooks/`, `.pipeline/session-hooks/`) carry no
  destructive-git control. Git offers no hook for the worktree-discard classes (forced clean,
  path-scoped checkout or restore, `reset --hard` to the same commit), as the #1354 filer observed
  on git 2.53.0.
- The guard scans command text, so a destructive command quoted in a heredoc body is refused as if
  it were run.

The operator chose comprehensive scope: every provider, both run modes, all five destructive
classes, and proof by executable tests including a run with no operator home configuration. The
git-side ref backstop was split to #2693.

## Options Considered

### Option A: engine-generated `git` argv guard prepended to the agent child PATH
- **Pros:** one provider-neutral mechanism, and it covers all five classes, including the worktree
  discards no git hook can see. It classifies real argv, so descriptive text can never trip it. The
  daemon's own `execa` git never sees it.
- **Cons:** a `git` called by absolute path, or a shell startup file that puts another `git` earlier
  on `PATH`, bypasses it. The protection is against accidents, not adversaries.

### Option B: git hooks only (`reference-transaction` + `pre-push`)
- **Pros:** reuses fail-closed wiring, with no `PATH` dependency.
- **Cons:** it cannot veto forced clean or path discards. It fires on every engine ref update, so
  every engine rewrite needs an escape. Split to #2693 as a backstop instead.

### Option C: port the text-scanning hook per provider
- **Pros:** smallest change for Claude.
- **Cons:** Codex has no engine hook seam (#1353), and text scanning keeps the false-positive class.

## Decision

Option A.

1. **The guard is an embedded, engine-generated bash asset.** The engine writes it as a real file
   (not a symlink) at `«worktree»/.pipeline/bin/git`, mode 0755. It bakes in two values at write
   time: the absolute path of the real `git`, resolved from the daemon's own `PATH` excluding any
   `.pipeline/bin` entry, and the feature repository's git common directory. Worktree preparation
   writes it through the existing fail-closed preventive-hook provisioning, following the
   preventive-control precedent in adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.
   A write failure fails preparation and never proceeds silently.
2. **Every provider adapter's child-environment construction is the enforcement point.** When the
   dispatch working directory is an engine-prepared worktree, the adapter prepends
   `«worktree»/.pipeline/bin` to the child `PATH`. An engine-prepared worktree is one whose
   worktree-scoped `core.hooksPath` is that worktree's `.pipeline/git-hooks`. This applies to Claude
   and Codex, in self-host and non-self-host runs, and to every dispatch shape (initial, retried,
   auxiliary, model-fallback, replacement provider, review), because all of them end at the
   adapter. Only the child environment changes. The daemon's `process.env` is never mutated
   (adr-2026-08-27-daemon-dispatcher-executor-seam), and review allowlisting and credential
   stripping are unchanged. For Codex, the prepended `PATH` also goes into
   `shell_environment_policy.set`, so the policy-built shell environment carries it explicitly.
3. **The guard is re-verified before every guarded dispatch, fail-closed.** Before prepending, the
   engine confirms the guard's content and mode match the embedded asset, and rewrites it if they
   do not. If it still cannot be confirmed, the dispatch is not launched and fails with a message
   naming the guard path. A missing guard directory on `PATH` would otherwise fall through to the
   real `git` without any error.
4. **Refusal is scoped to the feature repository.** The guard classifies argv first. Commands that
   cannot be destructive `exec` the real `git` immediately, with no extra git call. A candidate
   destructive command is refused only when its target repository's common directory equals the
   baked one; the target honours `-C`, `--git-dir`, `GIT_DIR` and the current directory. The
   feature worktree, its sibling worktrees and the root checkout are protected. Test-fixture and
   temporary repositories pass through.
5. **The refusal matrix.**
   - Force push: bare `--force`, `-f`, or a `+`-prefixed refspec is refused. `--force-with-lease`,
     with or without `--force-if-includes`, and plain pushes pass.
   - `reset --hard` is refused. `--keep`, `--soft` and `--mixed` pass.
   - `branch -D` and `--delete --force` are refused for a branch that is not an ancestor of the
     default branch. `-d` passes.
   - `clean` with `-f` or `--force` in any combination is refused. `-n` and `--dry-run` pass.
   - Working-tree path discards are refused: `checkout [«tree-ish»] -- «paths»` and `restore «paths»`
     without `--staged` only. `checkout`/`restore` with `--ours`, `--theirs` or `--merge`, `restore
     --staged` alone, and a branch switch without a pathspec all pass.
   - A single-level non-shell git alias is expanded before classification.

   > **Amended 2026-09-23 by #1354:** conflict-check found that the unmerged-branch rule above refuses the #334 smoke cleanup (a branch created at `HEAD` in the root checkout) and disagrees with parked-feature reconciliation when a local `main` lags. The rule now refuses `branch -D` and `--delete --force` only when the branch tip is not reachable from any other local branch or remote-tracking ref, which is when commits would become unreachable. The ancestor-of-default-branch case is a subset of this rule and stays allowed.
6. **Every refusal explains itself.** It exits non-zero without running `git`. Its stderr names the
   refused operation, why it is refused, and the safe alternative: `--force-with-lease`,
   `reset --keep`, `branch -d`, `clean -n`, or committing a WIP first or using a temporary worktree.

   > **Amended 2026-09-23 by #1354:** conflict-check found that the self-host environment-claim audit (#1106) treats the write-fence as the only environmental control and refutes any claimed `git push` blocker. A refusal from this guard is a real environmental control, so the audit does not refute a claimed blocker naming a push form the guard refuses (a bare force push). It still refutes a claimed blocker for a plain or lease push.
7. **Engine git is unaffected by construction, and there is no bypass variable.** Engine rewrites
   (rebase, quarantine, shipped-record, spec landing, setup triage) run through `execa` in the daemon
   process, whose `PATH` never contains the guard. Engine CLIs that an agent launches inherit the
   guard, and none of them issues a refused form today; their lease push is allowed. No escape
   variable is added.
8. **The operator hook stays as early feedback, with its false positive fixed.**
   `hooks/claude/block-destructive-git.sh` is not removed. Its scanner drops heredoc bodies as well
   as quoted spans before matching, so text that merely describes a destructive command is not
   refused.
9. **Skill text agrees with the guard.** The `tdd` skill's pre-diff counterfactual runs in a
   temporary detached worktree, never by discarding changes in the build worktree.
10. **Coverage is proven by executable tests and documented limits.**
    - Guard behaviour is tested against a stub real `git` that refused calls never reach, as the
      repository's test-process-isolation rule requires.
    - Adapter tests cover all four provider × run-mode cells, with the operator home absent.
    - Each provider's opt-in live smoke test proves the guard is the `git` an agent shell resolves.
    - Remaining limits are recorded in the control inventory in
      `docs/reference/settings-and-hooks.md`: absolute-path `git`, shell startup files that put
      another `git` earlier on `PATH`, shell aliases, interactive and inline runs with no prepared
      worktree, and custom providers.

## Consequences

### Positive
- Self-host and Codex builds gain the destructive-git prevention that only non-self-host Claude had.
- Descriptive text can no longer be mistaken for a destructive command.
- The #1354 entry in the control inventory moves from known-inactive to active.

### Negative
- It adds one `exec` hop to every agent `git` call, plus a `rev-parse` only when the argv is
  destructive.
- It depends on `PATH` order inside agent shells. Verified on the operator's host (2026-09-23):
  interactive zsh startup puts `~/.asdf/shims` and `~/.local/bin` ahead of the inherited prefix, and
  neither contains a `git`. A future `git` in such a directory bypasses the guard until #2693 and
  #1352 land.
- Agents lose `reset --hard` and forced clean in the feature repository, and must use the
  alternatives.

### Follow-up Actions
- [ ] #2693: a git-side `reference-transaction`/`pre-push` backstop for ref moves that bypass the
      guard.
- [ ] #1352: OS-level sealing for the adversarial bypass class.
