**Status:** Accepted

# Stories: Contradiction-check auto-park against completion evidence

Technical track (no PRD) · Tier S · intake jstoup111/ai-conductor#612
Source of intent: intake #612 ("Auto-park ignores completion evidence: 5/5 build
parked as 'empty/missing plan'").

Root cause (verified): the daemon-gated auto-park block
(`src/conductor/src/engine/conductor.ts:2193-2225`) derives `emptyPlan` from the
completion-gate reason string alone and passes it to `checkAndAutoPark`
(`src/conductor/src/engine/daemon-auto-park.ts:48-56`) as an immediate-park
reason, with no cross-check against completion evidence the engine already holds
at that point (`resolvedTasksAfter` at `conductor.ts:2147`, in-memory
`taskEvidence.evidenceStamps`, and the run's own `.pipeline/summary.json`
`tasks_completed`). On 2026-07-13 a 5/5-completed build (summary.json
`tasks_completed: 5`, commits f28e2d26..8485b161) was parked as
`empty/missing plan` off a false gate signal (#578).

---

## Story 1: A build with completed-task evidence is never parked as empty/missing plan

**Requirement:** intake #612 desired outcome 1 (a build whose own run evidence
shows completed work is never parked with reason `empty/missing plan`).

As the daemon build loop, I want the empty/missing-plan park verdict to be
contradiction-checked against the completion evidence already in scope so that a
false "no tasks in plan" signal can never convert a build with completed work
into a terminal park.

### Acceptance Criteria

#### Happy Path
- Given a daemon build gate miss whose gate reason matches the empty-plan
  grammar (`plan is empty` / `no tasks in plan` / `plan file not found`), and
  the run's `.pipeline/summary.json` parses with `tasks_completed > 0`, when
  the auto-park block evaluates, then `checkAndAutoPark` is NOT invoked with
  the immediate reason `empty/missing plan` (no park marker with that reason is
  written) and the run proceeds on the existing retry/stall path.
- Given the same gate miss and an in-memory task-evidence sidecar with at least
  one evidence stamp (even when `summary.json` is missing), when the auto-park
  block evaluates, then the empty-plan park is likewise refused.
- Given the same gate miss and `resolvedTasksAfter > 0` from `task-status.json`
  (even when both other signals are empty), when the auto-park block evaluates,
  then the empty-plan park is likewise refused.
- The three signals are checked deterministically (file reads + in-memory
  state) — no LLM dispatch is involved in the refusal decision.

#### Negative Path
- Given the empty-plan gate reason and ALL three signals empty/zero
  (`summary.json` absent or `tasks_completed: 0`, no evidence stamps,
  `resolvedTasksAfter === 0`), when the auto-park block evaluates, then the
  park fires with reason `empty/missing plan` exactly as today (marker written,
  `auto_park` event emitted, HALT marker text unchanged).
- Given a corrupt or unparseable `.pipeline/summary.json` (session-authored
  file), when the guard reads it, then the read resolves to 0 completed tasks
  (tolerant parse — no throw, no crash of the build loop) and contributes no
  contradiction on its own.

## Story 2: A refused park is loud and names its evidence

**Requirement:** intake #612 desired outcome 2 (the engine refuses the park,
logs the contradiction loudly, naming both the verdict and the contradicting
evidence source).

As the operator reading `.daemon/daemon.log`, I want a refused empty-plan park
to emit a distinct, loud event naming the refused verdict and the contradicting
evidence so that the contradiction is diagnosable after the fact instead of
silent.

### Acceptance Criteria

#### Happy Path
- Given a refusal per Story 1, when it fires, then a new
  `auto_park_contradiction` event is emitted carrying the slug, the refused
  verdict (`empty/missing plan`), and the contradicting evidence counts (e.g.
  `summaryTasksCompleted`, `evidenceStamps`, `resolvedTasks`).
- Given the daemon event log rendering, when the event is emitted, then a
  human-readable line appears in the daemon log naming the refused verdict and
  the non-zero evidence source(s) — greppable by `auto_park_contradiction` or
  an equivalent stable token.

#### Negative Path
- Given a genuine empty-plan park (Story 1 negative path), when it fires, then
  NO `auto_park_contradiction` event is emitted — the event fires only on
  actual refusals.

## Story 3: Zero-progress counter park is unchanged

**Requirement:** intake #612 negative-path outcome (a genuinely empty/missing
plan still auto-parks exactly as today) generalized to the sibling counter path.

As the daemon, I want the durable no-evidence counter park (`no completion
evidence after N attempts`, `daemon-auto-park.ts:51-55`) to be untouched by the
contradiction guard so that genuinely stuck builds still park at the existing
threshold.

### Acceptance Criteria

#### Happy Path
- Given a build whose empty-plan park was refused by the contradiction guard,
  when subsequent attempts make zero progress and the durable
  `noEvidenceAttempts` counter reaches the threshold, then `checkAndAutoPark`
  parks with reason `no completion evidence after N attempts` exactly as today
  (the guard strips only the immediate empty-plan reason; it does not exempt
  the feature from parking).

#### Negative Path
- Given a non-daemon (interactive) run, when the guard code path is reached,
  then behavior is unchanged from today (`checkAndAutoPark` still never parks
  interactive runs; the guard introduces no interactive-mode side effects).
