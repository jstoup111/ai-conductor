# ADR: Done when: checks are evidenced at BUILD task close when the block exists
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Amends:** adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-07-22-per-task-work-happened-floor, adr-2026-07-21-demote-task-stamping-to-telemetry, adr-2026-07-05-engine-owned-task-status, adr-2026-07-17-verify-only-judged-closure, adr-2026-07-21-no-diff-task-evidence-stamp

## Context

#1764 made every plan task carry a `Done when:` block, gated at land only (adr-2026-08-21 D1):
300 of 301 merged plans lack it. No engine module reads the block. Earlier ADRs rejected a blocking
per-task *trailer* floor and demoted mechanical task stamping to telemetry because trailer
discipline produced false blocks.

## Options Considered

### Option A: Keep Done when: as land-gate-only prose
- **Cons:** per-task delivery has no owner once completeness is retired.

### Option B: Blocking per-task gate on every plan
- **Cons:** blocks the legacy corpus; the rejected shape of adr-2026-07-22.

### Option C: Evidence required only where the block exists (chosen)

## Decision

1. When a task has a `Done when:` block, the engine records per-check evidence (`Done-when:` lines
   in the task-close record, one per enumerated check) before marking the task `completed`; the
   write is engine-owned on the task-status record (adr-2026-07-05 H1/H4).
2. A task without the block closes on the prior evidence rule, unchanged — the legacy corpus keeps
   building. Verify-only and `Evidence: skipped` closures satisfy a check by their existing
   prove-closed path.
3. A check that cannot be made true under the approved plan is a `plan-gap` HALT from BUILD; it is
   never repaired off-plan and never appends a task.
4. This is a criteria floor on opted-in plans, not a trailer floor: adr-2026-07-22's rejection of a
   blocking trailer floor stands; adr-2026-07-21's demotion of stamping to telemetry stands.

> **Amended 2026-10-02 by #2758:** a free-text evidence string satisfied every check, so 44 of 102
> checks on one feature closed with one identical boilerplate sentence while the tests they named did
> not exist; the gap surfaced only as `prd_audit` "no test covers criterion" laps. Decisions 1-4 stand;
> the prove-closed path of decision 2 and the plan-gap route of decision 3 are narrowed for test-tagged checks only, as follows.
> Untagged checks and plans without tags close exactly as before.
>
> D5. **The plan author marks a check that requires a test; the land gate validates the mark.** A
> `Done when:` check that requires a test begins with the inline tag `[test]`, kept verbatim in the
> check text so every existing substring consumer (coherence quotes, architecture obligation
> evidence) still matches. Whether a check needs a test is the planner's judgement; no engine
> heuristic classifies untagged checks. Land refuses a malformed tag as an evidentiary defect with no
> waiver (adr-2026-08-24-evidentiary-defects-are-not-waivable), beside the existing shape rule of
> adr-2026-08-21-review-bound-by-plan-done-when-criteria D1.
>
> D6. **A tagged check closes only on a verified test reference.** The evidence is a test reference
> (file path plus test title). The engine verifies it by text alone, from the repository top level:
> the file exists at HEAD (not necessarily in the feature diff, so existing tests verify), its
> whitespace-normalized content contains the title, and it carries a `Covers:` marker naming the task
> or a story criterion the task's `Story:` lines cover. Nothing parses a language, framework, or AST,
> so every consumer project gets the same check. The file-level marker is an acceptance bound for
> closing, not a test binding (adr-2026-09-06-engine-owned-test-quality-scope D4 stands). A record is
> stamped `verified`, `reported` (untagged), `verify-only`, or `unverified` as an additive field of the
> decision 1 close record. Generic evidence, or a reference that fails any part, is refused, and the refusal
> names the check and the missing part. On a verify-only task a tagged check also needs a test
> reference or an explicit unverified close; D2's prove-closed path applies to its untagged checks only.
>
> D7. **A refused tagged check is never a plan-gap.** D3's plan-gap HALT does not apply to a missing
> test for a tagged check. The agent writes or cites the test, or closes that check as `unverified`
> with a per-check reason. An unverified close completes the task, so it never counts toward
> `no_task_progress`. No new halt class is introduced.
>
> D8. **Unverified checks get one bounded nudge, then are recorded and handed to `prd_audit`.** When
> the BUILD step session ends with unverified checks and no nudge has been spent this lap, the
> completion predicate withholds completion once, through the ordinary retry hint, naming each
> unverified check. The nudge draws on the existing per-step retry budget and does not increment
> `noEvidenceAttempts` (adr-2026-07-12-progress-aware-build-halt D1 stands for every other miss); its
> spent flag is persisted through the serialized engine-state seam
> (adr-2026-09-06-reopened-task-resolution D3). After that, BUILD completes on task resolution as
> before; the uncommitted-work floor (adr-2026-08-03) and trailer routing (adr-2026-07-23) are
> unchanged. The engine emits one `ConductorEvent` naming each still-unverified check, with an
> `EVENT_SINKS` row, and `prd_audit`'s engine-owned input carries the unverified close records so the
> audit grades them instead of rediscovering them. The `task done` CLI emits nothing itself.
>
> D9. **Criterion-bound remediation tasks are tagged.** When the existing remediation-append seam
> appends a task for a `prd_audit` FIXABLE criterion (decision 5 of
> adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback), its criterion check carries the `[test]` tag, so the repair closes under D6. No new appender
> or plan-growth source is added, and as-built REMEDIABLE tasks are unchanged.

## Consequences

### Positive
- BUILD evidences what the plan said would be true; test-quality scoping can bind to `task:<id>`.

### Negative
- New engine parser for the block (`plan-task-parse.ts` home) and a new halt class.

### Follow-up Actions
- [ ] Parser, task-close evidence write, plan-gap HALT.
