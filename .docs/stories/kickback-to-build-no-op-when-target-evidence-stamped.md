# Kickback to build is a no-op when the target task's evidence is still stamped (#647)

Status: Accepted

## Context

A blocking SHIP-gate review (`architecture_review_as_built`, `prd_audit`, `finish`) routes rework to
`build` through the remediation kickback machinery: `planRemediation`
(`src/conductor/src/engine/conductor.ts:871-930`) dispatches `/remediate`, appends any gap `tasks`
as new `rem-<source>-<id>` plan tasks (`remediation-append.ts:79-136`), re-seeds task-status, and
routes to the earliest target — for as-built/finish at `conductor.ts:3046-3097`, for prd_audit at
`:2920-3016`. Build completion is then derived from durable on-disk evidence (`autoheal.ts`
`deriveCompletion` ~`:791`, via `gate-verdicts.ts` `checkGateCompletion`). When the tasks implicated
by the finding are already evidence-complete — the common case for an as-built finding, where the
task "completed" but wrongly/partially — the re-entered build gate passes instantly with **zero new
commits**, the reviewer re-runs on identical code and returns the **same verdict**, and the loop
repeats until the kickback cap (`MAX_KICKBACKS_PER_GATE`, `:196-201`) or a retry budget exhausts,
dead-ending in a generic "retries exhausted" HALT that never states what input failed to change.

The existing zero-work machinery (`detectZeroWorkProduct` + `zero_work_product` event,
`conductor.ts:2145-2160`) does **not** cover this: it fires only inside the build retry loop on a
completion-gate **miss**, but here the build *passed* the gate, so the step succeeded and none of it
ran.

Observed 2026-07-13 (feature `2026-07-12-wiring-reachability-gate`): kickback
`adr-2026-07-12-wiring-check-gate→build` at 19:45Z; build gate-passed in 23s, worktree tip unchanged;
6 identical BLOCKED as-built reviews (re-run #6 "unchanged, escalating"); 3 retries wasted; operator
intervention. Intake: jstoup111/ai-conductor#647.

## Story 1 — a kickback that produces real rework still self-heals in BUILD (regression)

As the remediation kickback→build path, when `/remediate` emits a build disposition with a *new*
`rem-*` task, the re-entered build must genuinely dispatch that task, so the legitimate self-heal
path is unchanged.

### Happy Path

- **Given** a blocking as-built review whose `/remediate` plan appends a new `rem-<source>-<id>`
  build task not present in the plan and not evidence-stamped,
- **When** the engine routes the kickback to `build` and the build step re-enters,
- **Then** build completion recomputed from disk is **not** satisfied (the new task is pending), the
  build step dispatches work with the kickback finding in its retry hint, and — on a dispatch that
  produces commits / resolves the new task — the run proceeds to re-review as today (no HALT, no
  escalation).

### Negative Path — the append is an idempotent no-op on an already-complete task

- **Given** a repeat kickback for the same still-blocking gap, whose deterministic `rem-*` task id
  already exists and is already evidence-complete (idempotent upsert, `remediation-append.ts:100-127`),
- **When** the engine resolves the route to `build`,
- **Then** build completion recomputed from disk is already satisfied and the engine does **not**
  navigate back into a guaranteed no-op build (Story 2 governs the outcome).

## Story 2 — routing to build with no dispatchable work HALTs with the gap ledger, not a no-op

As `planRemediation`, when a resolved build route would re-enter a build that is already
evidence-complete (nothing to dispatch), I must escalate with the gap ledger instead of routing into
a silent no-op.

### Happy Path

- **Given** a `/remediate` route whose earliest target is `build` and, after append + `seedTaskStatus`,
  build completion recomputed via `checkGateCompletion(dir, 'build', ctx)` reports satisfied
  (empty `tasks`, or all appended `rem-*` ids already complete),
- **When** the route is resolved,
- **Then** the engine returns a HALT outcome (not a `route`), writes a HALT marker whose reason
  carries the blocking finding plus "remediation produced no dispatchable build work; the implicated
  task(s) are already evidence-complete — human needed", and surfaces it via the existing
  `surfaceRemediationPr` path — the build step is never re-entered for this round.

### Negative Path — dispatchable work present ⇒ normal route

- **Given** the same route but build completion recomputes to **unsatisfied** (a genuine pending
  `rem-*` task exists),
- **When** the route is resolved,
- **Then** the engine routes to `build` exactly as today (no HALT) — the guard only fires on a
  provably empty re-dispatch.

## Story 3 — a build after kickback that changes nothing, with an unchanged verdict, escalates

As the kickback→build re-entry, when a build reached via a kickback ends having done zero net work
and the re-review returns the same verdict, I must HALT with both artifacts instead of re-kicking.

### Happy Path

- **Given** a build entered via a kickback for gate G whose verdict/finding V was recorded at
  kickback time,
- **When** the build ends with `headShaAfterBuild == headShaBeforeBuild` AND
  `taskEvidence.lastResolvedCount` unchanged from the pre-kickback value (zero net progress), and the
  next verdict for G is byte-identical to V,
- **Then** the engine HALTs (fail-closed) with a reason that names the unchanged input and attaches
  **both** artifacts (the reviewer finding and the "build did zero work" record), and does **not**
  re-kick — even if `MAX_KICKBACKS_PER_GATE` is not yet reached.

### Negative Path — build did real work ⇒ no escalation

- **Given** a build entered via a kickback that produced commits (`headShaAfterBuild !=
  headShaBeforeBuild`) or resolved ≥1 additional task,
- **When** the re-review runs,
- **Then** the engine does **not** escalate on this branch — the re-review proceeds and may pass or
  return a *different* finding; a still-failing verdict re-kicks within the existing cap as today.

### Negative Path — legitimate reviewer-wrong is capped, not ping-ponged

- **Given** a task that is genuinely complete and correct but a reviewer that keeps returning the
  same BLOCKED verdict (reviewer wrong),
- **When** the kickback re-enters build, which correctly does zero work, and the same verdict
  returns,
- **Then** the engine HALTs with both artifacts on the **first** zero-work + unchanged-verdict cycle
  (Story 3 happy path) — it does not oscillate build↔review until the cap.

## Story 4 — the outcome is auditable and idempotent

As the audit trail, I distinguish a productive kickback from a no-op one, and the guards are
deterministic under re-evaluation.

### Happy Path

- **Given** a build-after-kickback,
- **When** it ends,
- **Then** the audit event records `did-work (commits N..M / resolved +K)` vs
  `derived-already-complete`, and any escalation HALT reason states the unchanged input.

### Negative Path — repeated evaluation is stable

- **Given** identical on-disk state (same stamps, same verdict, same head sha),
- **When** the route-into-no-op guard (Story 2) or the escalation classifier (Story 3) is evaluated
  more than once,
- **Then** it yields the same decision every time and writes the HALT marker at most once (no
  duplicate PRs, no counter drift).

### Negative Path — escalation disabled reverts to prior behaviour

- **Given** `kickback_escalation.enabled: false` in config,
- **When** a zero-work + unchanged-verdict kickback occurs,
- **Then** the engine re-kicks up to `MAX_KICKBACKS_PER_GATE` exactly as before this change (exact
  revert; Story 2's route-into-no-op guard, being fail-closed correctness, still applies).
