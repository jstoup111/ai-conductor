# Conflict check: v1 interface lock for parallel task-stream dispatch (#552)

**Date:** 2026-08-02
**Stories reviewed:** 11 (`.docs/stories/lock-474-s-breaking-surfaces-before-v1-enumerate-e.md`)
**Verdict:** PASS with three recorded cross-feature constraints and one behavior-change risk.
No blocking contradiction found between the stories themselves.

## Method

Two passes. Internal: every pair of stories checked for contradictory assertions about the
same surface. External: the advisory `conduct-ts overlap-scan` over the union of files these
stories touch, then a semantic read of the open spec PRs whose subject matter actually
intersects. The raw scan is not reproduced here — it reports overlap against every unmerged
`spec/*` branch in the repository, most of them long-superseded, so its signal is the branch
*list*, not the verdict. The two PRs below are the ones whose decisions genuinely interact.

## Internal consistency

| Pair | Potential conflict | Resolution |
| --- | --- | --- |
| Story 1 (stamp unique-or-absent) vs Story 4 (`currentTaskId` unique-or-absent) | Two different "current task" notions could drift apart | Deliberately aligned: both are defined as *present iff exactly one task is in flight*. The stamp is the file, the scalar is the derived telemetry; a single rule governs both. No conflict. |
| Story 3 (unknown row fields preserved) vs Story 9 (file sets drive the veto) | Story 3 says unknown fields are ignored; Story 9 needs `files` to be meaningful | Complementary. Story 3 pins *tolerance* so a future field survives; Story 9 pins the *rule* for the field's empty case. Neither asserts `files` is currently populated by the engine — see external constraint C2. |
| Story 6 (`dispatch-count` frozen) vs Story 4 (telemetry widened) | Both concern attribution telemetry | Disjoint surfaces: one is the per-dispatch line log, the other the progress snapshot. No shared field. |
| Story 2 (branch-name charset) vs Story 10 (config keys) | Both edit config validation | Same file, different keys, no shared rule. Sequenced in the plan to avoid a mechanical collision only. |
| Story 7 (`phase-active` frozen) vs Story 9 / Story 8 | None — different artifacts | No interaction. |

No story asserts a shape another story contradicts.

## External constraints (recorded, not blocking)

### C1 — PR #1262 (`#1227`, plan-scope containment) is silently disabled by parallel dispatch

`adr-2026-08-02-plan-scope-containment-at-commit-boundary` (APPROVED, unmerged) makes
`commit-msg` refuse a BUILD commit whose staged paths fall outside **the stamped task's**
declared files. Its abstention ladder is blanket fail-open, and one rung is *"no `Task:`
trailer is present"*.

Under #474, `.pipeline/current-task` is absent whenever ≥2 lanes are in flight (this
feature's S1 pin), so `prepare-commit-msg` stamps nothing, so no `Task:` trailer exists, so
containment abstains on **every** commit made during parallel execution. The gate does not
break — it evaporates, silently, exactly when the most work is happening.

This is not a contradiction to resolve now, and neither spec should change: #1262's fail-open
rule is correct, and this feature's S1 freeze is what keeps its hooks working at all. It is a
**constraint on #474**, and it belongs in the lock: it is the sharpest argument for why S2
(`.pipeline/lanes/`) and S8 (`dispatch-log.jsonl`) are reserved rather than left to
post-v1 invention. #474 must restore a per-commit task id from lane-scoped state before it
can be enabled, or it silently regresses a shipped correctness gate.

**Action taken:** recorded in the ADR's consequences as a named post-v1 precondition. No story
changes.

### C2 — PR #1262 populates `files` on task rows; this feature must not assume it exists yet

#1262 decision 1 has `seedTaskStatus` write `files: string[]` per row from
`parsePlanTaskPaths()`, reviving a dead read path in `commit-msg`. Story 9 pins the *rule* for
an empty declared set and Story 3 pins field tolerance — neither depends on `files` being
populated, and both hold whether #1262 merges before or after this feature.

**Ordering:** if #1262 merges first, Story 3's round-trip test must use a field name other
than `files`, which will by then be a known field. Recorded in the plan as a note on that task.

### C3 — PR #1237 (`#1167`, conduct-state lost update) touches the same state file as Story 2

#1237 introduces a mutation port for `conduct-state.json` to stop whole-object rewrites
clobbering out-of-process writes. Story 2 constrains the *grammar of keys written into* that
file (`<step>__<branch>`), not how it is written. Disjoint concerns; no contradiction. Both
are spec-only PRs today, so there is no code-level collision to sequence.

## Behavior-change risk found during the check

**Story 4's redefinition of `currentTaskId` changes what operators see today, not only under
#474.** The current implementation reports the *first* `in_progress` row
(`build-progress-watcher.ts:120-124`). Multiple rows are already simultaneously `in_progress`
in real builds — that is precisely the live condition #531 documents, where the build
orchestrator batches tasks informally. So switching the scalar to unique-or-absent will make
the daemon dashboard, the renderer, and OTEL spans show *no* current task in exactly the
situations where they show an arbitrary one today.

That is the correct direction — an arbitrary id is a lie, and it has already misled forensics
— but it must not read as a regression to the operator. The plural field is what carries the
information, so the renderer and dashboard have to display it.

**Action taken:** Story 4's Done-When now requires the renderer and daemon dashboard to
surface `currentTaskIds` when more than one task is in flight, so the operator sees "3 tasks
in flight" rather than a blank field.

## Resource and state contention

None introduced. This feature adds no dispatch, no concurrency, no new step, and no new
runtime writer. Story 5's single-writer fix *removes* a contention (the lost-update race on
`task-evidence.json` counters) rather than adding one.
