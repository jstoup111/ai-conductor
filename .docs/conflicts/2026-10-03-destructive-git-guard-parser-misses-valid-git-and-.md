# Conflict Check: destructive-git-guard-parser-misses-valid-git-and- (#2904)

**Date:** 2026-10-03
**ADR corpus:** `change_set` (default; `conflict_check.adr_corpus` unset): adr-2026-10-03-fail-closed-git-option-normalization, adr-2026-09-23-engine-git-guard-on-agent-path
**Result:** Clean after resolution. Two blocking conflicts were resolved; zero remain.

## Scanned

Every story file mentioning the destructive-git guards, force pushes, hard resets, branch deletion
or forced clean was scanned. Each pair sharing a behavior was checked in both directions:
`destructive-git-prevention-is-absent-in-self-host`, `ref-moving-destructive-git-that-bypasses-the-build`,
`block-bare-force-pushes-inside-compound-commands`, `finish-force-with-lease-after-sanctioned-rebase`,
`parked-feature-reconciliation-1060`, `daemon-reclaim-sweep-deletes-a-worktree-that-holds`,
`auto-resolve-open-pr-conflicts`, `automatic-rebase-preserves-merges-carrying-unique-`,
`engineer-handoff-pushes-spec-branch-331`, `setup-triage-must-not-report-setup-failed-park-whe`,
`inline-build-work-commits-unattributed-session-hoo`, and the remaining keyword matches. Engine git
runs through `execa` outside the guard (adr-2026-09-23 D7), so engine-side stories do not interact.

## Conflict: corpus "refused by both guards" contradicts the hook's separate policy (resolved)

**Stories involved:** Story 5 (this feature) vs adr-2026-09-23 D8 and destructive-git-prevention-is-absent-in-self-host Story 9
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-09-23-engine-git-guard-on-agent-path
**Story ID:** 5
**ADR opposing sentence (verbatim):** "`hooks/claude/block-destructive-git.sh` is not removed."
**Story opposing sentence (verbatim):** "every case marked `refuse` is refused by both guards while every case marked `allow` is allowed by both."

**Description:** The hook is kept as early feedback with its own policy. It applies a merged-branch
rule to `branch -D` and refuses only `checkout -- .` and `restore .`, while the PATH guard uses
reachability from any ref and refuses any pathspec. No implementation can make both guards give the
same verdict on those forms without widening the hook's policy beyond the confirmed scope.

**Resolution (operator):** each corpus case declares a separate expected outcome per guard.
Cases that only vary a spelling must agree; policy differences are declared. Story 5 was rewritten
in place.

## Conflict: quote scrub before word splitting shifts arguments (resolved)

**Stories involved:** Story 3 (this feature) vs adr-2026-10-03-fail-closed-git-option-normalization D6
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-03-fail-closed-git-option-normalization
**Story ID:** 3
**ADR opposing sentence (verbatim):** "After the existing heredoc, comment and quote scrub, the hook splits the command into simple commands with Python `shlex` (POSIX mode, punctuation characters) on `;`, `|`, `&`, `&&`, `||` and newlines."
**Story opposing sentence (verbatim):** "I want the hook to judge each git invocation in a shell command by its normalized arguments, so that global options, bundled flags and abbreviations no longer slip past it."

**Description:** The existing scrub deletes quoted spans whole. `git -C "my dir" reset --hard`
therefore becomes `git -C  reset --hard`: `-C` consumes `reset` and the destructive command
passes. Following D6 as written breaks Story 3's goal.

**Resolution (operator):** D6 carries an additive amendment. Only heredoc bodies and comments are
dropped before `shlex`, which removes quotes itself. Story 3 gained the `git -C "my dir" reset --hard`
case.

## Interactions checked, no conflict

- **#1354 Story 8** (every engine-CLI git argv is allowed): compatible as long as the spec is
  complete. That story's existing test fails on any fail-closed refusal of an engine-CLI argv.
- **block-bare-force-pushes H1** (explicit `--force-with-lease=refs/heads/a:«sha»` exits 0): the
  spec must give `--force-with-lease` an optional `=value` argument. This is carried to the plan.
- **#2693 git-side hooks:** they judge ref values inside git after the PATH guard decides. The two
  are additive, and neither changes the other's verdict.
