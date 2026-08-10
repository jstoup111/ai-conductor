**Status:** Accepted

# Stories: Acceptance-specs RED evidence visibility and completion-wait discrimination (#1246)

Technical track (no PRD). Acceptance criteria derive from the technical intent and the two APPROVED
ADRs, `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` and
`adr-2026-08-09-recorded-red-exception-for-remediation`.

Terms used throughout:

- **RED marker** — `.pipeline/acceptance-specs-red.json` at the worktree root, the path the
  `acceptance_specs` gate reads (`artifacts.ts:2041`).
- **Run contract** — `.pipeline/acceptance-specs-run.json` = `{ command, cwd, targetSpecs }`.
- **Legacy marker** — a RED marker carrying only the fields today's validator requires
  (`executed`/`passed`/`failed`/`skipped`/`errors`, `command`, `targetSpecs`) and none of the
  provenance fields this feature adds.
- **Provenance fields** — `failingTests` (per-test identity and failure reason), `ranAt`,
  `intentRationale`.
- **Exception** — the structured remediation waiver recorded in the marker.

Requirement ids `T-1`…`T-6` are the intake's six desired outcomes.

---

## Story 1: RED evidence records which test failed, why, when, and why it is the intended failure

**Requirement:** T-2

As an operator or reviewer auditing an acceptance step, I want the RED marker to carry the identity
and reason of each failing test, when the run happened, and why that failure corresponds to the
behavior the feature is missing, so that `failed >= 1` stops being an anonymous counter I have to
take on trust.

### Acceptance Criteria

#### Happy Path
- Given an acceptance run that failed for the intended reason, when the marker is written, then it
  carries `failingTests` with at least one entry naming the test and its failure reason, a `ranAt`
  timestamp, and a non-empty `intentRationale`, and `validateAcceptanceRedEvidence` accepts it.
- Given a marker carrying all provenance fields and satisfying the existing counter bar
  (`errors == 0`, `skipped == 0`, `executed >= 1`, `failed >= 1`, `artifacts.ts:1276-1299`), when the
  `acceptance_specs` completion gate is evaluated, then the step passes.

#### Negative Paths
- Given a marker with `failed >= 1` but no `failingTests` field, when the marker is validated, then
  the gate reports the step incomplete with a reason naming the missing `failingTests` field, and
  does NOT pass.
- Given a marker whose `failingTests` is an empty array, when the marker is validated, then it is
  rejected — an empty array is absence, not evidence.
- Given a marker whose `intentRationale` is present but empty or whitespace-only, when the marker is
  validated, then it is rejected with a reason naming `intentRationale`.
- Given a marker whose `ranAt` is absent or is not a parseable timestamp, when the marker is
  validated, then it is rejected with a reason naming `ranAt`.
- Given a marker that satisfies every provenance field but shows `skipped > 0`, when the marker is
  validated, then it is still rejected with the existing skipped-specs reason — provenance never
  substitutes for execution.

### Done When
- [ ] `validateAcceptanceRedEvidence` (`src/conductor/src/engine/artifacts.ts:1245`) rejects a
      marker missing any of `failingTests`, `ranAt`, `intentRationale`, each with a reason naming the
      specific missing field.
- [ ] A marker whose `failingTests` is `[]` or whose `intentRationale` is empty/whitespace is
      rejected, not accepted as present.
- [ ] The four pre-existing counter checks (`errors`, `skipped`, `executed`, `failed`) still fire
      with their current reason strings, verified by a test that asserts the exact text.
- [ ] `skills/writing-system-tests/SKILL.md` §6 documents the provenance fields in its marker
      example, and its prose passes `test/test_provider_skill_contracts.sh`.

---

## Story 2: The engine's self-heal run produces the same provenance as the skill's own run

**Requirement:** T-2

As the build engine, I want the RED marker I write during a self-heal to carry the same provenance a
skill-authored marker carries, so that an engine-recovered step is never weaker evidence than a
first-attempt one.

### Acceptance Criteria

#### Happy Path
- Given committed spec files, a valid run contract, and no usable marker, when
  `selfHealAcceptanceRed` (`acceptance-red-runner.ts:195`) executes the contract and the specs fail,
  then the marker it writes at the authoritative worktree root carries `failingTests`, `ranAt`, and
  `intentRationale`, and re-validation passes.
- Given a self-heal run, when the marker is written, then `command` and `targetSpecs` continue to be
  merged in from the contract exactly as they are today, and the authoritative root path is still
  the write target.

#### Negative Paths
- Given a self-heal run whose specs execute but all PASS, when the marker is written and
  re-validated, then the result is rejected with the unchanged `0 failed — RED not established` text
  — the self-heal never fabricates a failure to satisfy its own provenance requirement.
- Given a self-heal run whose command errors at collection (`errors > 0`), when the marker is
  written, then it records the real counters and is rejected with the existing collection-error
  reason, never with a provenance reason that would misdescribe the failure.
- Given a self-heal run that cannot determine per-test identity from the runner's output, when the
  marker is written, then the step fails with a reason stating that failing-test detail could not be
  extracted — it does NOT write a placeholder entry that would pass validation.

### Done When
- [ ] A self-healed marker and a skill-authored marker are accepted or rejected by the identical
      validator path, verified by a test that runs both through `validateAcceptanceRedEvidence`.
- [ ] A self-heal over a passing suite still fails the gate with the exact existing reason text.
- [ ] No code path writes a synthesized/placeholder `failingTests` entry; a test asserts the
      extraction-failure branch reports rather than fabricates.

---

## Story 3: The RED lifecycle is visible on the event spine while the step runs

**Requirement:** T-1

As an operator watching a running `acceptance_specs` step, I want its RED-evidence state published on
the event spine as it changes, so that I can see whether evidence is required, still pending,
satisfied, or refused without waiting for the step to end.

### Acceptance Criteria

#### Happy Path
- Given an `acceptance_specs` step begins, when the step path dispatches, then an `acceptance_red`
  event with `state: 'required'` is emitted through the existing `ConductorEventEmitter` and is
  readable in `.pipeline/events.jsonl`.
- Given the dispatched session has returned but the gate has not yet been satisfied, when the step
  path reaches its completion check, then an `acceptance_red` event with `state: 'pending'` is
  emitted.
- Given the gate accepts the marker, when the verdict is reached, then an `acceptance_red` event with
  `state: 'satisfied'` is emitted.
- Given the gate refuses the marker, when the verdict is reached, then an `acceptance_red` event with
  `state: 'rejected'` is emitted carrying the gate's own `reason` string.

#### Negative Paths
- Given the RED lifecycle needs to be observed, when the implementation is reviewed, then no new
  ledger file, sidecar, poller, or watcher was introduced — the events ride
  `ConductorEventEmitter → EventPersister → .pipeline/events.jsonl` and no consumer had to be taught
  a second reader path.
- Given a step that is refused twice within one feature, when the ledger is read, then both
  `rejected` events are present with their distinct reasons — a later verdict never overwrites or
  suppresses an earlier one.
- Given event emission fails or the ledger is unwritable, when the step runs, then step execution and
  the gate verdict are unaffected — telemetry never changes whether the step passes.
- Given a consumer that checks only `state === 'satisfied'`, when a waived pass occurs, then that
  consumer still receives the separate `viaException` flag on the same event rather than a
  distinguishing fifth state it would ignore.

### Done When
- [ ] An `acceptance_red` variant exists on the `ConductorEvent` union
      (`src/conductor/src/types/events.ts`), appended at the END of the union, carrying `state`
      (`required | pending | satisfied | rejected`), optional `reason`, optional failing-test detail,
      and a separate `viaException` boolean.
- [ ] A test drives one full acceptance step and asserts the emitted state sequence in
      `.pipeline/events.jsonl`.
- [ ] `grep` over the diff shows no new `.jsonl` ledger, sidecar file, watcher, or poller added for
      this concern.
- [ ] A test asserts a failed event write leaves the gate verdict unchanged.

---

## Story 4: A green acceptance suite is refused and is never reported as a proven lifecycle

**Requirement:** T-3

As the build engine, I want a suite that is already green before qualifying RED evidence exists to be
refused explicitly and reported as refused, so that a step which never demonstrated RED cannot
present itself as successfully proven.

### Acceptance Criteria

#### Happy Path
- Given a marker showing `failed == 0` with no exception recorded, when the gate is evaluated, then
  the step is incomplete, the reason is the unchanged `acceptance-specs RED run shows 0 failed — RED
  not established; the generated specs must FAIL before implementation`, and an `acceptance_red`
  event with `state: 'rejected'` carrying that reason is emitted.
- Given that refusal, when the operator reads the live status surface, then it shows the RED state as
  refused together with the reason, rather than showing the step as progressing normally.

#### Negative Paths
- Given a green run with no exception, when any code path evaluates the step, then no event with
  `state: 'satisfied'` is emitted for it — the lifecycle is never presented as proven.
- Given a green run whose marker carries complete provenance fields, when the gate is evaluated, then
  it is still refused — provenance describes a run, it does not establish RED.
- Given a green run, when the step retries, then each attempt emits its own `rejected` event rather
  than falling silent after the first refusal.

### Done When
- [ ] A test asserts that a `failed == 0` marker with no exception yields the exact existing reason
      string, unchanged.
- [ ] A test asserts no `state: 'satisfied'` event is emitted anywhere in a green-without-exception
      run.
- [ ] The live status surface renders the refused state and its reason.

---

## Story 5: A remediation waiver of the RED requirement is recorded, attributable and observable

**Requirement:** T-6

As an operator reviewing a remediation, I want any exception to the normal RED requirement to be
recorded in the evidence and reported as a waiver, so that a legitimate combined test-and-production
remediation is distinguishable from a silent one and can be audited afterwards.

### Acceptance Criteria

#### Happy Path
- Given a marker with `failed == 0` that carries a well-formed exception (`kind: 'remediation'`, a
  non-empty `reason`, and attribution), when the gate is evaluated, then the step passes and an
  `acceptance_red` event with `state: 'satisfied'` and `viaException: true` is emitted.
- Given a waived pass, when the operator reads the live status surface or the ledger, then the pass is
  presented as waived, never as proven RED.
- Given the shipped remediation contract, when a remediation will combine acceptance and production
  changes, then `skills/remediate/SKILL.md` instructs it to declare the exception rather than perform
  the combination silently, in provider-neutral prose.

#### Negative Paths
- Given a marker with `failed == 0` and an exception whose `reason` is empty or whitespace-only, when
  the gate is evaluated, then the step is refused — a malformed exception is no exception.
- Given a marker with `failed == 0` and an exception missing its attribution, when the gate is
  evaluated, then the step is refused with a reason naming the missing field.
- Given a marker with `failed == 0`, a well-formed exception, and `skipped > 0`, when the gate is
  evaluated, then the step is refused — the exception waives the RED requirement, never the
  execution requirements (`errors == 0`, `skipped == 0`, `executed >= 1`).
- Given a marker with `failed == 0`, a well-formed exception, and `executed == 0`, when the gate is
  evaluated, then the step is refused with the existing executed-zero reason.
- Given a marker with an exception whose `kind` is an unrecognized value, when the gate is evaluated,
  then it is refused rather than treated as a generic waiver.
- Given a marker with `failed >= 1` that also carries an exception, when the gate is evaluated, then
  the step passes on its genuine RED evidence and `viaException` is NOT set — an unnecessary
  exception never launders a real pass into a waived one.

### Done When
- [ ] `validateAcceptanceRedEvidence` accepts `failed == 0` only with a well-formed exception, and a
      test covers each malformed shape (empty reason, missing attribution, unknown kind).
- [ ] Tests assert `errors`, `skipped`, and `executed` checks still fire in the presence of a valid
      exception.
- [ ] A test asserts `viaException` is false when the marker carries genuine RED evidence.
- [ ] `skills/remediate/SKILL.md` states the declaration obligation and passes
      `test/test_provider_skill_contracts.sh`.
- [ ] A `HARNESS.md` rule records the remediation RED-exception obligation for consumer projects.

---

## Story 6: Live status distinguishes active work from a completion wait and names the unmet condition

**Requirement:** T-4, T-5

As an operator deciding whether to wait, park, or intervene, I want the per-step status line to tell
me whether the step is actively working or waiting on a completion condition, and — when waiting —
exactly which condition is unmet, so that a wedged step and a busy step stop looking identical.

### Acceptance Criteria

#### Happy Path
- Given a running step whose heartbeat belongs to the current dispatch
  (`heartbeatBelongsToDispatch`) and is fresh (`classifyHeartbeatAge`), when the operator runs the
  daemon status surface, then the step renders as `working` with its heartbeat age, elapsed step
  time, last meaningful action, and last test outcome.
- Given a step whose dispatch has returned but whose completion gate has not passed, when the
  operator runs the status surface, then the step renders as `waiting` and prints the completion
  predicate's own `reason` string (`artifacts.ts:752`) as the unresolved condition.
- Given a step whose gate is then satisfied, when the operator runs the status surface, then the step
  no longer renders as waiting — it closes.

#### Negative Paths
- Given active child work cannot be observed (out of scope, deferred to
  `jstoup111/ai-conductor#1441`), when the status line renders, then the child count reads `unknown`
   — never `0` and never any other fabricated number.
- Given a heartbeat file left behind by a PREVIOUS dispatch, when the status surface classifies the
  current step, then the leftover heartbeat is treated as "no heartbeat yet" and the step is NOT
  reported as stalled, preserving the existing `heartbeatBelongsToDispatch` guarantee.
- Given no heartbeat file exists yet because the dispatch just started, when the status surface
  renders, then the step shows as working-with-no-telemetry-yet rather than stale or waiting.
- Given the completion predicate returns no `reason` string, when the step is waiting, then the
  status line states that the unresolved condition is unavailable rather than printing an empty or
  misleading condition.
- Given the event ledger is missing or unreadable, when the status surface renders, then it degrades
  to the information it can read and does not throw or block the status command.

### Done When
- [ ] The per-step line in `src/conductor/src/engine/daemon-dashboard.ts` renders a `working` /
      `waiting` classification plus elapsed step time, heartbeat age, last meaningful action, last
      test outcome, and RED state.
- [ ] When waiting, the rendered line contains the completion predicate's `reason` text verbatim.
- [ ] A test asserts the child-count field renders the literal `unknown`, and that no code path can
      render `0` for it.
- [ ] A test asserts a stale leftover heartbeat from a prior dispatch does not produce a stalled or
      waiting classification.
- [ ] A test asserts an unreadable ledger degrades the line rather than failing the status command.

---

## Story 7: Existing markers are recovered by re-running, not by grandfathering or hard-failing

**Requirement:** T-2

As an operator with features already in flight, I want a marker written before this change to be
recovered automatically, so that tightening the validator does not halt work that was progressing
correctly.

### Acceptance Criteria

#### Happy Path
- Given an in-flight feature whose worktree holds a legacy marker and a valid run contract, when the
  `acceptance_specs` gate is next evaluated, then the marker reads as invalid, the existing
  self-heal path (`conductor.ts:5311-5343`) re-executes the run contract once for that attempt, a
  fresh marker with provenance fields is written, and the step proceeds without operator action.
- Given that recovery, when the ledger is read, then the lifecycle events show the refusal and the
  subsequent satisfaction, so the extra run is visible rather than silent.

#### Negative Paths
- Given a legacy marker, when the gate is evaluated, then the step does NOT pass on the legacy
  marker's counters alone — grandfathering is not implemented, and a test asserts a legacy marker
  never satisfies the validator.
- Given a legacy marker, when the gate is evaluated, then the step does NOT halt with a
  fix-it-yourself diagnostic — the recovery is automatic.
- Given a legacy marker and NO valid run contract in the worktree, when the gate is evaluated, then
  the step fails with the existing `run contract missing` reason — the same failure as today, not a
  new one introduced by this change.
- Given the self-heal has already run once for this step attempt, when the gate is re-evaluated in
  the same attempt, then it is NOT re-executed a second time, preserving the once-per-attempt
  guarantee.

### Done When
- [ ] A test drives a legacy marker plus a valid run contract through the step and asserts a fresh
      provenance-bearing marker is produced without a halt.
- [ ] A test asserts a legacy marker alone never satisfies `validateAcceptanceRedEvidence`.
- [ ] A test asserts a legacy marker with no run contract produces the existing
      `run contract missing` reason text unchanged.
- [ ] A test asserts the once-per-attempt self-heal guarantee is preserved.

---

## Story 8: The recovery seam reaches a refused marker, and never erases a recorded waiver

**Requirement:** T-2, T-6

As the build engine, I want the self-heal to be reachable when the validator refuses a marker's
shape, and to carry forward a declaration it did not produce, so that the recovery path in Story 7
actually fires and the waiver in Story 5 survives it.

Added by conflict-check (`.docs/conflicts/acceptance-specs-hide-missing-red-evidence-and-com.md`,
Conflicts 1 and 2), which found that the shipped guard matches only two of the completion
predicate's three failure shapes, and that the self-heal writes the marker wholesale.

### Acceptance Criteria

#### Happy Path
- Given a marker the validator refuses for a **shape** defect — missing or empty `failingTests`,
  `ranAt`, `intentRationale`, `command` or `targetSpecs`, or non-numeric counters — when the
  `acceptance_specs` step evaluates completion, then the self-heal fires and re-executes the run
  contract, rather than falling through to a skill re-dispatch.
- Given a root marker carrying a well-formed exception, when a self-heal re-executes the contract
  and writes a fresh marker, then the exception is carried forward onto the new marker while the
  counters come from the fresh run.
- Given a self-heal re-execution, when the fresh marker is written, then `command` and `targetSpecs`
  still come from the run contract and the write still lands at the authoritative worktree-root
  path, unchanged from `adr-2026-07-21-engine-owned-acceptance-red-execution`.

#### Negative Paths
- Given a marker refused because the run reported a real **outcome** — `failed == 0`, `skipped > 0`,
  or `errors > 0` — when the step evaluates completion, then the self-heal does NOT fire, because
  re-running cannot change an outcome that was already observed; the step reports that outcome's
  existing reason.
- Given a marker refused for a shape defect but with NO committed spec files, when the step
  evaluates completion, then the self-heal still does not fire — the existing spec-files
  precondition is unchanged.
- Given no exception exists on the prior marker, when a self-heal writes a fresh marker, then no
  exception field is invented on it.
- Given a prior marker carrying a MALFORMED exception, when a self-heal writes a fresh marker, then
  the malformed exception is not laundered into a well-formed one — it is carried forward as-is or
  dropped, and either way the resulting marker is refused by the validator.
- Given a self-heal fires on a shape defect and the re-executed run also produces a shape-defective
  marker, when completion is re-evaluated, then the step reports and falls through to the existing
  retry path — the self-heal does not re-fire within the same step run, preserving the
  once-per-step-run guarantee at `conductor.ts:5356`.

### Done When
- [ ] The guard at `src/conductor/src/engine/conductor.ts:5326-5333` no longer decides reachability
      by substring-matching the reason text; it fires on missing marker, unparseable JSON, and
      shape-class validator refusals, and does not fire on outcome-class refusals.
- [ ] `validateAcceptanceRedEvidence` distinguishes shape-class from outcome-class refusals in a way
      the guard can consume without re-parsing prose, verified by a test over every refusal branch.
- [ ] `selfHealAcceptanceRed` (`acceptance-red-runner.ts:249-258`) reads any existing root marker and
      carries its `exception` forward onto the marker it writes; a test asserts a recorded exception
      survives a re-execution and that counters still come from the fresh run.
- [ ] A test asserts no exception is invented when none was recorded.
- [ ] A test asserts an outcome-class refusal does not trigger a re-run.
