# Track: finish/pr staleness-proof grep never matches git's actual "rebase (finish)" reflog wording

Track: technical

## Rationale

This is an internal correctness fix to a string-matching check inside two SKILL.md prompts
(`skills/finish/SKILL.md` §1b, `skills/pr/SKILL.md`'s equivalent push-direction section). Both
run `git reflog | grep "rebase: finish"` as the fallback staleness proof that authorizes a
force-with-lease push after the daemon's sanctioned finish-time rebase. Git does not write that
string — it writes `rebase (finish): returning to refs/heads/<branch>` (parenthesized, no colon
after "rebase"), confirmed empirically in this investigation with a real `git rebase` reproduction.
The grep therefore never matches, so on any twice-rebased branch (where the merge-base ancestry
proof also fails) both staleness proofs fail even though the remote is provably just the pre-rebase
snapshot — finish halts believing there are foreign commits, when there are none
(jstoup111/ai-conductor#587; same bug class as the 2026-07-09 `post-rebase-build-invalidation`
incident, both repaired manually via reflog + range-diff + force-with-lease).

There is no user-facing product requirement, no new command, no new config key, no new functional
surface — this widens/corrects one grep pattern in two prompt files to match text git already emits.
Acceptance criteria (a real in-progress rebase must not be flagged foreign; a genuinely foreign
commit must still be caught) belong in stories, not a PRD. → **technical track** (skip `/prd`).
