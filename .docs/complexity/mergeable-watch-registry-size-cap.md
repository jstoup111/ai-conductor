# Complexity assessment: cap the mergeable-watch registry size

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. No schema change (max-COUNT trims by array length; no new `WatchEntry` field). |
| Integrations | None. Pure in-memory trim before the existing `rewriteWatch`. |
| Auth / identity | Untouched. |
| State machines | None. Best-effort/non-blocking, same as the rest of the sweep. |
| Story count | 3 (over-cap registry trimmed with each drop logged; under-cap unchanged; merged/closed/gone self-prune still runs first). |
| Files touched | `mergeable-sweep.ts` (cap logic around `survivors`/`rewriteWatch`), plus its test. |
| Blast radius | Contained to `sweepMergeableLabels`'s rewrite path; the not-found classifier and `enrollWatch` are untouched. |

Points to **Small** — provided the scope is **max-COUNT only**. Max-AGE would require
an enrollment-timestamp schema addition and an `enrollWatch` call-site ripple (Medium)
and is explicitly deferred. Per the tier rules this Small technical fix **skips**
conflict-check, architecture-diagram, and architecture-review; the land gate requires
only track + stories + plan + this complexity marker.

Collision note: no overlap with the sibling #148 spec — that edits `pr-labels.ts`
(the not-found classifier); this edits `mergeable-sweep.ts` only and consumes the
classifier import read-only.
