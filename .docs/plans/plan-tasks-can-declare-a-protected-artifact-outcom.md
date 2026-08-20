# Implementation Plan: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

**Date:** 2026-08-19
**Stories:** .docs/stories/plan-tasks-can-declare-a-protected-artifact-outcom.md
**Stories status:** Accepted; Stories 1-5
**Complexity:** .docs/complexity/plan-tasks-can-declare-a-protected-artifact-outcom.md (Tier M)
**Conflict check:** Clean as of 2026-08-19 — .docs/conflicts/plan-tasks-can-declare-a-protected-artifact-outcom.md
**Review conditions:** .docs/decisions/architecture-review-2026-08-19-plan-tasks-can-declare-a-protected-artifact-outcom.md
**Design:** technical track — .docs/track/plan-tasks-can-declare-a-protected-artifact-outcom.md
**Source:** jstoup111/ai-conductor#1736

## Summary

Eight tasks that close the hole through which a plan task naming another feature's sealed artifact
reached BUILD, and correct the three normative statements that told authors it was allowed. The
governing decision (`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` §4) already
ordered this enforcement; this plan repairs an implementation that did not match it.

## Technical Approach

`scanPlanProtectedTargets` (`plan-protected-targets.ts:26-35`) branches on
`hasFilesLineByTaskId`: a task WITH a `**Files:**` line has only its declared paths checked, and a
task WITHOUT one has only its backticked prose checked. Never both. The incident task declared
`**Files:** .docs/validation/<report>.md`, so the foreign ADR named in its body was never scanned.
The fix is a union, not a new mechanism — and because the incident's ADR was another feature's
artifact, the union alone closes the observed defect.

A prose reference that names no path at all remains undetectable by a path scanner. That case was
scoped out deliberately: it has never been observed, and every candidate detector carried a
false-positive rate high enough to train authors to route around the gate — measured at 35 of 112
plans for naive marker matching. The architecture review records the measurement.

**Story 4 carries no task, deliberately.** The ADR correction was performed during DECIDE and is
already committed on this spec branch, because that file lives under `.docs/decisions/` and tasking
its mutation would commit the exact violation this feature exists to prevent. The other three
restatements (`HARNESS.md`, `skills/plan`, `skills/remediate`) are outside the sealed directories
and are ordinary BUILD tasks.

## Task Dependency Graph

```
T1 ─┬─▶ T3 ─▶ T4 ─▶ T5
T2 ─┘
T6, T7, T8   (documentation chain, independent of the engine chain)
```

---

### Task 1: RED — a task with `**Files:**` still has its prose scanned

**Story:** 1 (happy)
**Files:** src/conductor/test/engine/plan-protected-targets.test.ts
**Dependencies:** none

Add a failing test: a task declaring `**Files:** .docs/validation/report.md` whose body
backtick-cites another feature's `.docs/decisions/adr-2026-01-01-other.md` yields exactly one
violation naming that task id and that path. Must fail against current `main`.

### Task 2: RED — regression floor and the negative paths

**Story:** 1 (negative)
**Files:** src/conductor/test/engine/plan-protected-targets.test.ts
**Dependencies:** T1

Three tests that must pass both before and after the change, pinning behavior the union must not
break: the same task with its `**Files:**` line removed still yields the violation (S1.2); a task
naming `.docs/stories/<plan-stem>.md` yields none (S1.3); a task naming only `src/` and
`.docs/validation/` paths yields none (S1.4).

### Task 3: GREEN — union the `**Files:**` and prose scans

**Story:** 1 (happy)
**Files:** src/conductor/src/engine/plan-protected-targets.ts
**Dependencies:** T1; T2

Replace the `hasFilesLineByTaskId` either/or branch with a union over both sources. Keep the
`isProtectedArtifactPath` + `!namesOwnFeature` predicate exactly as-is (review condition **C2** —
this widens where the scanner looks, never what counts as protected), and keep the existing
`taskId\0path` dedup. T1 goes green; T2 stays green.

### Task 4: Corpus false-positive floor

**Story:** 1 (negative)
**Files:** src/conductor/test/engine/plan-protected-targets.test.ts
**Dependencies:** T3

Add a test running the scanner over every plan under `.docs/plans/` and asserting each reported
violation names a real protected path actually present in that task. Guards the union against
widening into a spurious blocker on a gate that fronts every `engineer land` in every consumer
repository.

### Task 5: Correct the CLI's remediation message

**Story:** 2 (happy)
**Files:** src/conductor/src/cli.ts; src/conductor/test/cli/plan-protected-targets.test.ts
**Dependencies:** T4

`cli.ts:433` prints "add `**Files:**` to declare the task's targets" — the edit that silences the
prose scan (review condition **C4**). Replace it with a message naming the task, the protected
path, and directing the amendment to DECIDE. Assert the output no longer instructs adding a
`**Files:**` line, and that a clean plan still prints the no-violations message and exits 0 (S2.2).

### Task 6: Extend the `skills/plan` prohibition

**Story:** 3 (happy)
**Files:** skills/plan/SKILL.md
**Dependencies:** none

`skills/plan/SKILL.md:143-147` has two defects: it omits `.docs/decisions/`, and it scopes the ban
to the `**Files:**` set. Add the fifth directory and extend the ban to any reference in a task that
directs an amendment (S3.2). Preserve the own-feature carve-out verbatim. Update step 8a2's wording
so it no longer implies a `**Files:**` line resolves a violation.

### Task 7: Correct the remaining normative statements

**Story:** 3 (happy)
**Files:** HARNESS.md; skills/remediate/SKILL.md
**Dependencies:** none

`HARNESS.md:123-124` and `skills/remediate/SKILL.md:101` repeat the same four-directory list. Add
`.docs/decisions/` to both. HARNESS.md is the consumer-facing contract, so its wording stays
provider-neutral and mechanism-free.

### Task 8: Author the recovery runbook

**Story:** 5 (happy)
**Files:** docs/runbooks/protected-artifact-plan-deadlock.md
**Dependencies:** T5

Document the signature (a completeness `missing-outcome` finding whose evidence cites only the plan
and the diff, with `remediation_sealed_artifact_redirect` events and no legal autonomous route), the
sanctioned exit (`conduct-ts build-review accept` with a sealed-artifact rationale), and the durable
fix (amend in DECIDE, re-author the task — never task the mutation). State plainly that this is the
accepted residue per the governing ADR §5, not a defect awaiting a bypass.

Author the runbook file only. Do **not** edit `docs/runbooks/index.md` or README's runbook list:
registering a new runbook is owned by this repository's gating `maintain-documentation` step
(`.ai-conductor/config.yml`, `after: rebase`), whose Audiences section names runbooks as its
destination and whose README ownership section governs that list. This task exists because that
step decides impact from the surfaces a diff changed, and this diff changes a scanner and prose
rather than recovery behavior — so it would record an evidence-backed no-op and the runbook would
never be written.
