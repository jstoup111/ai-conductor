# ADR: Completed remediation tasks are judged against their named change before BUILD hands off

**Date:** 2026-10-21
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#3190

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
question. The shipped `rebase-regrade` judgement
(`adr-2026-07-20-post-rebase-delta-aware-invalidation`, 2026-10-03 amendment) is the local pattern.

Scope boundary (operator-confirmed track): engine-appended `rem-*` tasks only. Ordinary plan tasks
and `[test]` Done-when verification semantics are unchanged.

## Options Considered

### Option A: Every `rem-*` task carries a `[test]` check whose test is new in the round
- **Pros:** Mechanical; refuses at `task done`.
- **Cons:** Proves a test exists, not that the finding is fixed. The incident's PRD-audit remediation
  tasks already carried `[test]` checks; the tag only checks file, title and `Covers:` at HEAD.

### Option B: BUILD-exit judgement of each closed remediation task (chosen)
- **Pros:** Asks the next audit lap's question per task, inside BUILD, before `test_suite` and
  `build_review`; one commit may still close several tasks because each is judged on its own.
- **Cons:** One provider call per BUILD exit with candidates; a judgement can be wrong, so it is
  bounded and never the final authority.

### Option C: Bind cited commits to the files a task names
- **Pros:** Deterministic and cheap.
- **Cons:** A touched file is not an implemented finding; many titles name no paths; the mechanism
  would grow an exception list.

## Decision

1. **The judgement runs at BUILD's completion boundary, after the existing predicate passes.** When
   BUILD's completion predicate returns done, the conductor runs the remediation-closure judgement
   before it treats BUILD as complete and before the existing unverified Done-when nudge. A
   non-resolved outcome converts the result to not-done with a fixed reason prefix
   (`remediation closure judgement reopened:`). The completion predicate itself stays pure; no
   judgement runs at `task done`.
2. **Candidates are completed `rem-*` tasks with no verdict for their current close.** A candidate
   passes `isEngineAppendedRemediationTaskId`, lies in the current BUILD task scope (in a stacked
   feature, the active child's scope), is resolved, and has no persisted verdict for its current
   close identity. The close identity is a digest of the task id, its current Done-when records, and
   its newest `Task:` trailer commit. A task is never re-judged until it closes again, so a resolved
   verdict stands and one commit may legitimately close several tasks. No candidates means no
   dispatch and no event.
3. **The plan task block is the authority for the named change.** The judge receives, per
   candidate, the task's plan block (title, Rationale, Criterion, Governing clause, Done-when) and
   the commits that cite it: its `Task:` trailer commits in the feature evidence range plus any
   commit SHA in its `reported` Done-when evidence that resolves in the repository, with their diff
   bounded at 48,000 bytes and a truncation flag. No gate finding text is re-persisted.
4. **One batched auxiliary judgement through a shipped skill, under the build_review provider
   policy.** The engine makes one dispatch per BUILD exit through the existing auxiliary provider
   boundary, invoking the shipped `remediation-closure` skill (judgement policy and result contract),
   with provider, model and effort resolved from the `build_review` step so the builder does not
   grade its own work. The dispatch port is optional on the step runner, as
   `dispatchRebaseRegradeJudgement` is.
5. **The judge reads a disposable checkout, never the feature worktree.** The judgement runs with
   its working directory in a detached worktree of the judged HEAD, created before dispatch and
   removed after it, following `build-review-materialization.ts`. The feature worktree cannot be
   mutated by the judge by construction. If the feature HEAD moved during the judgement, the result
   is discarded as a judge failure.
6. **The result schema is closed.** The result is one entry per candidate:
   `{ taskId, verdict: resolved | persists | partial, rationale }`, with a non-empty rationale,
   exactly the candidate ids, and no other keys. Anything else, a thrown dispatch, or a provider
   failure is a judge failure.
7. **A judge failure retries once, then hands off unjudged.** On a judge failure the engine retries
   the dispatch once immediately. If it fails again, every candidate is recorded `unjudged` for its
   current close, the event records outcome `unjudged`, and BUILD hands off. A broken provider never
   wedges BUILD; the as-built and PRD-audit gates remain the backstop.
8. **A non-resolved verdict reopens the task through a settled repair obligation.** For each task
   judged `persists` or `partial`, under its bound, the engine admits a repair obligation with source
   authority `remediation_closure`, the close identity as finding id, the verdict rationale as
   instruction, and a HEAD boundary at admission, through the repair obligation store and its
   idempotent replay (`adr-2026-09-06-reopened-task-resolution` D1–D6). It is marked settled at
   admission and charges no lap and no plan growth: it comes from a BUILD-internal check, not a gate
   finding. The task row is restaged pending. A reopened task closes exactly as decision 4 of that
   ADR requires, so its pre-reopen trailer no longer resolves it. The obligation has no governing
   review of its own: it ends when its task resolves, and the next BUILD exit judges the new close.
9. **Each task may be reopened at most twice, and only while a BUILD attempt remains.** The per-task
   reopen count is persisted with its verdicts. A non-resolved task at its bound, or one judged when
   no BUILD attempt remains under the step's existing retry cap, is not reopened: it stands closed,
   is named on the event as `bound-exhausted`, and BUILD hands off. No halt class is added.
10. **The reopen retry neither ticks the stall detector nor loses its reason.** The no-progress stall
    detector skips a completion reason carrying the fixed prefix, as it does for the unverified
    Done-when nudge. The BUILD retry hint names each reopened task and its rationale, and startup
    recovery rebuilds it from the open obligations, as it already does for every open settled
    obligation.
11. **Verdicts are durable state; the judgement is an event.** Verdicts, close identities and reopen
    counts persist per plan identity in an additive, versioned section of `engine-state.json`
    through its serialized update seam (event-spine exception C: read by name as the authority for
    whether to re-judge). A present but malformed section blocks BUILD completion with a reason
    naming it, as malformed repair state does (`adr-2026-09-06-reopened-task-resolution` D3), so
    the reopen bound can never be silently reset. A non-resolved verdict, its reopen count and its
    obligation admission are applied so that a crash never leaves the task completed with that
    verdict and no open obligation, and never counts one close twice. Each judgement emits one new `remediation_closure_judged` `ConductorEvent`
    carrying the outcome (`judged` or `unjudged`), the attempt count, and per task its id, verdict,
    rationale, and whether it was reopened or `bound-exhausted`. No other channel is added.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The plan task block names the repair specifically enough to judge it; the incident's R11 title names the resolver default and all four callers. | inferred | 80% | yes | Vague blocks yield weak verdicts; findings would then need persisting at append time. | APPROVED by operator 2026-10-21 |
| A2 | A reopen bound of two, then hand-off with the downstream gates as backstop, is the right trade between cost and intervention. | inferred | 75% | yes | Too low lets misses through to the audit lap as today; too high spends BUILD attempts. | APPROVED by operator 2026-10-21 |
| A3 | Handing off unjudged after one retry is acceptable on judge failure. | inferred | 80% | yes | A persistent provider fault disables this check silently except for the event. | APPROVED by operator 2026-10-21 |
| A4 | The conductor's `completion.done && step.name === 'build'` region is the seam before hand-off, and the unverified-nudge prefix exemption in the stall detector is the pattern to extend. | verified | 95% | yes | The judgement would need a different hook into BUILD completion. | n/a |
| A5 | A `Task:` trailer resolves a restaged row again unless an open obligation exists. | verified | 95% | yes | A raw restage would suffice; the obligation would be redundant. | n/a |

## Architectural Alignment

This ADR adds a repair source to the obligation store without changing any decision of
`adr-2026-09-06-reopened-task-resolution`: admission, replay, freshness and resolution follow its
decisions 1–6 unchanged, and the `plan_amendment` source (its decision 11) is the precedent for a
settled, lap-free, BUILD-internal reopen. Plan-growth accounting (`adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
D5/D6, `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` D9) is untouched because no
task is appended. `build_review` remains the completion authority
(`adr-2026-07-23-trailer-union-build-step-routing`); this judgement only decides whether BUILD hands
off yet.

## Consequences

### Positive
- A claimed-but-absent repair is caught inside BUILD, before `test_suite` and `build_review`,
  instead of by the next full audit lap.
- Fewer audit laps and fewer growth-allowance raises on remediation-heavy features.

### Negative
- One extra provider call per BUILD exit that has newly closed remediation tasks.
- A wrong `persists` verdict can spend up to two BUILD attempts per task before hand-off.

### Follow-up Actions
- [ ] Ship `skills/remediation-closure/` with its model-table row and provider contract.
- [ ] Add the `remediation_closure_judged` event variant and its sink declaration.
