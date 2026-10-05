# Halt record

Status: halted
Slug: destructive-git-guard-parser-misses-valid-git-and-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-guard-parser-misses-valid-git-and-
Head SHA: fda6a705b36c13726a7c46b6c701916b64086367
Halted at: 2026-10-05T10:13:40.978Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 5 happy: Given a corpus case that only varies the spelling of a form both guards refuse (an abbreviation, a bundled flag, a global-option prefix), when the corpus schema test reads it, then its PATH guard and Claude hook expectations are both `refuse`; the guards' expectations differ only for a form whose policy differs between them (the hook's merged-branch rule for `branch -D`, and the hook refusing only `checkout -- .` and `restore .`).
Task ids: 12
Done when checks: `destructive-git-corpus.json` holds the #2904 spellings (`-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`), the #1354 lap spellings (`--git-dir=` equals, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and `reset --har`, `branch -df`, `branch --delete --forc`, a global-option prefix case, `clean -xdf` and `push origin +main`, as asserted by a named-case presence test. | `git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases. | `destructive-git-hook.test.ts` runs every corpus case whose `hook` is `refuse` or `allow` and asserts the real hook exits 2 or 0 accordingly, and fails if the count of cases it ran differs from the count of such cases. | A schema test fails when any `spellingOnly` corpus case does not carry `refuse` for both `pathGuard` and `hook`, and fails when any case whose `pathGuard` and `hook` are both non-`not-applicable` and unequal lacks a `policyDifference` of `checkout-paths` or `branch-merged-rule`; the corpus holds `checkout -- file` (`pathGuard` `refuse`, `hook` `allow`, `checkout-paths`) and an unmerged `branch -D` reachable from another ref (`pathGuard` `allow`, `hook` `refuse`, `branch-merged-rule`). | Every corpus case with `pathGuard` `not-applicable` is a heredoc- or comment-only shell form, and no suite skips a case by any mechanism other than its `not-applicable` expectation, as asserted by the count checks.
Missing assertion: the hook refusing only `checkout -- .` and `restore .`
```
