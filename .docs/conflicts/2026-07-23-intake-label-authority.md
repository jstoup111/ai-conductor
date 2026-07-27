# Conflict Report: intake-issues-get-contradictory-duplicate-priority (#889)

**Date:** 2026-07-23
**Stories checked:** TR-1..TR-5 vs all files in `.docs/stories/` (11 candidates matching a
keyword scan over the affected surfaces — `label-sync`, `syncIssueLabels`, `intake-file`,
`intake-backfill`, `pr-labels`, `priority:`, `size:`, `addLabel` — read in full; remainder
excluded by the scan), plus prior `.docs/conflicts/` reports.
**Result:** ZERO blocking conflicts. Three coordination notes; one story amended in place.

## Resolved by amendment (story updated in place)

### 1. TR-1 vs `2026-07-10-priority-banded-intake-claim` (contract that must survive)
That shipped story explicitly pins duplicate-label **tolerance** as correct behavior:
"Given an issue with two priority labels (`priority: low` + `priority: critical`), when
claim runs, then the highest band wins (critical) — per `parsePriorityLabels`' existing
highest-rank rule." `2026-07-03-daemon-issue-priority-scheduling` depends on the same
rule for backlog ordering.

This is **not** a conflict — TR-1 removes the *cause* of duplicates, not the *tolerance*
for them — but an implementer reading "collapse to one label" could reasonably decide the
highest-rank fallback is now dead code and delete it. It is not: it is the defence-in-depth
layer that keeps scheduling deterministic for any issue the sweep declines to resolve
(TR-4's `unresolved` set) and for anything a human hand-labels later.

**Resolution (applied):** TR-1 and TR-4 are scoped so that `parsePriorityLabels` /
`parseSizeLabel` in `backlog-priority.ts` are explicitly **not modified**, and TR-4's
unresolved path deliberately leaves such issues schedulable via that rule. Severity was
degrading; now closed.

## Coordination notes (accepted, no amendment)

### 2. TR-1/TR-5 amend a shipped contract in `intake-only-enforcement`
`intake-only-enforcement` is the origin story for this seam and states: "if the field is
missing or unparsable, then the sync applies the **default** label — the issue is still
born complete, never left unlabelled." TR-1 narrows *when* that fires: the default now
applies only to an **empty** namespace, deferring to an existing label first. The invariant
that story actually protects ("never left unlabelled") is preserved verbatim — an issue
with nothing in the namespace still gets the default. The narrowing is intentional and is
the fix. Its acceptance tests must be reviewed for any that assert defaulting over an
*already-labelled* issue; such an assertion encodes the bug and should be updated with the
change, not worked around.

### 3. Concurrent DECIDE work — no file overlap
Two other specs are in flight against this repo: **#879** (`steps.ts` gate ordering) and
**#878** (`autoheal.ts` / `conductor.ts` / `daemon-cli.ts` trailer-scan caching). Neither
touches this spec's surfaces. Verified by grep: none of `steps.ts`, `autoheal.ts`,
`daemon-cli.ts` imports `label-sync` or `syncIssueLabels`; `conductor.ts`'s only contact is
`import { makeProductionGh, makeProductionGit, prMergeState } from './pr-labels.js'` — this
spec adds no export to and changes no signature in `pr-labels.ts` (it reuses
`restRemoveLabelArgs` / `removeLabel` as they already exist), so that import is unaffected.
No merge coordination required beyond ordinary rebasing.

### 4. Out-of-scope neighbour: the workflow has no intake-only filter
`intake-label-sync.yml` triggers on every `issues: [opened, edited]` with no label/author
filter, so non-intake issues are also stamped — contradicting its own "intake issues"
framing. Pre-existing, unchanged by this design (an empty namespace defaults before and
after), and out of scope for #889's stated outcomes. Flagged in the architecture review as
F5; file separately rather than folding it in.
