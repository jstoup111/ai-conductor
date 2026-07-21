# Complexity assessment: pr-labels structured gh not-found detection

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. Reuses the existing `PrMergeState` / sentinel contract. |
| Integrations | One existing `gh` subprocess; no new invocation shape (reads structured fields off the already-thrown `ExecFileException`). |
| Auth / identity | Untouched. |
| State machines | None. The `MERGED`/`CLOSED`/`NOTFOUND`/`UNKNOWN` state contract is preserved; only the classifier that assigns `NOTFOUND` vs `UNKNOWN` changes. |
| Story count | 3 (structured NOT_FOUND → prune; transient/ambiguous → keep+retry; wording/locale change no longer mis-classifies). |
| Files touched | `pr-labels.ts` (the classifier) + its test; optionally the runner-seam return type and mergeable-sweep test fakes if `stderr`/`code` is surfaced through the typed seam. |
| Blast radius | Contained to the not-found classification path; `mergeable-sweep.ts` prune logic consumes only `state.state` and needs no change. |

All signals point to **Small**: a single classifier swaps five loose English
substrings for one durable structured signal, keeping the fail-safe direction and the
state contract. Per the tier rules this Small technical fix **skips** conflict-check,
architecture-diagram, and architecture-review; the land gate requires only track +
stories + plan + this complexity marker.
