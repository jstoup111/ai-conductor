# Implementation Plan: fail-closed git option normalization for both destructive-git guards (#2904)

**Date:** 2026-10-03
**Design:** .docs/architecture/destructive-git-guard-parser-misses-valid-git-and-.md
**Stories:** .docs/stories/destructive-git-guard-parser-misses-valid-git-and-.md
**Conflict check:** Clean as of 2026-10-03
**Source:** jstoup111/ai-conductor#2904

## Summary

Twelve tasks add one TypeScript git option spec and use it in both destructive-git guards. The
engine PATH guard (`GIT_GUARD_SCRIPT`) and the shipped Claude hook (`block-destructive-git.sh`)
normalize git's two option grammars and refuse what they cannot resolve. One corpus, a parity test
and a drift test keep the two guards in agreement.

## Technical Approach

- **Spec (ADR D1).** A new data-only module, `src/conductor/src/engine/git-option-spec.ts`, exports
  `GIT_OPTION_SPEC`. It holds:
  - `global`: each git.c global option's exact name, arity (`none` or `required`), and whether an
    `--name=value` form exists.
  - `subcommands`: for each of `reset`, `branch`, `clean`, `push`, `checkout` and `restore`, every
    option git 2.53 accepts. Each entry has a long name, an optional short letter, arity
    (`none` / `required` / `optional`), and negatability.

  It is authored from each subcommand's `git «cmd» -h` usage and documentation, hidden options
  included (`--force` for `clean` and `branch`). `push --force-with-lease` and `--force-if-includes`
  carry an optional `=value` argument (conflict report). Every option the engine-CLI argv table in
  `git-guard-engine-unaffected.test.ts` uses must be present.
- **Grammar (D2).**
  - Global options match exactly. A known option consumes its argument by arity.
  - For a guarded subcommand, parse-options rules apply:
    - A bundled short token expands letter by letter until a letter with a `required` or `optional`
      argument. The rest of the token, or the next argv for `required`, is that argument.
    - `--name=value` splits at the first `=`.
    - A long token resolves by exact match, else a unique prefix among the subcommand's long names
      and their `no-` forms. A token that matches several is ambiguous.
    - `--no-«name»` is allowed only for negatable options.
    - `--` and `--end-of-options` end option parsing; later tokens are operands.
- **Fail closed (D3).**
  - On a guarded subcommand, an unknown or ambiguous option yields
    `unrecognized option «token» for git «cmd»; spell the option in full`.
  - An unknown global option followed later by a guarded subcommand name yields
    `unrecognized git option «token» before «cmd»`.
  - The PATH guard applies both through its existing feature-common-dir check (adr-2026-09-23 D4)
    and reports them through `refuse`.
- **Predicates (D4).** These are the existing D5 matrix, evaluated presence-based on canonical long
  names:
  - `reset`: `hard`.
  - `branch`: `delete`+`force`, or the `-D` letter, which expands to both.
  - `clean`: `force`.
  - `push`: `force`, or a `+`-prefixed operand.
  - `checkout`: `--` with operands after it, unless `ours`/`theirs`/`merge` is present.
  - `restore`: the existing staged/worktree rule.

  Existing reasons and alternatives are unchanged.

  The Claude hook keeps its own narrower policy on these normalized options (adr-2026-09-23 D8):
  - push force, `-f` or a `+` operand;
  - `reset` `hard`;
  - `branch` `delete`+`force`, routed to its merged-branch check;
  - `clean` `force`;
  - `checkout -- .` and `restore .` only.
- **PATH guard (D5).**
  - `git-hook-assets.ts` builds the normalizer fragments from `GIT_OPTION_SPEC` once when the
    module loads and joins them into the static `GIT_GUARD_SCRIPT`:
    - a global-option `case` for each arity class;
    - per-subcommand bash arrays of long names, arities and negatability;
    - a per-subcommand short-letter `case`.
  - Pattern basis: `protectedArtifactPathCase` is a module-load fragment computed from engine data
    and joined into a static bash string, with no runtime value interpolated, so the
    interpreter-source inventory accepts it. Rediscover it via `protectedArtifactPathCase` and
    `PRE_COMMIT_HOOK` in `git-hook-assets.ts`. Allowed variation: several fragments instead of one.
  - Alias expansion stays where it is and runs before normalization.
  - `writeGitGuard` and `ensureGitGuardForDispatch` already write and re-verify `GIT_GUARD_SCRIPT`
    content, so provisioning needs no change.
- **Claude hook (D6, both amendments).** The Python block in `block-destructive-git.sh`:
  1. Keeps heredoc-body removal and comment masking.
  2. Stops deleting quoted spans before splitting.
  3. Tokenizes with `shlex.shlex(text, posix=True, punctuation_chars=True)` (whitespace_split on)
     and splits simple commands on `;`, `|`, `&`, `&&`, `||` and newlines.
  4. Treats any word equal to `git` or ending in `/git` as the start of a git argv.
  5. Normalizes that argv with an embedded JSON copy of the spec. The copy sits between the marker
     lines `# BEGIN GIT_OPTION_SPEC` and `# END GIT_OPTION_SPEC`, as `SPEC = json.loads(r'''…''')`.

  The Python block prints a verdict line for bash to act on: `deny «message»`,
  `branch-delete «names…»`, `rebase-note`, or `allow`. Shell-split failure (`ValueError`) on text
  containing a `git` word yields `deny … could not be parsed`. The existing merged-branch check
  (git/gh) runs only for a `branch-delete` verdict. Existing messages and exit codes are kept.
- **Proof (D7).**
  - `src/conductor/test/fixtures/destructive-git-corpus.json` holds cases with fields:
    `name`, `argv` (PATH guard), `command` (hook), `pathGuard` and `hook` expectations
    (`refuse` | `allow` | `not-applicable`), and an optional `branch` fixture state.
  - `git-guard-script.test.ts` and `destructive-git-hook.test.ts` each iterate the whole corpus.
  - A parity test parses the hook's embedded JSON and deep-equals `GIT_OPTION_SPEC`.
  - A drift test compares the spec with `git «cmd» --git-completion-helper`.
- **Test isolation.**
  - PATH guard tests use the existing stub real `git`, extended to record the full argv. Every
    refusal asserts that no refused subcommand reached it (adr-2026-09-23 D10, review condition 1).
  - Hook tests use the existing `git`/`gh` stubs.
- **Sequencing.**
  - Task 1 lands the spec.
  - Tasks 2–6 change `GIT_GUARD_SCRIPT` and run serially.
  - Tasks 7–10 change the hook and run serially, after Task 1 and in parallel with Tasks 2–6.
  - Task 11 needs Tasks 1 and 7.
  - Task 12 needs both guard tracks.
- **Documentation.** The control-inventory update in `docs/reference/settings-and-hooks.md`
  (adr-2026-10-03 D8) goes to the documentation-maintenance step, not a plan task.
- **Release.** Per review condition 2, if the self-host release gate flags `hook wiring` for the
  hook's content change, the build adds
  `.docs/release-waivers/destructive-git-guard-parser-misses-valid-git-and-.md` waiving `hook wiring`.

## Prerequisites

- None. Guard provisioning, re-verification and hook installation already exist and are unchanged.

## Tasks

### Task 1: Add the git option spec and its completion-helper drift test
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-option-spec.test.ts`:
   - `GIT_OPTION_SPEC.subcommands` has exactly the six guarded subcommands.
   - `clean` and `branch` include `force` (short `f`).
   - `push` `force-with-lease` has arity `optional`.
   - `reset` `hard` is not negatable.
   - Every option in the engine-CLI argv table of `git-guard-engine-unaffected.test.ts` resolves in
     the spec.
   - A test-local `driftFindings(spec, cmd, helperOutput)` turns each `--name`/`--name=`/`--no-name`
     token of a helper output into a finding `«cmd» --«name»` when the spec lacks it. A fabricated
     helper output with an extra `--brand-new` yields `reset --brand-new`, and one that omits
     `--force` for `clean` yields none.
   - A drift case runs the real `git «cmd» --git-completion-helper` for each guarded subcommand and
     expects zero findings, with a message listing every finding.
2. Verify RED.
3. Implement `src/conductor/src/engine/git-option-spec.ts`: types `GitGlobalOption`,
   `GitSubcommandOption`, `GuardedSubcommand`, and the data constant `GIT_OPTION_SPEC`, authored
   from `git «cmd» -h` usage on git 2.53.0 plus hidden options. Data only, no logic. A short-only letter with no long name in git is an entry with `short` and `expandsTo` (canonical long names): `branch` `-D` → `delete`+`force`, `-M` → `move`+`force`, `-C` → `copy`+`force`. Parity and drift key such entries as `«cmd» -«letter»`.
4. Verify GREEN. Commit: "git guard: add the shared git option spec"

**Done when:**
- `src/conductor/test/engine/git-option-spec.test.ts` asserts `GIT_OPTION_SPEC.subcommands` keys equal `reset`, `branch`, `clean`, `push`, `checkout`, `restore`, that `clean` and `branch` contain `force`, and that `push` `force-with-lease` has arity `optional`.
- Every option token in the engine-CLI argv table of `git-guard-engine-unaffected.test.ts` resolves to a `GIT_OPTION_SPEC` entry, as asserted in `git-option-spec.test.ts`.
- The drift test runs the real `git «cmd» --git-completion-helper` for each guarded subcommand and passes with zero findings against `GIT_OPTION_SPEC`.
- `driftFindings` fed a helper output containing `--brand-new` for `reset` returns `reset --brand-new` and the drift assertion fails naming that subcommand and option; fed a `clean` helper output lacking `--force`, it returns no finding.

**Files likely touched:**
- `src/conductor/src/engine/git-option-spec.ts`
- `src/conductor/test/engine/git-option-spec.test.ts`

**Dependencies:** none

### Task 2: PATH guard consumes git's global options exactly, from the spec
**Story:** 1, 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard-script.test.ts`, with the stub real `git` extended to append the full argv (NUL-joined) per call:
   - `--config-env=core.pager=PAGER reset --hard` and `-C «fixture» --no-pager reset --hard` are refused as hard resets.
   - `--no-pag status` reaches the stub real `git` unchanged.
   - `--no-pag reset --hard` is refused, and the stub records no `reset` call.
2. Verify RED.
3. Implement in `src/conductor/src/engine/git-hook-assets.ts`:
   - Build the global-option `case` arms from `GIT_OPTION_SPEC.global` when the module loads: exact
     names, `--name=*` for `=`-capable options, and arity-driven skips. This replaces the
     hand-written list, including the over-permissive `-C*`/`-c*` arms.
   - An unknown `-…` token sets `unknown_global` and is skipped.
   - If any later argv equals a guarded subcommand name, the guard refuses with
     `unrecognized git option «token» before «cmd»` through the existing common-dir check. Otherwise
     it `exec`s the real `git` unchanged.
   - Keep passing the consumed global-option prefix (`args[@]:0:$i`) to every classification query (`config`, `rev-parse --git-common-dir`, `for-each-ref`, `merge-base`), so `-C`/`--git-dir` still select the target repository for D4 scoping.
   - Follow the `protectedArtifactPathCase` pattern: a fragment computed at module load from engine
     data, joined into the static `GIT_GUARD_SCRIPT` string, with no runtime value interpolated.
4. Verify GREEN. Commit: "git guard: parse global options from the shared spec"

**Done when:**
- `GIT_GUARD_SCRIPT` driven with `--config-env=core.pager=PAGER reset --hard` and with `-C «fixture» --no-pager reset --hard` exits non-zero with the hard-reset reason and `git reset --keep` alternative on stderr, and the stub real `git` records no `reset` argv.
- `GIT_GUARD_SCRIPT` driven with `--no-pag reset --hard` exits non-zero, stderr names `--no-pag` as an unrecognized git option before `reset`, and the stub real `git` records no `reset` argv.
- `GIT_GUARD_SCRIPT` driven with `--no-pag status` passes the exact original argv to the stub real `git`.
- The interpreter-source inventory run over the real `git-hook-assets` exports reports no finding for `GIT_GUARD_SCRIPT`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** Task 1

### Task 3: PATH guard normalizes abbreviations, bundles and negations for guarded subcommands
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard-script.test.ts`:
   - Refused: `reset --har`, `reset --ha HEAD~1`, `clean --fo`, `clean --forc -d`, `clean -dxf`, `-C «fixture» --no-pager reset --har`, `--config-env=core.pager=PAGER reset --ha`.
   - Refused with the stub reporting the branch as unreachable: `branch -df «b»`, `branch -fd «b»`, `branch -Dq «b»`, `branch --del --force «b»`.
   - Allowed: `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix`, `push --force-with origin main`, `clean -nd`, `clean --dry`, and `branch -df «b»` when the stub reports `«b»` reachable.
   - `checkout -- --har` is refused as a path checkout.
   - `reset --har` is allowed when the stub's `rev-parse` reports a different common dir.
   - A guard file written by `writeGitGuard` into a fixture worktree refuses `reset --har`.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`:
   - Per guarded subcommand, normalize the argv after the subcommand into `canon` (canonical long names) and `operands`:
     - Generated short-letter `case` per subcommand, expanding bundles until an arg-taking letter.
     - Generated long-name arrays and unique-prefix resolution, with `=value` split.
     - `--no-` handled for negatable options.
     - `--`/`--end-of-options` end option parsing.
   - Rewrite the existing predicates to read `canon`/`operands` instead of raw tokens; refusal text is unchanged.
   - Fragments are generated from `GIT_OPTION_SPEC` at module load, following the `protectedArtifactPathCase` pattern (static string, no runtime interpolation).
4. Verify GREEN. Commit: "git guard: normalize guarded subcommand options before classifying"

**Done when:**
- `GIT_GUARD_SCRIPT` refuses `reset --har`, `reset --ha HEAD~1`, `-C «fixture» --no-pager reset --har` and `--config-env=core.pager=PAGER reset --ha` with exit non-zero, the hard-reset reason and `git reset --keep «target»` on stderr, and no `reset` argv recorded by the stub real `git`.
- With the stub reporting `«b»` unreachable, `GIT_GUARD_SCRIPT` refuses `branch -df «b»`, `branch -fd «b»`, `branch -Dq «b»` and `branch --del --force «b»` with exit non-zero, the commits-unreachable reason and `git branch -d «b»` on stderr, and no `branch` argv recorded; with the stub reporting `«b»` reachable, `branch -df «b»` reaches the stub unchanged.
- `GIT_GUARD_SCRIPT` refuses `clean --fo`, `clean --forc -d` and `clean -dxf` with the forced-clean reason and `git clean -n` alternative, and passes `clean -nd`, `clean --dry`, `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix` and `push --force-with origin main` to the stub real `git` as the exact original argv, whose exit status the guard returns.
- `GIT_GUARD_SCRIPT` refuses `checkout -- --har` with the path-checkout reason, not a hard-reset or unrecognized-option message, and passes `reset --har` unchanged to the stub when `rev-parse --git-common-dir` reports a non-feature common dir.
- A guard written by `writeGitGuard` into a fixture worktree's `.pipeline/bin/git`, run with its provisioned data files, refuses `reset --har` with the hard-reset reason.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** Task 2

### Task 4: PATH guard refuses unknown and ambiguous options on guarded subcommands
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard-script.test.ts`:
   - Refused, each naming its token: `reset --bogus HEAD`, `push --forc origin main` (ambiguous), `branch -Z «b»`.
   - Allowed: `status --bogus` and `log --ha` reach the stub unchanged; `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file`, `reset --soft HEAD~1` reach the stub unchanged.
   - Allowed when the stub reports a non-feature common dir: `reset --bogus`.
   - On a refusal, every recorded stub call is one of `config`, `rev-parse`, `for-each-ref`, `merge-base`.
   - The engine-CLI argv table test in `src/conductor/test/engine/git-guard-engine-unaffected.test.ts` keeps passing unchanged.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`: when normalization finds no match or several prefix matches, set the refusal to `unrecognized option «token» for git «cmd»; spell the option in full`. It is subject to the existing feature-common-dir check and reported through `refuse`, with operation `«cmd»`.
4. Verify GREEN. Commit: "git guard: refuse unresolvable options on guarded subcommands"

**Done when:**
- `GIT_GUARD_SCRIPT` refuses `reset --bogus HEAD`, `push --forc origin main` and `branch -Z «b»` with exit non-zero and stderr naming `--bogus`, `--forc` and `-Z` respectively as unrecognized for that git subcommand and asking for the full option spelling, with no `reset`, `push` or `branch` argv recorded by the stub real `git`.
- For each of those refusals, every call the stub real `git` recorded is one of `config`, `rev-parse`, `for-each-ref`, `merge-base`.
- `GIT_GUARD_SCRIPT` passes `status --bogus`, `log --ha`, `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file` and `reset --soft HEAD~1` to the stub real `git` as the exact original argv.
- `GIT_GUARD_SCRIPT` passes `reset --bogus` to the stub real `git` unchanged when `rev-parse --git-common-dir` reports a non-feature common dir.
- The engine-CLI argv table test in `git-guard-engine-unaffected.test.ts` passes with every listed argv reaching the stub real `git`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** Task 3

### Task 5: PATH guard normalizes an expanded alias
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/git-guard-script.test.ts`: with the stub's `config --get alias.nuke` returning `reset --har`, `nuke` is refused as a hard reset.
2. Verify RED.
3. Implement: run normalization over the post-alias-expansion argv (existing expansion position), so expanded alias text is classified by the same tables.
4. Verify GREEN. Commit: "git guard: normalize options after alias expansion"

**Done when:**
- With the stub real `git` answering `config --get alias.nuke` with `reset --har`, `GIT_GUARD_SCRIPT` driven with `nuke` exits non-zero with the hard-reset reason and `git reset --keep` alternative, and the stub records no `nuke` or `reset` argv.
- With the alias answering `reset --keep HEAD~1`, `GIT_GUARD_SCRIPT` driven with `nuke` passes the exact original argv `nuke` to the stub real `git`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** Task 4

### Task 6: PATH guard canonical refusal matrix and messages are unchanged
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing or confirming tests in `src/conductor/test/engine/git-guard-script.test.ts`:
   - The existing `REFUSAL_CASES` table and its exact message assertions stay unchanged.
   - Allowed cases (exact argv reaches the stub): `push --force-with-lease --force-if-includes origin main`, `reset --keep HEAD~1`, `branch -d «b»`, `clean -n`, `checkout --ours -- file`, `restore --staged file`.
   - `reset --hard --soft` is refused as a hard reset.
2. Verify RED for any case the normalizer regressed.
3. Implement only what a failing case requires in `GIT_GUARD_SCRIPT`.
4. Verify GREEN. Commit: "git guard: pin the canonical refusal matrix"

**Done when:**
- Every `REFUSAL_CASES` entry in `git-guard-script.test.ts` (force push, `-f`, `+` refspecs, lease-plus-force, `reset --hard`, `branch -D`, `--delete --force`, `clean -f`/`-fd`/`-xdf`/`--force`, path `checkout`, `restore «file»`) is refused with its unchanged reason and alternative regexes, with the unchanged single-line `ai-conductor git guard: refused «cmd» — ` prefix.
- `GIT_GUARD_SCRIPT` passes `push --force-with-lease --force-if-includes origin main`, `reset --keep HEAD~1`, `branch -d «b»`, `clean -n`, `checkout --ours -- file` and `restore --staged file` to the stub real `git` as the exact original argv.
- `GIT_GUARD_SCRIPT` refuses `reset --hard --soft` with the hard-reset reason and records no `reset` argv on the stub.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** Task 5

### Task 7: Claude hook splits simple commands and normalizes each git argv with the embedded spec
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/destructive-git-hook.test.ts`, using the existing `git`/`gh` recording stubs:
   - Also exit 2 (steps-only pipe case): `make build | git clean -fd`.
   - Exit 2: `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard`, `git --git-dir=.git reset --hard`, `git reset --har`, `git clean -xdf`, `git clean --fo`, `git push origin +main`, `cd repo && git -C . reset --hard`, `make build; git clean -fd & wait`, `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard`, `xargs git clean -f`, and a `<<\EOF` / `<<E"OF"` / `# <<EOF` opener followed by a later `git reset --hard` line.
   - Exit 0: `git commit -m "undo reset --hard"`, a heredoc body containing `git reset --hard`, `# git reset --hard`, `git push --force-with-lease origin main`, `git -C . push --force-with origin main`, `git status`, `git -C . log --oneline`, `git reset --soft HEAD~1`; for each, the `git` and `gh` stubs record no call.
2. Verify RED.
3. Implement in `hooks/claude/block-destructive-git.sh`:
   - Embed the spec JSON between `# BEGIN GIT_OPTION_SPEC` / `# END GIT_OPTION_SPEC` inside the quoted `python3 - <<'PY'` heredoc.
   - Keep heredoc-body dropping and comment masking, and remove the quoted-span `sed` scrub.
   - Split with `shlex.shlex(posix=True, punctuation_chars=True, whitespace_split=True)` into simple commands on `;`, `|`, `&`, `&&`, `||` and newlines.
   - Treat every word equal to `git` or ending `/git` as a git argv start, then apply the global grammar, normalization and predicates.
   - Print a verdict line for bash: `deny «message»`, `branch-delete «names»`, `rebase-note` or `allow`. Bash maps `deny` to the existing message and exit 2.
   - Command text stays data passed through the environment, never interpolated into interpreter source.
4. Verify GREEN. Commit: "claude hook: normalize each git invocation against the shared spec"

**Done when:**
- `destructive-git-hook.test.ts` asserts exit 2 from the real hook for `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard` and `git --git-dir=.git reset --hard`.
- The real hook exits 2 for `git reset --har`, `git clean -xdf`, `git clean --fo`, `git push origin +main`, `cd repo && git -C . reset --hard`, `make build; git clean -fd & wait`, `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` and `xargs git clean -f`.
- The real hook exits 2 when a `<<\EOF`, `<<E"OF"` or comment-only `# <<EOF` opener is followed on a later line by `git reset --hard`.
- The real hook exits 0 for `git commit -m "undo reset --hard"`, a heredoc body containing `git reset --hard`, `# git reset --hard`, `git push --force-with-lease origin main` and `git -C . push --force-with origin main`.
- The real hook exits 0 for `git status`, `git -C . log --oneline` and `git reset --soft HEAD~1`, and for every exit-0 command in this task the `git` and `gh` stubs record no call.

**Files likely touched:**
- `hooks/claude/block-destructive-git.sh`
- `src/conductor/test/engine/destructive-git-hook.test.ts`

**Dependencies:** Task 1

### Task 8: Claude hook routes every force-delete spelling to its merged-branch check
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/destructive-git-hook.test.ts`, with the `git` stub's `merge-base --is-ancestor` answering per branch and `gh` reporting no merged PR:
   - `git branch -df «b»` and `git -C . branch --delete --force «b»` exit 2 with stderr naming `«b»` as unmerged.
   - `git branch -df «m»` for a merged `«m»` exits 0.
2. Verify RED.
3. Implement: the Python verdict `branch-delete` carries the normalized branch operands (canonical `delete`+`force`). Bash runs the existing merged check over exactly those names instead of re-parsing the raw command text, keeping the existing BLOCKED message.
4. Verify GREEN. Commit: "claude hook: classify force-delete spellings by normalized options"

**Done when:**
- The real hook exits 2 for `git branch -df «b»` and `git -C . branch --delete --force «b»` when the `git` stub reports `«b»` is not an ancestor of the default branch and `gh` reports no merged PR, and stderr contains the existing `force-delete UNMERGED branch(es):` text naming `«b»`.
- The real hook exits 0 for `git branch -df «m»` when the `git` stub reports `«m»` is an ancestor of the default branch.

**Files likely touched:**
- `hooks/claude/block-destructive-git.sh`
- `src/conductor/test/engine/destructive-git-hook.test.ts`

**Dependencies:** Task 7

### Task 9: Claude hook refuses unresolvable options and unparseable git commands
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/destructive-git-hook.test.ts`:
   - Exit 2, with stderr naming the token and asking for the full spelling: `git reset --bogus`, `git push --forc origin main`.
   - Exit 2, naming `--unknown-global`: `git --unknown-global reset HEAD`.
   - Exit 2, saying the command could not be parsed: `git reset "--hard`.
   - Exit 0: `git status --bogus`, `git --unknown-global status`, `echo "unterminated`.
   - For every exit-2 case, the `git`/`gh` stubs record no call.
2. Verify RED.
3. Implement in the hook's Python block:
   - Unknown or ambiguous option on a guarded subcommand → `deny unrecognized option «token» for git «cmd»; spell the option in full`.
   - Unknown global option with a later guarded subcommand word → `deny unrecognized git option «token» before «cmd»`.
   - `shlex` `ValueError` with a `git` word in the scanned text → `deny git command could not be parsed`; without one → `allow`.
4. Verify GREEN. Commit: "claude hook: fail closed on unresolvable git invocations"

**Done when:**
- The real hook exits 2 for `git reset --bogus` and `git push --forc origin main`, and stderr names `--bogus` and `--forc` respectively and asks for the full option spelling.
- The real hook exits 2 for `git --unknown-global reset HEAD` with stderr naming `--unknown-global`, and exits 2 for `git reset "--hard` with stderr saying the command could not be parsed.
- For each of those four refusals, the `git` and `gh` stubs record no call.
- The real hook exits 0 for `git status --bogus`, `git --unknown-global status` and `echo "unterminated`.

**Files likely touched:**
- `hooks/claude/block-destructive-git.sh`
- `src/conductor/test/engine/destructive-git-hook.test.ts`

**Dependencies:** Task 8

### Task 10: Claude hook canonical refusals, messages and rebase note are unchanged
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing or confirming tests in `src/conductor/test/engine/destructive-git-hook.test.ts`:
   - Each canonical refused form (`git push --force origin main`, `git push -f`, `git reset --hard`, `git branch -D «unmerged»`, `git clean -f`, `git checkout -- .`, `git restore .`) exits 2 with its existing stderr message.
   - `git rebase --continue` exits 0 with empty stderr.
   - `git rebase main` exits 0 with the existing `NOTE: 'git rebase' is allowed` text.
2. Verify RED for any regression.
3. Implement only what a failing case requires: the verdict mapping keeps each existing message string and the rebase reminder.
4. Verify GREEN. Commit: "claude hook: pin canonical refusals and the rebase reminder"

**Done when:**
- The real hook exits 2 for `git push --force origin main`, `git push -f`, `git reset --hard`, `git branch -D «unmerged»`, `git clean -f`, `git checkout -- .` and `git restore .`, and each stderr equals that form's message from before this change (force-push deny JSON, `BLOCKED: git reset --hard …`, `BLOCKED: git branch -D …`, `BLOCKED: git clean -f …`, `BLOCKED: This discards all unstaged changes …`).
- The real hook exits 0 with empty stderr for `git rebase --continue`, and exits 0 with stderr containing `NOTE: 'git rebase' is allowed` for `git rebase main`.

**Files likely touched:**
- `hooks/claude/block-destructive-git.sh`
- `src/conductor/test/engine/destructive-git-hook.test.ts`

**Dependencies:** Task 9

### Task 11: Parity test keeps the hook's embedded spec equal to the TypeScript spec
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write a failing test, `src/conductor/test/engine/destructive-git-hook-spec-parity.test.ts`:
   - Read `hooks/claude/block-destructive-git.sh` and extract the JSON between `# BEGIN GIT_OPTION_SPEC` and `# END GIT_OPTION_SPEC`.
   - Compare it with `GIT_OPTION_SPEC` through a test-local `specDifferences(a, b)` that lists `«cmd» --«name»` for every option present in one and missing or different in the other.
   - Assert the real comparison is empty.
   - Assert that a copy with `reset` `soft` removed yields `reset --soft`, and that the parity assertion then fails naming it.
   - Assert that a hook with missing markers fails the test.
2. Verify RED (if Task 7's copy drifted) or GREEN on the first run. Then add the mutated-copy cases.
3. Implement: only reconcile the embedded copy if it differs.
4. Commit: "claude hook: assert embedded option spec parity"

**Done when:**
- `destructive-git-hook-spec-parity.test.ts` extracts the JSON between `# BEGIN GIT_OPTION_SPEC` and `# END GIT_OPTION_SPEC` from the real hook and `specDifferences` against `GIT_OPTION_SPEC` returns an empty list.
- `specDifferences` over a copy with `reset` `soft` removed returns `reset --soft`, and the parity assertion over that copy fails with a message naming `reset` and `--soft`.
- A hook text with the markers absent makes the parity test fail rather than pass.

**Files likely touched:**
- `src/conductor/test/engine/destructive-git-hook-spec-parity.test.ts`
- `hooks/claude/block-destructive-git.sh`

**Dependencies:** Tasks 1, 7

### Task 12: One shared corpus with per-guard expectations drives both guard suites
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Add `src/conductor/test/fixtures/destructive-git-corpus.json`, one entry per case with `name`, `argv`, `command`, `pathGuard`, `hook` (each `refuse` | `allow` | `not-applicable`) and an optional `branch` state: `unreachable` (no other ref holds the tip, not merged), `reachable-unmerged` (another ref holds the tip, not merged into the default branch), or `merged` (an ancestor of the default branch). Both suites map these three values to their stubs the same way. Cover:
   - The #2904 spellings: `-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`.
   - The #1354 lap spellings: `--git-dir=` equals form, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers.
   - The review's residual bypasses: `reset --har`, `branch -df`, `branch --delete --forc`, global-option prefixes, `clean -xdf`, `push origin +main`.
   - Spelling-only cases carry `refuse` for both guards. Policy-differing cases declare their difference: `checkout -- file` (PATH guard `refuse`, hook `allow`); `checkout -- .` and `restore .` are the only checkout/restore path forms the hook refuses (hook `refuse`); and `branch -D` of a branch reachable from another ref but unmerged (PATH guard `allow`, hook `refuse`). Shell-only cases carry PATH guard `not-applicable`. Alias cases carry hook `not-applicable` (the hook does not expand aliases) and are not `spellingOnly`.
2. Write failing tests:
   - `git-guard-script.test.ts` iterates every corpus case whose `pathGuard` is not `not-applicable` and asserts the outcome.
   - `destructive-git-hook.test.ts` iterates every case whose `hook` is not `not-applicable`.
   - Each suite asserts that the number of cases it ran equals the number of corpus cases whose expectation for that guard is not `not-applicable`.
   - A schema assertion requires every spelling-only case (marked `"spellingOnly": true`) to carry `refuse` for both guards, and every case with unequal applicable expectations to carry `"policyDifference"` of `checkout-paths` or `branch-merged-rule`.
3. Verify RED, then fix any guard disagreement in its owning file.
4. Verify GREEN. Commit: "git guards: shared destructive-git corpus with per-guard expectations"

**Done when:**
- `destructive-git-corpus.json` holds the #2904 spellings (`-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`), the #1354 lap spellings (`--git-dir=` equals, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and `reset --har`, `branch -df`, `branch --delete --forc`, a global-option prefix case, `clean -xdf` and `push origin +main`, as asserted by a named-case presence test.
- `git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases.
- `destructive-git-hook.test.ts` runs every corpus case whose `hook` is `refuse` or `allow` and asserts the real hook exits 2 or 0 accordingly, and fails if the count of cases it ran differs from the count of such cases.
- A schema test fails when any `spellingOnly` corpus case does not carry `refuse` for both `pathGuard` and `hook`, and fails when any case whose `pathGuard` and `hook` are both non-`not-applicable` and unequal lacks a `policyDifference` of `checkout-paths` or `branch-merged-rule`; the corpus holds `checkout -- file` (`pathGuard` `refuse`, `hook` `allow`, `checkout-paths`) and an unmerged `branch -D` reachable from another ref (`pathGuard` `allow`, `hook` `refuse`, `branch-merged-rule`).
- The corpus holds `checkout -- .` and `restore .` with `hook` `refuse`, and a schema test fails when any other `checkout` or `restore` path case carries `hook` `refuse`, so the hook's refusal of only `checkout -- .` and `restore .` is asserted.
- The corpus holds at least one heredoc-only and one comment-only shell case, each with `pathGuard` `not-applicable`; a schema test fails if any case with `pathGuard` `not-applicable` is not a heredoc- or comment-only shell form; and `git-guard-script.test.ts` skips exactly the cases whose `pathGuard` is `not-applicable` — its count check fails if it skips any other case or runs any of those — so the PATH guard suite never skips a case by an unlisted exclusion.

**Files likely touched:**
- `src/conductor/test/fixtures/destructive-git-corpus.json`
- `src/conductor/test/engine/git-guard-script.test.ts`
- `src/conductor/test/engine/destructive-git-hook.test.ts`
- `src/conductor/src/engine/git-hook-assets.ts`
- `hooks/claude/block-destructive-git.sh`

**Dependencies:** Tasks 6, 10, 11

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ──┐
        ├─▶ Task 7 ─▶ Task 8 ─▶ Task 9 ─▶ Task 10 ──────────┼─▶ Task 12
        └─▶ Task 11 (also needs Task 7) ────────────────────┘
```

## Integration Points

- After Task 3: a guard written by `writeGitGuard` refuses abbreviated and bundled spellings in a provisioned worktree.
- After Task 7: the installed Claude `PreToolUse` hook classifies by normalized argv.
- After Task 12: one corpus proves both guards, with their policy differences declared.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the feature repository, when the PATH guard receives `reset --har` or `reset --ha HEAD~1`, then it is refused as a hard reset with `git reset --keep «target»` as the alternative. | 3 | "`GIT_GUARD_SCRIPT` refuses `reset --har`, `reset --ha HEAD~1`, `-C «fixture» --no-pager reset --har` and `--config-env=core.pager=PAGER reset --ha` with exit non-zero, the hard-reset reason and `git reset --keep «target»` on stderr, and no `reset` argv recorded by the stub real `git`" | diff-local |
| Story 1 happy: Given the feature repository and an unreachable branch, when the PATH guard receives `branch -df «branch»`, `branch -fd «branch»`, `branch -Dq «branch»` or `branch --del --force «branch»`, then each is refused as a force deletion that would make commits unreachable, with `git branch -d «branch»` as the alternative. | 3 | "With the stub reporting `«b»` unreachable, `GIT_GUARD_SCRIPT` refuses `branch -df «b»`, `branch -fd «b»`, `branch -Dq «b»` and `branch --del --force «b»` with exit non-zero, the commits-unreachable reason and `git branch -d «b»` on stderr, and no `branch` argv recorded; with the stub reporting `«b»` reachable, `branch -df «b»` reaches the stub unchanged" | diff-local |
| Story 1 happy: Given the feature repository, when the PATH guard receives `clean --fo`, `clean --forc -d` or `clean -dxf`, then each is refused as a forced clean with `git clean -n` as the alternative. | 3 | "`GIT_GUARD_SCRIPT` refuses `clean --fo`, `clean --forc -d` and `clean -dxf` with the forced-clean reason and `git clean -n` alternative, and passes `clean -nd`, `clean --dry`, `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix` and `push --force-with origin main` to the stub real `git` as the exact original argv, whose exit status the guard returns" | diff-local |
| Story 1 happy: Given the feature repository, when the PATH guard receives `-C «repo» --no-pager reset --har` or `--config-env=core.pager=PAGER reset --ha`, then it is refused as a hard reset. | 3 | "`GIT_GUARD_SCRIPT` refuses `reset --har`, `reset --ha HEAD~1`, `-C «fixture» --no-pager reset --har` and `--config-env=core.pager=PAGER reset --ha` with exit non-zero, the hard-reset reason and `git reset --keep «target»` on stderr, and no `reset` argv recorded by the stub real `git`" | diff-local |
| Story 1 happy: Given the feature repository and a non-shell alias `nuke = reset --har`, when the PATH guard receives `nuke`, then it is refused as a hard reset. | 5 | "With the stub real `git` answering `config --get alias.nuke` with `reset --har`, `GIT_GUARD_SCRIPT` driven with `nuke` exits non-zero with the hard-reset reason and `git reset --keep` alternative, and the stub records no `nuke` or `reset` argv" | diff-local |
| Story 1 negative: Given the feature repository, when the PATH guard receives `reset --ke HEAD~1`, `reset --so HEAD~1` or `reset --mix`, then the stub real `git` receives the original argv unchanged and the guard exits with its status. | 3 | "`GIT_GUARD_SCRIPT` refuses `clean --fo`, `clean --forc -d` and `clean -dxf` with the forced-clean reason and `git clean -n` alternative, and passes `clean -nd`, `clean --dry`, `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix` and `push --force-with origin main` to the stub real `git` as the exact original argv, whose exit status the guard returns" | diff-local |
| Story 1 negative: Given the feature repository, when the PATH guard receives `push --force-with origin main` (a unique prefix of `--force-with-lease`), then the stub real `git` receives the original argv unchanged. | 3 | "`GIT_GUARD_SCRIPT` refuses `clean --fo`, `clean --forc -d` and `clean -dxf` with the forced-clean reason and `git clean -n` alternative, and passes `clean -nd`, `clean --dry`, `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix` and `push --force-with origin main` to the stub real `git` as the exact original argv, whose exit status the guard returns" | diff-local |
| Story 1 negative: Given the feature repository and a branch whose tip another local branch contains, when the PATH guard receives `branch -df «branch»`, then the stub real `git` receives the original argv unchanged. | 3 | "With the stub reporting `«b»` unreachable, `GIT_GUARD_SCRIPT` refuses `branch -df «b»`, `branch -fd «b»`, `branch -Dq «b»` and `branch --del --force «b»` with exit non-zero, the commits-unreachable reason and `git branch -d «b»` on stderr, and no `branch` argv recorded; with the stub reporting `«b»` reachable, `branch -df «b»` reaches the stub unchanged" | diff-local |
| Story 1 negative: Given the feature repository, when the PATH guard receives `clean -nd` or `clean --dry`, then the stub real `git` receives the original argv unchanged. | 3 | "`GIT_GUARD_SCRIPT` refuses `clean --fo`, `clean --forc -d` and `clean -dxf` with the forced-clean reason and `git clean -n` alternative, and passes `clean -nd`, `clean --dry`, `reset --ke HEAD~1`, `reset --so HEAD~1`, `reset --mix` and `push --force-with origin main` to the stub real `git` as the exact original argv, whose exit status the guard returns" | diff-local |
| Story 1 negative: Given the feature repository, when the PATH guard receives `checkout -- --har` (a pathspec after `--`), then it is refused as a path checkout, not as a hard reset or an unrecognized option. | 3 | "`GIT_GUARD_SCRIPT` refuses `checkout -- --har` with the path-checkout reason, not a hard-reset or unrecognized-option message, and passes `reset --har` unchanged to the stub when `rev-parse --git-common-dir` reports a non-feature common dir" | diff-local |
| Story 1 negative: Given a repository whose common directory differs from the recorded one, when the PATH guard receives `reset --har`, then the stub real `git` receives the original argv unchanged. | 3 | "`GIT_GUARD_SCRIPT` refuses `checkout -- --har` with the path-checkout reason, not a hard-reset or unrecognized-option message, and passes `reset --har` unchanged to the stub when `rev-parse --git-common-dir` reports a non-feature common dir" | diff-local |
| Story 2 happy: Given the feature repository, when the PATH guard receives `reset --bogus HEAD`, then it exits non-zero, stderr names `--bogus` as an unrecognized option for `git reset` and asks for the full option spelling, and the stub real `git` records no `reset` call. | 4 | "`GIT_GUARD_SCRIPT` refuses `reset --bogus HEAD`, `push --forc origin main` and `branch -Z «b»` with exit non-zero and stderr naming `--bogus`, `--forc` and `-Z` respectively as unrecognized for that git subcommand and asking for the full option spelling, with no `reset`, `push` or `branch` argv recorded by the stub real `git`" | diff-local |
| Story 2 happy: Given the feature repository, when the PATH guard receives `push --forc origin main` (ambiguous between `--force-with-lease` and `--force-if-includes`), then it is refused naming `--forc` as unrecognized or ambiguous, and the stub real `git` records no `push` call. | 4 | "`GIT_GUARD_SCRIPT` refuses `reset --bogus HEAD`, `push --forc origin main` and `branch -Z «b»` with exit non-zero and stderr naming `--bogus`, `--forc` and `-Z` respectively as unrecognized for that git subcommand and asking for the full option spelling, with no `reset`, `push` or `branch` argv recorded by the stub real `git`" | diff-local |
| Story 2 happy: Given the feature repository, when the PATH guard receives `branch -Z «branch»` (an unknown short letter), then it is refused naming `-Z`. | 4 | "`GIT_GUARD_SCRIPT` refuses `reset --bogus HEAD`, `push --forc origin main` and `branch -Z «b»` with exit non-zero and stderr naming `--bogus`, `--forc` and `-Z` respectively as unrecognized for that git subcommand and asking for the full option spelling, with no `reset`, `push` or `branch` argv recorded by the stub real `git`" | diff-local |
| Story 2 happy: Given the feature repository, when the PATH guard receives `--no-pag reset --hard` (git's global options do not abbreviate), then it is refused, and the stub real `git` records no `reset` call. | 2 | "`GIT_GUARD_SCRIPT` driven with `--no-pag reset --hard` exits non-zero, stderr names `--no-pag` as an unrecognized git option before `reset`, and the stub real `git` records no `reset` argv" | diff-local |
| Story 2 negative: Given the feature repository, when the PATH guard receives `status --bogus` or `log --ha`, then the stub real `git` receives the original argv unchanged (not a guarded subcommand). | 4 | "`GIT_GUARD_SCRIPT` passes `status --bogus`, `log --ha`, `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file` and `reset --soft HEAD~1` to the stub real `git` as the exact original argv" | diff-local |
| Story 2 negative: Given the feature repository, when the PATH guard receives `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file` or `reset --soft HEAD~1`, then the stub real `git` receives the original argv unchanged. | 4 | "`GIT_GUARD_SCRIPT` passes `status --bogus`, `log --ha`, `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file` and `reset --soft HEAD~1` to the stub real `git` as the exact original argv" | diff-local |
| Story 2 negative: Given the feature repository, when the PATH guard receives `--no-pag status`, then the stub real `git` receives the original argv unchanged. | 2 | "`GIT_GUARD_SCRIPT` driven with `--no-pag status` passes the exact original argv to the stub real `git`" | diff-local |
| Story 2 negative: Given a repository whose common directory differs from the recorded one, when the PATH guard receives `reset --bogus`, then the stub real `git` receives the original argv unchanged. | 4 | "`GIT_GUARD_SCRIPT` passes `reset --bogus` to the stub real `git` unchanged when `rev-parse --git-common-dir` reports a non-feature common dir" | diff-local |
| Story 2 negative: Given the feature repository, when the PATH guard refuses an unrecognized option, then the only calls the stub real `git` recorded are read-only classification queries (`config`, `rev-parse`, `for-each-ref`, `merge-base`). | 4 | "For each of those refusals, every call the stub real `git` recorded is one of `config`, `rev-parse`, `for-each-ref`, `merge-base`" | diff-local |
| Story 3 happy: Given the Claude hook, when the command is `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard` or `git --git-dir=.git reset --hard`, then the hook exits 2. | 7 | "`destructive-git-hook.test.ts` asserts exit 2 from the real hook for `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard` and `git --git-dir=.git reset --hard`" | diff-local |
| Story 3 happy: Given the Claude hook, when the command is `git reset --har`, `git clean -xdf`, `git clean --fo` or `git push origin +main`, then the hook exits 2. | 7 | "The real hook exits 2 for `git reset --har`, `git clean -xdf`, `git clean --fo`, `git push origin +main`, `cd repo && git -C . reset --hard`, `make build; git clean -fd & wait`, `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` and `xargs git clean -f`" | diff-local |
| Story 3 happy: Given the Claude hook, when the command is `cd repo && git -C . reset --hard` or `make build; git clean -fd & wait`, then the hook exits 2. | 7 | "The real hook exits 2 for `git reset --har`, `git clean -xdf`, `git clean --fo`, `git push origin +main`, `cd repo && git -C . reset --hard`, `make build; git clean -fd & wait`, `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` and `xargs git clean -f`" | diff-local |
| Story 3 happy: Given the Claude hook, when the command is `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` or `xargs git clean -f`, then the hook exits 2. | 7 | "The real hook exits 2 for `git reset --har`, `git clean -xdf`, `git clean --fo`, `git push origin +main`, `cd repo && git -C . reset --hard`, `make build; git clean -fd & wait`, `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` and `xargs git clean -f`" | diff-local |
| Story 3 happy: Given the Claude hook and a branch that is not merged, when the command is `git branch -df «branch»` or `git -C . branch --delete --force «branch»`, then the hook exits 2 naming the unmerged branch. | 8 | "The real hook exits 2 for `git branch -df «b»` and `git -C . branch --delete --force «b»` when the `git` stub reports `«b»` is not an ancestor of the default branch and `gh` reports no merged PR, and stderr contains the existing `force-delete UNMERGED branch(es):` text naming `«b»`" | diff-local |
| Story 3 negative: Given the Claude hook, when `reset --hard` appears only inside a quoted argument (`git commit -m "undo reset --hard"`), a heredoc body, or a comment (`# git reset --hard`), then the hook exits 0. | 7 | "The real hook exits 0 for `git commit -m "undo reset --hard"`, a heredoc body containing `git reset --hard`, `# git reset --hard`, `git push --force-with-lease origin main` and `git -C . push --force-with origin main`" | diff-local |
| Story 3 negative: Given the Claude hook, when the command is `git push --force-with-lease origin main` or `git -C . push --force-with origin main`, then the hook exits 0. | 7 | "The real hook exits 0 for `git commit -m "undo reset --hard"`, a heredoc body containing `git reset --hard`, `# git reset --hard`, `git push --force-with-lease origin main` and `git -C . push --force-with origin main`" | diff-local |
| Story 3 negative: Given the Claude hook and a branch that is merged into the default branch, when the command is `git branch -df «branch»`, then the hook exits 0. | 8 | "The real hook exits 0 for `git branch -df «m»` when the `git` stub reports `«m»` is an ancestor of the default branch" | diff-local |
| Story 3 negative: Given the Claude hook, when the command is `git status`, `git -C . log --oneline` or `git reset --soft HEAD~1`, then the hook exits 0, and the `git` and `gh` stubs record no call. | 7 | "The real hook exits 0 for `git status`, `git -C . log --oneline` and `git reset --soft HEAD~1`, and for every exit-0 command in this task the `git` and `gh` stubs record no call" | diff-local |
| Story 3 negative: Given the Claude hook, when the command spells a heredoc delimiter `<<\EOF` or `<<E"OF"`, or opens one only inside a comment (`# <<EOF`), and a later line runs `git reset --hard`, then the hook exits 2. | 7 | "The real hook exits 2 when a `<<\EOF`, `<<E"OF"` or comment-only `# <<EOF` opener is followed on a later line by `git reset --hard`" | diff-local |
| Story 4 happy: Given the Claude hook, when the command is `git reset --bogus` or `git push --forc origin main`, then the hook exits 2 and stderr names the offending token and asks for the full option spelling. | 9 | "The real hook exits 2 for `git reset --bogus` and `git push --forc origin main`, and stderr names `--bogus` and `--forc` respectively and asks for the full option spelling" | diff-local |
| Story 4 happy: Given the Claude hook, when the command is `git --unknown-global reset HEAD`, then the hook exits 2 and stderr names `--unknown-global`. | 9 | "The real hook exits 2 for `git --unknown-global reset HEAD` with stderr naming `--unknown-global`, and exits 2 for `git reset "--hard` with stderr saying the command could not be parsed" | diff-local |
| Story 4 happy: Given the Claude hook, when the command contains a `git` word and cannot be split into words (for example an unterminated quote: `git reset "--hard`), then the hook exits 2 and stderr says the command could not be parsed. | 9 | "The real hook exits 2 for `git --unknown-global reset HEAD` with stderr naming `--unknown-global`, and exits 2 for `git reset "--hard` with stderr saying the command could not be parsed" | diff-local |
| Story 4 negative: Given the Claude hook, when the command is `git status --bogus` or `git --unknown-global status`, then the hook exits 0 (no guarded subcommand). | 9 | "The real hook exits 0 for `git status --bogus`, `git --unknown-global status` and `echo "unterminated`" | diff-local |
| Story 4 negative: Given the Claude hook, when the command cannot be split into words but contains no `git` word (`echo "unterminated`), then the hook exits 0. | 9 | "The real hook exits 0 for `git status --bogus`, `git --unknown-global status` and `echo "unterminated`" | diff-local |
| Story 4 negative: Given the Claude hook, when it refuses an unresolvable command, then the `git` and `gh` stubs record no call. | 9 | "For each of those four refusals, the `git` and `gh` stubs record no call" | diff-local |
| Story 5 happy: Given the committed corpus fixture, where each case declares a separate expected outcome for the PATH guard and for the Claude hook (`refuse`, `allow`, or `not-applicable`), when the PATH guard suite and the Claude hook suite run, then each suite runs every case whose declared outcome for that guard is `refuse` or `allow`, skips exactly the cases declared `not-applicable` for that guard, and every outcome it runs matches its declared expectation for that guard. | 12 | "`git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases" | diff-local |
| Story 5 happy: Given a corpus case that only varies the spelling of a form both guards refuse (an abbreviation, a bundled flag, a global-option prefix), when the corpus schema test reads it, then its PATH guard and Claude hook expectations are both `refuse`; the guards' expectations differ only for a form whose policy differs between them (the hook's merged-branch rule for `branch -D`, and the hook refusing only `checkout -- .` and `restore .`). | 12 | "A schema test fails when any `spellingOnly` corpus case does not carry `refuse` for both `pathGuard` and `hook`, and fails when any case whose `pathGuard` and `hook` are both non-`not-applicable` and unequal lacks a `policyDifference` of `checkout-paths` or `branch-merged-rule`; the corpus holds `checkout -- file` (`pathGuard` `refuse`, `hook` `allow`, `checkout-paths`) and an unmerged `branch -D` reachable from another ref (`pathGuard` `allow`, `hook` `refuse`, `branch-merged-rule`)" | diff-local |
| Story 5 happy: Given the corpus fixture, when the corpus presence test reads it, then it contains every spelling named in #2904, the earlier #1354 lap spellings (`--git-dir=` equals form, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and each residual bypass the architecture review lists (`reset --har`, `branch -df`, `branch --delete --forc`, global-option prefixes, `clean -xdf`, `push origin +main`). | 12 | "`destructive-git-corpus.json` holds the #2904 spellings (`-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`), the #1354 lap spellings (`--git-dir=` equals, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and `reset --har`, `branch -df`, `branch --delete --forc`, a global-option prefix case, `clean -xdf` and `push origin +main`, as asserted by a named-case presence test" | diff-local |
| Story 5 happy: Given the hook's embedded spec equals the TypeScript spec, when the parity test runs, then it passes. | 11 | "`destructive-git-hook-spec-parity.test.ts` extracts the JSON between `# BEGIN GIT_OPTION_SPEC` and `# END GIT_OPTION_SPEC` from the real hook and `specDifferences` against `GIT_OPTION_SPEC` returns an empty list" | diff-local |
| Story 5 happy: Given every long option that `git «cmd» --git-completion-helper` lists for each guarded subcommand is in the spec, when the drift test runs, then it passes. | 1 | "The drift test runs the real `git «cmd» --git-completion-helper` for each guarded subcommand and passes with zero findings against `GIT_OPTION_SPEC`" | diff-local |
| Story 5 negative: Given the hook's embedded spec lacks one option the TypeScript spec has, when the parity test runs, then it fails naming the subcommand and option. | 11 | "`specDifferences` over a copy with `reset` `soft` removed returns `reset --soft`, and the parity assertion over that copy fails with a message naming `reset` and `--soft`" | diff-local |
| Story 5 negative: Given the completion helper lists an option the spec lacks, when the drift test runs, then it fails naming the subcommand and option. | 1 | "`driftFindings` fed a helper output containing `--brand-new` for `reset` returns `reset --brand-new` and the drift assertion fails naming that subcommand and option; fed a `clean` helper output lacking `--force`, it returns no finding" | diff-local |
| Story 5 negative: Given the spec holds an option the helper does not list (`--force` for `clean` or `branch`), when the drift test runs, then it passes. | 1 | "`driftFindings` fed a helper output containing `--brand-new` for `reset` returns `reset --brand-new` and the drift assertion fails naming that subcommand and option; fed a `clean` helper output lacking `--force`, it returns no finding" | diff-local |
| Story 5 negative: Given a corpus case is a shell-only form with no PATH-guard meaning (a heredoc or a comment), when the PATH guard suite runs, then that case is skipped because its PATH guard expectation is `not-applicable`, never by an unlisted exclusion. | 12 | "Every corpus case with `pathGuard` `not-applicable` is a heredoc- or comment-only shell form, and no suite skips a case by any mechanism other than its `not-applicable` expectation, as asserted by the count checks" | diff-local |
| Story 6 happy: Given the feature repository, when the PATH guard receives each canonical refused form (`push --force`, `push -f`, `push origin +main`, `reset --hard`, `branch -D «unreachable»`, `branch --delete --force «unreachable»`, `clean -f`, `checkout -- «file»`, `restore «file»`), then it is refused with the same reason and alternative text as before this change. | 6 | "Every `REFUSAL_CASES` entry in `git-guard-script.test.ts` (force push, `-f`, `+` refspecs, lease-plus-force, `reset --hard`, `branch -D`, `--delete --force`, `clean -f`/`-fd`/`-xdf`/`--force`, path `checkout`, `restore «file»`) is refused with its unchanged reason and alternative regexes, with the unchanged single-line `ai-conductor git guard: refused «cmd» — ` prefix" | diff-local |
| Story 6 happy: Given the Claude hook, when the command is each canonical refused form, then it exits 2 with the same message as before this change. | 10 | "The real hook exits 2 for `git push --force origin main`, `git push -f`, `git reset --hard`, `git branch -D «unmerged»`, `git clean -f`, `git checkout -- .` and `git restore .`, and each stderr equals that form's message from before this change (force-push deny JSON, `BLOCKED: git reset --hard …`, `BLOCKED: git branch -D …`, `BLOCKED: git clean -f …`, `BLOCKED: This discards all unstaged changes …`)" | diff-local |
| Story 6 negative: Given the feature repository, when the PATH guard receives `push --force-with-lease --force-if-includes`, `reset --keep`, `branch -d «branch»`, `clean -n`, `checkout --ours -- «file»` or `restore --staged «file»`, then the stub real `git` receives the original argv unchanged. | 6 | "`GIT_GUARD_SCRIPT` passes `push --force-with-lease --force-if-includes origin main`, `reset --keep HEAD~1`, `branch -d «b»`, `clean -n`, `checkout --ours -- file` and `restore --staged file` to the stub real `git` as the exact original argv" | diff-local |
| Story 6 negative: Given the Claude hook, when the command is `git rebase --continue`, then it exits 0 with no note, and when it is `git rebase main`, then it exits 0 with the existing non-blocking rebase note. | 10 | "The real hook exits 0 with empty stderr for `git rebase --continue`, and exits 0 with stderr containing `NOTE: 'git rebase' is allowed` for `git rebase main`" | diff-local |
| Story 6 negative: Given the feature repository, when the PATH guard receives `reset --hard --soft` (git applies the last mode), then it is still refused as a hard reset. | 6 | "`GIT_GUARD_SCRIPT` refuses `reset --hard --soft` with the hard-reset reason and records no `reset` argv on the stub" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-03-fail-closed-git-option-normalization#D1 | task | task-1 | `src/conductor/test/engine/git-option-spec.test.ts` asserts `GIT_OPTION_SPEC.subcommands` keys equal `reset`, `branch`, `clean`, `push`, `checkout`, `restore`, that `clean` and `branch` contain `force`, and that `push` `force-with-lease` has arity `optional` |
| adr-2026-10-03-fail-closed-git-option-normalization#D2 | task | task-2, task-3 | `GIT_GUARD_SCRIPT` refuses `reset --har`, `reset --ha HEAD~1`, `-C «fixture» --no-pager reset --har` and `--config-env=core.pager=PAGER reset --ha` with exit non-zero, the hard-reset reason and `git reset --keep «target»` on stderr, and no `reset` argv recorded by the stub real `git` |
| adr-2026-10-03-fail-closed-git-option-normalization#D3 | task | task-4, task-9 | `GIT_GUARD_SCRIPT` refuses `reset --bogus HEAD`, `push --forc origin main` and `branch -Z «b»` with exit non-zero and stderr naming `--bogus`, `--forc` and `-Z` respectively as unrecognized for that git subcommand and asking for the full option spelling, with no `reset`, `push` or `branch` argv recorded by the stub real `git` |
| adr-2026-10-03-fail-closed-git-option-normalization#D4 | task | task-6 | `GIT_GUARD_SCRIPT` refuses `reset --hard --soft` with the hard-reset reason and records no `reset` argv on the stub |
| adr-2026-10-03-fail-closed-git-option-normalization#D5 | task | task-2, task-3, task-5 | The interpreter-source inventory run over the real `git-hook-assets` exports reports no finding for `GIT_GUARD_SCRIPT` |
| adr-2026-10-03-fail-closed-git-option-normalization#D6 | task | task-7, task-8, task-9 | `destructive-git-hook.test.ts` asserts exit 2 from the real hook for `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard` and `git --git-dir=.git reset --hard` |
| adr-2026-10-03-fail-closed-git-option-normalization#D7 | task | task-1, task-11, task-12 | `git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases |
| adr-2026-10-03-fail-closed-git-option-normalization#D8 | no-change | none | The control-inventory text in `docs/reference/settings-and-hooks.md` is documentation, delivered by the documentation-maintenance step; the decision requires no implementation change |
| adr-2026-09-23-engine-git-guard-on-agent-path#D1 | existing | none | `writeGitGuard` in `src/conductor/src/engine/git-guard.ts` writes the static `GIT_GUARD_SCRIPT` and its `real-git`/`common-dir` data files (shipped by #1354); this feature changes only the script content |
| adr-2026-09-23-engine-git-guard-on-agent-path#D2 | existing | none | `withGitGuardPath` in `src/conductor/src/execution/child-environment.ts` prepends the guard to the Claude and Codex child `PATH` (shipped by #1354); unchanged here |
| adr-2026-09-23-engine-git-guard-on-agent-path#D3 | existing | none | `ensureGitGuardForDispatch` in `src/conductor/src/engine/git-guard.ts` re-verifies the guard file against `GIT_GUARD_SCRIPT` content, so the regenerated script is re-verified with no change |
| adr-2026-09-23-engine-git-guard-on-agent-path#D4 | task | task-3, task-4 | `GIT_GUARD_SCRIPT` refuses `checkout -- --har` with the path-checkout reason, not a hard-reset or unrecognized-option message, and passes `reset --har` unchanged to the stub when `rev-parse --git-common-dir` reports a non-feature common dir |
| adr-2026-09-23-engine-git-guard-on-agent-path#D5 | task | task-3, task-6 | Every `REFUSAL_CASES` entry in `git-guard-script.test.ts` (force push, `-f`, `+` refspecs, lease-plus-force, `reset --hard`, `branch -D`, `--delete --force`, `clean -f`/`-fd`/`-xdf`/`--force`, path `checkout`, `restore «file»`) is refused with its unchanged reason and alternative regexes, with the unchanged single-line `ai-conductor git guard: refused «cmd» — ` prefix |
| adr-2026-09-23-engine-git-guard-on-agent-path#D6 | task | task-4, task-6 | Every `REFUSAL_CASES` entry in `git-guard-script.test.ts` (force push, `-f`, `+` refspecs, lease-plus-force, `reset --hard`, `branch -D`, `--delete --force`, `clean -f`/`-fd`/`-xdf`/`--force`, path `checkout`, `restore «file»`) is refused with its unchanged reason and alternative regexes, with the unchanged single-line `ai-conductor git guard: refused «cmd» — ` prefix |
| adr-2026-09-23-engine-git-guard-on-agent-path#D7 | task | task-4 | The engine-CLI argv table test in `git-guard-engine-unaffected.test.ts` passes with every listed argv reaching the stub real `git` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D8 | task | task-7, task-10 | The real hook exits 2 for `git push --force origin main`, `git push -f`, `git reset --hard`, `git branch -D «unmerged»`, `git clean -f`, `git checkout -- .` and `git restore .`, and each stderr equals that form's message from before this change (force-push deny JSON, `BLOCKED: git reset --hard …`, `BLOCKED: git branch -D …`, `BLOCKED: git clean -f …`, `BLOCKED: This discards all unstaged changes …`) |
| adr-2026-09-23-engine-git-guard-on-agent-path#D9 | no-change | none | The `tdd` skill counterfactual is not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D10 | task | task-4 | For each of those refusals, every call the stub real `git` recorded is one of `config`, `rev-parse`, `for-each-ref`, `merge-base` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D11 | no-change | none | The `reference-transaction` and `pre-push` hook assets (#2693) are not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D12 | no-change | none | `REFERENCE_TRANSACTION_HOOK` (#2693) is not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D13 | no-change | none | `PRE_PUSH_HOOK` (#2693) is not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D14 | no-change | none | Engine ref operations and the commit-only `CONDUCT_ENGINE_COMMIT` escape are not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D15 | no-change | none | The #2693 real-git hook tests are not touched by this feature |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s1-4-1: src/conductor/src/engine/git-option-spec.ts:61-62 — set global `attr-source` to arity `required` (acceptsEquals true) and replace the false comment (git consumes the next argv as the tree); add a GIT_GUARD_SCRIPT refusal test in src/conductor/test/engine/git-guard-script.test.ts for `--attr-source HEAD reset --hard` (hard-reset reason, no reset argv recorded) and add the spaced form to src/conductor/test/fixtures/destructive-git-corpus.json with pathGuard `refuse` and hook `refuse` (spellingOnly), keeping the existing `--attr-source=` case at :33
**Gate:** prd-audit
**Rationale:** git-option-spec.ts:61-62 declares global `attr-source` with arity `none`, so the generated case at git-hook-assets.ts:5-17 emits `--attr-source) ((i++))` and `git --attr-source HEAD reset --hard` takes `HEAD` as the subcommand and execs the hard reset; git 2.53 consumes the spaced value (audit probe) and the base guard skipped two argv. Task 2 (global options consumed exactly from the spec) owns the fix. Matched pair: the hook's embedded spec copy (block-destructive-git.sh:8-10) is repaired in the S3.1 task so Task 11 parity holds. Sweep: no other global entry was found misdeclared by the audit; the `=` form corpus case (destructive-git-corpus.json:33) is kept and the spaced form added beside it.
**Criterion:** S1.4
**Parent task:** 2
**Done when:**
- S1.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-4-1 is complete.

### Task rem-prd-audit-rem-s3-1-1: hooks/claude/block-destructive-git.sh:8-10 — regenerate the embedded GIT_OPTION_SPEC JSON from git-option-spec.ts after rem-s1-4-1 so `attr-source` is arity `required` (destructive-git-hook-spec-parity.test.ts must stay []); add a destructive-git-hook.test.ts case asserting exit 2 for `git --attr-source HEAD reset --hard`
**Gate:** prd-audit
**Rationale:** The hook's embedded spec (block-destructive-git.sh:8-10) carries `attr-source` arity `none`, so norm() at :60-70 takes `HEAD` in `git --attr-source HEAD reset --hard` as the subcommand and exits 0. Task 7 owns the hook's global-option consumption; the repair is the S1.4 spec change propagated to the embedded copy (counterpart of git-option-spec.ts, kept equal by the Task 11 parity test).
**Criterion:** S3.1
**Parent task:** 7
**Done when:**
- S3.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s3-1-1 is complete.

### Task rem-prd-audit-rem-s1-8-1: src/conductor/test/engine/git-guard-script.test.ts — add a test beside :416-422 that, with the stub reporting «b» reachable, drives GIT_GUARD_SCRIPT with `branch -df «b»` and asserts the exact original argv reaches the stub real git and its exit status is returned
**Gate:** prd-audit
**Rationale:** Test gap: no test drives `branch -df «b»` against a reachable branch; git-guard-script.test.ts:416-422 and the corpus reachable case use only `-D`. Task 3's Done-when explicitly requires `branch -df «b»` to reach the stub unchanged when `«b»` is reachable.
**Criterion:** S1.8
**Parent task:** 3
**Done when:**
- S1.8 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-8-1 is complete.

### Task rem-prd-audit-rem-s1-11-1: src/conductor/test/engine/git-guard-script.test.ts — next to the foreign-common-dir `reset --bogus` test at :304-310, add `reset --har` with the stub's `rev-parse --git-common-dir` reporting a non-feature common dir, asserting the exact original argv reaches the stub real git
**Gate:** prd-audit
**Rationale:** Test gap: git-guard-script.test.ts:304-310 drives only `reset --bogus` with a foreign common dir; Task 3's Done-when requires `reset --har` to pass unchanged when `rev-parse --git-common-dir` reports a non-feature common dir.
**Criterion:** S1.11
**Parent task:** 3
**Done when:**
- S1.11 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-11-1 is complete.

### Task rem-prd-audit-rem-s3-3-1: hooks/claude/block-destructive-git.sh:115-132 — evaluate every git invocation instead of exiting on the first verdict: any `deny` wins (first deny reported), `branch-delete` operands are aggregated across all invocations into one list, and the rebase note is emitted (unchanged text) whenever any invocation yields `rebase-note`, without stopping the scan; update the bash `case "$VERDICT"` to the new verdict output in the same change. Add destructive-git-hook.test.ts cases asserting exit 2 for `git rebase main && git reset --hard` and for `git branch -D «merged»; git push --force`
**Gate:** prd-audit
**Rationale:** block-destructive-git.sh:117-120 prints the first truthy verdict and raises SystemExit, so `git rebase main && git reset --hard` exits 0 with only the note and `git branch -D merged; git push --force` exits 0 once the merged check passes; the base hook judged the whole command. Task 7 owns the per-invocation loop. Matched pair: the python verdict vocabulary and the bash `case "$VERDICT"` at :122-132 change together; message texts stay byte-equal (Task 10, S6.2/S6.4 coverage preserved).
**Criterion:** S3.3
**Parent task:** 7
**Done when:**
- S3.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s3-3-1 is complete.

### Task rem-as-built-rem-ab4-1: src/conductor/test/engine/destructive-git-hook.test.ts — add compound-command cases: `git branch -D «merged» && git branch -D «unmerged»` exits 2 naming «unmerged» (operands aggregated across invocations); `git rebase main && git status` exits 0 and still prints the unchanged rebase NOTE; `git rebase main && git clean -fd` exits 2 with the clean-force message
**Gate:** as-built
**Rationale:** Same defect as S3.3 (hooks/claude/block-destructive-git.sh:115-120 stops at the first truthy verdict, violating ADR D6); the implementation lands in rem-s3-3-1, and this task pins the conditional and non-blocking paths so the aggregation is covered. Approved architecture is unchanged, so this is conforming implementation drift routed to build.
**Governing clause:** adr-2026-10-03-fail-closed-git-option-normalization decision 6
**Done when:**
- adr-2026-10-03-fail-closed-git-option-normalization decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab4-1 is complete.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/git-hook-assets.ts:93-103 — resolve the full long name (exact, then unique prefix) against option names plus `no-<name>` forms of negatable options before treating `no-` as a negation, mirroring hook find() at block-destructive-git.sh:51-56; and at :91/:221 make the checkout path predicate key only on a literal `--` (not `--end-of-options`). Add git-guard-script.test.ts cases: `reset --no-refresh HEAD~1` and `checkout --end-of-options «branch»` pass exact argv to the stub; existing `checkout -- --har` path refusal and negation refusals stay green
**Gate:** as-built
**Rationale:** git-hook-assets.ts:96 strips `no-` before resolving, so `reset --no-refresh` (declared at git-option-spec.ts:66) resolves to non-negatable `refresh` and is refused, contrary to ADR D2 exact-name-first resolution; Task 3 owns long-name resolution and negation. Matched pair: the hook's find() (block-destructive-git.sh:51-56) already resolves exact names plus `no-<name>` for negatable options, and the PATH guard is aligned to that rule. Sibling (NC.5, Task 3 admits `--end-of-options` handling): git-hook-assets.ts:91 sets options_ended for `--end-of-options` and :221 then refuses `checkout --end-of-options «branch»` as a path checkout; D4 keys the path rule to `--`, matching the hook (:75-76).
**Governing clause:** adr-2026-10-03-fail-closed-git-option-normalization decision 2
**Done when:**
- adr-2026-10-03-fail-closed-git-option-normalization decision 2 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab2-1 is complete.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/git-hook-assets.ts:153-169 — when `unknown_global` is set, scan every argv after the unknown token for a guarded subcommand name and, subject to the existing feature-common-dir check, refuse with `unrecognized git option «token» before «cmd»`; add git-guard-script.test.ts cases: `--no-pag HEAD reset --hard` refused naming `--no-pag` with no reset argv recorded, while `--no-pag status` still passes exact argv
**Gate:** as-built
**Rationale:** git-hook-assets.ts:153-169 refuses an unknown global option only when the first non-option is guarded, but ADR D3 and Task 2 Step 3 require refusal when any later argv equals a guarded subcommand name (e.g. `--no-pag HEAD reset --hard`). Matched pair: the hook already implements this at block-destructive-git.sh:61-63 over the same guarded set; the PATH guard's guarded-name regex `^(reset|branch|clean|push|checkout|restore)$` is reused for the scan. S2.7 coverage (`--no-pag status` passes exact argv) is preserved.
**Governing clause:** adr-2026-10-03-fail-closed-git-option-normalization decision 3
**Done when:**
- adr-2026-10-03-fail-closed-git-option-normalization decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab3-1 is complete.

### Task rem-as-built-rem-ab5-1: docs/reference/settings-and-hooks.md:136 — describe the hook as splitting the command into simple commands and normalizing each git argv against the embedded shared option spec, refusing unresolvable options; :288-290 — remove the non-canonical-spellings limit, stating that git's global and per-subcommand option grammars are normalized from the shared spec and unknown/ambiguous options on guarded subcommands are refused; hooks/claude/block-destructive-git.sh:1-2 — add the header line documenting the shell-indirection exclusion (eval, bash -c, variables) named in the feature diagram
**Gate:** as-built
**Rationale:** ADR D8 requires the control inventory to shrink, but docs/reference/settings-and-hooks.md:136 still says the hook strips quoted spans and pattern-matches, and :288-290 still says non-canonical spellings pass until #2904 ships; the plan assigned this to the documentation step (plan lines 107-108) and it was not delivered. Documentation drift preserving approved architecture routes to build. Sibling from the as-built drift notes: the feature diagram says the hook header documents the shell-indirection exclusion, but block-destructive-git.sh:1-2 does not.
**Governing clause:** adr-2026-10-03-fail-closed-git-option-normalization decision 8
**Done when:**
- adr-2026-10-03-fail-closed-git-option-normalization decision 8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab5-1 is complete.

### Task rem-prd-audit-rem-s3-8-1: hooks/claude/block-destructive-git.sh:142 — make the branch-delete operand split emit real newlines (e.g. `sep=chr(10)` or `'\n'.join(...)` written so bash single quotes pass a Python newline escape), keeping the existing BLOCKED message; in src/conductor/test/engine/destructive-git-hook.test.ts add cases with the git stub reporting every named branch merged: `git branch -D m1 m2` and `git branch -D m1 && git branch -D m2` exit 0, and tighten the aggregation test at :362 (`git branch -D «merged» && git branch -D «unmerged»`) to assert stderr names «unmerged» and does NOT name «merged», so it fails if operands are not split
**Gate:** prd-audit
**Rationale:** [99% verified — reproduced: BRANCHES='["a","b"]' python3 -c '...sep="\\n"' prints the single line `a\nb`] hooks/claude/block-destructive-git.sh:142 passes `sep="\\n"` inside bash single quotes, so Python joins operands with a literal backslash-n and the merged check sees one bogus name; every multi-branch delete (`git branch -D m1 m2`, `git branch -D m1 && git branch -D m2`) of merged branches is refused, regressing the base hook. Task 8 (route every force-delete spelling through the merged check over the normalized operands) and rem-prd-audit-rem-s3-3-1 (aggregate branch-delete operands across invocations) admit the fix. Preserved coverage: Task 8's single-branch merged/unmerged tests (:356) and rem-as-built-rem-ab4-1's aggregated-unmerged test (:362) stay, the latter tightened so it cannot pass on an unsplit string. Matched pair: the producer at :126/:131 (`json.dumps(branches)`) is unchanged; only the consumer split is repaired. Sweep: no other `sep=` / `\\n` literal exists in the hook (grep).
**Criterion:** S3.8
**Parent task:** 8
**Done when:**
- S3.8 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s3-8-1 is complete.

### Task rem-as-built-rem-ab3-2: src/conductor/src/engine/git-hook-assets.ts:166-190 — during the global-option loop build a `classify_prefix` array of only the recognized global-option argv (every token consumed by a generated spec arm, including `-C <path>`, repeated `-C`, `--git-dir <path>`, `--git-dir=<path>`), excluding every token that falls to the unknown `-*)` arm; use it for the unknown-global `rev-parse --git-common-dir` query at :189 and for the classification queries at :196 (alias config), :225 and :272 in place of `args[@]:0:$unknown_prefix_end` / `args[@]:0:$i`. In src/conductor/test/engine/git-guard-script.test.ts, with the stub answering `rev-parse --git-common-dir` per `-C`/`--git-dir` target, add: `--no-pag -C «outside» reset --hard` and `--no-pag --git-dir=«outside»/.git reset --hard` pass exact argv to the stub; `-C «outside» --no-pag -C «feature» reset --hard` is refused naming `--no-pag` with no reset argv recorded; the unknown token never appears in any recorded classification query
**Gate:** as-built
**Rationale:** src/conductor/src/engine/git-hook-assets.ts:189 builds the unknown-global common-dir query from `args[@]:0:$unknown_prefix_end`, dropping recognized target selectors after the unknown token (`--no-pag -C /outside reset --hard` is refused against the feature repo; `-C /outside --no-pag -C «feature» reset --hard` escapes), violating ADR D3 scoping and the D4 `-C`/`--git-dir` targeting that Task 2 Step 3 explicitly requires ('keep passing the consumed global-option prefix … so -C/--git-dir still select the target repository'). Approved architecture is unchanged, so this is conforming implementation drift routed to build. Preserved coverage: rem-as-built-rem-ab3-1's `--no-pag HEAD reset --hard` refusal and Task 2/S2.7 `--no-pag status` exact-argv tests stay green. Sibling sweep: the queries at :225 and :272 use `args[@]:0:$i`, which also includes the unknown token whenever execution reaches them with `unknown_global` set — the same classification prefix must be used there; the Claude hook has no feature-repo scoping, so it has no counterpart.
**Governing clause:** adr-2026-10-03-fail-closed-git-option-normalization decision 3
**Done when:**
- adr-2026-10-03-fail-closed-git-option-normalization decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab3-2 is complete.
