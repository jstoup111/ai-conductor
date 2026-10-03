# Architecture Review: fail-closed git option normalization for both destructive-git guards (#2904)

**Date:** 2026-10-03
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment
**Input:** `.docs/track/destructive-git-guard-parser-misses-valid-git-and-.md` (technical track; operator-confirmed scope), `.docs/architecture/destructive-git-guard-parser-misses-valid-git-and-.md` (approved 2026-10-03)
**Stories reviewed:** none yet (pre-stories review)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All git-semantics claims were observed on git 2.53.0 in scratch repositories on 2026-10-03
(verified, about 95%). Guard behavior was probed against main @ `833b75868`, and the guard files are
unchanged at `34a3095f9`.

- The PATH guard and the Claude hook both allow `reset --har` and `branch -df`. The PATH guard also
  allows `branch --delete --forc`. The Claude hook also allows any global option before the
  subcommand, `clean -xdf`, and `push origin +main`.
- The three bypasses the issue names are already refused, fixed by #2773.
- Global options are exact-match only: `--no-pag`, `-C.` and `-ca.b=c` each exit 129. Subcommand
  options accept unique prefixes and reject ambiguous ones (`push --forc`, `branch --for`).
  Non-negatable options reject `--no-` (`reset --no-hard`).
- `--git-completion-helper` omits hidden options (`--force` for `clean` and `branch`), so the spec
  must be authored, with the helper used only as a superset drift check.
- Python's `shlex` (stdlib, POSIX mode with punctuation characters) splits simple commands. The hook
  already runs `python3` over data passed in an environment variable, so there is no new dependency.

Stack: no new package, service, schema or migration. Prerequisites: none.

Integration surface: one new engine module (data only), `git-hook-assets.ts`
(`GIT_GUARD_SCRIPT`), `hooks/claude/block-destructive-git.sh`, their existing tests, one new corpus
fixture, and `docs/reference/settings-and-hooks.md`. That is two module boundaries plus documentation.

Performance: the PATH guard runs on every agent `git` call. Normalization is an in-process bash loop
over argv. Subcommands that are not guarded still pass through before option parsing, so there is no
added process start.

Worktree isolation: no ports, databases or shared state.

## Alignment

- **Governing ADR reused and extended:** adr-2026-09-23-engine-git-guard-on-agent-path. D4
  (feature-repository scoping), D6 (refusal messages) and D10 (test isolation through a stub real
  `git`) apply unchanged. Its 2026-10-02 and 2026-10-03 amendments to D5 and D8 hand this work to
  #2904. Both decisions carry a 2026-10-03 amendment note recording the outcome.
- **New structural decision:** one cross-language spec that both guards consume, plus a parity
  contract. It makes a component decomposition and a cross-module ownership choice, so it is
  recorded in adr-2026-10-03-fail-closed-git-option-normalization (APPROVED).
- **Interpreter-source inventory:** the generated case arms are fixed when the module loads, with
  no runtime value interpolated (precedent: `protectedArtifactPathCase` in `git-hook-assets.ts`).
  The hook keeps its existing quoted-heredoc `python3 -` with data passed through the environment.
- **Overlap with #2693** (in flight, builds `ref-moving-destructive-git-that-bypasses-the-build`):
  it adds new exports to `git-hook-assets.ts` but does not edit `GIT_GUARD_SCRIPT`. The two features
  are independent in behavior, with possible textual adjacency in one file.
  `ai-conductor overlap-scan` reported no overlap.
- **Diagrams:** the feature diagram is approved and accurate. No container or system-context change.
- **Security boundary:** this change only adds refusals, and the matrix does not shrink. The new
  failure mode is a false refusal, which is safe.

## Focused local pattern basis

- **Role:** a TypeScript-derived fragment embedded in a static bash asset.
- **Traits to preserve:** computed once when the module loads from engine data, joined into
  `case` patterns, and no runtime value expanded into interpreter source.
- **Rediscover via:** `protectedArtifactPathCase` and `PRE_COMMIT_HOOK` in
  `src/conductor/src/engine/git-hook-assets.ts`.
- **Allowed variation:** several generated fragments (global options, per-subcommand long names,
  short-letter arity) instead of one.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Git option spec module (new, data only) | Imported by `git-hook-assets.ts` to build `GIT_GUARD_SCRIPT` |
| `GIT_GUARD_SCRIPT` normalizer (changed content) | Written by the existing worktree-preparation guard provisioning to `«worktree»/.pipeline/bin/git` and re-verified by `ensureGitGuardForDispatch` before each Claude and Codex dispatch. No wiring change. |
| `block-destructive-git.sh` argv normalizer (changed content) | The existing `PreToolUse` / `Bash` registration installed by `bin/install`. No hook-wiring change. |
| Shared corpus, parity and drift tests | Test-only |
| Control-inventory text | `docs/reference/settings-and-hooks.md` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Spec omits a legitimate option, so agents get false refusals mid-build | Technical | Medium | Medium | Spec authored from the git documentation, including hidden options; drift test against the completion helper; refusal names the token |
| CI git upgrade adds an option and fails the drift test on an unrelated PR | Integration | Low | Low | Failure message names the subcommand and option to add |
| Hook's embedded spec drifts from the TypeScript spec | Technical | Medium | Medium | Parity test |
| `shlex` mis-splits exotic shell (process substitution, `$( … )`) | Technical | Medium | Low | The hook is early feedback (adr-2026-09-23 D2), the PATH guard is the enforcement point, and the corpus covers the listed spellings |
| Release gate classifies the `hooks/claude/` edit as a hook-wiring change | Integration | Medium | Low | Condition 2 |

## ADRs Created

- `adr-2026-10-03-fail-closed-git-option-normalization`, **APPROVED** (operator, 2026-10-03).
- `adr-2026-09-23-engine-git-guard-on-agent-path`: D5 and D8 amended (additive notes).

## Conditions

1. Tests that exercise the PATH guard keep the stub real `git` from adr-2026-09-23 D10 and assert
   that refused corpus cases never reach it, per the repository's test-process-isolation rule.
2. Hook content changes but its wiring does not. If the self-host release gate flags `hook wiring`
   for `hooks/claude/block-destructive-git.sh`, the diff carries a
   `.docs/release-waivers/destructive-git-guard-parser-misses-valid-git-and-.md` waiver rather than an
   empty migration.
3. The corpus contains every spelling named in #2904 (including the three already fixed, as
   regression cases) and each verified residual bypass listed under Feasibility.
