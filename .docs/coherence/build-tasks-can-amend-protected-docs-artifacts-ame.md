# Coherence: Amendment of accepted `.docs/` artifacts belongs to DECIDE

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
| outcome | outcome-2 | story-TS-1 | covered | Amending an accepted assertion becomes a DECIDE-time act with a defined home; TS-1 makes the three detecting skills perform and record rather than defer. |
| outcome | outcome-3 | story-TS-4 | covered | Mid-BUILD discovery routes to a recorded request on an unsealed path; TS-4 pins that nothing halts, kicks back, or rewinds, which is the constraint the intake set. |
| outcome | outcome-4 | story-TS-5 | covered | The corpus can be stale but never silently so; TS-5 fails `finish` closed on an unsurfaced request while leaving build verdicts untouched. |
| outcome | outcome-5 | story-TS-1, story-TS-2 | covered | Regression coverage: TS-2 pins sealed-rejected and unsealed-accepted, TS-1 pins that a DECIDE-authored amendment reaches the seal baseline and BUILD completes without a halt. |
| story | story-TS-1 | task-10, task-11, task-15 | covered | Ledger parse and validation give the amendment act its recorded home; the skill edits are what make the three detecting skills perform it. |
| story | story-TS-2 | task-1, task-2, task-3, task-4, task-5, task-6 | covered | Reproduction, the exported engine policy, the scan itself, its exemptions, inherited-set resolution, and the blocking command. |
| story | story-TS-3 | task-7, task-8 | covered | The land gate and its blast-radius negative paths. |
| story | story-TS-4 | task-9 | covered | The amendment directory is writable during BUILD and provably outside the sealed set — the two properties the non-blocking route rests on. |
| story | story-TS-5 | task-12, task-13 | covered | The fail-closed `finish` predicate and the negative paths proving it blocks on silence rather than on the build. |
| story | story-TS-6 | task-14 | covered | Remediation records a sealed-artifact gap instead of routing it to a phase whose seal rejects it. |
| task | task-1 | story-TS-2 | covered | Owns the RED reproduction of the observed sealed-artifact task. |
| task | task-2 | story-TS-2 | covered | Owns exporting the sealed-directory set and own-feature predicate, provably inert. |
| task | task-3 | story-TS-2 | covered | Owns the scan, built on the existing path parser and the exported policy. |
| task | task-4 | story-TS-2 | covered | Owns the own-feature, unsealed, and clean-plan exemptions. |
| task | task-5 | story-TS-2 | covered | Owns judging `same` / `same as Task N` sets on their resolved paths. |
| task | task-6 | story-TS-2 | covered | Owns the blocking CLI command and its exit-code contract. |
| task | task-7 | story-TS-3 | covered | Owns the land-time refusal inside the existing gate sequence. |
| task | task-8 | story-TS-3 | covered | Owns tier-independence, unchanged gate ordering, and the clean-spec case. |
| task | task-9 | story-TS-4 | covered | Owns the write allowlist entry and the proof that the directory is unsealed. |
| task | task-10 | story-TS-1 | covered | Owns the ledger parser and its fail-closed behavior. |
| task | task-11 | story-TS-1 | covered | Owns row validation against the sealed set, including the no-ledger common case. |
| task | task-12 | story-TS-5 | covered | Owns the fail-closed `finish` predicate. |
| task | task-13 | story-TS-5 | covered | Owns the resolved-row, follow-up-present, and no-ledger negative paths. |
| task | task-14 | story-TS-6 | covered | Owns the remediation narrowing and the proof that every other disposition is unchanged. |

## Story-free tasks

Tasks 15 and 16 carry no traceability row. Both are typed `infrastructure` and declare an explicit
purpose on their `**Story:**` line, so neither is an orphan:

- **Task 15** codifies the rule across the five skills that can direct a mutation. The engine checks
  reject a violation; the skill text is what stops one being authored. The contract needs both halves,
  and neither is a user story.
- **Task 16** satisfies this repository's documentation-upkeep rule, which requires the canonical
  affected pages to be truthful in the same PR that changes behavior.

## Verify-Claims Verdict

Every counterpart id above was confirmed against the accepted stories and the authored plan. The five
outcome rows reproduce the intake issue's Desired-outcome bullets in order. TS-3 and TS-6 carry no
outcome row of their own: TS-3 is the durability half of outcome-1 (the same rejection at land time,
so enforcement does not depend on an agent having run the authoring check), and TS-6 closes the
routing path the intake names in its Impact section and that #1254 states as a desired outcome. Both
are deliberate additions beyond the intake's enumerated outcomes, recorded here rather than left to be
discovered as unmapped rows.

No ambiguous or transitive-uncovered row remains.

Verdict: CLEAR
