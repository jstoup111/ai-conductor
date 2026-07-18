# Stories: unpark grants a fresh evidence budget (issue #667)

Status: Accepted

Source: jstoup111/ai-conductor#667 — `noEvidenceAttempts` persists across unpark, so a
re-dispatched feature that previously exhausted its 3-attempt evidence budget insta-halts
with zero fresh attempts. Observed twice 2026-07-14 (~06:46-06:49Z) on `park-and-unpark`
REDO and `auto-park-markers` (#486); operator had to hand-zero the sidecar each time.

Root cause (verified in code): `dispatchDaemonPark` unpark branch
(`src/conductor/src/engine/daemon-park-cli.ts:143-172`) calls
`resetNoEvidenceAttempts` only when park provenance is `auto`
(lines 155-164); the operator-park `else` branch (165-167) removes the marker but leaves the
counter. The gate (`checkAndAutoPark`, daemon-auto-park.ts:122-148) then re-parks on the
inherited count with a message implying fresh failures.

---

## Story 1 — Operator unpark resets the evidence budget

As the daemon operator, when I run `conduct daemon unpark <slug>`, I want the feature's
no-evidence budget reset regardless of how it was parked, so the halt message's own
prescribed remedy actually works.

### Scenario 1.1 (happy): unpark of an operator-parked feature resets the counter
- Given a feature parked with an operator marker and `.pipeline/task-evidence.json`
  carrying `noEvidenceAttempts: 3` with `noEvidenceReasons` populated
- When the operator runs `conduct daemon unpark <slug>`
- Then the park marker is removed
- And `noEvidenceAttempts` is 0 and `noEvidenceReasons` is empty at the root the evidence
  gate reads from

### Scenario 1.2 (happy): unpark of an auto-parked feature still resets (no regression)
- Given a feature auto-parked ("auto-parked: ..." provenance) with `noEvidenceAttempts: 3`
- When the operator runs `conduct daemon unpark <slug>`
- Then the counter and reasons are reset exactly as today (daemon-park-cli.test.ts:303 behavior preserved)

### Scenario 1.3 (negative): reset failure keeps the marker for recovery
- Given a feature parked (either provenance) and a sidecar write that fails
- When the operator runs `conduct daemon unpark <slug>`
- Then the command fails loudly and the park marker survives so the feature is not
  half-unparked (existing daemon-park-cli.test.ts:496 contract extended to operator parks)

### Scenario 1.4 (negative): reset lands where the gate reads
- Given the per-feature worktree `.worktrees/<slug>` exists and carries the sidecar
- When unpark resets the counter
- Then the reset is applied such that a subsequent `checkAndAutoPark` read for this feature
  observes 0 attempts (worktree root and resolved-root fallback both covered; the
  known root-mismatch hazard between the reset root and the gate's `projectRoot` read is
  closed or explicitly asserted by test)

## Story 2 — Truthful halt message for an inherited budget

As the daemon operator reading a halt marker, I want the halt reason to distinguish an
inherited (pre-park) budget from fresh failures, so I never misread an insta-halt as three
new failed attempts.

### Scenario 2.1 (happy): fresh failures keep today's message
- Given a dispatch cycle in which the gate itself incremented `noEvidenceAttempts` to the
  threshold
- When the daemon auto-parks
- Then the reason reads "no completion evidence after 3 attempts" (unchanged)

### Scenario 2.2 (happy): inherited budget is named as such
- Given a feature whose `noEvidenceAttempts` was already at/over threshold at dispatch
  start (zero increments in the current dispatch cycle)
- When the daemon auto-parks
- Then the halt reason states the budget was inherited from a prior park cycle (not
  implied fresh failures) and still names the unpark remedy

### Scenario 2.3 (negative): no false "inherited" claim
- Given a feature whose counter was 0 at dispatch start and reached 3 within the cycle
- When the daemon auto-parks
- Then the reason does NOT claim the budget was inherited

## Story 3 — Bounded thrash: budget per cycle, not infinite

As the harness owner, I want park→unpark→dispatch to grant exactly one full fresh budget
per unpark, so recovery works while a genuinely evidence-less feature still re-parks after
its per-cycle budget.

### Scenario 3.1 (happy): full fresh budget after unpark
- Given a feature that exhausted its budget, was parked, and was unparked
- When the daemon re-dispatches it and no evidence appears
- Then the gate makes 3 fresh attempts before parking again (not 0)

### Scenario 3.2 (negative): thrash still bounded
- Given a feature unparked N times with no evidence ever produced
- When each cycle runs
- Then each cycle is bounded at the same 3-attempt budget (reset happens only at the
  explicit unpark verb — no in-cycle resets, no unbounded retries)
