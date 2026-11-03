# ADR: Stacked restack recovery keeps every commit, and a stacked feature's halt record lives on a ref

**Date:** 2026-11-02
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3582 (folding #3557 and #3576)

## Context

Three defects share one operator story on stacked features.

- **Every recorded `--tip` goes stale.** Consumption requires the live parent's tree to equal the recorded `newParentTree` (`adr-2026-10-25-operator-recorded-restack-conflict-resolution` decision 4). Each halt and each clear commits `.docs/halted/<slug>.md` on the checked-out child (`adr-2026-10-07-per-child-build-region` decision 11). When that child is the parent, its tree always differs by the time the resolution is read. #3557 and #3582 both observed `restack-resolution-stale ... parent-tree`, with the halt record as the only tree difference.
- **A stale halt locks the operator out.** It carries no `Restack-Conflict:` line, and `stack restack-resolve` requires that line for both `--tip` and `--decision`. On 2026-11-03 the only exit was deleting `refs/conductor/<slug>/restack/*` by hand.
- **A resolver-settled restack can drop a whole child.** On 2026-11-03 `restack_applied` moved child 3 from `cdff3b2f31` to `33b8d879f2`, which is child 2's tip, and 8 commits left the leaf with no halt. `resolveRestackConflict` takes its tip from the post-rewrite hook, and falls back to `newParent` when that list is empty. The hook is installed only through the `GIT_CONFIG_*` environment on `RestackResolutionContext`, and `StepRunner.resolveRebaseConflict` never passes that environment to the provider. A real-git probe confirmed that `rebase --continue` without the environment finishes and writes no list. The FR-9 guard reads the temporary checkout's HEAD, so it passes while the returned tip discards that HEAD.
- **Halt-record commits also break child boundaries (#3576).** `moveLeaf` refuses them as unrelated, a closed child's branch gains commits past its closure, and `moveLeaf` alone refuses a clone without `refs/remotes/origin/HEAD`, which the rebase path handles.

`adr-2026-10-10-stacked-restack-journaled-replay` (as amended by #3451) made restack replay tolerate halt-record commits. That left the commits themselves in place, and six separate sites now carry a halt-record exemption.

## Options Considered

### Option A: Keep committing to stack branches and extend the exemptions
- **Pros:** Smallest change. The record stays in the branch's tree.
- **Cons:** Adds more exceptions to a list that keeps growing, and a closed child's branch still moves past its closure, which #3576 rules out.

### Option B: Refresh the conflict record whenever bookkeeping commits
- **Pros:** The tree comparison stays exact.
- **Cons:** Every halt-record writer must know restack refs, a crash between the two writes leaves the record stale, and the commits stay on the branches.

### Option C: Move the record to a ref for stacked features, and mask it when comparing trees
- **Pros:** Removes the source of drift for new records, while the mask handles records already committed on in-flight stacks. Follows the ref-backed precedent for state that must survive worktree loss.
- **Cons:** A stacked feature's record is no longer in its branch tree or on origin.

## Decision

Option C, because it removes the cause and still handles every stack already in flight.

1. **A stacked feature's halt record lives on `refs/conductor/<slug>/halt-record`.** When `hasDurableChildState` is true, `recordHalt` and `supersedeHaltRecord` write no file and no branch commit. Each write appends a commit, by compare-and-swap, whose tree holds only `.docs/halted/<slug>.md` and whose parent is the previous record commit, so `git log -p` keeps the audit trail. The record text keeps its fields and gains the ref in its push-status line. Nothing pushes the ref. A `git-error` from the predicate returns a failed result and writes nothing to a branch. A feature not in the stacked lifecycle, including a leaf before its first child, keeps today's commit and push.

2. **The ref wins over a committed record.** Reading a stacked feature's record tries the ref, then `HEAD:.docs/halted/<slug>.md`. Superseding a record found only at HEAD writes the resolved text to the ref. `hasOutstandingHalt` reads through this rule, so an in-flight stack upgrades at its next clear. Commits already on branches stay, and the shipped restack and cursor exemptions keep handling them. The ref joins `featureConductorRefNames`, and it does not count as durable child state.

3. **A recorded resolution ignores only this feature's halt record when it compares.** The parent-tree check compares both trees with `.docs/halted/<slug>.md` removed. The range check accepts a live `oldParent` or `oldTip` that differs from the record only by non-merge commits whose sole changed path is that record. Every other difference stays stale. Consumption replays with `haltRecordSlug`, in both `runRestack` and recovery, so the rebuilt tip carries the newest record and a halt-record-only commit in the operator's range cannot conflict.

4. **A genuinely stale resolution becomes a fresh, answerable conflict.** On a `parent-tree` or `range` mismatch the engine aborts the journal, deletes the resolution ref, writes a conflict record for the live range and live parent with the old record's `commit` and `paths`, then writes a halt that carries `Restack-Conflict: <child> <opId>`, the stale reason and field, and both recipes. The resolution is deleted first, because a stale tip paired with a fresh record would replay the wrong range. `restack_refused` still reports `restack-resolution-stale`, and `restack_resolution` gains the action `retired`. No branch or closure ref moves.

5. **A resolution with no usable record is retired, and the replay continues.** A resolution ref with no readable record, or a record naming another child, has nothing to answer. The engine deletes that ref, emits `restack_resolution` `retired`, and runs the ordinary replay. That replay applies, or reaches the resolver, or writes a fresh conflict halt.

6. **The resolver receives its environment.** `ResolutionContext` carries an optional environment, the step runner forwards it, and `InvokeOptions` gains an overlay that the Claude, Codex and Pi adapters apply before their session markers. This restores the journal committer stamp, the post-rewrite list and the halt-record merge driver for provider-run Git. The fallback model ladder forwards it too.

7. **The settled tip is what the guards checked, and a missing commit halts.** After a resolver-settled replay the tip is the temporary checkout's HEAD, which FR-8 and FR-9 just read. The post-rewrite list's last entry is used only if HEAD cannot be read. `newParent` is a valid tip only when the todo had no candidates. When the list is empty, rewrites come from unique subjects matched between the old range and the settled range, as consumption already does, and ambiguous subjects are left to patch-id reconstruction. If any candidate subject is missing from `newParent..tip`, or no tip can be read, the resolver reports `conflict_halt` naming the commits, and the shipped unresolved-conflict path halts with a fresh record. No branch moves.

8. **`moveLeaf` tolerates only this feature's halt records, and finds the default branch like the rebase path.** Stray commits that are non-merge and change only `.docs/halted/<slug>.md` no longer refuse the move. Any other stray refuses, naming the commit. Discovery shares a new no-fetch helper with `resolveBaseCore`: `origin/HEAD`, then `git remote show origin`. When discovery fails, the stray check uses only `^<tip>`, so a base commit may be refused by name, and discovery failure alone never refuses.

9. **Out of scope.** Merge-bearing `flatten_refused` stays with #3438, which is blocked by this spec. The six shipped exemptions are not removed, because in-flight stacks still need them. Pushing the ref to origin is not added.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `StepRunner.resolveRebaseConflict` passes no environment to the provider (`step-runners.ts`), so a provider-run `rebase --continue` installs no post-rewrite hook; a real-git probe wrote no list | verified | 95% | yes | The dropped child has another cause, and decision 6 would not stop it, though decision 7 still halts | |
| A2 | FR-9 reads subjects from the temporary checkout's `<onto>..HEAD`, and that checkout is removed only in the `finally` after the tip is computed (`rebase.ts`, `restack-resolver.ts`) | verified | 90% | yes | Decision 7 falls back to the post-rewrite list, then halts | |
| A3 | `hasOutstandingHalt` is the only production reader of a committed record's content (grep of `src/conductor/src`, `bin` and `skills`) | verified | 90% | yes | A missed reader sees a stale `Status:` on an upgraded stack | |
| A4 | Provider shells forward the overlay; Codex may filter variables whose names contain `KEY`, which would strip `GIT_CONFIG_KEY_*` | unverified | 60% | no | The merge driver and committer stamp are lost on that provider, and decision 7 still keeps every commit | |
| A5 | No operator flow needs a stacked feature's record on origin; child records are already unpushed, and only an active leaf loses its push | inferred | 80% | yes | Off-host pickup of a stacked leaf halt loses the record | APPROVED by operator 2026-11-02 |
| A6 | Pre-region records on the leaf are safe to discard at the leaf move, because the branch's reflog keeps them and they were resolved before stacking | inferred | 85% | yes | A pre-region halt's history is only in the reflog and on origin | APPROVED by operator 2026-11-02 |

## Consequences

### Positive
- An operator's `--tip` is consumed on the next dispatch, and a genuine change always leaves a path that needs no ref surgery.
- A restack can no longer silently drop a child's commits.
- New halts stop adding commits to stack branches, so child boundaries and closure tips stay clean.

### Negative
- Operators read a stacked record with `git show refs/conductor/<slug>/halt-record:.docs/halted/<slug>.md`, and the runbooks must change.
- Two record locations exist until in-flight stacks drain, and the six exemptions remain until then.

## Amendments made by this decision

`adr-2026-08-23-committed-halt-record` decisions 1, 5 and 7; `adr-2026-10-07-per-child-build-region` decisions 3 and 11; `adr-2026-10-10-stacked-restack-journaled-replay` decisions 4 and 6; `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decision 4.
