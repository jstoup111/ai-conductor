# Halt record

Status: halted
Slug: destructive-git-guard-parser-misses-valid-git-and-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-guard-parser-misses-valid-git-and-
Head SHA: 7166b7b9fec2e583e1b6006aabc30a17ba115439
Halted at: 2026-10-05T10:33:58.388Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 5 negative: Given a corpus case is a shell-only form with no PATH-guard meaning (a heredoc or a comment), when the PATH guard suite runs, then that case is skipped because its PATH guard expectation is `not-applicable`, never by an unlisted exclusion.
Task ids: 12
Done when checks: `destructive-git-corpus.json` holds the #2904 spellings (`-C`/`--git-dir` prefix with `branch -D`, `--config-env=`, `<<\EOF`, `<<E"OF"`, `# <<EOF`), the #1354 lap spellings (`--git-dir=` equals, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and `reset --har`, `branch -df`, `branch --delete --forc`, a global-option prefix case, `clean -xdf` and `push origin +main`, as asserted by a named-case presence test. | `git-guard-script.test.ts` runs every corpus case whose `pathGuard` is `refuse` or `allow` and asserts `GIT_GUARD_SCRIPT` refuses or reaches the stub real `git` accordingly, and fails if the count of cases it ran differs from the count of such cases. | `destructive-git-hook.test.ts` runs every corpus case whose `hook` is `refuse` or `allow` and asserts the real hook exits 2 or 0 accordingly, and fails if the count of cases it ran differs from the count of such cases. | A schema test fails when any `spellingOnly` corpus case does not carry `refuse` for both `pathGuard` and `hook`, and fails when any case whose `pathGuard` and `hook` are both non-`not-applicable` and unequal lacks a `policyDifference` of `checkout-paths` or `branch-merged-rule`; the corpus holds `checkout -- file` (`pathGuard` `refuse`, `hook` `allow`, `checkout-paths`) and an unmerged `branch -D` reachable from another ref (`pathGuard` `allow`, `hook` `refuse`, `branch-merged-rule`). | The corpus holds `checkout -- .` and `restore .` with `hook` `refuse`, and a schema test fails when any other `checkout` or `restore` path case carries `hook` `refuse`, so the hook's refusal of only `checkout -- .` and `restore .` is asserted. | Every corpus case with `pathGuard` `not-applicable` is a heredoc- or comment-only shell form, and no suite skips a case by any mechanism other than its `not-applicable` expectation, as asserted by the count checks.
Missing assertion: a corpus case is a shell-only form with no PATH-guard meaning (a heredoc or a comment)
```
