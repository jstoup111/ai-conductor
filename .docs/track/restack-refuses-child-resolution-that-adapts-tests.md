# Track: Restack refuses child resolution that adapts tests its new parent added

Track: technical

Scope boundary: Balanced. All four outcomes of jstoup111/ai-conductor#3598, applied identically at every path-ownership caller: the restack executor, restack recovery, and the operator `stack restack-resolve --tip` check. A clean mechanical replay keeps today's strict path-ownership rule. Excluded: retroactive rescue of resolver tips already discarded as dangling commits.

Engine-internal restack acceptance and halt recovery. There are no user-facing product requirements, so acceptance criteria live in stories. Operator confirmed 2026-11-07.

Chosen approach (B): a resolved tip (resolver result, operator `--tip`, or recovery) may change paths in its new parent's delta (`oldParent..newParent`) as recorded "adapted paths". An adapted path is refused as a revert when the tip restores its old-parent content, including deleting a file the parent added. Paths outside both the old range and the parent delta still halt `replay-mismatch`. Adapted paths are emitted on the restack event and force the child's judged gates to re-run, so `build_review` judges whether the adaptation is legitimate. A refused resolution's tip is pinned under the feature's restack refs, named in the HALT, and recorded so `restack-resolve --tip` can reuse it.

Rejected: (A) widening ownership to the parent delta everywhere, because it drops the silent-revert guard (adr-2026-10-10-stacked-restack-journaled-replay decision 3) on exactly the paths the parent just changed. (C) Keeping the strict refusal with one-command recovery, because every such restack would still halt needs-human, which fails the first desired outcome.
