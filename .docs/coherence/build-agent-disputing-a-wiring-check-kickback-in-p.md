# Coherence Mapping: Engine-stamped build outcome for a disputed kickback

**Issue:** jstoup111/ai-conductor#1336
**Tier:** M · **Track:** technical
**Plan stem:** build-agent-disputing-a-wiring-check-kickback-in-p

Row classes present: **outcome**, **story**, **task**. The **fr** class is omitted — this is a
technical-track spec with no PRD, so there are no enumerated `FR-N` to map. Omission is correct
here, not a gap.

Every `covered` verdict was confirmed by parsing the real artifact files with the same grammars the
land-time validator uses (`splitStoryBlocks` at `artifacts.ts:3493`, `collectPlanCoverage` at
`:3568`, `parsePlanTaskPaths`). Result: story ids `1`–`7` all parse, task ids `1`–`21` all parse,
every task cites exactly one existing story id, zero uncovered stories, zero fabricated citations.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | A build that changes no tree bytes is distinguishable from the daemon log alone. story-1 records the fact at the settle boundary; story-2 renders it. Both carry `**Requirement:** OUT-1`. |
| outcome | outcome-2 | story-3 | covered | The agent's conclusion reaches a durable artifact. story-3 carries `**Requirement:** OUT-2, C4, C5` and binds the note to the existing 200-line tail. |
| outcome | outcome-3 | story-4, story-7 | covered | An identical no-movement cycle is not re-paid. story-4 owns the pre-dispatch refusal; story-7 bounds its failure mode to fail-open. |
| outcome | outcome-4 | story-5 | covered | The halt reason names the operator's decision. story-5 carries `**Requirement:** OUT-4, D6`. |
| outcome | outcome-5 | story-6 | covered | Negative path. A real wiring gap still halts needs-human. story-6 asserts cap halt, HALT.class, wiring evidence and dispatch count are all baseline-identical. |
| story | story-1 | task-1, task-2, task-7, task-8, task-9, task-10, task-11, task-12 | covered | Happy paths in task-1, task-7, task-8; negative paths in task-2, task-9, task-10, task-11, task-12. |
| story | story-2 | task-15, task-16, task-17 | covered | Happy in task-15, task-16, task-17; negatives in task-15 (no competing heartbeat) and task-16 (non-build, legacy, indeterminate lines). |
| story | story-3 | task-13, task-14 | covered | Happy in task-13 (category values and artifact precedence); negative in task-14 (category gates nothing). task-8 lands the note itself. |
| story | story-4 | task-3, task-4, task-18, task-19 | covered | Happy in task-3 and task-18; negatives in task-4 (null and rung) and task-19 (ledger invariance). |
| story | story-5 | task-20 | covered | task-20 carries both path types: the composer's three category forms plus HALT.class, re-kick and multi-line-note negatives. |
| story | story-6 | task-21 | covered | task-21 is negative-path typed and owns every OUT-5 regression assertion. |
| story | story-7 | task-5, task-6, task-11 | covered | Negatives in task-5 (five fail-open read cases); happy plus negative in task-6 (atomic write, rename-failure cleanup); task-11 covers the unwritable pipeline criterion. |
| task | task-1 | story-1 | covered | infrastructure. Record shape and pure classifyBuildSettle. Carries ADR D1 and D7. |
| task | task-2 | story-1 | covered | Negative path. Null tree hash classifies as no-movement. |
| task | task-3 | story-4 | covered | Pure sameNoOpCycle definite match. Carries ADR D3. |
| task | task-4 | story-4 | covered | Negative paths. Null components and escalation rung. Carries review conditions C1 and C2. |
| task | task-5 | story-7 | covered | Fail-open sidecar read, five cases. |
| task | task-6 | story-7 | covered | infrastructure. Atomic temp plus rename write. Carries ADR D7. |
| task | task-7 | story-1 | covered | infrastructure. Baseline captured at the existing conductor.ts:4940 probe. Carries accepted conflict constraint D-1. |
| task | task-8 | story-1 | covered | Stamp on successful settle; note sourced from the existing tail. Carries ADR D2, D4, D5 and review condition C4. |
| task | task-9 | story-1 | covered | Stamp on step_failed. Carries review condition C3. |
| task | task-10 | story-1 | covered | Stamp on no-verdict and authFailure. Carries review condition C3. |
| task | task-11 | story-1 | covered | An unwritable pipeline directory never fails the build. |
| task | task-12 | story-1 | covered | Both movement witnesses recorded; empty-commit case. Carries the amended ADR D1 and the resolved blocking conflict. |
| task | task-13 | story-3 | covered | Advisory category plus optional dispute artifact. Carries ADR D2. |
| task | task-14 | story-3 | covered | Proves the category gates nothing. Carries review condition C5. |
| task | task-15 | story-2 | covered | infrastructure. Event fields. Carries accepted conflict constraint D-2, no competing heartbeat. |
| task | task-16 | story-2 | covered | Daemon render, tree-scoped strings only. |
| task | task-17 | story-2 | covered | Interactive renderer parity. |
| task | task-18 | story-4 | covered | Pre-dispatch refusal; zero provider calls on a match. Carries ADR D3 and review condition C1. |
| task | task-19 | story-4 | covered | Kickback ledger untouched. Carries ADR D7 so #984 keeps sole ownership of the cap. |
| task | task-20 | story-5 | covered | Halt-reason composer at both wiring_check halt sites. Carries ADR D6, no HaltClass extension. |
| task | task-21 | story-6 | covered | Negative-path regressions. No auto-pass, no unbounded retry. Carries ADR D8. |

## Binding-constraint carriage

Not a validator row class — recorded in prose so the operator can audit that every APPROVED-ADR
decision and every accepted-conflict constraint has a task that lands it. Each mapping below is
also restated in the Notes column of the owning task row above.

- **D1** (amended 2026-08-06, two movement witnesses; tree hash classifies) — task-1, task-12
- **D2** (engine-authored stamp; agent artifact optional) — task-8, task-13
- **D3 / C1** (definite-match refusal; null dispatches; no delegation to `classifyBuildProgress`) — task-3, task-4, task-18
- **D4 / C3** (stamp on every terminal outcome) — task-8, task-9, task-10
- **D5 / C4** (200-line tail bound, reused not re-read) — task-8
- **D6** (`HaltClass` not extended; re-kick byte-identical) — task-20, task-21
- **D7** (separate sidecar; #984 keeps the cap) — task-1, task-6, task-19
- **D8** (engine never adjudicates the staleness claim) — task-21
- **C2** (escalation rung in the refusal key) — task-4
- **C5** (category advisory, gates nothing) — task-14
- **Conflict D-1** (baseline at the existing probe site; no third git call) — task-7
- **Conflict D-2** (annotation rides `step_completed`; no competing heartbeat) — task-15
- **Conflict D-3** (file contention with unmerged #1270) — **no task by design.** This is a
  sequencing note: whichever branch merges second rebases onto the first. Inventing a task here
  would fabricate work, so the constraint is carried by the conflict report alone.

## Result

**Zero gaps.** All 5 outcome rows, all 7 story rows and all 21 task rows are `covered`, each
confirmed against the counterpart artifact's own text. No `gap` ids are emitted, so no
`.docs/coherence-waivers/` entry is required.
