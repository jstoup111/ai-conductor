**Status:** Accepted

# Stories: coverage_binding lap-cap halt has a supported recovery (#2846)

Technical track (no PRD). Tier: M. Source: jstoup111/ai-conductor#2846. Governing design:
`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` decision 6.

**Terms used below.**

- *coverage_binding cap halt* — the HALT written when the coverage_binding step cannot reopen completed tasks bound by a changed criterion because `gates.coverage_binding` has used its lap cap.
- *Default cap* — the engine default per-gate lap cap for coverage_binding (2 today); there is no coverage_binding config key.
- *Effective cap* — the feature-local lap cap after operator raises; equal to the default cap until a raise is applied.
- *Grant* — a successful `ai-conductor kickback-budget raise --gate coverage_binding` or `reset --gate coverage_binding`.
- *Feature ledger* — the feature's root `.pipeline/kickback-ledger.json`, as opposed to a stacked child's ledger.

## Story 1: A coverage_binding cap halt carries the evidence a supported recovery needs

**Requirement:** TI-1 (technical intent: #2846 outcome "an operator can grant additional coverage_binding remediation laps to a halted feature through the same supported CLI")

As an operator, I want a coverage_binding cap halt to record exactly which budget ran out and how to recover it, so that the supported recovery command can act on it without my editing engine state.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `gates.coverage_binding` laps equal its effective cap, when the coverage_binding step must reopen completed tasks for a changed criterion, then the feature halts with class `needs-human` and the feature ledger's `gates.coverage_binding` holds cap evidence naming gate `coverage_binding`, allowance `laps`, the consumed laps, the effective cap as the limit, and a halt generation.
- Given that halt, when the operator reads `.pipeline/HALT`, then it contains a `Kickback halt generation:` line equal to the recorded generation and the exact command `ai-conductor kickback-budget raise --feature <slug> --gate coverage_binding --by «N» --rationale "«why»"` with the feature's slug.
- Given the same cap is reached on the judge-enabled coverage_binding path, when the step halts, then the halt carries the same cap evidence, generation line, and recovery command as the judge-disabled path.

#### Negative Paths
- Given `gates.coverage_binding` laps are below the effective cap, when the step reopens bound tasks, then one lap is charged, the tasks are reopened, and no cap evidence is recorded and no HALT is written.
- Given the feature ledger's coverage_binding entry is unreadable, when the step must reopen bound tasks, then it reopens nothing, charges no lap, records no cap evidence, and a later `raise --gate coverage_binding` is refused with no ledger change.
- Given the coverage_binding step refuses a plan conflict with sealed criteria or ADR decisions, when it halts, then the halt carries no coverage_binding cap evidence or generation line and `raise --gate coverage_binding` is refused because no current cap evidence exists.

### Done When
- [ ] A test drives the coverage_binding step at its lap cap and asserts the HALT class `needs-human`, the HALT body generation line and recovery command, and the ledger cap evidence fields, for both the judge-disabled and judge-enabled branches.
- [ ] A test with laps below the cap asserts a charged lap, reopened tasks, and absent cap evidence.

## Story 2: The operator grants coverage_binding laps through kickback-budget with a recorded rationale

**Requirement:** TI-1 (technical intent: #2846 outcome "with a rationale recorded in adjustment history")

As an operator, I want `kickback-budget raise` and `reset` to accept `--gate coverage_binding` for a live coverage_binding cap halt, so that I recover the feature through the supported, audited path.

### Acceptance Criteria

#### Happy Path
- Given a live coverage_binding cap halt with laps 2 and effective cap 2, when the operator runs `raise --gate coverage_binding --by 1` with a non-empty rationale from an interactive terminal, then the command succeeds, the effective cap becomes 3, laps stay 2, and the gate's adjustment history gains one `raise` entry with before limit 2, after limit 3, the operator, the rationale, and the halt generation.
- Given the same halt, when the operator runs `reset --gate coverage_binding` with a non-empty rationale, then laps become 0, the effective cap is unchanged, and the adjustment history gains one `reset` entry carrying the rationale.
- Given a successful grant, when the events ledger is read, then it holds one `kickback_budget_adjustment_authorized` event for gate `coverage_binding` with the same adjustment id, kind, rationale, and before and after values, and the gate holds an unconsumed resume authorization bound to the live halt generation.

#### Negative Paths
- Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run from a non-interactive process, then it is refused with `mutations require an interactive local operator terminal` and the ledger and park state are unchanged.
- Given the feature's live HALT is not a coverage_binding cap halt (another gate's halt, or a halt whose generation differs from the coverage_binding cap evidence), when `raise --gate coverage_binding` is run, then it is refused and the ledger's coverage_binding entry and the HALT are unchanged.
- Given the feature is not halted, when `raise --gate coverage_binding` is run, then it is refused with `feature is not currently halted` and no adjustment is staged.
- Given a grant on coverage_binding, when the ledger is read, then the `build_review`, `prd_audit`, and `architecture_review_as_built` entries, including their counts, limits, and adjustment histories, are byte-identical to before the grant.

### Done When
- [ ] CLI-level tests for raise and reset on coverage_binding assert the ledger's laps, effective cap, adjustment entry, resume authorization, and the authorization event.
- [ ] CLI-level tests assert each refusal above leaves the ledger, HALT, and park state unchanged.

## Story 3: After a grant, the next dispatch reopens the bound tasks instead of re-halting

**Requirement:** TI-2 (technical intent: #2846 outcome "after such a grant, the next dispatch reopens the bound tasks instead of re-halting on the lap cap")

As an operator, I want the daemon to resume a granted feature and have coverage_binding reopen the tasks it previously could not, so that one grant ends the halt loop.

### Acceptance Criteria

#### Happy Path
- Given a coverage_binding cap halt and a grant that raised the effective cap from 2 to 3, when the daemon's resume-authorization sweep runs, then it clears the HALT, emits `halt_cleared` with cause `kickback-budget`, and marks the authorization consumed.
- Given that cleared feature, when coverage_binding runs again, then it reopens the bound completed tasks, emits `coverage_binding_task_reopened` for each, charges laps from 2 to 3, and does not halt.
- Given the halt was produced on the judge-enabled path, when coverage_binding runs again after the grant, then it still reopens the bound tasks rather than completing without reopening them.

#### Negative Paths
- Given a grant raised the effective cap to 3 and laps reached 3, when a further changed criterion needs another reopen, then coverage_binding halts again with new cap evidence and a new generation, and the consumed authorization is not reused.
- Given no grant was made, when the daemon sweep runs over a coverage_binding cap halt, then the HALT is retained and coverage_binding is not re-dispatched.
- Given the operator parked the feature before the sweep, when the sweep runs, then the authorization is left unconsumed and the HALT is retained until the operator unparks.
- Given the rerun replays an admission already settled before the halt, when coverage_binding runs again, then that admission charges no second lap.

### Done When
- [ ] An integration test from cap halt through grant, daemon sweep, and coverage_binding rerun asserts the cleared HALT, the consumed authorization, the reopened tasks, laps 3, and no new HALT, for both judge branches.
- [ ] A test asserts the re-halt at the raised cap writes a new generation and leaves the earlier authorization consumed.

## Story 4: kickback-budget inspect shows coverage_binding beside the other gates

**Requirement:** TI-3 (technical intent: #2846 outcome "kickback-budget inspect shows coverage_binding's consumed laps, cap, and adjustments alongside the other gates")

As an operator, I want `inspect` to list coverage_binding, so that I can see how much reopen budget a feature has used before and after a halt.

### Acceptance Criteria

#### Happy Path
- Given a feature whose ledger holds `coverage_binding` laps 2 and no adjustments, when `inspect --format human` runs, then the output lists coverage_binding with consumed 2 and limit equal to the default cap alongside build_review, prd_audit, and architecture_review_as_built.
- Given a coverage_binding raise from 2 to 3 has been applied, when `inspect --format json` runs, then the coverage_binding gate object reports consumed 2, limit 3, an adjustments array holding that raise with its rationale, and a resume authorization state.
- Given a feature with no coverage_binding entry, when `inspect --format json` runs, then coverage_binding is listed with consumed 0, the default cap, and an empty adjustments array.

#### Negative Paths
- Given the ledger's coverage_binding entry fails validation, when `inspect` runs, then it reports `coverage_binding: budget unavailable (durable entry failed validation)`, still renders the healthy gates, and exits non-zero.
- Given a coverage_binding resume authorization bound to a generation other than the live halt's, when `inspect` runs, then the coverage_binding line reports the authorization as stale with both generations.

### Done When
- [ ] Inspect tests assert the human and JSON coverage_binding rows for each case above.

## Story 5: Invalid recovery requests are still refused

**Requirement:** TI-4 (technical intent: #2846 outcome "invalid requests (unknown gate, empty rationale) are still refused")

As an operator, I want malformed recovery requests refused before anything changes, so that admitting coverage_binding does not loosen the command's guards.

### Acceptance Criteria

#### Happy Path
- Given a live coverage_binding cap halt, when `raise --gate coverage_binding --by 1` is run with a valid rationale, then it is accepted, which shows coverage_binding is now a valid gate.

#### Negative Paths
- Given any feature, when `raise` or `reset` names an unknown gate such as `coverage_bind`, then it prints `kickback-budget: invalid gate or rationale.`, exits 2, and takes no park and changes no ledger.
- Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run with an empty or whitespace-only rationale, then it prints `kickback-budget: invalid gate or rationale.`, exits 2, and changes nothing.
- Given a live coverage_binding cap halt, when `raise --gate coverage_binding` is run with a rationale longer than 2000 bytes, then it is refused with exit 2 and changes nothing.

### Done When
- [ ] CLI tests assert the exit code, message, and unchanged ledger and park state for each refusal above.

## Story 6: coverage_binding recovery works on a stacked feature with child state

**Requirement:** TI-1, TI-2 (technical intent: the same supported recovery applies when the feature has stacked children)

As an operator of a stacked feature, I want coverage_binding's budget recovered from the feature ledger it is charged in, so that an active child does not hide it.

### Acceptance Criteria

#### Happy Path
- Given a feature with child state and an active child, and a coverage_binding cap halt recorded in the feature ledger, when the operator runs `raise --gate coverage_binding` without `--child`, then the grant is applied to the feature ledger and the active child's ledger is unchanged.
- Given that grant, when the daemon sweep runs, then it finds the coverage_binding authorization in the feature ledger, clears the HALT, and consumes it.
- Given a feature with child state, when `inspect` runs, then coverage_binding is reported from the feature ledger while the child-scoped gates are reported from the active child's ledger.

#### Negative Paths
- Given a feature with child state, when `raise --gate coverage_binding --child 2` is run, then it is refused with a message that coverage_binding is feature-scoped and changes no ledger.
- Given a feature with child state whose active child's ledger holds an unconsumed authorization for a child-scoped gate bound to a different generation, when the coverage_binding grant is consumed, then that child authorization stays unconsumed and its ledger is unchanged.

### Done When
- [ ] CLI and sweep tests on a fixture with child state assert which ledger each read and write touches and the refusal of `--child` for coverage_binding.
