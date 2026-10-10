# Track: Halt records never reach origin after daemon auto-rebase

Track: technical

Scope boundary: Narrow (operator-settled). Only the halt-record publication push (`publishHaltRecord`, shared by the halt-record write and its resolution/supersede) changes: it publishes with `--force-with-lease`, leased on the branch's remote-tracking ref — the remote tip the daemon last observed — matching the SHIP draft-PR lease push. Excluded: publishing the rebased branch from the rebase step, any other push site, a bare `--force`, explicit-SHA leases, fetching before the push, changing the halt-record content or its "may be ahead of the remote" line, and the stacked-child no-push rule owned by #2942. A remote moved by anyone other than the daemon is never overwritten and the failure is still reported through the existing `halt_record_push_failed` / pushFailed surfaces.

Internal daemon publication correctness fix with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2891).

## Approaches weighed (explore)

1. **Lease push at the halt-record publication seam (chosen; operator decision).** `publishHaltRecord` appends `--force-with-lease`, exactly as `openShipDraftPr` does for its FINISH-time `pushMode: 'lease'` and `pushRefreshedBranch` does for the mergeable refresh. Est. effort: ~1h (S). Impact: every halt record and resolution written after a daemon rebase reaches origin; a foreign remote move is still refused and reported.
2. **Rebase step publishes the rewritten branch (filer Option B).** Est. effort: ~half day (M). Impact: would also fix any other plain push between rebase and SHIP. Rejected by the operator: it publishes mid-build state from a gate that today never touches the remote, widens the blast radius to every rebase, and does not by itself fix a halt raised before the next publication.
3. **Replay the halt-record commit onto the remote tip (genuine alternative, not from the filer).** Fetch the feature branch, cherry-pick only the `.docs/halted/` commit onto the remote tip, and push that fast-forward. Est. effort: ~half day. Impact: never rewrites remote history. Rejected: origin would carry a branch that diverges from the daemon's working branch, so the next daemon publication (SHIP lease push) would discard it anyway, and it adds fetch/replay failure modes inside a seam that must never throw.

## Verified facts

- `publishHaltRecord` pushes `['push', 'origin', 'HEAD:refs/heads/<branch>']` with no lease — `src/conductor/src/engine/halt-record.ts:198-199` (verified, 100%). Both `recordHalt` (`:134`) and `supersedeHaltRecord` (`:172`) call it (verified).
- The SHIP precedent pushes `['push', '-u', 'origin', 'HEAD:refs/heads/<branch>', '--force-with-lease']` through `executeRemoteGit` — `src/conductor/src/engine/ship-draft-pr.ts:396-397` (verified).
- The engine-provisioned `pre-push` hook admits a non-fast-forward exactly when `refs/remotes/<remote>/<branch>` equals the remote's current SHA ("A matching tracking ref is the local proof required by --force-with-lease") — `src/conductor/src/engine/git-hook-assets.ts:441-460` (verified). The guarded push grammar admits `--force-with-lease` — `remote-git-targets.ts:73-80`, `git-option-spec.ts:91` (verified).
- The daemon `rebase` gate fetches only the default branch (`rebase.ts:247`), so it does not move the feature branch's remote-tracking ref (verified).
- git 2.53 behavior, reproduced in a scratch repo: after a local history rewrite, a bare-lease push to an unmoved remote is a forced update; after a foreign push the same push is `! [rejected] … (stale info)`; with no remote-tracking ref a fast-forward is admitted and a non-fast-forward is rejected `stale info` (verified, 100%).

## Assumptions

- The feature branch's remote-tracking ref still holds the daemon's last pushed tip when a post-rebase halt is recorded (inferred, ~85%: every daemon push to `origin` updates it and no daemon fetch targets feature branches; the issue's 112/84 divergence is against that pre-rebase tip). Impact if wrong: a fetch that pulled in a foreign commit would let the lease pass and overwrite it — the same residual exposure as the SHIP lease push, which the operator accepted by choosing this precedent.
