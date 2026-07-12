# finish/pr staleness-proof grep never matches git's actual "rebase (finish)" reflog wording

Status: Accepted

## Context

On 2026-07-12 the feature `retry-log-lines-carry-the-completion-check-reason-` halted at `finish`
needing human DECIDE despite a PASS prd-audit and a fully green suite (jstoup111/ai-conductor#587).
The finish skill's §1b staleness proof (added by #213 / PR #265) is supposed to authorize a
force-with-lease push after the daemon's sanctioned finish-time rebase via two independent proofs:

1. `git merge-base --is-ancestor origin/<branch> ORIG_HEAD` (fast path), and
2. `git reflog | grep "rebase: finish"` (fallback).

On a twice-rebased branch the fast path can legitimately fail (`ORIG_HEAD` only reflects the most
recent rebase, not an earlier one), which is exactly when the fallback is supposed to catch it. But
the fallback's literal, `"rebase: finish"`, never appears in real git output — confirmed by
reproducing a rebase in a scratch repo during this investigation, where git wrote:

```
rebase (finish): returning to refs/heads/<branch>
```

— parenthesized, no colon after "rebase". Both proofs failed, finish concluded (wrongly) that
foreign commits existed on `origin/<branch>`, and halted for human review. Manual verification
(`git range-diff`) confirmed the remote held zero foreign work — it was purely the pre-rebase
snapshot. This is the same bug class manually repaired on 2026-07-09
(`post-rebase-build-invalidation`) and now recurs because the grep pattern itself was never fixed
at the source. The identical wrong literal exists in `skills/pr/SKILL.md` (also touched by PR #265).

Fix: correct the grep pattern in both skills to match git's actual reflog wording, e.g.
`git reflog | grep -E "rebase \(finish\)"`.

## Story 1 — a real in-progress-rebase reflog entry is recognized as staleness proof

As the finish (or pr) skill, when the daemon's sanctioned finish-time rebase has run and left a
`rebase (finish): returning to refs/heads/<branch>` entry in the reflog, but the merge-base
ancestry fast path fails (e.g. a twice-rebased branch where `ORIG_HEAD` no longer reflects the
first rebase), I recognize the reflog entry as valid staleness proof so the push proceeds via
`--force-with-lease` instead of halting for a false foreign-commit alarm.

### Happy Path

- **Given** a branch that the daemon's finish-time rebase has run against (a real reflog entry
  reading `rebase (finish): returning to refs/heads/<branch>` exists), and the merge-base fast path
  (`git merge-base --is-ancestor origin/<branch> ORIG_HEAD`) fails or is unavailable,
- **When** the finish (or pr) skill runs the fallback reflog proof,
- **Then** the grep matches the real reflog entry, staleness is proven, and the skill proceeds to
  `git push --force-with-lease` — it does NOT stop, does NOT report foreign commits, and does NOT
  refuse to write `.pipeline/finish-choice` (finish) or refuse to create the PR (pr).

## Story 2 — a genuinely foreign commit on the remote is still caught and blocks the push

As the finish (or pr) skill, when `origin/<branch>` genuinely holds a commit from another writer
that is not part of the daemon's own rebase (no matching reflog entry, no merge-base ancestry), I
still detect this as unproven staleness and refuse to force-push, so another writer's real work is
never silently overwritten.

### Negative Path — no rebase reflog entry and failed merge-base ancestry

- **Given** `origin/<branch>` holds a commit pushed by another writer after the local pre-rebase
  HEAD, `git merge-base --is-ancestor origin/<branch> ORIG_HEAD` exits non-zero, and the reflog
  contains no `rebase (finish):` entry (no sanctioned rebase ran, or the rebase was for an unrelated
  operation),
- **When** the finish (or pr) skill runs the staleness proof (fast path, then fallback),
- **Then** both proofs fail, the skill STOPS immediately — no push of any kind (`--force`,
  `--force-with-lease`, or plain), no pull/rebase/merge of `origin/<branch>`, no PR creation, and
  (in finish) no `.pipeline/finish-choice` written — and reports the foreign commits plainly via
  `git log HEAD..origin/<branch> --oneline`, exactly as the existing gate specifies.

### Negative Path — the corrected pattern does not over-match unrelated reflog text

- **Given** a reflog that contains an unrelated entry mentioning "finish" in a different context
  (e.g. a commit message subject line reflog entry, not a `rebase (finish):` operation marker),
- **When** the corrected grep runs,
- **Then** it matches only genuine `rebase (finish):` reflog operation entries (the pattern anchors
  on the literal `rebase (finish)` git writes for this specific reflog action, not a bare
  substring like "finish" alone), so an unrelated occurrence of the word does not produce a false
  positive staleness proof.
