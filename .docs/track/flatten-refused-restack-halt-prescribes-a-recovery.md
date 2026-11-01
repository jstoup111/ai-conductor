# Track: Stacked restacks recover merge-bearing conflicts automatically

Track: technical

Scope boundary: comprehensive for stacked restacks, auto-recover. A stacked restack conflict on a child whose own range contains a merge reaches the restack resolver, under its existing budget and guards, instead of halting `flatten_refused`. When the resolver cannot settle it, the feature takes the ordinary restack conflict halt, whose recovery keeps the merge's content. Excluded: N=1 `flatten_refused` rebases and their recipe; children with no merge in their range, which behave exactly as today; the parent-tree staleness of recorded `--tip` resolutions, owned by jstoup111/ai-conductor#3557; documentation edits, left to the `maintain-documentation` pre-finish gate.

Engine recovery behavior with no end-user product requirements; acceptance criteria live in stories. Operator confirmed 2026-11-01. Chosen approach: flatten at the resolver hand-off, using the first-parent classification the plumbing replay already applies. Rejected: an operator-only recipe, because it costs an intervention on every occurrence; squashing the child's whole range, because it fails the FR-9 subject guard and loses evidence correspondence; permanently flattening the child's branch first, because it moves engine-owned refs before the conflict is settled. Source: jstoup111/ai-conductor#3438.
