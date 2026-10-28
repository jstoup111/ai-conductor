# Conflict Check: Daemon commits carry the bot co-author trailer under every executor isolation mode (#3377)

**Date:** 2026-10-24
**New stories:** `.docs/stories/daemon-commits-carry-no-bot-co-authored-by-trailer.md` (3 stories)
**Result:** PASSED. 0 blocking, 0 degrading.

**ADR corpus:** repo-wide. Every approved ADR was loaded and narrowed by subject (co-author
attribution, bot credential, executor isolation, child or supervisor ownership, daemon event
spine). Examined:
- `adr-2026-09-11-github-operation-ownership` (D9 bot credential; D10 co-author, as amended 2026-10-24);
- `adr-2026-07-22-canonical-tracker-client-seam` (item 3, the read-auth exception D10.1 already carves out);
- `adr-2026-10-15-per-dispatch-engine-pinned-executor` (child owns its feature spine; supervisor owns root mutations);
- `adr-2026-08-27-daemon-dispatcher-executor-seam` (per-executor `gh` calls are an accepted consequence);
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement` (worktree hook pattern, unchanged here).

Narrowed out by subject: stale-engine restart and respawn, origin refresh, daemon profile, session
command contracts, step applicability, dispatch-first maintenance, stacked restack, and every
provider, cost, memory, intake, release, and DECIDE-tooling ADR.

**Story corpus:** 622 files, narrowed to 14 by a subject grep for co-author, bot identity or
credential, executor child or isolation, `prepareWorktree`, and the worktree commit hook. The
substantive comparison parties were `daemon-commits-co-authored-by-the-configured-bot`,
`use-a-dedicated-bot-identity-for-daemon-github-act`, `engine-updates-reach-dispatched-features-only-afte`,
and the hook-attribution stories (`deterministic-evidence-attribution`,
`inline-build-work-commits-unattributed-session-hoo`, `missing-session-hook-files-terminally-halt-a-build`).

## Pairs examined (both directions)

| Pair | Finding |
|---|---|
| New Story 1 and 2 vs `daemon-commits-co-authored-by-the-configured-bot` Story 1 ("Given the identity was already resolved once in the current daemon process for the same token file, … no second identity read is performed") | Compatible. Each executor child is its own process and caches within it. Fully satisfying the new stories (one read per child) leaves the old criterion true within every process, and the old criterion never requires a single read across processes. ADR D10.1's amendment states the per-process scope explicitly. |
| New Story 1 vs the same file's Story 6 ("the token is present only in that one child process's environment and not in the daemon's own environment or any provider or build child's environment") | Compatible. Verified: the bot token is placed only in the spawned `gh` child's `env` (`tracker-client.ts` and `pr-labels.ts` build `{ ...process.env, GH_TOKEN }` for that spawn), never in `process.env` of the executor child. The executor child already spawns such `gh` children for its GitHub writes. |
| New Story 2 (operator entry points never stamp) vs the same file's Story 4 (commits outside the daemon are never stamped) | Same behavior restated for the new entry point; no tension in either direction. |
| New Story 3 (`resolver-absent` skip) vs the same file's Story 5 (no bot means byte-identical commits and no co-author value) | Compatible. `resolver-absent` fires only when no resolver is installed at daemon dispatch. With the resolver installed and `github_bot` unconfigured, the new Story 3 asserts no event, matching Story 5. |
| New Story 3 vs the same file's engine-commit criterion ("no identity read is performed inside that commit path") | Compatible. The new story adds no read or event on the commit path; the skip is raised only during dispatch worktree preparation. |
| New Stories 1 and 2 vs `engine-updates-reach-dispatched-features-only-afte` (child/in-process parity story) | Reinforcing. Both executors reach attribution through one bootstrap. |
| New Story 1 vs `adr-2026-10-15-per-dispatch-engine-pinned-executor` ("The child is the single writer of its feature `.pipeline/events.jsonl`") | Compatible. Child-side skip events are written through the child's own feature bus. Installing an in-memory resolver and writing the worktree's own `.pipeline/co-author` are not root mutations. |
| New stories vs the hook-attribution stories | No overlap. The hook and its `Task:` and co-author stamping are unchanged; only which processes write the hook's input changes. |
| New stories vs `use-a-dedicated-bot-identity-for-daemon-github-act` | No overlap. Write-credential selection is unchanged. |

Oscillation hunt: no pair fails the "satisfy A, does B still hold?" test in either direction.

## Conflicts

None.
