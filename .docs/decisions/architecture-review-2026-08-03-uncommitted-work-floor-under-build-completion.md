# Architecture Review: uncommitted-work floor under BUILD completion (#1270)

**Date:** 2026-08-03
**Tier:** M (lightweight review per the tier contract)
**Track:** technical
**ADR:** `adr-2026-08-03-uncommitted-work-floor-under-build-completion` (APPROVED)
**Verdict:** APPROVED — proceed to stories.

## What was reviewed

The proposal to make an uncommitted working tree a blocking condition on BUILD completion,
enforced at both the completion predicate and the budget-exhaustion escape, plus a narrow
additive cleanliness flag on `test-suite-evidence.json`.

## Feasibility

**Confirmed feasible with no new mechanism.** Every primitive already ships:

| Need | Existing primitive | Location |
|---|---|---|
| Porcelain read | `worktreeStatus(path)` | `worktree-shared.ts:80-82` |
| Optional injected probe on the completion context | `getHeadSha`, `isHeadPushed`, `wiringProbe`, `fullSuiteInspect` | `artifacts.ts:886-898`, built at `conductor.ts:1191-1364` |
| Miss → operator-visible reason | `CompletionResult.reason` → `lastError` → `step_failed.error` | `conductor.ts:5021`, `:5702-5713` |
| Miss → steered re-dispatch | `buildRetryHint` | `conductor.ts:8038-8102` |
| Path-list truncation format | unresolved-task reason ("3-name truncation") | `artifacts.ts:1893-1908` |
| Untracked-inclusive status precedent | `--untracked-files=all` | `land-spec.ts:447` |

No new file, store, step, gate, event type, config key, or migration is required.

## Architectural alignment

**Aligned with the repository's stated design principle.** CLAUDE.md: "Deterministic where
possible; LLM only where necessary… when an agent repeatedly violates a rule, the fix is machinery
that stamps/validates/rejects at the moment of the mistake — not a stronger prompt." The prompt-level
form of this rule already exists (`skills/pipeline/SKILL.md:427-431`, "check for uncommitted
changes") and demonstrably did not hold. Converting it to an engine-side conjunct is the textbook
application, and it follows the precedent chain the file cites (#426 path matching engine-side,
#433 engine-stamped task ids).

**Consistent with the completion-authority split.** The change is confined to the *routing*
pre-filter. It can only withhold a handoff; it cannot assert completion. `build_review` remains
sole authority (#773, #859). This is the same line the trailer-union ADR walked, and it is walked
the same way here.

## Risks examined

1. **Re-creating a wedge class.** *Examined and bounded.* The dominant risk is converting a
   self-healing retry into a permanent stall. It does not materialize: a dirty tree the next
   attempt commits moves HEAD, which the stall breaker classifies as `unattributed_progress`, not
   `no_task_progress` (`conductor.ts:5125-5185`). A dirty tree no attempt ever commits exhausts the
   budget with zero HEAD movement — a genuine wedge that *should* halt, and now does so naming the
   files instead of reporting "retries exhausted".

2. **The second door.** *Found during review; now load-bearing.* The liveness ADR's escape at
   `conductor.ts:5640-5680` bypasses the completion gate entirely. Had the change shipped as a
   predicate conjunct alone, a build that committed early and left its final attempt's work
   uncommitted would have reproduced #1270 verbatim with the guard silently overridden. **This is
   the single most important finding of the review** and is now ADR Decision 2 and Story 3.

3. **The rebase closure path.** `rebase.ts:590` runs `git rebase --autostash` precisely because "a
   daemon build/lint step can leave uncommitted changes in the worktree". A reapplied autostash can
   therefore leave a legitimately dirty tree at the post-rebase build closure check
   (`conductor.ts:7651`). *Mitigation:* the check is probe-gated, and Story 7 pins the closure
   path's behavior explicitly rather than leaving it to chance. Reviewers should treat any change
   to that story as a change to rebase semantics.

4. **Untracked-file blocking.** Widening beyond the intake's literal "tracked files" wording is a
   judgement call with a real false-positive tail (a tool dropping a non-gitignored artifact would
   now block a build). Accepted because the intake's own Impact section names untracked loss as the
   catastrophic case, and because gitignore already excludes the known offenders. Flagged in ADR
   Decision 5 as the one deliberate deviation, reversible in one line.

5. **Scope creep into #1249/#1269.** *Explicitly fenced.* ADR Decision 8 states what this change
   does not claim. The conflict-check confirms zero file overlap with either.

## Assumption ledger

| Assumption | Confidence | Impact if wrong | Disposition |
|---|---|---|---|
| No caller in the step path reads dirty state today | ~95%, verified by repo-wide search | Duplicate/conflicting enforcement | Accepted |
| `provenanceHeadSha` has zero readers | ~95%, verified | A reader would break on an additive field | Accepted — field is additive and optional |
| The exhaustion escape can fire with a dirty tree | ~90%, inferred from source; no observed instance | Story 3 guards a path that never occurs (harmless) | Accepted; Story 3 pins it by construction |
| #1270's `test_suite` FAIL causal chain | ~60%, inferred | None — no design element depends on it | **Held open, non-blocking** (ADR closing note) |
| The omission is provider-specific (Codex) | ~30%, unverified | None — the fix is engine-side and provider-agnostic | Accepted; deliberately not diagnosed |

No assumption in this ledger is load-bearing-and-unconfirmed, so no HARD-BLOCK applies.

## Conclusion

**APPROVED.** The design is minimal, uses only existing seams, follows the repository's stated
enforcement doctrine, and correctly identifies and closes both paths to `status:done`. Proceed to
stories.
