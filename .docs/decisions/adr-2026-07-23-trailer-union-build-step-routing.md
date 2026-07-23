# ADR: Build-step exit routes on the trailer-union task resolution

**Date:** 2026-07-23
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #859
**Extends:** adr-2026-07-21-demote-task-stamping-to-telemetry, adr-2026-07-21-completeness-as-build-review-rubric

<!-- Filename stem is the identifier: adr-2026-07-23-trailer-union-build-step-routing -->

## Context

#773 (adr-2026-07-21-demote-task-stamping-to-telemetry) deleted the per-task evidence-derivation
machinery and moved completion authority to `build_review`'s plan-vs-diff completeness rubric
(adr-2026-07-21-completeness-as-build-review-rubric). But the migration left the **build step's
own completion predicate** (`artifacts.ts` `CUSTOM_COMPLETION_PREDICATES.build`) gating on raw
`.pipeline/task-status.json` rows (`completed|skipped`) — and post-#773 **no live machinery writes
those statuses**: the session hook flips only `in_progress`, `conduct task done` never touches the
file (`task-cli.ts` — "completion is gate authority"), and the derivation engine that used to flip
rows is deleted. Meanwhile the stall circuit breaker (`conductor.ts` build-step retry loop) was
patched (#757/#773 Task 15) to read `countResolvedTasks` = rows ∪ `Task:` commit trailers.

Consequence (observed on flow-examples #786/PR #856, verified against source ~95%): the build
exit gate is **structurally unsatisfiable**, so at 100% completion the loop re-dispatches
already-committed tasks, the union count sits pinned at its ceiling, the breaker misreads "all
done" as "no progress", and the feature HALTs `no_task_progress` (#859). Every multi-task feature
hits this at the moment it finishes. The demote ADR's own follow-up ("preserve the #757 progress
resolved-count … source it from `Task:`-trailered commits") was applied to the breaker but never
to the exit gate — two consumers, two disagreeing definitions.

## Options Considered

### Option A: One shared trailer-union resolution for exit gate + stall breaker (CHOSEN)
Extract `resolveTaskIds(projectRoot, planIds)` — rows (`completed|skipped`) ∪ distinct `Task:`
trailers on the branch, `canonicalTaskId`-matched against plan ids; exactly the fold
`countResolvedTasks` already performs — into `task-progress.ts`. The build predicate computes
`unresolved = planIds − resolveTaskIds(…)` (fail-closed: missing/corrupt status file or plan ⇒
not done, as today); the breaker's `countResolvedTasks` is refactored onto the same resolver.
- **Pros:** exit gate and breaker can never disagree again; all-evidenced build exits to
  `build_review` (the authority) instead of halting; unresolved ids in the completion-miss reason
  steer retries away from resolved tasks; branch-derived evidence survives worktree loss (#497
  class); zero new stores, zero new steps.
- **Cons:** trailers become load-bearing for *routing* (see Decision — they remain
  non-authoritative for completion); predicate semantics change needs test rewrite.

### Option B: Ceiling escape hatch in the breaker only (`resolved ≥ total` ⇒ route onward)
- **Cons:** exit gate stays permanently unsatisfiable — every build burns ≥2 redundant dispatches
  (one zero-work) before the breaker rescues it; the two disagreeing definitions remain. Rejected.

### Option C: Flip rows to `completed` from trailer evidence (revive a light `deriveCompletion`)
- **Cons:** re-animates machinery #773 deliberately deleted; makes rows a live gating store
  again, against explicit operator direction ("nothing should gate or dispatch off those rows").
  Rejected.

### Option D: No task-level routing at all — clean session end ⇒ straight to build_review
- **Cons:** "session ended cleanly" is the least reliable doneness signal in the system
  (#433/#773 precedents); every partial session costs a grader dispatch + kickback cycle. A is D
  with a zero-cost deterministic pre-filter in front of the grader. Rejected.

## Decision

Adopt **Option A**, with these constraints:

1. **Routing vs. authority split.** `Task:` trailers are **non-authoritative routing
   telemetry**: they decide *when* the build step stops dispatching and hands off to
   `build_review`; they never assert that work is complete. `build_review`'s completeness rubric
   remains the SOLE completion authority and can FAIL a fully-trailered build and kick back.
   This *refines* — does not reverse — #773's "trailers are telemetry only".
2. **One definition, two consumers.** Both the build completion predicate and the stall breaker
   consume `resolveTaskIds`. The breaker's stall predicate itself (`attempt ≥ 2` ∧ no count
   movement ⇒ HALT) is unchanged — genuine stalls (tasks unresolved, no movement) halt exactly
   as today.
3. **Rows stay dead, but still count.** No machinery writes `completed` rows (no derivation
   revival). Rows present from operator/recovery edits or `skipped` markers still resolve — the
   union only widens resolution, never narrows it.
4. **No wedge-class reasoning.** The resolver is a plain trailer-id fold (the same one
   `countResolvedTasks` shipped with) — NO SHA reachability, NO pinned stamps, NO path
   corroboration, NO per-task attribution. The #773 guardrail against re-emerging wedge classes
   applies verbatim.
5. **Fail direction.** The gate stays fail-closed ("no data ⇒ not done"); trailer reads inside
   the resolver stay fail-soft (git error ⇒ no extra ids) — degradation is to today's row-only
   behavior, never to a false `done`. The legacy no-context fallback branch of the predicate
   (callers without `projectRoot`/`planPath`) is unchanged.
6. **Contract-text sync (same PR).** `skills/pipeline/SKILL.md`'s "the engine derives completion
   from this trailer" is corrected to the routing/authority split; `artifacts.ts`'s #773 comment
   block and `docs/daemon-operations.md`'s stall semantics likewise.

**Verified claims** (all read directly from source this session, confidence ~95%): the predicate's
row-only `unresolved` filter (`artifacts.ts:1304-1317`); no live writer of `completed`
(`task-cli.ts:169`, session-hook assets, deleted derivation per #773 ADR); breaker union via
`countResolvedTasks` (`conductor.ts:3720-3733`, `task-progress.ts:27-67`); `countResolvedTasks`'
other consumers (`daemon-cli.ts:434` progress-re-kick eligibility; kickback-escalation baselines
`conductor.ts:1909/1932`) observe identical values under the refactor (same fold, shared).

**Assumption (surfaced, low impact):** the trailer fold treats a trailered commit as resolving a
task even if later reverted on the branch. Accepted — identical to the breaker's shipped
semantics, and build_review judges the real diff regardless.

## Consequences

### Positive
- A feature whose plan tasks are all commit-evidenced reaches `build_review`, never a false
  `no_task_progress` HALT; the dispatcher stops re-issuing resolved tasks at the boundary.
- One resolution definition ends the exit-gate/breaker disagreement class.
- Worktree recreation (rows lost, branch intact) no longer false-stalls (#497 class).

### Negative
- Trailer forgery (a trailer with no real work) can route to build_review early — bounded by
  build_review's fail-closed FAIL + kickback (`MAX_KICKBACKS_PER_GATE`), which is precisely the
  authority #773 assigned it.
- The build predicate's existing row-only tests must be rewritten to the union semantics.

### Follow-up Actions
- [ ] Regression fixture: all plan tasks trailer-resolved, zero `completed` rows ⇒ build exits
      `done` and reaches build_review (the #859 shape).
- [ ] Genuine-stall fixture: tasks unresolved, count unmoved ⇒ `no_task_progress` HALT unchanged.
- [ ] Same-PR doc sync per Decision 6.
