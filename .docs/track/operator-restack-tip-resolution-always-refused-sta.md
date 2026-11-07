# Track: Operator restack --tip resolution always refused stale on a stacked feature

Track: technical

Scope boundary: comprehensive for stacked restack recovery and stacked halt bookkeeping, folding #3557 and #3576. Covers `--tip` and `--decision` consumption in `runRestack` and journal recovery, halt-record drift on the parent and on the conflicted child's own range, the stale-halt path, the resolver's dropped-tip defect and its fail-closed guard, halt records on stack branches, leaf-boundary refusals, and clones without `origin/HEAD`. Excludes the merge-bearing `flatten_refused` route owned by #3438, and non-stacked halt-record delivery.

Engine recovery defects with no new capability: acceptance criteria live in stories, with no PRD.
