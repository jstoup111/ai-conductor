# Stories — Per-task "work happened at all" floor under build_review

**Stem:** `per-task-work-happened-floor` · Track: TECHNICAL · **Status: Accepted**
**Source:** jstoup111/ai-conductor#781

Actors: the daemon build loop (runs `build_review`), the harness operator (reads
telemetry/log), the plan author (writes markers). The floor is a deterministic,
non-blocking advisory computed inside the `build_review` step.

---

## Story 1 — Zero-commit unmarked task is surfaced before ship (happy path of the guard)

**As** the harness operator
**I want** a deterministic warning when a planned task produced no commit and no marker
**So that** a silently-unimplemented task can't slip past the LLM completeness rubric unseen.

- **Given** a plan with tasks `1,2,3` and a branch whose commits carry `Task:` trailers
  for `1` and `2` only, and task `3` has no `**Verify-only:**`/`**Type:** verification`
  marker and is not `skipped` in `task-status.json`,
  **When** `build_review` runs,
  **Then** the floor writes `.pipeline/per-task-floor.json` with `satisfied: false` and
  `gaps: ["3"]`, and emits a WARNING advisory line naming task `3` into the build output
  **before** ship.

- **Given** the same build,
  **When** the floor completes,
  **Then** it does NOT change `.pipeline/build-review.json`, does NOT trigger a kickback,
  and does NOT block the step (non-blocking disposition).

## Story 2 — Every task covered by a trailer: floor is silent

**As** the daemon
**I want** no advisory noise when every planned task has a trailered commit
**So that** the floor only speaks when there is a real zero-work candidate.

- **Given** a plan with tasks `1,2` and commits carrying `Task: 1` and `Task: 2`
  (matched via `canonicalTaskId`, so `Task: T1`/`Task: 1` both count),
  **When** `build_review` runs,
  **Then** the artifact records `satisfied: true`, `gaps: []`, and no WARNING lines are
  emitted.

## Story 3 — Verify-only / skipped task does NOT trip the floor

**As** a plan author
**I want** a way to declare a task legitimately produces no commit
**So that** verification-only or explicitly-skipped tasks are not flagged.

- **Given** task `4` carries `**Verify-only:** yes` (or `**Type:** verification`) in the
  plan, and task `5` has `status: "skipped"` in `task-status.json`, and neither has a
  trailered commit,
  **When** `build_review` runs,
  **Then** neither `4` nor `5` appears in `gaps` (`markedTasks` lists both), and
  `satisfied` reflects only the remaining tasks.

## Story 4 — Folded-work task is flagged but NEVER wedges (the #773 no-wedge guarantee)

**As** the harness maintainer
**I want** the floor to be advisory even in the folded-work case
**So that** it can never revive the #773 wedge that a blocking gate would.

- **Given** the reproduced #773 shape — plan tasks `6,7`, a single commit carrying
  `Task: 7` only (task 6's work folded in, no `Task: 6` trailer), task 6 unmarked,
  **When** `build_review` runs,
  **Then** the floor lists `6` in `gaps` (advisory), the rendered line frames it as
  "confirm its work shipped inside another task's commit or add a marker",
  **And** the build is NOT blocked — the grader verdict stands unchanged and the step
  proceeds. (Proves determinism without a false halt.)

## Story 5 — Fail-soft on missing/again git data (negative path)

**As** the daemon
**I want** the floor to fabricate no flags when it can't read git or the plan
**So that** a transient failure never produces a false "work didn't happen" advisory.

- **Given** a project dir where `listCommitsWithTrailers` errors (non-repo / no commits)
  or the plan/`task-status.json` is missing or malformed,
  **When** the floor runs,
  **Then** it records the reason in `skipNotes`, returns `satisfied: true` with `gaps: []`,
  emits no WARNING, and never throws — `build_review` proceeds normally.

## Story 6 — Kill-switch disables emission (negative/config path)

**As** the operator
**I want** to turn the advisory off
**So that** I can suppress it without code changes if it proves noisy.

- **Given** `build_review.perTaskFloor: false` in config,
  **When** `build_review` runs on a build that would otherwise flag a gap,
  **Then** the floor is skipped entirely — no artifact write, no WARNING — and
  `build_review` behaves exactly as it does today.
- **Given** the field is absent/malformed,
  **When** `build_review` runs,
  **Then** the floor defaults to ENABLED (fail-open-to-on, matching build_review's own
  default-on posture).

---

**Acceptance:** Stories 1–6 cover happy (1,2), marker escapes (3), the no-wedge
guarantee (4), fail-soft negative (5), and config negative (6). No product FRs (technical
track). **Status: Accepted.**
