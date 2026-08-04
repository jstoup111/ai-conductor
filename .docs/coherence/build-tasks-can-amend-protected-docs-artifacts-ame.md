# Coherence: DECIDE mutates accepted `.docs/` artifacts; no task may

**Date:** 2026-08-04
**Tier:** M
**Track:** technical — FR rows are not applicable and are omitted
**Plan stem:** `build-tasks-can-amend-protected-docs-artifacts-ame`
**Refs:** jstoup111/ai-conductor#1293
**Verdict:** covered — zero gaps

## Traceability Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-TS-2 | covered | A plan task editing a protected artifact is rejected deterministically at authoring time, naming the task and the protected path; TS-2 pins the message content and the observed Task 14 shape. |
| outcome | outcome-2 | story-TS-1 | covered | Amending an accepted assertion becomes a DECIDE-time act with a defined home; TS-1 makes the three detecting skills perform the mutation rather than defer it. |
| outcome | outcome-3 | story-TS-4 | covered | Mid-BUILD discovery has a defined, non-manual route: remediation routes it to its owning DECIDE step. The intake's preference for avoiding an operator gate is deliberately not honored — the ADR records the operator's ruling that a BUILD-side bypass is worse than a rare human gate. |
| outcome | outcome-4 | story-TS-4 | covered | The corpus cannot silently contradict shipped behavior: TS-4 pins the seal's existing halt as the unchanged fail-closed backstop, so an unamended falsification that reaches BUILD halts loudly and names the path. |
| outcome | outcome-5 | story-TS-1, story-TS-2 | covered | Regression coverage: TS-2 pins sealed-rejected and unsealed-accepted, TS-1 pins that a DECIDE-authored mutation reaches the seal baseline and BUILD completes without a halt. |
| story | story-TS-1 | task-11 | covered | The skill edits are what make the three detecting skills perform the mutation in place; TS-1 has no engine surface by design, because the mutation is an authoring act and not machinery. |
| story | story-TS-2 | task-1, task-2, task-3, task-4, task-5, task-6 | covered | Reproduction, the exported engine policy, the scan itself, its exemptions, inherited-set resolution, and the blocking command. |
| story | story-TS-3 | task-7, task-8 | covered | The land gate and its blast-radius negative paths. |
| story | story-TS-4 | task-9, task-10 | covered | Sealed-artifact remediation gaps routed to DECIDE, and the proofs that nothing else changed and the seal halt survives. |
| task | task-1 | story-TS-2 | covered | Owns the RED reproduction of the observed sealed-artifact task. |
| task | task-2 | story-TS-2 | covered | Owns exporting the sealed-directory set and own-feature predicate, provably inert. |
| task | task-3 | story-TS-2 | covered | Owns the scan, built on the existing path parser and the exported policy. |
| task | task-4 | story-TS-2 | covered | Owns the own-feature, unsealed, and clean-plan exemptions. |
| task | task-5 | story-TS-2 | covered | Owns judging `same` / `same as Task N` sets on their resolved paths. |
| task | task-6 | story-TS-2 | covered | Owns the blocking CLI command and its exit-code contract. |
| task | task-7 | story-TS-3 | covered | Owns the land-time refusal inside the existing gate sequence. |
| task | task-8 | story-TS-3 | covered | Owns tier-independence, unchanged gate ordering, and the clean-spec case. |
| task | task-9 | story-TS-4 | covered | Owns routing a sealed-artifact remediation gap to DECIDE instead of BUILD. |
| task | task-10 | story-TS-4 | covered | Owns proving no disposition, artifact, or seal behavior changed beyond that one case. |
| task | task-11 | story-TS-1 | covered | Owns the DECIDE mutation act across the five skills that can direct a mutation. |

## Story-free tasks

Task 12 is the only task carrying no story citation. It is typed `infrastructure` and declares an
explicit purpose on its `**Story:**` line, so it is not an orphan: it satisfies this repository's
documentation-upkeep rule, which requires the canonical affected pages to be truthful in the same PR
that changes behavior.

Task 11 does carry a story citation, and the pairing is worth stating plainly: TS-1's entire surface is
a skill contract. The engine half of this feature exists only to reject violations, never to perform
amendments — so TS-1 is implemented by skill text and nothing else.

## Verify-Claims Verdict

Every counterpart id above was confirmed against the accepted stories and the authored plan. The five
outcome rows reproduce the intake issue's Desired-outcome bullets in order.

One outcome row deserves explicit note rather than silent coverage. Outcome-3 asks for a mid-BUILD
route that does not convert a self-healing build into an operator interrupt. TS-4 provides the route
but **not** that property: the finding returns to DECIDE and, in daemon mode, reaches the existing
operator gate. This is a deliberate, operator-ruled departure from the intake's stated preference,
reasoned in ADR §5 — a mechanism letting BUILD record a DECIDE-owned decision without going to DECIDE
is a bypass of DECIDE, which is the defect the issue reports. Recorded here so the divergence is
visible in the traceability record rather than discovered later as an unmet outcome.

TS-3 carries no outcome row of its own: it is the durability half of outcome-1 (the same rejection at
land time, so enforcement does not depend on an agent having run the authoring check).

No ambiguous or transitive-uncovered row remains.

Verdict: CLEAR
