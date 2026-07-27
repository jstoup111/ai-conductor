**Status:** Accepted

# Kickback bound survives re-dispatch and cannot be laundered by an empty commit (#984)

Track: technical (no PRD — acceptance criteria live here)
Tier: M

## Context

A feature looped `build → build_review → wiring_check → build` indefinitely on 2026-07-26, reaching
an identical `wiring_check` failure each lap until an operator killed the daemon. The bound meant to
stop this — `MAX_KICKBACKS_PER_GATE = 2` (`conductor.ts:318`) — never engaged, for three independent
reasons verified in the current tree:

1. `kickbackCounts` (`conductor.ts:2319`) is declared inside `Conductor.run()`. The daemon builds a
   new `Conductor` per dispatch (`daemon-cli.ts:922` via `daemon-runner.ts:366`), and `ConductState`
   has no kickback field, so the counter restarts at zero every lap.
2. The #647 D2 no-op escalation has the same defect — `kickbackToBuildContext`
   (`conductor.ts:2359`) is also run-local.
3. `classifyBuildProgress` (`kickback-escalation.ts:35-41`) compares HEAD **commit shas**. An empty
   commit advances HEAD over a byte-identical tree, scoring `'did-work'` and suppressing the halt.
   One such commit (`0c4515db`) was minted during the incident.

Additionally, `wiring_check` — the gate in the incident — is the one kickback gate that never calls
the D2 capture/check pair at all (`conductor.ts:5069-5155` `continue`s at `:5134`, bypassing the
generic site at `:5411`).

Design is fixed by `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (APPROVED). The single
load-bearing constraint: **the bound is keyed on the HEAD tree hash alone, never on failure-reason
text.** Only `wiring_check` produces a deterministic reason; `build_review`, `manual_test`, and
`test_suite` reasons are LLM prose or raw runner output, so a reason-keyed counter would reset every
lap and leave the bug unfixed.

Out of scope, explicitly (see ADR Non-goals): migrating `stuckGate`, `prdAuditSelfHeals`,
`remediationRounds`, or `manualTestSelfHeals`; changing `MAX_KICKBACKS_PER_GATE`'s value; changing
any gate's PASS/FAIL judgment; blocking empty commits.

---

## Story 1 — The kickback bound survives daemon re-dispatch

**Requirement:** #984 desired outcome 1

As the daemon's gate loop, I want a gate's consumed kickback budget to be remembered across
dispatches, so a feature that cannot pass a gate stops instead of re-running forever.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `wiring_check` has consumed 1 kickback against tree `T1`, recorded in
  `.pipeline/kickback-ledger.json`
- When the daemon discards the `Conductor` and re-dispatches the feature, and `wiring_check` fails
  again with HEAD still at tree `T1`
- Then the ledger is read from disk and the count resumes at 1 (not 0), incrementing to 2 — the
  budget is not silently refreshed by the dispatch boundary.

- Given a feature that has now consumed `MAX_KICKBACKS_PER_GATE` kickbacks against an unchanged tree
- When the same gate fails again on a fresh dispatch
- Then the loop HALTs instead of routing back to `build`.

#### Negative Path
- Given no `.pipeline/kickback-ledger.json` exists (first run, or the worktree was recreated)
- When a gate fails and consults the ledger
- Then the read returns an empty ledger without throwing, the gate receives a full fresh budget, and
  no halt is raised — the guard fails **open**.

- Given `.pipeline/kickback-ledger.json` contains corrupt JSON, or `version` is not `1`
- When the ledger is read
- Then the document is treated as absent, a `console.warn` is emitted, and the run proceeds with a
  fresh budget rather than crashing the dispatch.

- Given a genuinely fresh feature session (`state.run_started_at` is unset)
- When the conductor starts
- Then the ledger is cleared, matching the `.pipeline/build-review-regrade.json` lifecycle
  (`conductor.ts:2166`, `:2176-2180`) — a new feature never inherits a prior feature's budget.

### Verification
- [ ] A test drives two sequential `Conductor` instances over one worktree and asserts the second
      resumes the persisted count rather than starting at zero.
- [ ] A test asserts absent / corrupt / wrong-version ledgers each yield an empty ledger and no throw.
- [ ] A test asserts the ledger write is atomic (temp file in the same directory + `rename`), and
      that no torn or empty document is ever observable — mirroring `task-evidence.test.ts`.
- [ ] A test asserts a fresh feature session clears the ledger.

---

## Story 2 — An empty commit does not count as progress

**Requirement:** #984 desired outcome 2

As the gate loop, I want "did the source change?" judged by something a no-op commit cannot falsify,
so a lap that commits nothing of substance and fails identically is recognised as no progress.

### Acceptance Criteria

#### Happy Path
- Given a kickback-to-build cycle whose build produced only an empty commit (HEAD sha advanced,
  `HEAD^{tree}` byte-identical) and no resolved-task movement
- When the source gate fails again
- Then `classifyBuildProgress` returns `'no-work'` and the D2 escalation fires — where today the
  advanced commit sha returns `'did-work'` and suppresses it.

- Given a build that changed real files
- When the source gate fails again
- Then the tree hash differs, `'did-work'` is returned, and no escalation fires.

#### Negative Path
- Given the tree hash cannot be resolved (git failure / indeterminate HEAD), yielding null on either
  side
- When progress is classified
- Then the conservative `'no-work'` branch is taken, preserving the documented stance at
  `kickback-escalation.ts:27-33` — an unobservable tree may suppress a halt-worthy escalation but
  must never fabricate progress.

- Given `resolvedAfter > resolvedBefore` while the tree hash is unchanged
- When progress is classified
- Then `'did-work'` is still returned — the resolved-count signal is retained unchanged alongside
  the new tree key.

### Verification
- [ ] A test constructs a real empty commit (`git commit --allow-empty`) and asserts the cycle
      classifies as `'no-work'`.
- [ ] A test asserts a real file change classifies as `'did-work'`.
- [ ] A test asserts null-tree on either side folds to `'no-work'`.
- [ ] `classifyBuildProgress` remains pure (no I/O); tree hashes are gathered by the caller.

---

## Story 3 — `wiring_check` is guarded by D2 like every other kickback gate

**Requirement:** #984 desired outcome 1 (the incident gate specifically)

As the gate loop, I want `wiring_check` to capture a pre-kickback baseline and consult the no-op
escalation, so the gate observed livelocking is not the only one exempt from the guard built to
stop livelocks.

### Acceptance Criteria

#### Happy Path
- Given `wiring_check` fails with gap messages and is about to route back to `build`
- When the kickback is committed
- Then `captureKickbackToBuildContext('wiring_check')` records the baseline before the
  `navigateBack` at `conductor.ts:5125`.

- Given a `wiring_check` kickback whose intervening build produced no tree movement
- When `wiring_check` fails again
- Then `checkKickbackToBuildEscalation('wiring_check')` is consulted **before** the counter at
  `conductor.ts:5104`, and HALTs — matching the ordering `build_review` already uses (`:4969`
  before `:4989`).

#### Negative Path
- Given `kickback_escalation.enabled` is `false`
- When a no-op `wiring_check` cycle occurs
- Then D2 does not fire and the prior re-kick-until-cap behaviour is preserved — but the D1
  persisted cap still bounds the loop, so it still terminates.

- Given `wiring_check` runs in a non-daemon (`mode: 'auto'`) Conductor
- When a kickback fires
- Then the existing non-daemon-gated behaviour is preserved (`conductor.ts:5060-5068`) and
  `test/wiring-gate-loop.test.ts` continues to pass unmodified.

### Verification
- [ ] A test replays the incident shape (identical gap, unchanged tree, across two dispatches) and
      asserts a HALT within two laps rather than an unbounded loop.
- [ ] A test asserts the capture/check calls bracket the `wiring_check` block in the same order as
      `build_review`.
- [ ] `test/wiring-gate-loop.test.ts` passes unmodified.

---

## Story 4 — Real progress earns a fresh budget; nondeterministic steps keep bounded retries

**Requirement:** #984 desired outcomes 3 and 5 (negative path)

As a feature that is genuinely making progress, I want a changed tree to restore my full kickback
budget, so an earlier failure never penalises a run that is actually moving, and the limit never
collapses to zero for steps whose output can legitimately vary.

### Acceptance Criteria

#### Happy Path
- Given a gate has consumed 2 kickbacks against tree `T1`
- When the next build produces tree `T2` (`T2 != T1`) and the gate fails again
- Then `count` resets to 1 and `treeHash` is updated to `T2` — a full fresh budget, no penalty
  carried from `T1`.

- Given a gate has consumed kickbacks against tree `T1`
- When the next lap leaves the tree at `T1` but the resolved-task count increases
- Then `count` also resets — the ledger agrees with `classifyBuildProgress`
  (`kickback-escalation.ts:39`) and with the daemon's re-kick eligibility
  (`daemon-cli.ts:472-479`), which both already treat a resolved-count increase as progress. The
  two mechanisms must never disagree about whether the same lap made progress.

#### Negative Path
- Given a step whose output varies over an identical tree (nondeterministic)
- When it fails repeatedly over unchanged tree `T1`
- Then it still receives the full `MAX_KICKBACKS_PER_GATE` laps before the bound trips — the limit
  is never zero, and never one.

- Given a gate whose failure reason text differs on every lap (`build_review` grader prose,
  `manual_test` rows, `test_suite` runner output) while the tree is unchanged
- When the bound is evaluated
- Then the count still increments and the loop still terminates — the bound must **not** require
  reason-text equality, because three of the four gates would otherwise never match and the
  livelock would survive.

### Verification
- [ ] A test asserts a changed tree resets the count to 1 and rewrites `treeHash`.
- [ ] A test asserts an unchanged tree with **differing** reason text on each lap still terminates
      within `MAX_KICKBACKS_PER_GATE` laps. This is the regression test for the design's central
      constraint.
- [ ] A test asserts the budget is never reduced below `MAX_KICKBACKS_PER_GATE` for any step kind.

---

## Story 5 — The livelock HALT names the gate and its recurring reason, and is classified

**Requirement:** #984 desired outcome 4

As an operator or a remediation step, I want the HALT to state which gate repeated and why, so I can
act without reconstructing the loop from the daemon log.

### Acceptance Criteria

#### Happy Path
- Given a gate exhausts its persisted kickback budget over an unchanged tree
- When the loop HALTs
- Then the marker body names the repeated gate, the number of laps consumed, and the recorded
  `lastReason`, and `.pipeline/HALT.class` is written as `needs-human`.

- Given the HALT is emitted
- Then it follows the established ordering used by every other HALT path: `writeState` →
  `surfaceRemediationPr(reason)` → `emit({type:'loop_halt', reason, prUrl})` → signal handlers
  detached → return.

#### Negative Path
- Given the `build_review` and `wiring_check` cap HALTs today hand-roll `mkdir` + `writeFile`
  (`conductor.ts:5029-5036`, `:5137-5144`) and write **no** class sidecar, leaving `readHaltClass`
  `'unclassified'`
- When those paths are converted to `writeHaltMarker(..., 'needs-human')`
- Then a budget-exhausted livelock is no longer recycled by the re-kick sweep as an unclassified
  marker.

- Given `lastReason` is absent or empty in the ledger
- When the HALT is composed
- Then it still names the gate and lap count and degrades to a stated "no reason recorded"
  placeholder, never an empty or misleading body.

### Verification
- [ ] A test asserts the HALT body contains the gate name, the lap count, and the recorded reason.
- [ ] A test asserts `.pipeline/HALT.class` reads back as `needs-human` for both converted paths.
- [ ] A test asserts the empty-`lastReason` path still produces a well-formed marker.
- [ ] `docs/configuration.md` and `docs/daemon-operations.md` are updated for the new ledger and the
      halt-classification change, per the repository's Documentation Upkeep rule.
