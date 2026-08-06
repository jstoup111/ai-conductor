# Coherence: Worktree classification, retained reasons, and the operator lever (#1329)

**Date:** 2026-08-05
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; technical intents TI-1..TI-6 in the
stories file carry the requirement layer).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1329, carried into the
spec by the `.docs/intake/` marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-6 | covered | "No HALT, no park, unpushed branch, no commits is dispatchable." Story 2 asserts the never-started slug renders in ELIGIBLE; Story 6 guarantees a failed dispatch always leaves a clearable lever. |
| outcome | outcome-2 | story-1 | covered | "A worktree that never initialised pipeline state is distinguishable from one retained after a verified ship." Story 1 asserts a distinct never-started collection excluded from the retained one. |
| outcome | outcome-3 | story-3 | covered | "A retained row's stated reason matches reality." Story 3 gates the awaiting-main reason behind an established open PR and degrades to an explicit unknown otherwise. |
| outcome | outcome-4 | story-4 | covered | "A shipped-and-retained worktree whose PR is open is still excluded from dispatch." Story 4 is the dedicated non-regression story. |
| outcome | outcome-5 | story-5 | covered | "An operator can determine which reason applies and what action would resume it from daemon status alone." Story 5 requires a reason plus a remedy line on every excluded row. |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Classification split plus its setup-era, malformed-state and infrastructure-prefix negative paths. |
| story | story-2 | task-5, task-6 | covered | ELIGIBLE membership and the park/HALT precedence negatives. |
| story | story-3 | task-7, task-8, task-9 | covered | Ledger-derived reason, probe-refined reason, and the absent/failing/mismatched probe negatives. |
| story | story-4 | task-10 | covered | The mandatory non-regression, including the probe-failure variant asserting the exclusion survives a downgraded reason. |
| story | story-5 | task-13 | covered | Reason plus remedy per group, the double-qualifying single-row case, the empty-HALT unknown case, and the no-orphan-lines case. |
| story | story-6 | task-11, task-12 | covered | Slug-derived marker path, the unwritable-marker warning, and the no-automatic-retry assertion. |
| task | task-1 | story-1 | covered | Never-started collection introduced; retained collection no longer receives the missing-state case. |
| task | task-2 | story-1 | covered | Setup-era-artifacts-only fixture classifies never-started. |
| task | task-3 | story-1 | covered | Malformed conduct-state stays IN-PROGRESS with step unknown. |
| task | task-4 | story-1 | covered | resolve-/engineer- prefixes excluded from both collections; an unreadable state file does not abort the scan. |
| task | task-5 | story-2 | covered | Never-started slug renders under ELIGIBLE. |
| task | task-6 | story-2 | covered | Park and HALT precedence preserved over the new bucket. |
| task | task-7 | story-3 | covered | Reason union widened; a legacy no-PR ledger entry derives the shipped-no-PR-reference reason. |
| task | task-8 | story-3 | covered | Injected probe gates the awaiting-main reason behind an open result. |
| task | task-9 | story-3 | covered | Absent, throwing and mismatched probes all degrade to the explicit unknown. |
| task | task-10 | story-4 | covered | Shipped-and-retained with an open PR stays out of ELIGIBLE; the exclusion is independent of the derived reason. |
| task | task-11 | story-6 | covered | Marker path derived from the slug so a createWorktree throw still leaves a lever. |
| task | task-12 | story-6 | covered | Unwritable marker logged explicitly; an errored outcome is not auto-re-dispatched. |
| task | task-13 | story-5 | covered | Reason and remedy rendered for every excluded row, including the reclaim verb for retained rows. |

No `gap` rows. Every `covered` verdict was checked against the cited artifact file in this
worktree (`.docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md` and
`.docs/plans/worktree-with-no-conduct-state-is-retained-as-pr-o.md`).

## Assumptions surfaced

- **The observed non-dispatch was caused by `createWorktree` throwing before a worktree handle
  existed** — ~35% confidence. Impact if wrong: that specific stall recurs after this ships.
  Mitigated by design — no story or task asserts this cause, story-6/task-11 state the invariant
  for every error path, and story-5's remedy rendering makes whichever cause fires legible on the
  next occurrence. Confirm by reading the `reporting_app` daemon log around the dispatch that left
  `.worktrees/v4-latest-endpoint` without pipeline state.
- **A processed-ledger entry's `prUrl` is sufficient evidence that a ship occurred, without a
  probe** — ~90%, verified against `readProcessedEntries` (`daemon-dashboard.ts:211-235`), which
  parses `prUrl` from the ledger JSON written by `markProcessed(slug, prUrl)`. Impact if wrong: a
  retained row states "shipped, no PR reference" for a slug that did ship with a PR — a weaker
  statement than reality, never a stronger one.
