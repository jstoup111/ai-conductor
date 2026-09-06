# Architecture Review: One transient failure in a validation-group member discards its siblings (#1425)
**Date:** 2026-09-06
**Mode:** pre-stories, lightweight (Tier M), technical track
**Inputs reviewed:** `.docs/track/one-transient-failure-in-a-validation-group-member.md` (scope boundary binding), `.docs/complexity/…`, `.docs/architecture/sequences/…`, `.memory/decisions/2026-09-06-validation-group-branch-retry-budget.md`; repo-wide ADR sweep (all 553 files under `.docs/decisions/`, 305 `adr-*.md`); `src/conductor/src/engine/conductor.ts` group fan-out, join, halt, and signal paths; `group-core.ts` `runGroupBranch`; `selector.ts`/`state.ts` satisfaction predicates.
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

Two edits, both in `src/conductor/src/engine/conductor.ts`:

- **E1 — retry budget.** The trailing `maxRetries` argument to `runGroupBranch` inside
  `dispatchGroupRound` becomes the member's resolved `max_retries` (default
  `FALLBACK_RETRIES = 3`, `resolved-config.ts`), not the literal `1`.
  > **Amended 2026-09-06 by #1425:** E1 is delivered by #2190 (accepted Story 1 of
  > `a-halted-feature-only-re-runs-when-a-human-clears-`, PR #2206), found at conflict-check.
  > This spec builds E2 only, blocked by #2190; the E1 findings below stand as the corpus
  > justification #2190 relies on, and conditions C4/C5's budget-neutral tests move with E1.
- **E2 — sibling retention.** The no-verdict group halt persists `done` for satisfied
  siblings before (in the same commit as) marking the group `failed`.

Excluded, and confirmed by this review as correct exclusions: the join policy (a no-verdict
branch still halts the group), and any new observability event or halt-reason surface.

## Feasibility

| Check | E1 | E2 |
|---|---|---|
| Stack compatibility | Existing value already resolved per step (`resolveStepConfig` → `resolved.max_retries`); no new dependency. | Existing `commitStateChanges` batch write; existing `gateVerdicts` map computed by the join; no new dependency. |
| Prerequisites | None. | None — the join already computes and writes each passing member's objective gate verdict (`computeAndWriteVerdict`) BEFORE the no-verdict check runs, so the evidence E2 needs exists at that point. |
| Integration surface | One call site. Also reached by the ADR-004 `parallel:` config-DSL consumer of the same core — a behavior change for config-declared groups too (they gain the same budget). | One halt block. Downstream readers: `resolveGroupMembership` (`status === 'done'` skip), `markDownstreamStale` (done → stale), `nonGreenFinishValidators` (FINISH re-validation). |
| Data implications | None. | Writes member keys + synthetic `«group»__«member»` keys to `conduct-state.json`, the exact shape the all-green join already writes. |
| Performance | Up to 3× provider attempts per branch on genuine failure — bounded, and the serial walk already spends this. | None. |
| Worktree isolation | Unchanged. | Unchanged. |

**Verified claims (basis: read directly):**
- `runGroupBranch` loops `for attempt = 1..maxRetries`, minting a fresh session identity per
  attempt and honoring `escalateForStep`; a throw burns one attempt and continues
  (`group-core.ts`). With `1`, there is no second attempt and the escalation ladder never engages.
  95%.
- Rate-limit and auth-failure paths do not consume attempts (`group-core.ts` rate-limit branch;
  `conductor.ts` auth-failure recovery loop re-dispatches only failed members). E1 must not change
  this — and does not touch those paths. 90%.
- The no-verdict halt block commits only `{[group]: 'failed', last_step}`; `inFlightGroupCompletions`
  is cleared before it runs; green siblings are never marked `done`. 100%.
- `resolveGroupMembership` skips a member only on `getStepStatus === 'done'` (with
  `reverifyDoneMembers` false at both call sites). `stale` re-dispatches. 100%.
- `markDownstreamStale` flips `done → stale` on the bare member keys for every step after the
  kickback target, so a retained `done` is invalidated by any kickback to `build` or post-rebase
  invalidation. `dispatchGroupRound` itself restages the synthetic keys to `stale` at round start. 95%.
- `nonGreenFinishValidators` re-computes every member's objective verdict from disk at FINISH and
  treats `status !== 'done' || !verdict.satisfied || manualTestFailed` as non-green. 100%.

**Filer hypothesis vs alternative.** The issue's sketch was "give branches the serial budget".
The genuine alternative weighed at explore was retention alone, or retention plus observability;
the operator chose budget + retention. This review found no alternative mechanism for E2 that is
more ADR-compliant than a join-time write (see Alignment).

## Alignment

### E1 is mandated, not merely permitted
- `adr-2026-07-10-concurrent-group-core` **D5** (APPROVED, never amended, nothing supersedes it):
  "Branch retries reuse the step's resolved `max_retries` … semantics equivalent to the serial loop,
  scoped per branch." The literal `1` is a live violation. Per this skill's rule, existing code that
  conflicts with an APPROVED decision is tech debt, not precedent.
- `adr-2026-07-05-retry-as-escalation-ladder` **D4**: budgets floor at 3 because the model-bump rung
  lives at attempt 3. A budget of 1 disables the ladder entirely for every SHIP validator in auto mode.
- `adr-2026-07-21-s-tier-pipeline-knobs` **D2/D4**: no tier is supposed to give fewer than 3 attempts;
  the SHIP tail is tier-invariant.
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` **D5**: an absent/prior-identity
  artifact "reruns within the existing step-retry budget" — which presupposes a budget to rerun in.
- `adr-2026-07-10-validation-group-join` **D2**: a no-verdict branch halts only after "its retries
  exhausted" — with `1`, that precondition was vacuous.

**Constraints E1 must preserve (all already satisfied by the untouched paths, to be pinned by tests):**
`adr-2026-07-04-auth-failure-park-and-poll` D2 and `adr-2026-07-05-daemon-rate-limit-episode-coordinator`
D3 (neither consumes budget nor triggers escalation); `adr-2026-07-10-validation-group-join` D3 final
clause (parallelism must not multiply the per-gate kickback budgets — E1 raises the *step* budget only).

### E2 reverses a deliberate code-level choice, but not an ADR-level one
The comment at the halt block ("No partial join either: not even siblings that themselves passed get
marked 'done'") traces to the #469 story criterion "the FAIL verdict alone is NOT remediated around the
broken sibling (no partial join)". Read precisely, that criterion forbids **remediating** around a
broken sibling. E2 does not remediate; it records. The criterion survives intact; the comment
overstated it and must be rewritten in the same diff. No story amendment is required.

**Governing ADRs, reused:**
- `adr-2026-07-10-concurrent-group-core` **D6** and `adr-2026-07-10-validation-group-join` **D5**:
  the core is the single writer of `conduct-state.json` **at join**. E2 writes at the join, from the
  join, after every branch settled — the licensed shape.
- `adr-2026-08-01-conduct-state-mutation-port`: writes go through the port with explicit intent, and
  fields that form one invariant use the **atomic batch**. Hence Condition C1: the sibling `done`s and
  the group `failed` are ONE `commitStateChanges` call, never two.
- `adr-2026-07-28-total-halt-classification-legacy-boundary` **D1/D4**, `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`,
  `adr-2026-08-23-committed-halt-record` **D2**: the halt keeps its `needs-human` class, its marker,
  and its `writeHaltMarker` seam. E2 makes the halt cheaper to recover from; it does not reclassify
  or bypass it. The retention write follows `writeHaltMarker` (the existing order), so a failed
  retention write can never skip the HALT — Condition C2.

**The genuine tension, reconciled — `adr-2026-08-03-build-repair-member-reuse-validity`:** its
invariant says a member is declared satisfied for a round "only by that round's join, on evidence its
own predicate validated … no on-disk gate verdict, step status, or timestamp is sufficient authority
on its own", and it names `resolveGroupMembership`'s `status === 'done'` reuse as a defect mechanism.
E2 satisfies the invariant *literally*: the `done` is written by that round's join, for exactly the
members whose objective verdict the join computed and wrote as satisfied that round — the same
per-member predicate `allGreen` applies. It is not a status standing in for evidence; it is the
join's own verdict, persisted. The status then carries no more authority than the all-green join's
`done` already does: `markDownstreamStale` invalidates it on kickback/rebase, and FINISH re-validates
it from disk. This reconciliation is recorded as an amendment to `adr-2026-07-10-validation-group-join`
D2 (this review), and Condition C3 pins the predicate so BUILD cannot widen it to "dispatch succeeded".

**Related, read and confirmed non-blocking:**
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` D1: none of the three validators is
  tree-attesting, so no pre-dispatch recheck guards a retained `done`. Mitigated by the two downstream
  guards above (stale-on-kickback; FINISH fence). Registered as the High-impact risk.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D6 (a harness process must not
  launder failures into fresh starts): E2 writes a *green* result the join observed, never a failure;
  the failed member stays failed and the group stays halted.
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` D2: the verdict-freshness predicate.
  Unchanged; it continues to govern the verdict files the FINISH fence reads.
- `adr-2026-07-13-retry-classify-rerun-vs-route` D2 and `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind`
  D2/D3: the identical-repeat and unretryable-by-kind classifiers are specified at the SERIAL seam.
  Whether they are reachable from `runGroupBranch` is not settled by this review — Condition C4 makes
  BUILD verify it, because with a real budget an unwired classifier would spend 3 attempts where the
  serial walk routes on 1.
- `architecture-review-2026-09-05-a-halted-feature-only-re-runs-when-a-human-clears-` (#2190, in
  flight): explicitly defers the validation-group no-verdict case to #1425. Complementary, not
  colliding.

**Diagram accuracy:** `.docs/architecture/sequences/one-transient-failure-in-a-validation-group-member.md`
already shows both CHANGED points and the two unchanged guards; consistent with this review.

## Wiring Surface

No new production surface. Both edits change existing call sites on an already-wired path:
- E1: the `runGroupBranch` invocation inside `dispatchGroupRound`, reached from the auto-mode run
  loop's built-in validation-group branch (`this.mode === 'auto' && builtinGroup`), itself reached
  from `daemon-cli.ts` (the only setter of `mode: 'auto'`).
- E2: the `no-verdict` halt block in the same fan-out, reached whenever any branch outcome is
  `no-verdict` with a reason other than `authFailure` (that case is consumed earlier by the
  park-and-poll loop).

Advisory overlap scan (`ai-conductor overlap-scan --files src/conductor/src/engine/conductor.ts`):
~40 unmerged spec branches touch `conductor.ts`; none identified as touching the group fan-out or
the no-verdict halt block. Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A retained `done` is honored on re-dispatch against a tree that changed without a kickback/rebase (no validator is tree-attesting) | Data | Low | High | `markDownstreamStale` on any kickback/rebase; FINISH fence re-validates every member from disk at current HEAD; C3 restricts retention to join-validated members |
| BUILD widens the retention predicate to "dispatch succeeded" (`inFlightGroupCompletions` verbatim) | Technical | Medium | High | C3 + a negative test: a member with `verdict:pass` but unsatisfied gate / FAIL rows / handshake failure is NOT retained |
| Two state writes (siblings, then group failed) leave a torn state on crash | Data | Low | Medium | C1: one atomic batch |
| Retention write throws and skips the HALT | Technical | Low | High | C2: order is `writeHaltMarker` first; retention failure is caught, logged loudly, halt proceeds |
| Raised budget re-spends attempts on unretryable-by-kind failures the serial walk routes on try 1 | Performance | Medium | Medium | C4 |
| Config-DSL `parallel:` groups silently gain the same budget | Integration | High | Low | Document in the plan and stories; it is the ADR-004-sanctioned behavior |
| Existing acceptance flow B (`parallel-validation-phase-fan-out…acceptance.test.ts`, "a validator that throws … still lets its siblings dispatch") sees 3 `manual_test` calls instead of 1 | Technical | High | Low | Test asserts containment, not counts; remains green. Add count assertions in the new tests |

## ADRs Created

None. Structural prerequisite applied: E1 makes no structural decision (it conforms to an existing
one). E2 revises a durable state-transition design at the join, which is already governed by
`adr-2026-07-10-validation-group-join`; per the repository's amendment-over-new-ADR preference it is
recorded as an additive **Amended 2026-09-06 by #1425** note beside that ADR's D2, reconciling it with
`adr-2026-08-03-build-repair-member-reuse-validity`. No ADR is superseded.

## Conditions

- **C1 — one commit.** The retained sibling `done`s (bare member key AND synthetic
  `«group»__«member»` key, mirroring the all-green join) and `{[group]: 'failed', last_step}` are
  written in a single `commitStateChanges` call.
- **C2 — halt first, retention never blocks it.** `writeHaltMarker` precedes the state commit (as
  today). A failure in the commit is caught and logged loudly (the `persistSignalCompletionsBestEffort`
  shape); the halt, `loop_halt`, and `step_failed` still fire.
- **C3 — retention predicate is the join's, not the dispatcher's.** A member is retained iff its
  outcome is `verdict: pass` AND (when `verifyArtifacts`) its `gateVerdicts` entry is satisfied AND
  it has no handshake failure AND (for `manual_test`) `manualTestFailRows` is empty — the per-member
  body of `allGreen`. `inFlightGroupCompletions` is NOT the source. Tests must include the negative
  cases.
- **C4 — classifier reachability.** BUILD verifies whether the identical-repeat and
  unretryable-by-kind classifiers (`adr-2026-07-13` D2, `adr-2026-08-19-unretryable…` D2) are
  reachable from `runGroupBranch`. If they are not, the plan records it as a follow-up intake (not
  built here — outside the scope boundary) and the stories state the budget is spent without routing.
- **C5 — comment and budget-neutral paths.** Rewrite the "No partial join either …" comment to
  state the new rule; add tests pinning that rate-limit and auth-failure branch outcomes still
  consume zero attempts at the raised budget.
- **C6 — docs.** `docs/guides/running-the-daemon.md` and the stalled-feature runbook describe the
  re-dispatch after a validation-group halt as re-running only the failed member.
