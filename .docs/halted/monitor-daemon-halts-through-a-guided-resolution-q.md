# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-30T10:47:09.388Z
Slug: monitor-daemon-halts-through-a-guided-resolution-q
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-monitor-daemon-halts-through-a-guided-resolution-q
Head SHA: b3e2f57035a84800a72429a110b026f782c2c372
Halted at: 2026-09-30T01:38:40.379Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 10 negative: Given two halts whose bands are equal, when one of them is deferred and the queue is recomputed, then the remaining items hold their previous relative order.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. Skipped items are offered after all unseen work regardless of their band, and among themselves are ordered by descending band. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. Recomputing after an unrelated feature halts keeps the previously-ordered equal-band items in their prior relative order and places the new item by its own band. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub. A lookup failure for one reference while others succeed leaves every halt queued and reports the failure once rather than per item; a halt whose linked issue does not exist stays queued with its band reported as unlabeled (the existing resolver attribution for a not-found issue) and the pass does not fail; a halt with no linked reference is placed by the existing band ranking for unlinked work and still offered; and the ordered queue reports each item's attributed band and the ordering basis applied, reporting the basis as the fallback when every item's priority is unresolved.
Missing assertion: No cited check requires preservation of relative order after deferring an equal-band halt.
```
