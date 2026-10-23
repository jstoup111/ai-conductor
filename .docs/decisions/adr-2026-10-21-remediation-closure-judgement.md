# ADR: Completed remediation tasks are judged against their named change before BUILD hands off

**Date:** 2026-10-21
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#3190; design
reconciled with the landed #3200 citation judgement and re-approved by the operator 2026-10-23

## Context

Engine-appended remediation tasks (`rem-*`, `adr-2026-07-05-engine-owned-task-status` H3/H9) close
through the ordinary Done-when task close (`adr-2026-08-22-done-when-evidence-at-task-close`). An
untagged check records free-text `reported` evidence, and as-built remediation tasks carry only
untagged checks ("Task N is satisfied by this task.", "The repair for task … is committed and its
targeted tests pass."). In feature `a-change-to-one-stacked-child-cannot-be-carried-in` (2026-10-11)
all 20 round-1 remediation tasks closed citing one commit, and the next as-built lap found several
of the named repairs absent ("Prior finding 2 persists"). Nothing between task close and the next
full audit lap asks whether the change a remediation task names is present; each miss costs a full
as-built/PRD-audit lap (~10 minutes, ~$12 for that feature) and plan-growth allowance.

Whether a named repair is present is a judgement ("is this done?"), not a path or string test, so
per this repository's design principle machinery owns the bookkeeping (candidate selection, input
scoping, bounds, persisted verdicts, reopen) and a schema-constrained LLM judgement answers the
question.

#3200 has since shipped the local pattern at exactly this point
(`adr-2026-08-22-done-when-evidence-at-task-close` D13–D18, `adr-2026-09-06-reopened-task-resolution`
decision 13): at the end of each BUILD session, before the completion predicate, the conductor
dispatches one engine-owned, native-schema, read-only judgement over pending `[test]` citations, and
a refusal reopens the task through a repair obligation and withholds completion with a fixed reason
prefix that the stall detector exempts. It does not cover this defect: it judges only `[test]`
citations, and remediation tasks close on untagged `reported` checks. This ADR adds a sibling
judgement at the same boundary, built the same way.

Scope boundary (operator-confirmed track): engine-appended `rem-*` tasks only. Ordinary plan tasks,
`[test]` Done-when verification and the #3200 citation judgement are unchanged.

## Options Considered

### Option A: Every `rem-*` task carries a `[test]` check whose test is new in the round
- **Pros:** Mechanical; refuses at `task done`.
- **Cons:** Proves a test exists, not that the finding is fixed. The incident's PRD-audit remediation
  tasks already carried `[test]` checks.

### Option B: A sibling BUILD-boundary judgement of each closed remediation task (chosen)
- **Pros:** Asks the next audit lap's question per task, inside BUILD, before `test_suite` and
  `build_review`; one commit may still close several tasks because each is judged on its own. Reuses
  the boundary, dispatch shape, obligation pattern and stall exemption #3200 shipped.
- **Cons:** One provider call per BUILD session end with newly closed remediation tasks; a judgement
  can be wrong, so it is bounded and never the final authority.

### Option C: Extend #3200's citation dispatch to carry both questions
- **Pros:** One provider call per session end.
- **Cons:** The inputs (cited test file versus cited commits plus current code), the bounds (one
  refusal per check versus two reopens per task) and the terminal dispositions (demote to
  `unverified` versus stand closed) all differ, and one malformed output would void both verdict
  sets.

### Option D: Bind cited commits to the files a task names
- **Pros:** Deterministic and cheap.
- **Cons:** A touched file is not an implemented finding; many titles name no paths; the mechanism
  would grow an exception list.

## Decision

1. **The judgement runs at the BUILD session boundary, straight after the citation judgement.** When
   a BUILD session ends, the conductor runs the remediation-closure judgement inside the same
   boundary block as `adr-2026-08-22-done-when-evidence-at-task-close` D13, after the citation
   judgement and its settlement and admissions, and before the BUILD completion predicate is
   evaluated. The predicate stays pure and no judgement runs at `task done`. A reopen under decision
   8 withholds completion with a reason that begins with the fixed prefix
   `Remediation closure reopened:` and names each reopened task by id and title with the judge's
   rationale. When the same pass also refused a citation, the reason carries the citation lines
   first and the reopen lines after them. When the worktree has uncommitted tracked changes the
   judgement is skipped for that pass, with no dispatch, no verdict and no event; the predicate
   withholds completion for the dirty tree as it already does.
2. **Candidates are completed `rem-*` tasks with no verdict for their current close.** A candidate
   passes `isEngineAppendedRemediationTaskId`, lies in the BUILD task scope of the execution child
   (`adr-2026-10-12-routed-whole-feature-repair` decision 8; the whole plan when the feature is not
   stacked), is resolved, has no `pending-judgement` record and no open `done-when-citation`
   obligation, and has no persisted verdict for its current close identity. The close identity is a
   digest of the task id, the task's reopen count under decision 9, and its current Done-when close
   records (check text, evidence and source). It excludes the row's `commit`, its `startHead` and
   every `Task:` trailer, which rebase translation rewrites, so a rebase alone never triggers a
   re-judgement, while a reopen always yields a new identity for the next close. A task is never
   re-judged until it closes again, so a resolved verdict stands and one commit may legitimately
   close several tasks. No candidates means no dispatch and no event.
3. **The plan task block is the authority for the named change.** The judge receives, per
   candidate, the task's plan block (title, Rationale, Criterion, Governing clause, Done-when), each
   check's close-record source, and the commits that cite it: any commit SHA in its Done-when
   evidence that resolves in the repository, plus its `Task:` trailer commits in the feature evidence
   range, with their combined diff bounded at 48,000 bytes and a truncation flag. Trailer commits are
   context for the judge only, never evidence or provenance
   (`adr-2026-07-21-demote-task-stamping-to-telemetry` stands). An `unverified` close record is not
   by itself grounds for `persists` or `partial`; the question is whether the named change is
   present. No gate finding text is re-persisted.
4. **One engine-owned dispatch per pass under the `build_review` provider policy.** The engine makes
   one free-form one-shot dispatch per pass through the step runner's optional
   `dispatchRemediationClosureJudgement` port, as `dispatchDoneWhenCitationJudgement` is. The prompt
   is rendered by the engine and the output is constrained by the provider's native output schema;
   no skill is shipped. Provider, model and effort are those resolved for the `build_review` step,
   so the builder does not grade its own work. When no candidate provider declares native output
   schema support, the dispatch is unavailable.
5. **The judge reads the feature worktree read-only.** The dispatch runs with its working directory
   in the feature worktree under the read-only review capability, as the citation judgement does.
   No BUILD session runs at this boundary, so HEAD does not move; if HEAD nevertheless differs when
   the dispatch returns, its result is discarded as a failed dispatch.
6. **The result schema is closed.** The result is one entry per candidate:
   `{ taskId, verdict: resolved | persists | partial, rationale }`, with a non-empty rationale,
   exactly the candidate ids, and no other keys. Anything else, a thrown dispatch, or a provider
   failure is a failed dispatch.
7. **A failed dispatch retries once, then hands off unjudged.** The port retries a failed dispatch
   once immediately. If it fails again, or the dispatch is unavailable, or the runner has no port,
   every candidate is recorded `unjudged` for its current close, the event records outcome
   `unjudged`, and the pass reopens nothing. A broken provider never wedges BUILD; the as-built and
   PRD-audit gates remain the backstop.
8. **A non-resolved verdict reopens the task through a settled repair obligation.** For each task
   judged `persists` or `partial`, under its bound, the engine admits a repair obligation with source
   authority `remediation-closure` (`adr-2026-09-06-reopened-task-resolution` decision 14), with the
   close identity as finding id, the verdict rationale as instruction, and a HEAD boundary at
   admission, through the repair obligation store and its idempotent replay. It is marked settled at
   admission and charges no lap and no plan growth: it comes from a BUILD-internal check, not a gate
   finding. The task row is restaged pending. A reopened task closes exactly as decision 4 of that
   ADR requires, so its pre-reopen trailer no longer resolves it. The obligation has no governing
   review of its own: it ends when its task resolves, and the next pass judges the new close.
9. **Each task may be reopened at most twice, and only while a BUILD attempt remains.** The per-task
   reopen count is persisted with its verdicts. A non-resolved task at its bound, or one judged when
   no BUILD attempt remains under the step's existing retry cap, is not reopened: it stands closed,
   is named on the event as `bound-exhausted`, and BUILD proceeds. No halt class is added.
10. **The reopen retry neither ticks the stall detector nor loses its reason.** The retry a reopen
    causes draws on the existing per-step retry budget but, like the citation refusal of
    `adr-2026-08-22-done-when-evidence-at-task-close` D14, never increments `noEvidenceAttempts`:
    `isNoTaskProgressBuildStall` skips a completion reason carrying the fixed prefix. The BUILD retry
    hint names each reopened task and its rationale, and startup recovery rebuilds it from the open
    obligations.
11. **Verdicts are durable state; the judgement is an event.** Verdicts, close identities and reopen
    counts persist per plan identity in an additive, versioned section of `engine-state.json`
    through its serialized update seam (event-spine exception C: read by name as the authority for
    whether to re-judge). A present but malformed section blocks BUILD completion with a reason
    naming it, as malformed repair state does (`adr-2026-09-06-reopened-task-resolution` D3), so the
    reopen bound can never be silently reset. A non-resolved verdict, its reopen count and its
    obligation admission are applied so that a crash never leaves the task completed with that
    verdict and no open obligation, and never counts one close twice. Each dispatched pass emits one
    new `remediation_closure_judged` `ConductorEvent` carrying the outcome (`judged` or `unjudged`),
    the attempt count, and per task its id, verdict, rationale, and whether it was reopened, left
    closed, or `bound-exhausted`, with an `EVENT_SINKS` row. No other channel is added.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The plan task block names the repair specifically enough to judge it; the incident's R11 title names the resolver default and all four callers. | inferred | 80% | yes | Vague blocks yield weak verdicts; findings would then need persisting at append time. | APPROVED by operator 2026-10-21 |
| A2 | A reopen bound of two, then hand-off with the downstream gates as backstop, is the right trade between cost and intervention. | inferred | 75% | yes | Too low lets misses through to the audit lap as today; too high spends BUILD attempts. | APPROVED by operator 2026-10-21 |
| A3 | Handing off unjudged after one retry is acceptable on a failed dispatch. | inferred | 80% | yes | A persistent provider fault disables this check silently except for the event. | APPROVED by operator 2026-10-21 |
| A4 | The citation-judgement block in `conductor.ts` (guarded by `step.name === 'build'`, before `checkStepCompletion`, overriding completion with its refusal reason) is the seam, and the `Done-when citation refused:` prefix exemption in `isNoTaskProgressBuildStall` is the pattern to extend. | verified | 95% | yes | The judgement would need a different hook into BUILD completion. | n/a |
| A5 | A `Task:` trailer resolves a restaged row again unless an open obligation exists. | verified | 95% | yes | A raw restage would suffice; the obligation would be redundant. | n/a |
| A6 | `build_review` is an allowed free-form one-shot step (`ProviderAwareFreeFormOneShotStep` in `step-runners.ts`), so the port can dispatch under its provider policy with `readOnlyReview` and `nativeSchema`. | verified | 95% | yes | The port would need a new one-shot step kind or BUILD's provider policy. | n/a |
| A7 | Rebase translation (`applyMapToPipelineStore` in `rebase-translate.ts`) rewrites task-row `commit` and `startHead` and evidence-store SHAs, but not Done-when close-record evidence text, so a close identity built from Done-when records survives a rebase. | verified | 90% | yes | A rebase would re-judge every remediation task once. | n/a |

## Architectural Alignment

This ADR adds a repair source to the obligation store as decision 14 of
`adr-2026-09-06-reopened-task-resolution`; admission, replay, freshness and resolution follow its
decisions 1–6 unchanged, and its decision 11 (`plan_amendment`) and decision 13
(`done-when-citation`) are the precedents for a BUILD-internal reopen. It shares decision 13's BUILD
boundary in `adr-2026-08-22-done-when-evidence-at-task-close` and adds that ADR's D19. Plan-growth
accounting (`adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` D5/D6,
`adr-2026-08-25-as-built-remediable-findings-bounded-build-route` D9) is untouched because no task is
appended. `prd_audit` at SHIP remains the completion authority
(`adr-2026-07-23-trailer-union-build-step-routing` as amended 2026-08-22,
`adr-2026-08-22-one-owner-per-review-question`); this judgement only decides whether BUILD hands off
yet, recorded in that map by its 2026-10-23 amendment.

## Consequences

### Positive
- A claimed-but-absent repair is caught inside BUILD, before `test_suite` and `build_review`,
  instead of by the next full audit lap.
- Fewer audit laps and fewer growth-allowance raises on remediation-heavy features.

### Negative
- One extra provider call per BUILD session end that has newly closed remediation tasks.
- A wrong `persists` verdict can spend up to two BUILD attempts per task before hand-off.

### Follow-up Actions
- [ ] Add the `remediation_closure_judged` event variant and its sink declaration.
