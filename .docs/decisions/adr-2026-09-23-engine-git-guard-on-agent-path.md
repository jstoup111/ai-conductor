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

   > **Amended 2026-09-28 by #1354 (operator decision):** the guard does not bake values into its
   > source. `«worktree»/.pipeline/bin/git` is the static `GIT_GUARD_SCRIPT` asset, so the
   > interpreter-source inventory can check it like every other embedded hook asset. The two values
   > are written at preparation time as data files, `«worktree»/.pipeline/git-guard/real-git` and
   > `«worktree»/.pipeline/git-guard/common-dir`, through the same fail-closed provisioning, and the
   > guard reads them at run time. This matches the approved plan and feature diagram (2026-09-23).

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

   > **Amended 2026-09-28 by #1354 (operator decision):** review dispatches are out of the guard's
   > scope. adr-2026-09-10-portable-build-review-policy D5.1 retired review mount composition, and a
   > review launches from a materialized detached checkout that is not an engine-prepared worktree,
   > so no guard is prepended for it. This is a recorded limit under D10.

   > **Amended 2026-10-01 by #1354 (operator decision):** the Pi provider is out of this decision's
   > scope. Pi became a built-in provider after this ADR was approved; its adapter's guard
   > enforcement is delivered by #2895, which builds on this decision's adapter seam. Until #2895
   > ships, Pi dispatches are unguarded, and this is a recorded limit under D10.

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

   > **Amended 2026-10-02 by #1354 (operator decision):** this decision's matrix is delivered for the
   > canonical spellings of each refused form, and for the global-option and alias spellings that
   > #1354's tests name. Parsing every other spelling git accepts is delivered by #2904. That
   > includes global options such as `--config-env=<name>=<envvar>` and alias text quoted the way
   > git quotes it. Until #2904 ships, those spellings are a recorded limit under D10.

   > **Amended 2026-10-03 by #1354 (operator decision):** the shipped guard already classifies the
   > `--config-env`, `--attr-source` and `--super-prefix` global options and splits alias text the
   > way git quotes it, delivered by this feature's remediation tasks ahead of #2904. Those spellings
   > are therefore not a recorded limit under D10, and the D10 control inventory says so. Every other
   > non-canonical spelling, such as `branch -d -f` or `-df`, stays a recorded limit until #2904.

   > **Amended 2026-10-03 by #2904 (operator decision):** non-canonical spellings are no longer a
   > recorded limit. Both guards normalize argv against one git option spec, following git's global
   > and parse-options grammars, and refuse any option on a guarded subcommand they cannot resolve
   > (adr-2026-10-03-fail-closed-git-option-normalization). The matrix above is unchanged.
6. **Every refusal explains itself.** It exits non-zero without running `git`. Its stderr names the
   refused operation, why it is refused, and the safe alternative: `--force-with-lease`,
   `reset --keep`, `branch -d`, `clean -n`, or committing a WIP first or using a temporary worktree.

   > **Amended 2026-09-28 by #1354 (operator decision):** "without running `git`" means the refused
   > command, and any command that can change repository state, never reaches the real `git`. The
   > read-only queries the guard uses to classify the command (`rev-parse`, `config`,
   > `for-each-ref`, `merge-base`) may run first.


   > **Amended 2026-09-23 by #1354:** conflict-check found that the self-host environment-claim audit (#1106) treats the write-fence as the only environmental control and refutes any claimed `git push` blocker. A refusal from this guard is a real environmental control, so the audit does not refute a claimed blocker naming a push form the guard refuses (a bare force push). It still refutes a claimed blocker for a plain or lease push.
7. **Engine git is unaffected by construction, and there is no bypass variable.** Engine rewrites
   (rebase, quarantine, shipped-record, spec landing, setup triage) run through `execa` in the daemon
   process, whose `PATH` never contains the guard. Engine CLIs that an agent launches inherit the
   guard, and none of them issues a refused form today; their lease push is allowed. No escape
   variable is added.

   > **Amended 2026-10-03 by #2693 (operator decision):** "unaffected by construction" now holds
   > only for `PATH`. The git-side backstop (D11) runs from the feature worktree's
   > `core.hooksPath`, so engine git whose working directory is a feature worktree or a resolve
   > worktree runs its hooks too. The engine stays unaffected because none of its git issues a form
   > the hooks refuse, as D14 establishes. Still no escape variable is added.
8. **The operator hook stays as early feedback, with its false positive fixed.**
   `hooks/claude/block-destructive-git.sh` is not removed. Its scanner drops heredoc bodies as well
   as quoted spans before matching, so text that merely describes a destructive command is not
   refused.

   > **Amended 2026-10-02 by #1354 (operator decision):** the heredoc and quote handling covers the
   > forms #1354's tests name. Bash quote removal on heredoc delimiters (`<<\EOF`, `<<E"OF"`) and
   > ignoring openers inside comments are delivered by #2904. The hook is early feedback, not the
   > enforcement point (D2), so these gaps cost a false refusal or a missed early warning only.

   > **Amended 2026-10-03 by #2904 (operator decision):** heredoc delimiter quote removal and
   > comment-opener masking shipped with #1354 itself (#2773), verified on main @ `833b75868`. #2904
   > replaces the hook's regex matching with argv normalization against the shared option spec
   > (adr-2026-10-03-fail-closed-git-option-normalization D6). Shell indirection stays out of scope.
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

    > **Amended 2026-09-28 by #1354 (operator decision):** the stub real `git` records the guard's
    > read-only classification queries; the proof is that it records no refused subcommand and no
    > state-changing subcommand. Review dispatches (D2 amendment) are added to the recorded limits.

    > **Amended 2026-10-01 by #1354 (operator decision):** the provider × run-mode cells, the live
    > guard smoke, and the control-inventory coverage cover Claude and Codex only. The Pi adapter
    > cells, a Pi live guard smoke, and Pi's inventory entry are delivered by #2895. Pi dispatches
    > are added to the recorded limits in `docs/reference/settings-and-hooks.md`.

    > **Amended 2026-10-03 by #2693 (operator decision):** for two ref-moving classes, deleting a
    > local branch whose commits would become unreachable and a push that overwrites remote history
    > the worktree has not fetched, the absolute-path `git`, `PATH`-shadowing, shell-alias, Pi,
    > review-dispatch and non-canonical-spelling limits are backstopped by the git-side hooks of
    > D11 to D15. Those limits still apply to every other refused form.

    > **Amended 2026-10-06 by #2904 (operator decision):** adr-2026-10-03-fail-closed-git-option-normalization
    > D8 removes the non-canonical-spelling limit: a spelling the shared option spec cannot resolve is
    > refused by both guards, and the control inventory records that fail-closed refusal instead. The
    > absolute-path `git`, `PATH`-shadowing, shell-alias, review-dispatch and Pi limits are unchanged.

> **Amended 2026-10-03 by #2693 (operator decision): git-side backstop for ref-moving destructive
> git.** Option B, rejected above as the primary control, is adopted as a backstop behind Option A.
> It vetoes two ref-moving classes in git itself, so it holds when a `git` is reached without the
> guard. Local non-fast-forward branch moves (amend, rebase, `reset`, `branch -f`) stay allowed.
> Forced clean and path discards fire no ref transaction and stay with the guard alone. Remote
> branch deletion stays with the explicit-approval gate of the GitHub operation CLI.
>
> 11. **Two engine hooks join the worktree hook channel.** `reference-transaction` and `pre-push`
>     are static bash assets in `git-hook-assets.ts`. `writeGitHooks` writes them into
>     `«worktree»/.pipeline/git-hooks/` beside the commit-time hooks, mode 0755, through the same
>     fail-closed provisioning (adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts
>     D3; the fail-open provisioning of adr-2026-07-10-inline-work-attribution-enforcement does not
>     apply). They are pure shell with no runtime data expanded into interpreter source, so the
>     interpreter-source inventory checks them like every other hook asset. Each hook decides first;
>     when it allows, it chains to `$GIT_COMMON_DIR/hooks/«name»` when that file is present and
>     executable and returns its status, as adr-2026-07-09-deterministic-evidence-attribution-enforcement
>     D2 requires. A hook refusal is never overridden by a chained hook.
> 12. **`reference-transaction` refuses deleting a branch whose commits would become unreachable.**
>     It acts only at the `prepared` stage, and only on lines whose ref is under `refs/heads/` and
>     whose new value is all zeros. Every other stage and line passes with no git call, so commits,
>     rebases and ordinary ref updates pay one process start. For a deletion it resolves the ref's
>     current value itself, because `git branch -D` passes an all-zero old value. It allows the
>     deletion when either holds:
>     - a loose-ref prune: the loose ref file exists and `packed-refs` holds the same ref at the
>       same value, which is how `git pack-refs` and `git gc` remove the loose copy; or
>     - the tip is reachable from another `refs/heads/` or `refs/remotes/` ref, the rule D5's
>       2026-09-23 amendment uses.
>
>     Otherwise it exits non-zero, git aborts the whole transaction and every ref is unchanged.
>     Renaming a branch whose tip no other ref holds is refused, because git deletes the old name
>     before the new one is visible. The refusal names that case and the safe alternative: create
>     the new branch, then delete the old one with `git branch -d`.
> 13. **`pre-push` refuses overwriting remote history the worktree has not seen.** For each
>     update on stdin it allows a deletion (out of scope above), a new ref, a fast-forward (the
>     remote's current value is an ancestor of the pushed value), and an update whose remote
>     current value equals the local remote-tracking ref for that branch under the remote's default
>     fetch mapping. It refuses any other update. That last rule is a lease-equivalent check:
>     `pre-push` cannot see the `--force-with-lease` flag, but it receives the remote's advertised
>     value per ref, and a successful bare lease always has the tracking ref equal to it. Git
>     withholds updates it has already rejected locally (a plain non-fast-forward push, a failed
>     lease) from `pre-push`, so the hook judges only updates git would send. It reads stdin and
>     local refs only and never contacts the remote, so a child-only push credential is
>     unaffected (adr-2026-09-11-github-operation-ownership D9). A lease with an explicit expected
>     value that differs from the tracking ref is refused; the safe alternative is to fetch, then
>     push with a bare `--force-with-lease`.
>
> > **Amended 2026-10-10 by #2943:** Engine force pushes now use an explicit expected SHA, preceded by a single-branch fetch so the tracking ref equals the remote value and this hook still passes (`adr-2026-10-10-stacked-restack-journaled-replay` decision 11).
>
> 14. **The engine passes with no bypass variable.** Verified on main @ `fd6f539ca`:
>     - the engine's branch deletions (`WorktreeManager.cleanup`, park reconciliation) run in the
>       root checkout, which does not read a feature worktree's `core.hooksPath`; reclaim,
>       park and teardown of squash-merged branches must keep running there;
>     - its local ref moves inside a feature or resolve worktree (setup-triage quarantine
>       `branch -f`, the post-finish `update-ref HEAD`, `checkout -B`, rebase) are updates, not
>       deletions;
>     - its pushes are plain or bare `--force-with-lease`.
>
>     `CONDUCT_ENGINE_COMMIT` stays a commit-only escape and the new hooks do not read it. An
>     operator deleting a squash-merged branch from a halted worktree runs that deletion from the
>     root checkout. Before every guarded dispatch, the D3 re-verification also confirms both hook
>     files' content and mode and rewrites them if they differ, failing the dispatch with a message
>     naming the hook path if they still cannot be confirmed. Refusals are stderr-only, as for the
>     guard; refusal telemetry stays out of scope.
>
> > **Amended 2026-10-10 by #2943:** Engine pushes are plain or `--force-with-lease=<ref>:<sha>` after a single-branch fetch; engine commits in a stacked feature worktree go through a guarded helper ending in `update-ref HEAD <new> <old>`, an update not a deletion (`adr-2026-10-10-stacked-restack-journaled-replay` decisions 4, 11).
>
> 15. **Coverage is proven by real-git tests and documented limits.** Tests run real `git` in
>     temporary repositories and linked worktrees provisioned by `prepareWorktree`, push to a local
>     bare remote, call `git` by absolute path so the guard is not on the path, and set `HOME` to an
>     empty directory so no operator configuration is present. They prove each refusal leaves the
>     ref unchanged and names the operation and its safe alternative. They prove these pass: lease
>     pushes, fast-forward and new-ref pushes, deletion of a branch reachable from another ref,
>     `git pack-refs --all` and `git gc`, and the engine's own ref operations listed in D14. Because
>     the hooks fire inside git, one provider-independent proof covers every provider and run mode.
>     Recorded limits added to the control inventory in `docs/reference/settings-and-hooks.md`:
>     `git -c core.hooksPath=…`, `git push --no-verify`, and git run from the root checkout or a worktree
>     the engine did not prepare.

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
- [ ] #2895: destructive-git guard enforcement and proof for the Pi provider adapter.
- [ ] #2904: git-faithful option, alias and heredoc parsing for the guard and operator hook.
