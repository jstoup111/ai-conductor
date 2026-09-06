# Architecture Review: plan-growth-allowance-is-spent-on-work-existing-ta
**Date:** 2026-08-31
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track, Tier M lightweight)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- Stack-only change: two engine files (`src/conductor/src/engine/artifacts.ts` disposition
  union/validator, `src/conductor/src/engine/conductor.ts` remediation routing + budgets) plus
  `skills/remediate/SKILL.md`. No new dependencies, schema, or infrastructure. (verified)
- `remediationDispositionStep('existing-task') → 'build'` composes with
  `earliestRemediationTarget` (conductor.ts:12546) unchanged. (verified)
- Lap consumption already rides the durable kickback ledger (`gates.architecture_review_as_built`
  / `gates.prd_audit`); no new ledger schema is needed beyond the authorization event
  redefinition for `pendingAsBuiltRemediationFindings` (adr-2026-08-25 D7, amended D9). (verified)
- Task-id validation reuses `resolvePlanTaskReference` (plan-task-parse.ts), mandated by
  adr-2026-08-30 D1 — no new parser. (verified)
- Worktree isolation: no ports, services, or shared state. (verified)

## Alignment

Full APPROVED-ADR sweep (all ~250 approved ADRs read) found no hard conflict; one clause
deliberately departed from and amended in this pass:

- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` — D4 charged every
  remediable route to the shared plan-growth allowance. **Amended: decision 9 added** — the
  non-appending `existing-task` disposition charges the lap allowance only; D3/D7/D8 qualified.
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` — **Amended at D5/D6**
  (cross-notes): append caps govern appending dispositions only; growth record untouched.
- `adr-2026-08-06-publication-progress-is-its-own-disposition` — binding shape precedent:
  union + fail-closed validator + step/append helpers widen in the same change. Note
  `readRemediationPlan` silently drops unknown dispositions, so a half-landed change degrades
  to a silent no-op — the plan must widen all four in one task.
- `adr-2026-08-30-shared-plan-task-reference-resolver` — mandates the resolver for id validity;
  no `Number()`/regex re-derivation.
- `adr-2026-08-22-one-owner-per-review-question`, `adr-2026-07-10-validation-group-join` D3,
  `adr-2026-07-28` D1, `adr-2026-08-29` D1/D2, `adr-2026-07-26` D1, `adr-2026-07-13`,
  `adr-2026-08-18` — complied with as constraints; see conditions.

## Wiring Surface

- `existing-task` union member + widened validator (`readRemediationPlan`), widened
  `remediationDispositionStep` / `remediationDispositionAppendsToPlan` — consumed by the
  existing remediation routing in `conductor.ts` (gap admission loop ~:4007 and
  `earliestRemediationTarget` :12546); reached in production from the SHIP-tail verdict
  handlers that call `planRemediation` on `blocked-remediable` / prd_audit non-clean verdicts.
- Lap-only budget charge — wired into the existing `readRemediationGateAppendBudget` /
  ledger-write path in `conductor.ts` (no growth write for existing-task gaps).
- Halt-wording change — the existing `kickback-cap` halt sites in `conductor.ts` (~:4177,
  ~:4190, ~:4211); prose diagnostic only.
- `/remediate` skill contract — `skills/remediate/SKILL.md` disposition list; consumed by the
  remediation planner dispatch.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Zero-progress loop: finding bound to a task already marked done, tree never changes | Technical | Medium | High | Keep the adr-2026-07-13 no-op escalation pair armed for existing-task laps (D9 requires it) |
| Half-landed union widening degrades to silent gap-drop (validator drops unknown dispositions) | Technical | Low | High | Single task widens union, validator, step map, and append predicate together with a test that an existing-task gap survives readRemediationPlan |
| Planner over-uses existing-task to dodge the growth cap on genuinely new scope | Knowledge | Medium | Medium | Resolver-validated task binding required; skill text demands the owning Done-when clause admits the remedy; lap cap still bounds |
| Consolidated round (manual_test FAIL) accidentally takes the new route | Integration | Low | High | D8 condition unchanged; existing-task reachable only on the no-FAIL path |
| Bound tasks stay `done` in task-status.json, next dispatch has no pending work (prior restage bug) | Technical | High | High | Mandatory fail-closed re-stage of bound task ids to pending via the appender's re-seed seam (condition 6) |

## ADRs Created

None — no uncovered structural decision. Two existing governing ADRs amended (additive notes):
`adr-2026-08-25-as-built-remediable-findings-bounded-build-route` (decision 9),
`adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` (D5/D6 notes).

## Conditions

1. Union, fail-closed validator, `remediationDispositionStep`, and
   `remediationDispositionAppendsToPlan` widen in the same plan task (adr-2026-08-06 shape
   discipline); a test proves an `existing-task` gap is not silently dropped.
2. Task-id bindings resolve via `resolvePlanTaskReference` only; unresolvable id invalidates
   the disposition (fail-closed), never a silent append or drop.
3. The no-op escalation pair stays armed for existing-task laps; the tree-hash witness is the
   termination evidence.
4. `existing-task` is unreachable on consolidated (manual_test FAIL) rounds — D8 condition,
   not ordering, is the guard.
5. Halt prose names the exhausted budget as diagnostics only; typed ledger evidence stays the
   authority (adr-2026-08-29 D2). Halt class remains `kickback-cap`/`needs-human` — no new class.
6. Every `existing-task` kickback re-stages its bound task ids to `pending` in
   `.pipeline/task-status.json` via the same re-seed seam the appender uses (conductor.ts
   ~:4263), fail-closed before the rewind — the next dispatch must see the unfinished tasks as
   pending work. A route that cannot re-stage halts instead of dispatching an empty BUILD.

> **Amended 2026-09-06 by #1831:** Pending rows alone do not establish dispatchability because the shared resolver also reads old trailers. Apply `adr-2026-09-06-reopened-task-resolution` so admitted bound repairs remain open across shared resolution and reconstruction until current closure evidence exists. Admission, consolidated manual-test behavior, and lap-only charging stay unchanged; fresh evidence followed by a passing review closes without a make-work commit.
