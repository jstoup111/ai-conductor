# Implementation Plan: Operator-audited reseal of a protected DECIDE artifact (#1281)

**Date:** 2026-08-09
**Stories:** `.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md`
**Conflict check:** Clean as of 2026-08-09

## Summary

Adds an operator-only `conduct reseal` command that re-fingerprints an explicitly enumerated set of
protected DECIDE artifacts, refusing when anything outside that set has drifted, recording an
audited event, and optionally retiring the halt it resolves. 20 tasks.

## Technical Approach

`rotateProtectedArtifactSeal` currently fuses two concerns: computing the next seal (via
`createSeal`, which re-fingerprints **every** protected artifact at a commit) and persisting it
(temporary write, atomic rename, `rebaselines[]` append, observer notification). The plan splits
those: the persistence tail becomes one shared writer, and the seal-computation head becomes a
parameter. Rotation keeps supplying the existing recompute-everything head, so its behavior is
byte-identical — Task 1 pins that behavior before Task 2 moves any code.

The new scoped head starts from the current seal and replaces fingerprints only for the enumerated
paths. Its safety comes from a guard that refuses the whole operation when any protected artifact
*outside* those paths has drifted. Critically, "drifted" is delegated to `inspectSeal`'s existing
classification rather than re-derived, so base-inherited changes and tolerated self-amendments
behave identically on both the reseal path and the verification path — one definition, one code
path.

The command itself follows the `decide-grant` precedent: a pure `detect` parser, a `dispatch`
resolved from `index.ts`'s pre-boot chain before the pipeline boots, and a declaration in
`createProgram` so `--help` lists it. Operator-only is enforced by three independent mechanisms —
no step definition, pre-boot dispatch, and an interactivity gate behind an injectable seam. Task 12
discharges the architecture review's Condition 1: the assumption that a step's provider subprocess
presents non-interactive stdin is inferred, not verified, and must be confirmed against the real
execution path or the layer replaced.

Audit rides the existing spine: two new `ConductorEvent` variants declared in `EVENT_SINKS`, the
performed one routed to the existing `AuditTrailWriter`. Because an operator action belongs to no
step, `AuditRecord`'s origin widens rather than borrowing a sentinel `StepName` — which forces the
consumer sweep in Task 13 instead of hiding the mismatch.

Sequencing rationale: the seal engine is built and proven first (Tasks 1-7) because the CLI is a
thin driver over it; the command surface follows (8-12); audit and halt retirement land last
(13-19) since they observe rather than decide. Task 20 re-proves the safety property the whole
feature must not weaken.

**Documentation.** Per the plan skill's documentation boundary, no task in this plan writes
documentation. The runbook recovery recipe and the CLI reference update (architecture review
Condition 5) are delivered by this repository's `maintain-documentation` custom step in the same
PR.

## Prerequisites

- None. No migration, dependency, or external setup; every primitive reused already exists.

## Tasks

### Task 1: Pin the current rotation behavior before any extraction
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a test asserting the seal file produced by `rotateProtectedArtifactSeal` on a permitted
   rotation — its `protectedArtifacts` set, `baselineCommit`, and the appended `rebaselines` entry's
   `fromCommit`/`toCommit`/`trigger`/`paths`.
2. Verify it passes against the current implementation (this is a characterization test, so it is
   green from the start by design).
3. Add assertions that the temporary file is absent afterward and the observer received exactly one
   notification.
4. Commit with message: "test(seal): pin rotateProtectedArtifactSeal behavior before extraction"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — characterization test for rotation

**Wired-into:** none (no new production surface)

**Dependencies:** none

---

### Task 2: Extract the shared seal writer and delegate rotation to it
**Story:** 1
**Type:** refactor

**Steps:**
1. Write a failing test asserting a failed rename leaves the original seal unmodified and removes
   the temporary file.
2. Verify test fails (RED).
3. Extract the temporary-write / atomic-rename / `rebaselines` append / observer-notify / cleanup
   tail into one module-internal writer taking the computed next seal; make
   `rotateProtectedArtifactSeal` call it with the existing `createSeal` head.
4. Verify test passes (GREEN) and Task 1's characterization test still passes unchanged.
5. Commit with message: "refactor(seal): extract shared writer; rotation delegates to it"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — extract writer, rotation delegates
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — rename-failure test

**Wired-into:** `src/conductor/src/engine/protected-artifact-seal.ts#rotateProtectedArtifactSeal`

**Dependencies:** Task 1

---

### Task 3: Add the scoped seal head that re-fingerprints only enumerated paths
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: given a seal with entries `P1`/`P2`/`P3` and `P1` corrected at a commit,
   the scoped head returns a seal where `P1`'s fingerprint matches its content at that commit and
   `P2`/`P3` are byte-identical to their prior values.
2. Verify test fails (RED).
3. Implement the scoped head: read the current seal, recompute fingerprints for the enumerated paths
   from their content at the target commit, carry every other entry through untouched.
4. Verify test passes (GREEN).
5. Commit with message: "feat(seal): scoped head re-fingerprints only enumerated paths"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — scoped seal-computation head
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — scoped head happy path

**Wired-into:** none (inert until `src/conductor/src/index.ts`)

> **Amended 2026-08-10 by #1281:** The implemented reseal dispatcher imports the scoped
> reseal boundary directly; its actual production call site is the dispatcher, not the later
> pre-boot index dispatch.

**Wired-into:** `src/conductor/src/engine/reseal-cli.ts#resealProtectedArtifactSeal`

**Dependencies:** Task 2

---

### Task 4: Refuse malformed and unresolvable scoped-reseal inputs
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests for each refusal: a path absent from the seal's entry set; a path outside the
   protected artifact directories; a named path with uncommitted modifications; a named path deleted
   from the working tree; an unresolvable target commit; an empty enumerated set.
2. Verify tests fail (RED).
3. Implement the refusals, each naming the offending path, each leaving the seal file's bytes
   unchanged and the entry set unmodified.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(seal): refuse unknown, dirty, deleted and unresolvable reseal targets"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — scoped head refusals
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — refusal cases

**Wired-into:** same as Task 3

**Dependencies:** Task 3

---

### Task 5: Advance baselineCommit and record the rebaselines entry
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: after a scoped reseal, `baselineCommit` equals the reseal commit and a
   `rebaselines` entry records the prior baseline as `fromCommit`, the reseal commit as `toCommit`,
   and exactly the enumerated paths.
2. Verify test fails (RED).
3. Implement the baseline advance and the audit entry in the scoped head's result.
4. Add a test that verification passes against the advanced baseline for every entry.
5. Commit with message: "feat(seal): advance baselineCommit and record the reseal rebaseline"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — baseline advance, rebaselines entry
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — baseline coherence

**Wired-into:** same as Task 3

**Dependencies:** Task 4

---

### Task 6: Gate the reseal on inspectSeal's classification of unlisted paths
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: a reseal proceeds when only the enumerated path differs; proceeds when an
   unnamed path's difference is classified base-inherited; proceeds when an unnamed path's
   difference is classified a tolerated self-amendment, leaving that path's sealed entry untouched.
2. Verify tests fail (RED).
3. Implement the guard by invoking the existing classification routine and reading its verdict — do
   not write a second fingerprint comparison.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(seal): gate reseal on inspectSeal's existing drift classification"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — unlisted-drift guard
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — tolerance parity cases

**Wired-into:** same as Task 3

**Dependencies:** Task 5

---

### Task 7: Refuse the whole reseal on genuine unlisted drift
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: an unnamed path with a feature-authored committed change refuses the entire
   reseal naming it, with no enumerated path resealed either; an unnamed deleted path refuses; an
   unnamed non-inherited added path refuses; an unresolvable base ref refuses as undeterminable.
2. Verify tests fail (RED).
3. Implement the all-or-nothing refusal, asserting the seal file is byte-identical afterward.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(seal): refuse the whole reseal on unlisted protected-artifact drift"

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — all-or-nothing refusal
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — refusal cases

**Wired-into:** same as Task 3

**Dependencies:** Task 6

---

### Task 8: Parse the reseal command arguments with no I/O
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests: a valid invocation parses; a missing reason, an empty/whitespace reason, a
   duplicated conflicting flag, an unknown flag, and a slug containing a path separator or
   relative-path segment each return null.
2. Verify tests fail (RED).
3. Implement the pure detect function following the `decide-grant` parser shape.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(cli): parse conduct reseal arguments"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — detect function
- `src/conductor/test/engine/reseal-cli.test.ts` — parser cases

**Wired-into:** none (inert until `src/conductor/src/index.ts`)

> **Amended 2026-08-10 by #1281:** The parser and dispatch exports are now in the
> pre-boot index chain, so their actual call sites replace this deferred contract.

**Wired-into:** `src/conductor/src/index.ts#detectResealCommand`, `src/conductor/src/index.ts#detectMissingResealReasonCommand`, `src/conductor/src/index.ts#dispatchResealCommand`

**Dependencies:** none

---

### Task 9: Declare the reseal command so --help lists it
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting the built program exposes a reseal command with its flags.
2. Verify test fails (RED).
3. Add the command declaration beside the other non-interactive subcommand declarations.
4. Verify test passes (GREEN).
5. Commit with message: "feat(cli): declare conduct reseal in the command table"

**Files likely touched:**
- `src/conductor/src/cli.ts` — command declaration

**Wired-into:** `src/conductor/src/cli.ts#createProgram`

**Dependencies:** Task 8

---

### Task 10: Dispatch reseal from the pre-boot chain
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test: a valid invocation resolves the slug's worktree, reseals, exits zero, and
   reports the resealed paths, without booting the pipeline.
2. Verify test fails (RED).
3. Implement the dispatch function and insert it into the pre-boot chain beside the decide-grant
   dispatch; refuse an unknown slug and a worktree with no seal file.
4. Verify test passes (GREEN).
5. Commit with message: "feat(cli): dispatch conduct reseal before the pipeline boots"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — dispatch function
- `src/conductor/src/index.ts` — pre-boot dispatch wiring
- `src/conductor/test/engine/reseal-cli.test.ts` — dispatch cases

**Wired-into:** `src/conductor/src/index.ts#main`

**Dependencies:** Task 9

---

### Task 11: Refuse reseal outside an interactive terminal
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests driving both branches of an injected interactivity seam: interactive
   proceeds; non-interactive refuses, writes nothing, and leaves the seal byte-identical.
2. Verify tests fail (RED).
3. Implement the gate with the injectable seam defaulting to real stdin interactivity, matching the
   existing in-repo pattern. Provide no bypass flag or environment override.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(cli): restrict conduct reseal to an interactive operator terminal"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — interactivity gate and seam
- `src/conductor/test/engine/reseal-cli.test.ts` — both branches

**Wired-into:** same as Task 10

**Dependencies:** Task 10

---

### Task 12: Verify the non-interactive-subprocess assumption or replace the gate
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Trace the real step-execution path to determine whether a provider subprocess presents
   non-interactive stdin; record the evidence as a citation in the implementation.
2. If confirmed, add a test asserting reseal is refused under the step-subprocess stdio
   configuration.
3. If disconfirmed, replace the interactivity gate with an explicit engine-set in-band marker that
   the reseal dispatcher refuses on — do not remove the layer.
4. Verify the resulting test passes.
5. Commit with message: "test(cli): verify reseal is unreachable from a step subprocess"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — gate confirmation or replacement
- `src/conductor/test/engine/reseal-cli.test.ts` — step-subprocess reachability

**Wired-into:** same as Task 10

**Dependencies:** Task 11

---

### Task 13: Widen the audit record origin to admit an operator action
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting an audit record can carry an operator origin distinct from every
   pipeline step name.
2. Verify test fails (RED).
3. Widen the audit record's origin field; do not add a sentinel step name. Update every consumer so
   the build is compile-clean.
4. Verify test passes (GREEN) and the existing audit-trail tests still pass.
5. Commit with message: "feat(audit): admit an operator origin on audit records"

**Files likely touched:**
- `src/conductor/src/engine/audit-trail.ts` — origin widening
- `src/conductor/test/engine/audit-trail.test.ts` — operator origin

**Wired-into:** `src/conductor/src/engine/audit-trail.ts#AuditTrailWriter`

**Dependencies:** none

---

### Task 14: Add the reseal event variants and declare their sinks
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting both a performed and a refused reseal variant exist in the event
   union and are declared in the sink table, with the performed one routed to the audit sink.
2. Verify test fails (RED).
3. Add both variants carrying the enumerated paths, per-path prior and new fingerprints, the
   verbatim reason, and the from/to commits; declare both in the sink table.
4. Verify test passes (GREEN).
5. Commit with message: "feat(events): add reseal performed and refused variants"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — union variants
- `src/conductor/src/engine/event-sinks.ts` — sink declarations

**Wired-into:** `src/conductor/src/engine/event-sinks.ts#EVENT_SINKS`

**Dependencies:** Task 13

---

### Task 15: Record a performed reseal in the worktree audit trail
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test: after a successful reseal the audit trail contains a record naming the
   paths, each path's prior and new fingerprint, the verbatim reason, and the from/to commits.
2. Verify test fails (RED).
3. Emit the performed event from the dispatcher with the sinks constructed against the resolved
   worktree; create the audit directory when absent.
4. Verify test passes (GREEN), and assert no new ledger file or bespoke record format was added.
5. Commit with message: "feat(cli): record a performed reseal in the worktree audit trail"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — emit performed event
- `src/conductor/test/engine/reseal-cli.test.ts` — audit trail assertions

**Wired-into:** same as Task 10

**Dependencies:** Task 14

---

### Task 16: Record every refusal branch in the audit trail
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests asserting an audit record exists for each refusal: unlisted drift, missing
   rationale, and non-interactive invocation.
2. Verify tests fail (RED).
3. Emit the refusal event on every refusal branch, including the early returns, so no alternate
   branch bypasses the record. Surface an audit-write failure rather than swallowing it.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(cli): audit every reseal refusal branch"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — refusal event emission
- `src/conductor/test/engine/reseal-cli.test.ts` — per-branch audit assertions

**Wired-into:** same as Task 10

**Dependencies:** Task 15

---

### Task 17: Render the reseal events in the daemon event output
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting each reseal variant renders a human-readable line rather than
   falling through unhandled.
2. Verify test fails (RED).
3. Add the render cases beside the existing rebaseline cases.
4. Verify test passes (GREEN).
5. Commit with message: "feat(daemon): render reseal events"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — render cases

**Wired-into:** `src/conductor/src/daemon-cli.ts#renderDaemonEventUnsafe`

**Dependencies:** Task 14

---

### Task 18: Retire a protected-artifact halt on request
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write a failing test: with a protected-artifact halt classification, a successful reseal with the
   clear-halt flag preserves the halt reason to the cleared marker and removes both the halt and
   classification markers.
2. Verify test fails (RED).
3. Implement clearing gated on the existing protected-artifact halt classification constant, reusing
   the preserve-then-remove sequence rather than a second implementation.
4. Verify test passes (GREEN), including that omitting the flag leaves both markers untouched.
5. Commit with message: "feat(cli): retire a protected-artifact halt after a successful reseal"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — gated halt retirement
- `src/conductor/test/engine/reseal-cli.test.ts` — halt clearing

**Wired-into:** same as Task 10

**Dependencies:** Task 12

---

### Task 19: Leave halts alone when clearing is not warranted
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: a non-matching halt classification leaves both markers while the reseal
   still succeeds and reports why; no halt marker at all succeeds reporting nothing to clear; a halt
   with no classification marker is not cleared; a refused reseal touches no marker.
2. Verify tests fail (RED).
3. Implement the conditional behavior and report a partial-removal failure rather than implying the
   feature is unblocked.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(cli): leave unrelated halts intact when reseal cannot clear them"

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts` — clearing preconditions
- `src/conductor/test/engine/reseal-cli.test.ts` — non-clearing cases

**Wired-into:** same as Task 10

**Dependencies:** Task 18

---

### Task 20: Prove the tamper-detection boundary is unweakened
**Story:** 8
**Type:** negative-path

**Steps:**
1. Confirm the existing protected-artifact violation tests pass with no assertion relaxed or
   removed.
2. Write a failing test asserting a scoped reseal of one path does not suppress a violation on
   another path.
3. Write a failing test asserting an in-step reseal invocation is refused while the violation
   remains detected.
4. Verify tests pass (GREEN).
5. Commit with message: "test(seal): prove reseal does not weaken violation detection"

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — cross-path isolation
- `src/conductor/test/engine/reseal-cli.test.ts` — in-step refusal with violation intact

**Wired-into:** none (no new production surface)

**Dependencies:** Task 19

---

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ─▶ Task 7
                                                              │
Task 8 ─▶ Task 9 ─▶ Task 10 ─▶ Task 11 ─▶ Task 12 ────────────┤
                       │                      │               │
                       │                      ▼               │
                       │                  Task 18 ─▶ Task 19 ─┤
                       │                                      │
Task 13 ─▶ Task 14 ─▶ Task 15 ─▶ Task 16                      │
              │                                               │
              └──────▶ Task 17                                ▼
                                                          Task 20
```

Tasks 1-7 (seal engine), 8-12 (command surface), and 13-17 (audit) are three independent chains
that converge at Task 20. Tasks 18-19 depend on the command surface only.

## Integration Points

- **After Task 7:** the scoped reseal and its guard are exercisable end-to-end at the engine level,
  independent of any CLI.
- **After Task 10:** `conduct reseal` runs end-to-end against a real worktree.
- **After Task 12:** the operator-only boundary is closed and evidenced.
- **After Task 17:** a reseal is fully observable — audit trail, event ledger, and daemon output.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `conduct-ts plan-protected-targets` reports no violations
- [ ] `conduct-ts validate-wired-into` reports zero FAIL rows
