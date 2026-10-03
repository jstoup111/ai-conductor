# Conflict Check: Task-status recovery after abrupt daemon death (#2673)

**Date:** 2026-10-03
**Stories checked:** `.docs/stories/daemon-redispatch-loses-committed-task-progress-af.md` (Stories 1-3) against every file in `.docs/stories/`
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASS — 1 blocking and 1 degrading conflict resolved by operator, 1 low ADR-wording tension resolved; zero blocking conflicts remain.

## Conflict: Pre-dispatch seed promised never to reset in-progress rows

**Stories involved:** Story 2 (stale in-progress task becomes pending at the dispatch boundary) vs "Fresh dispatch seeds task-status.json and proceeds"
**Files:** [.docs/stories/daemon-redispatch-loses-committed-task-progress-af.md] vs [.docs/stories/fresh-build-dispatch-halts-immediately-with-attrib.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing story states the pre-dispatch seed "never resets completed/in-progress rows back to pending"; Story 2 resets a trailerless `in_progress` row to `pending` at that seed.

**Resolution Options:**
1. Replace the old assertion in place with an exception for `in_progress` rows with no branch-scoped `Task:` trailer (adr-2026-09-06 decision 12); completed rows stay protected.
2. Drop Story 2 and keep stale `in_progress` rows forever.

**Resolution (operator, 2026-10-03):** Option 1, shipped as companion PR jstoup111/ai-conductor#2956 (main-based, because the land gate rejects foreign-stem story edits). Merge together with this spec PR.

## Conflict: Kickback re-seed promised in-progress rows remain in progress

**Stories involved:** Story 2 vs "Engine seeds task-status.json from the plan at build entry"
**Files:** [.docs/stories/daemon-redispatch-loses-committed-task-progress-af.md] vs [.docs/stories/prd-audit-kickback-preserves-task-status.md]
**Type:** state-conflict
**Severity:** degrading

**Description:** Kickback re-entry into BUILD passes through the pre-BUILD dispatch seed (`seedBuildTaskTelemetry`), where the old story keeps task 3 `in_progress` and Story 2 resets a trailerless one.

**Resolution (operator, 2026-10-03):** add the decision-12 exception beside the existing open-repair exception; same companion PR #2956.

## ADR tension: "No machinery writes completed rows"

**Stories involved:** Story 1 vs ADR constraint 3
**Files:** [.docs/stories/daemon-redispatch-loses-committed-task-progress-af.md] vs [.docs/decisions/adr-2026-07-23-trailer-union-build-step-routing.md]
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-23-trailer-union-build-step-routing
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "No machinery writes `completed` rows (no derivation revival)."
**Story opposing sentence (verbatim):** "then task 18 has a row with status completed, that commit's sha, and restored_from task-trailer, and every other row keeps its prior status and commit."

**Description:** Wholesale reconstruction already writes trailer-restored `completed` rows; Story 1 extends that to a single missing row.

**Resolution (operator, 2026-10-03):** `adr-2026-09-06-reopened-task-resolution` decision 12 names this restore as the recovery exception to that constraint (restores a lost row, never derives a new completion; `build_review` stays sole completion authority). The 07-23 ADR is not amended.

## ADRs examined (repo_wide)

Overlapping and compatible: adr-2026-09-06-reopened-task-resolution, adr-2026-07-23-trailer-union-build-step-routing (constraints 1 and 4 compatible), adr-2026-07-21-demote-task-stamping-to-telemetry (deleted stamp-based reseed is a different mechanism), adr-2026-07-05-engine-owned-task-status, adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation, adr-2026-07-10-session-hook-task-stamping, adr-2026-07-11-pipeline-state-durability, adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main, adr-2026-07-12-progress-aware-build-halt, adr-2026-07-11-verdict-aware-resume-entry.

Narrowed out (no seed or task-row decision): the attribution and evidence-stamp family superseded or demoted by adr-2026-07-21; task-id alias; build and review gate ADRs that consume rows without governing seeding; daemon and halt machinery; seal, rebase, and plan-scope ADRs; event-spine and telemetry ADRs that mention events.jsonl only in passing.

## Stories examined and compatible

trailer-union-build-completion, build-step-completes-with-every-plan-task-still-pe, remediation-halts-when-the-owning-plan-task-is-alr, rebase-reopens-completed-repair-tasks-against-stal, evidence-stamps-sync-to-task-status-rows-so-progre, engine-invoked-task-attribution-494-freezes-curren, deterministic-evidence-attribution, pipeline-commits-files-outside-the-active-plan-bef, record-task-done-completion-without-a-current-task, build-dispatch-can-start-with-current-task-none-so, demote-task-stamping-to-telemetry, builds-stall-when-work-lands-without-task-trailer-, per-task-work-happened-floor, mid-loop-pipeline-wipe-549, consolidate-duplicate-halt-marker-and-taskstatusfi.

Noted, not a conflict (~25%): `plan-growth-allowance-is-spent-on-work-existing-ta` fails closed when a restage's bound id is missing from task-status.json; after this change a missing trailer-proven row is restored as completed first. The plan must keep restage binding behavior covered by the open-repair override.
