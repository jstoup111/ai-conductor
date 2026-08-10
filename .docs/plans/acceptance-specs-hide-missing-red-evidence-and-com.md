# Implementation Plan: Acceptance-specs RED evidence visibility and completion-wait discrimination (#1246)

**Date:** 2026-08-09
**Stories:** `.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md`
**Conflict check:** Clean as of 2026-08-09

## Summary

Makes the `acceptance_specs` RED lifecycle observable and its evidence auditable: 22 tasks that add
an `acceptance_red` variant to the `ConductorEvent` union, give the RED marker provenance and a
recorded remediation waiver, widen the self-heal guard so it can actually reach a refused marker,
and render a per-step status line that tells an operator whether the step is working or waiting and
on what.

## Technical Approach

The keystone is **refusal classification**. `validateAcceptanceRedEvidence`
(`src/conductor/src/engine/artifacts.ts:1245`) currently returns `{ ok: false, reason: string }`, and
the self-heal guard in `src/conductor/src/engine/conductor.ts:5326-5333` decides reachability by
substring-matching that prose. Every other change depends on that seam being fixed first, so Task 1
gives the validator a machine-readable refusal **class** — `shape` (the marker is malformed or
incomplete; re-running could fix it) versus `outcome` (the run reported a real result; re-running
cannot change it) — and the guard consumes the class instead of the prose.

With that in place the work splits into four independent tracks that converge at the end:

- **Evidence (Tasks 2-8).** Provenance fields (`failingTests`, `ranAt`, `intentRationale`) become
  required, and a well-formed `exception` becomes the only way `failed == 0` passes. Execution
  requirements (`errors == 0`, `skipped == 0`, `executed >= 1`) are never waived.
- **Telemetry (Tasks 9-12).** The `acceptance_red` variant is appended at the **end** of the
  `ConductorEvent` union — 242 open spec branches touch `src/conductor/src/types/events.ts` and it is
  the only contended surface in this change, so appending keeps the rebase conflict to one adjacent
  line. Emission is best-effort and never changes a verdict.
- **Recovery (Tasks 13-17, 22).** The guard widens to shape-class refusals, and
  `selfHealAcceptanceRed` gains a read-before-write so a recorded exception survives re-execution.
  Ownership rule: the exec result owns observed counters; a recorded declaration survives. The
  once-per-step-run guarantee at `conductor.ts:5356` is preserved throughout, and Task 22 pins the
  legacy-marker recovery end to end including its honest no-contract degradation.
- **Surface and contracts (Tasks 18-21).** The dashboard line gains `working`/`waiting`, the unmet
  condition, and a child count that renders the literal `unknown`. The two shipped `SKILL.md` files
  and `HARNESS.md` record the new obligations.

**Documentation note.** `docs/explanation/gates.md`, `docs/guides/running-the-daemon.md` and
`docs/reference/steps.md` are owned by this repository's gating `maintain-documentation` custom step
(`.ai-conductor/config.yml:114-119`, runs after `rebase`), so they are deliberately not plan tasks.
`HARNESS.md` is not ordinary documentation — it is a behavioral contract consumed by the engine and
by every dispatched agent — so Task 21 carries it.

## Prerequisites

- None. No migration, no new dependency, no infrastructure. Every surface exists today.
- Every task runs `test/test_harness_integrity.sh` before its commit (repository rule). Tasks 19 and
  20 additionally run `test/test_provider_skill_contracts.sh`.

## Tasks

### Task 1: Classify validator refusals as shape or outcome
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing test: `validateAcceptanceRedEvidence` returns `class: 'shape'` for a marker missing `command`, and `class: 'outcome'` for a marker with `failed: 0`.
2. Verify test fails (RED)
3. Implement: extend the failure result type with a `class` discriminant and set it on every existing refusal branch — non-object, non-numeric counters, missing `command`, missing `targetSpecs` are `shape`; `errors > 0`, `skipped > 0`, `executed < 1`, `failed < 1` are `outcome`.
4. Verify test passes (GREEN)
5. Commit with message: "classify acceptance RED validator refusals as shape or outcome"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — refusal result type and every refusal branch

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 2: Require failing-test identity on the RED marker
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a marker carrying `failingTests: [{ name, reason }]` plus the existing counters validates ok; one with no `failingTests` key is refused with a shape-class reason naming the field.
2. Verify test fails (RED)
3. Implement: add the `failingTests` requirement to `validateAcceptanceRedEvidence` with a shape-class refusal.
4. Verify test passes (GREEN)
5. Commit with message: "require failingTests identity on acceptance RED evidence"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

---

### Task 3: Reject an empty failingTests array
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a marker with `failingTests: []` is refused (shape class), and a marker with one entry missing its per-test `reason` is refused.
2. Verify test fails (RED)
3. Implement: require a non-empty array whose every entry carries a non-empty test name and reason.
4. Verify test passes (GREEN)
5. Commit with message: "reject empty or incomplete failingTests as absence, not evidence"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 2

---

### Task 4: Require a parseable ranAt timestamp
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a marker with no `ranAt`, and one whose `ranAt` is not a parseable timestamp, are both refused with a shape-class reason naming `ranAt`.
2. Verify test fails (RED)
3. Implement: add the `ranAt` requirement with parse validation.
4. Verify test passes (GREEN)
5. Commit with message: "require a parseable ranAt on acceptance RED evidence"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 2

---

### Task 5: Require a non-empty intentRationale
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a marker with no `intentRationale`, and one whose value is empty or whitespace-only, are both refused with a shape-class reason naming the field.
2. Verify test fails (RED)
3. Implement: add the requirement, trimming before the emptiness check.
4. Verify test passes (GREEN)
5. Commit with message: "require a non-empty intentRationale on acceptance RED evidence"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 2

---

### Task 6: Preserve every existing counter refusal and its exact text
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: assert the exact current reason strings for `errors > 0`, `skipped > 0`, `executed < 1` and `failed < 1`, including on a marker that satisfies every provenance field.
2. Verify test fails (RED) — the assertions pin text the provenance work must not disturb.
3. Implement: adjust ordering so provenance checks never mask an outcome-class refusal, leaving the four reason strings byte-identical.
4. Verify test passes (GREEN)
5. Commit with message: "pin existing acceptance RED counter refusal texts against provenance changes"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

---

### Task 7: Accept failed==0 only with a well-formed exception
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: a marker with `failed: 0` plus `exception: { kind: 'remediation', reason, attribution }` validates ok; the same marker without the exception keeps the unchanged `0 failed — RED not established` refusal.
2. Verify test fails (RED)
3. Implement: gate the `failed < 1` refusal on the absence of a well-formed exception.
4. Verify test passes (GREEN)
5. Commit with message: "accept a waived acceptance RED run only with a recorded exception"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

---

### Task 8: Refuse malformed exceptions and never waive execution
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: with `failed: 0`, each of an empty `reason`, a missing `attribution`, and an unrecognized `kind` is refused; and with a well-formed exception, `skipped > 0`, `errors > 0` and `executed == 0` are each still refused with their existing texts. Also assert a marker with `failed >= 1` and an exception passes on genuine RED.
2. Verify test fails (RED)
3. Implement: validate the exception's shape strictly, and keep the execution checks ahead of the waiver.
4. Verify test passes (GREEN)
5. Commit with message: "refuse malformed RED exceptions; a waiver never waives execution"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — validator

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

---

### Task 9: Add the acceptance_red variant at the end of the event union
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: a type-level and runtime test constructing an `acceptance_red` event with `state: 'required'` and asserting it is assignable to `ConductorEvent` and round-trips through the persister.
2. Verify test fails (RED)
3. Implement: append the variant at the END of the union — `state: 'required' | 'pending' | 'satisfied' | 'rejected'`, `step`, optional `reason`, optional failing-test detail, and a separate `viaException` boolean.
4. Verify test passes (GREEN)
5. Commit with message: "add acceptance_red lifecycle variant to the ConductorEvent union"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — union member appended at the end

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** none

---

### Task 10: Emit required and pending around the acceptance dispatch
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: driving the `acceptance_specs` step emits `state: 'required'` before dispatch and `state: 'pending'` once the dispatch has returned with the gate unsatisfied.
2. Verify test fails (RED)
3. Implement: emit at both points in the step path.
4. Verify test passes (GREEN)
5. Commit with message: "emit acceptance_red required and pending around the step dispatch"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — acceptance_specs step path

**Wired-into:** same as Task 9
**Dependencies:** Task 9

---

### Task 11: Emit satisfied and rejected at the gate verdict
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: an accepted marker emits `state: 'satisfied'`; a refused one emits `state: 'rejected'` carrying the gate's own reason; a waived pass emits `satisfied` with `viaException: true`.
2. Verify test fails (RED)
3. Implement: emit at the verdict, carrying reason and the waiver flag.
4. Verify test passes (GREEN)
5. Commit with message: "emit acceptance_red verdict states with reason and waiver flag"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — acceptance_specs verdict path

**Wired-into:** same as Task 9
**Dependencies:** Task 10

---

### Task 12: Keep telemetry failure from changing a verdict, and never suppress a repeat
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: with an emitter that throws, the step's verdict is unchanged; and two refusals within one feature both appear in the ledger with their distinct reasons.
2. Verify test fails (RED)
3. Implement: wrap emission best-effort and confirm no de-duplication suppresses a later verdict.
4. Verify test passes (GREEN)
5. Commit with message: "make acceptance_red emission best-effort and non-suppressing"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — emission sites

**Wired-into:** same as Task 9
**Dependencies:** Task 11

---

### Task 13: Make the self-heal guard consume the refusal class
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing test: a marker refused for a shape defect (valid JSON, missing `intentRationale`) reaches the self-heal; today's substring guard does not fire on it.
2. Verify test fails (RED)
3. Implement: replace the reason substring match with missing-marker, unparseable-JSON, or shape-class refusal.
4. Verify test passes (GREEN)
5. Commit with message: "gate acceptance RED self-heal on refusal class, not reason prose"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — self-heal guard
- `src/conductor/src/engine/artifacts.ts` — expose the class to the completion result

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

---

### Task 14: Keep the self-heal from firing on a real observed outcome
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: markers refused for `failed == 0`, `skipped > 0` and `errors > 0` do NOT trigger a re-run; a shape-class refusal with no committed spec files also does not; and the once-per-step-run guarantee still holds.
2. Verify test fails (RED)
3. Implement: restrict the widened guard to shape class, leaving the spec-files precondition and the `acceptanceRedPreHealed` flag untouched.
4. Verify test passes (GREEN)
5. Commit with message: "never re-run acceptance specs to relearn an outcome already recorded"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — self-heal guard

**Wired-into:** same as Task 13
**Dependencies:** Task 13

---

### Task 15: Produce provenance from the engine's own self-heal run
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a self-heal over a failing suite writes a marker carrying `failingTests`, `ranAt` and `intentRationale`, at the authoritative worktree-root path, and re-validation passes.
2. Verify test fails (RED)
3. Implement: extract per-test identity and reason from the exec result and stamp `ranAt`; keep `command`/`targetSpecs` merged from the contract.
4. Verify test passes (GREEN)
5. Commit with message: "produce RED provenance from the engine self-heal run"

**Files likely touched:**
- `src/conductor/src/engine/acceptance-red-runner.ts` — marker composition

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 5

---

### Task 16: Carry a recorded exception forward across re-execution
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing test: with a root marker carrying a well-formed exception, a self-heal re-execution writes fresh counters while the exception survives; with no prior exception none is invented; a malformed prior exception is not repaired into a valid one.
2. Verify test fails (RED)
3. Implement: read the existing root marker before writing and carry `exception` forward — exec result owns counters, the contract owns `command`/`targetSpecs`, the prior declaration survives.
4. Verify test passes (GREEN)
5. Commit with message: "preserve a recorded RED exception across self-heal re-execution"

**Files likely touched:**
- `src/conductor/src/engine/acceptance-red-runner.ts` — read-before-write in the marker path

**Wired-into:** same as Task 15
**Dependencies:** Task 15

---

### Task 17: Report rather than fabricate when failing-test identity cannot be extracted
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: given exec output from which per-test identity cannot be parsed, the self-heal returns a failure naming that, writes no placeholder `failingTests` entry, and a green or collection-errored run still fails with its existing reason text.
2. Verify test fails (RED)
3. Implement: return a specific extraction-failure reason instead of synthesizing an entry.
4. Verify test passes (GREEN)
5. Commit with message: "report unextractable RED failing-test identity instead of fabricating it"

**Files likely touched:**
- `src/conductor/src/engine/acceptance-red-runner.ts` — extraction path

**Wired-into:** same as Task 15
**Dependencies:** Task 16

---

### Task 18: Classify a running step as working or waiting
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a step whose heartbeat belongs to the current dispatch and is fresh renders `working`; one whose dispatch has returned with the gate unsatisfied renders `waiting`; a leftover heartbeat from a prior dispatch renders neither stalled nor waiting.
2. Verify test fails (RED)
3. Implement: derive the classification using the existing `heartbeatBelongsToDispatch` and `classifyHeartbeatAge` — do not reimplement either.
4. Verify test passes (GREEN)
5. Commit with message: "classify a running step as working or waiting in daemon status"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — per-step entry and its renderer

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** Task 11

---

### Task 19: Render the unmet condition and the RED state on the step line
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a waiting step's line contains the completion predicate's reason text verbatim plus elapsed step time, heartbeat age, last meaningful action, last test outcome and RED state; when no reason is available the line says the condition is unavailable rather than printing an empty one.
2. Verify test fails (RED)
3. Implement: read the ledger's latest `acceptance_red` state and the completion reason into the rendered line.
4. Verify test passes (GREEN)
5. Commit with message: "render the unmet completion condition and RED state on the step line"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — per-step line rendering

**Wired-into:** same as Task 18
**Dependencies:** Task 18

---

### Task 20: Render child count as unknown, and degrade on an unreadable ledger
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: the child-count field renders the literal `unknown` and no input renders `0`; and with a missing or unreadable event ledger the line degrades to what it can read without throwing or failing the status command.
2. Verify test fails (RED)
3. Implement: hard-code the unknown child count with a comment citing `jstoup111/ai-conductor#1441`, and wrap ledger reads tolerantly.
4. Verify test passes (GREEN)
5. Commit with message: "render unknown child count and degrade on an unreadable ledger"

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — per-step line rendering

**Wired-into:** same as Task 18
**Dependencies:** Task 19

---

### Task 21: Record the new obligations in the shipped contracts
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: `test/test_provider_skill_contracts.sh` and `test/test_harness_integrity.sh` both pass over the edited contracts.
2. Verify test fails (RED) — pin the current state first so a provider-neutrality regression is visible.
3. Implement: document the provenance fields in the `writing-system-tests` marker example and gating prose; state the exception-declaration obligation on the `remediate` acceptance_specs disposition; add the `HARNESS.md` rule that a remediation waiver of the RED requirement must be recorded, attributable and reported as waived. Keep every line provider-neutral.
4. Verify test passes (GREEN)
5. Commit with message: "record RED provenance and the remediation waiver obligation in shipped contracts"

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — marker example and gating prose
- `skills/remediate/SKILL.md` — acceptance_specs disposition obligation
- `HARNESS.md` — the remediation RED-exception rule

**Wired-into:** none (no new production surface)
**Dependencies:** Task 17

---

### Task 22: Recover a legacy marker end to end, and degrade honestly without a contract
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: a worktree holding a legacy counters-only marker plus a valid run contract advances without operator action and ends with a provenance-bearing marker; a legacy marker alone never satisfies the validator; a legacy marker with NO run contract fails with the existing `run contract missing` reason text; and the re-run is visible as a refusal followed by a satisfaction in the ledger.
2. Verify test fails (RED)
3. Implement: whatever branch work the assertions expose — in particular that the no-contract path still reports the pre-existing reason rather than a new one introduced by the widened guard.
4. Verify test passes (GREEN)
5. Commit with message: "recover a legacy acceptance RED marker by re-run, degrading honestly with no contract"

**Files likely touched:**
- `src/conductor/src/engine/acceptance-red-runner.ts` — no-contract reason path
- `src/conductor/src/engine/conductor.ts` — recovery path through the widened guard

**Wired-into:** same as Task 15
**Dependencies:** Task 16

## Task Dependency Graph

```
Task 1 (refusal classification — keystone)
 ├─ Task 2 → Task 3
 │        ├─ Task 4
 │        └─ Task 5 → Task 6 → Task 7 → Task 8
 │                     └─ Task 15 → Task 16 → Task 17 → Task 21
 │                                        └─ Task 22
 └─ Task 13 → Task 14

Task 9 (event variant — independent, land early)
 └─ Task 10 → Task 11 → Task 12
              └─ Task 18 → Task 19 → Task 20
```

## Integration Points

- **After Task 8** — the gate's full evidence contract is testable end to end: provenance required,
  waiver accepted only when well-formed, execution never waived.
- **After Task 12** — the whole RED lifecycle is readable from `.pipeline/events.jsonl` for a real
  step run.
- **After Task 17** — recovery is complete: a legacy marker re-runs, a waiver survives it, and an
  unparseable run reports instead of fabricating.
- **After Task 20** — `conduct daemon status` answers the operator's original question: is this step
  working or waiting, and on what.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] `conduct-ts validate-wired-into` reports zero FAIL rows
- [ ] `conduct-ts plan-protected-targets` reports no violations
