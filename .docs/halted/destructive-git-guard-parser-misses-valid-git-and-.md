# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-06T10:57:15.449Z
Slug: destructive-git-guard-parser-misses-valid-git-and-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-guard-parser-misses-valid-git-and-
Head SHA: 84c9f371b7eaffcfea85c0b699a1204862ac56bd
Halted at: 2026-10-06T10:42:32.737Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: plan tasks conflict with sealed criteria or ADR decisions.

Claim: stories#criterion-37
Text: Story 5 happy: Given the committed corpus fixture, where each case declares a separate expected outcome for the PATH guard and for the Claude hook (`refuse`, `allow`, or `not-applicable`), when the PATH guard suite and the Claude hook suite run, then each suite runs every case and every outcome matches its declared expectation for that guard.
Task ids: 12
Done when checks: `destructive-git-corpus.json` holds the #2904 spellings (`-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`), the #1354 lap spellings (`--git-dir=` equals, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and `reset --har`, `branch -df`, `branch --delete --forc`, a global-option prefix case, `clean -xdf` and `push origin +main`, as asserted by a named-case presence test. | `git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases. | `destructive-git-hook.test.ts` runs every corpus case whose `hook` is `refuse` or `allow` and asserts the real hook exits 2 or 0 accordingly, and fails if the count of cases it ran differs from the count of such cases. | A schema test fails when any `spellingOnly` corpus case does not carry `refuse` for both `pathGuard` and `hook`, and fails when any case whose `pathGuard` and `hook` are both non-`not-applicable` and unequal lacks a `policyDifference` of `checkout-paths` or `branch-merged-rule`; the corpus holds `checkout -- file` (`pathGuard` `refuse`, `hook` `allow`, `checkout-paths`) and an unmerged `branch -D` reachable from another ref (`pathGuard` `allow`, `hook` `refuse`, `branch-merged-rule`). | The corpus holds `checkout -- .` and `restore .` with `hook` `refuse`, and a schema test fails when any other `checkout` or `restore` path case carries `hook` `refuse`, so the hook's refusal of only `checkout -- .` and `restore .` is asserted. | The corpus holds at least one heredoc-only and one comment-only shell case, each with `pathGuard` `not-applicable`; a schema test fails if any case with `pathGuard` `not-applicable` is not a heredoc- or comment-only shell form; and `git-guard-script.test.ts` skips exactly the cases whose `pathGuard` is `not-applicable` — its count check fails if it skips any other case or runs any of those — so the PATH guard suite never skips a case by an unlisted exclusion.
Conflict: Task 12 requires the PATH guard suite to skip exactly corpus cases whose `pathGuard` is `not-applicable`, so it cannot run every case.

Claim: adr-2026-09-23-engine-git-guard-on-agent-path#D10
Text: 10. **Coverage is proven by executable tests and documented limits.**
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

**Amended 2026-10-03 by #2693 (operator decision): git-side backstop for ref-moving destructive
git.** Option B, rejected above as the primary control, is adopted as a backstop behind Option A.
It vetoes two ref-moving classes in git itself, so it holds when a `git` is reached without the
guard. Local non-fast-forward branch moves (amend, rebase, `reset`, `branch -f`) stay allowed.
Forced clean and path discards fire no ref transaction and stay with the guard alone. Remote
branch deletion stays with the explicit-approval gate of the GitHub operation CLI.
Task ids: rem-as-built-rem-ab5-1
Done when checks: adr-2026-10-03-fail-closed-git-option-normalization decision 8 is satisfied by this task. | Re-run as-built and confirm task rem-as-built-rem-ab5-1 is complete.
Conflict: It requires removing the documented non-canonical-spellings limit, while the claim retains that limit for refused forms other than the two git-side-backstopped ref-moving classes.
```
