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


> **Amended 2026-10-21 by #3200:** D6's text-only check accepted any test that existed at HEAD, matched
> the title as a substring, and shared a file-level `Covers:` marker. On one feature, only 34 of 185
> `[test]` citations asserted the check they closed, and the gap surfaced only through `prd_audit` laps
> (plan 33 → 98 tasks, 13 production bugs hidden). D1-D9 stand. D6's text checks still run first and
> still refuse; what a passing reference proves is now split by provenance, as follows. Untagged checks
> and plans without tags close exactly as before. `Task:` trailers stay telemetry
> (adr-2026-07-21-demote-task-stamping-to-telemetry) and are never read for provenance.
>
> D10. **Task start records its start commit.** `conduct task start` writes the current HEAD as an
> additive `startHead` field on the task's engine-owned task-status row (adr-2026-07-05 H1/H4). A task
> closed without a start, or started before this field existed, has no `startHead`.
>
> D11. **A test the task itself wrote closes mechanically.** After D6's checks pass, a `[test]` check is
> stamped `verified` only when `startHead` is an ancestor of HEAD and the cited title, whitespace-
> normalized, appears in the whitespace-normalized added lines of `git diff <startHead> HEAD -- <path>`.
> This is git and text only, with no language, framework, or AST parsing. A test that another task
> added inside the same window also counts as new. No judgement, no delay, no added cost.
>
> D12. **Every other citation closes pending judgement.** When D11 does not hold (no `startHead`, an
> unreachable `startHead` after a rebase, or a title that is not on an added line because the test
> predates the task or only its body changed), the check is recorded with source
> `pending-judgement` and the task completes. The `task done` CLI still runs no model and emits nothing.
>
> D13. **The conductor judges pending citations at the BUILD boundary.** When a BUILD session ends and
> any `pending-judgement` record exists, the conductor dispatches one judgement over all of them before
> the BUILD completion predicate is evaluated. The judgement is read-only and uses the provider's native
> output schema. Its input for each citation is the check text, the task text, the cited path and title,
> and the bounded content of the cited file at HEAD. It returns, per citation,
> `{ verdict: 'asserts' | 'does-not-assert', reason }`, and the engine stamps the envelope. A provider
> failure or schema-invalid output is a failed dispatch, retried once. A failed dispatch is never a
> refusal and never counts toward D14's bound.
>
> D14. **A refusal reopens the task, bounded.** `asserts` stamps source `judged` with the reason.
> `does-not-assert` reopens the task through a repair obligation
> (adr-2026-09-06-reopened-task-resolution decision 13), and the BUILD retry hint names the task, the
> check, the citation, and the judge's reason. That routes the task back to BUILD inside the same BUILD
> step rather than laps later. The engine persists a refusal count for each check, keyed by task id,
> check index, and check-text digest. A second refusal of the same check, a refusal when no BUILD
> attempt remains, or a refused check that BUILD completes without re-closing is demoted instead: the
> check is recorded `unverified`, with the judge's reason as its reason, and follows D8 unchanged. A
> refusal never halts the feature.
>
> D15. **A judgement that cannot run never blocks.** When no candidate provider declares native output
> schema support, or the dispatch fails twice, every pending record is demoted to `unverified` with the
> reason `citation judgement unavailable: <cause>` and follows D8. BUILD proceeds.
>
> D16. **The operator can overturn a refusal.** `ai-conductor done-when accept --feature <slug> --task
> <id> --check <n> --reason <text>` accepts a check whose latest judgement is `does-not-assert`, whether
> it is reopened or demoted. It records source `operator-accepted` with the reason, resolves that
> check's citation repair obligation, and emits a `ConductorEvent`. It refuses a check with no recorded
> refusal. `done-when` is not a session-sanctioned subcommand, so the daemon-session guard refuses it
> inside every dispatched session; only an operator can run it.
>
> D17. **The close-record source set grows, and stays closed.** `source` is exactly one of `verified`,
> `reported`, `verify-only`, `unverified`, `pending-judgement`, `judged`, or `operator-accepted`, and
> every consumer matches it exhaustively. `prd_audit`'s input still carries only `unverified` records
> (D8), which now include demoted refusals.
>
> D18. **Citation judgement is observable on the existing spine.** Each judgement pass emits one
> `ConductorEvent` listing each citation's task, check, and verdict (or demotion cause). Each
> `done-when accept` emits one naming the task, check, and reason. Both have `EVENT_SINKS` rows.

## Consequences

### Positive
- BUILD evidences what the plan said would be true; test-quality scoping can bind to `task:<id>`.

### Negative
- New engine parser for the block (`plan-task-parse.ts` home) and a new halt class.

### Follow-up Actions
- [ ] Parser, task-close evidence write, plan-gap HALT.
