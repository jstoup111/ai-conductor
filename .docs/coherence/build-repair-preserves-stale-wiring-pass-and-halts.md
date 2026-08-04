# Coherence: BUILD-verification member reuse after a repair

**Date:** 2026-08-03
**Tier:** M
**Track:** technical — FR rows are not applicable and are omitted
**Plan stem:** `build-repair-preserves-stale-wiring-pass-and-halts`
**Verdict:** covered — zero gaps

## Traceability Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-TS-2 | covered | Every prerequisite whose prior verdict no longer represents the repaired state runs again before review; TS-2 makes the round dispatch every non-skipped member rather than trusting an on-disk verdict. |
| outcome | outcome-2 | story-TS-3 | covered | A member the repair could not invalidate does no redundant work; TS-3 keeps that decision inside the member's own evidence anchor. |
| outcome | outcome-3 | story-TS-4 | covered | TS-4 forbids selecting a step whose own entry gate rejects a prerequisite, which is the only way review was reached on an unsatisfied one. |
| outcome | outcome-4 | story-TS-1 | covered | TS-1 removes the status divergence a kickback creates, so a repair rejoins or reports the real failing verification instead of a terminal-less park. |
| outcome | outcome-5 | story-TS-5 | covered | TS-5 requires a per-member decision event carrying the reuse-versus-recompute outcome and its basis, rendered in the daemon log. |
| story | story-TS-1 | task-1, task-2, task-3, task-4 | covered | Reproduction, both kickback branches reconciled, and the negative paths proving no new block and unchanged halt and rebase paths. |
| story | story-TS-2 | task-5, task-6 | covered | Post-repair rounds dispatch every non-skipped member, with every pre-existing exclusion rule proven preserved. |
| story | story-TS-3 | task-7, task-8 | covered | Members settle from their own evidence, charging no budget and altering no evidence contract. |
| story | story-TS-4 | task-9, task-10 | covered | The tail-selection clamp and the negative paths pinning the agreement case, the non-resolvable case, boundedness, and the absence of a new predicate. |
| story | story-TS-5 | task-11, task-12, task-13 | covered | Decision events declared and emitted, rendered in the daemon log, with the registry's existing equivalence assertion kept valid. |
| task | task-1 | story-TS-1 | covered | Owns the RED reproduction of the observed terminal-less park. |
| task | task-2 | story-TS-1 | covered | Owns the no-verdict kickback branch reconciliation. |
| task | task-3 | story-TS-1 | covered | Owns the failing-member branch leaving a passing sibling reconciled. |
| task | task-4 | story-TS-1 | covered | Owns the negative paths: no downstream block, cap and escalation halts unchanged, rebase path untouched. |
| task | task-5 | story-TS-2 | covered | Owns dispatching every non-skipped member in a post-repair round. |
| task | task-6 | story-TS-2 | covered | Owns proving tier, track, upstream, config, width, and member-list behavior preserved. |
| task | task-7 | story-TS-3 | covered | Owns surfacing each member's settle outcome from its own evidence. |
| task | task-8 | story-TS-3 | covered | Owns the no-budget guarantee, the indeterminate-evidence path, and the unchanged evidence contracts. |
| task | task-9 | story-TS-4 | covered | Owns the runnable-prerequisite clamp at the tail selection site. |
| task | task-10 | story-TS-4 | covered | Owns the unchanged-agreement, explicit-terminal, bounded, and no-new-predicate negative paths. |
| task | task-11 | story-TS-5 | covered | Owns the decision event types, their registry declaration, and their emission. |
| task | task-12 | story-TS-5 | covered | Owns the daemon-log rendering and its redaction. |
| task | task-13 | story-TS-5 | covered | Owns keeping the sink-membership equivalence assertion valid under additive types. |

## Verify-Claims Verdict

Every counterpart id above was confirmed against the accepted stories and the authored plan. The five
outcome rows reproduce the intake issue's explicit Desired-outcome bullets in order. Tasks 14 and 15
are the only story-free tasks; both are typed `infrastructure` and declare an explicit purpose, so
neither is an orphan and neither carries a traceability row. No ambiguous or transitive-uncovered row
remains.

Verdict: CLEAR
