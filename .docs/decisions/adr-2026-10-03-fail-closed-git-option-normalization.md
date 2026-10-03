# ADR: One git option spec, normalized fail-closed by both destructive-git guards

**Date:** 2026-10-03
**Status:** APPROVED (operator, 2026-10-03)
**Deciders:** James Stoup (operator), composer DECIDE for #2904
**Extends:** adr-2026-09-23-engine-git-guard-on-agent-path (D5, D8)

## Context

adr-2026-09-23-engine-git-guard-on-agent-path delivers its D5 refusal matrix for canonical
spellings only, and its 2026-10-02 and 2026-10-03 amendments leave every other spelling git accepts
to #2904. Both guards have the same flaw: they match exact tokens and allow anything else. So each
review lap of #1354 found new spellings that got through, and the feature burned four `prd_audit`
laps without converging.

Verified on git 2.53.0 against main @ `833b75868` on 2026-10-03 (scratch repositories, about 95%):

- The three bypasses #2904 names (`-C`/`--git-dir` prefix in the reachability query,
  `--config-env=`, heredoc quote removal and comment openers) are already fixed by #2773.
- Both guards still allow `reset --har` and `branch -df «unreachable»`, which really deleted the
  branch. The PATH guard also allows `branch --delete --forc`.
- The Claude hook also allows `git -C «dir» reset --hard`, `git -c k=v push --force`,
  `git --config-env=… reset --hard`, `git clean -xdf` and `git push origin +main`. Its regexes
  require the subcommand to follow `git` immediately.
- Git uses two grammars:
  - **Global options** (git.c) need exact spellings. `--no-pag`, `-C.` and `-ca.b=c` all exit 129.
  - **Subcommand options** (parse-options) accept any unique long-option prefix (`--har`, `--fo`)
    and bundled short flags (`-df`). An ambiguous prefix is an error (`push --forc`,
    `branch --for`), and a non-negatable option rejects `--no-` (`reset --no-hard` exits 129).
- `git «cmd» --git-completion-helper` lists a subcommand's options but omits hidden ones, such as
  `--force` for `clean` and `branch`. It cannot serve as the spec, only as a drift signal.

## Options Considered

### Option A: delegate parsing to git (filer's hypothesis)
- **Pros:** follows the installed git version.
- **Cons:** git has no dry parse of a built-in's options, and the completion helper is incomplete.
  Every guarded call pays an extra process. The Claude hook must still parse shell before git sees
  anything.

### Option B: shared normalizer, default allow
- **Pros:** allows exactly what git allows.
- **Cons:** any rule modeled wrong becomes the next bypass, which is the cycle #1354 hit.

### Option C: shared normalizer, fail closed (chosen)
- **Pros:** a spelling the spec cannot resolve is refused, not passed through, so later review laps
  can only find false refusals, not bypasses.
- **Cons:** a rare legitimate spelling is refused. The spec needs upkeep when git adds options.

## Decision

Option C.

1. **One TypeScript option spec is the single source of truth.** A new engine module holds data
   only:
   - Git's global options: exact names, argument arity, and whether an `=value` form exists, per
     git.c.
   - For each guarded subcommand (`reset`, `branch`, `clean`, `push`, `checkout`, `restore`), every
     option git accepts, hidden ones included: long name, short letter, argument arity
     (none / required / optional), and negatability.

   Neither guard hard-codes its own grammar.
2. **Normalization follows git's two grammars.**
   - Global options match exactly, consuming their argument by arity, as git.c does.
   - For a guarded subcommand, parse-options rules apply:
     - Bundled short flags expand until a letter that takes an argument; the rest of the token is
       that argument.
     - A long option resolves by exact name or a unique prefix.
     - `--name=value` and `--no-name` are honored.
     - `--` and `--end-of-options` end option parsing.
   - Subcommands that are not guarded pass through unchanged, as today.
3. **Unresolvable means refused.**
   - A guarded subcommand with an unknown or ambiguous option is refused. The message names the
     token and asks for the full spelling.
   - An unknown global-option token followed later by a guarded subcommand name is refused, because
     the subcommand cannot be determined.
   - In the PATH guard, both refusals stay scoped to the feature repository by the existing
     common-directory check (adr-2026-09-23 D4).
4. **The destructive predicates keep D5's matrix and act on canonical options.** They are
   presence-based. `--hard` anywhere in a `reset` refuses even if a later mode option wins in git,
   which errs toward refusing. Refusal messages and safe alternatives stay as D6 states them.
5. **The PATH guard's grammar is generated from the spec.**
   - `GIT_GUARD_SCRIPT` stays a static exported string. Its normalizer case arms are generated
     from the spec when the module loads, following the precedent of `protectedArtifactPathCase`.
     No runtime value is interpolated, so the interpreter-source inventory and the D3 content
     re-verification work unchanged.
   - Single-level non-shell alias expansion stays, and runs before normalization.
6. **The Claude hook normalizes argv, not regex text.**
   - After the existing heredoc, comment and quote scrub, the hook splits the command into simple
     commands with Python `shlex` (POSIX mode, punctuation characters) on `;`, `|`, `&`, `&&`, `||`
     and newlines.
   - It recognizes a `git` word (bare or path-suffixed, after leading `NAME=value` assignments) and
     normalizes that argv with an embedded literal copy of the spec.
   - Alias expansion and shell indirection (`$var`, `eval`, `bash -c`) stay out of scope. The hook
     is early feedback, not the enforcement point (adr-2026-09-23 D2, D8).
   - Classification makes no git or gh call. The existing post-classification check that a
     `branch -D` target is already merged is unchanged.

   > **Amended 2026-10-03 by #2904 (operator decision, stories):** the hook treats a `git` word
   > (bare or path-suffixed) at any word position of a simple command as the start of a git
   > invocation, not only after leading `NAME=value` assignments. This keeps today's coverage of
   > wrapped forms such as `sudo git …`, `env git …` and `xargs git …`; `echo git reset --hard`
   > stays a false refusal, as today. A command that contains a `git` word but cannot be split into
   > words (for example an unterminated quote) is refused with a message saying it could not be
   > parsed.

   > **Amended 2026-10-03 by #2904 (operator decision, conflict-check):** the hook does not split
   > words after the existing quote scrub, because that scrub deletes quoted spans whole and shifts
   > argument boundaries (`git -C "my dir" reset --hard` would let `-C` consume `reset`). The hook
   > drops heredoc bodies and comments only, then `shlex` performs quote removal while splitting,
   > so a quoted span stays one word and is never a `git` command word unless it is exactly `git`.
7. **Coverage is proven by one corpus, a parity check and a drift check.**
   - **Corpus:** one committed fixture lists argv or shell-command cases with an expected refuse or
     allow. It includes every spelling named in #2904 and in #1354's earlier laps. The PATH guard
     tests (stub real `git`, per the test-process-isolation rule) and the Claude hook tests both
     run every case.
   - **Parity:** a test fails when the hook's embedded spec differs from the TypeScript spec.
   - **Drift:** a test fails when `git «cmd» --git-completion-helper` lists an option the spec does
     not know. The check is superset-only, because the helper omits hidden options.

   > **Amended 2026-10-03 by #2904 (operator decision, conflict-check):** each corpus case declares
   > a separate expected outcome per guard, `refuse`, `allow` or `not-applicable`, because the hook
   > keeps its own narrower policy (adr-2026-09-23 D8) and some cases are shell-only (heredoc or
   > comment) or PATH-guard-only (alias expansion). Each suite runs every case whose expectation for
   > its guard is not `not-applicable`, and fails if it runs fewer. A spelling-only case is
   > `refuse` for both guards. A case whose two applicable expectations differ must name its
   > policy difference.
8. **Recorded limits shrink.** The control inventory in `docs/reference/settings-and-hooks.md`
   drops the non-canonical-spelling limit and records the fail-closed refusal instead. The
   absolute-path `git`, `PATH`-shadowing, shell-alias, review-dispatch and Pi limits of
   adr-2026-09-23 D10 are unchanged.

## Consequences

### Positive
- The bypass cycle ends: a spelling the spec cannot resolve is refused in both guards.
- One spec and one corpus replace two independently drifting grammars.

### Negative
- A legitimate but unusual spelling, or a new git option the spec lacks, is refused until the spec
  is updated. The refusal names the token.
- The drift test can fail on a CI git upgrade unrelated to the change under test. The failure names
  the new option to add.
- The hook carries a second copy of the spec. Only the parity test keeps it honest.

### Follow-up Actions
- [ ] Add the spec module, the generated PATH guard normalizer, and the hook argv normalizer.
- [ ] Add the shared corpus, parity and drift tests.
- [ ] Update the control inventory in `docs/reference/settings-and-hooks.md`.
