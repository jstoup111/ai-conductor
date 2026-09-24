# Architecture Review: post-plan DECIDE amendments reconcile with the plan at BUILD entry (#1700)

**Date:** 2026-09-23
**Mode:** lightweight (tier M) — §2 Feasibility and §4 Alignment in full
**Stories reviewed:** none yet (pre-stories review); input is
`.docs/track/post-plan-decide-amendments-never-reconcile-with-t.md`, the explore decision (extend
`coverage_binding`), and the diagram `.docs/architecture/post-plan-decide-amendments-never-reconcile-with-t.md`
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from the track marker): surface a plan that fails to carry an ADR decision
or an amended DECIDE clause at BUILD entry by extending `coverage_binding`; an operator reseal that
changes DECIDE content re-arms the check; completed tasks the amendment contradicts reopen.
Excluded: halt clause-naming, an operator-ruling scope channel, `prd`/`stories` remediation
dispositions, #1643, #1778, #1851.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Every seam exists (verified by reading): `validateArchitectureObligationCoverage` (`architecture-obligation-coverage.ts`), `parseAdrDecisions` (`artifacts.ts`), the coverage-binding runner, envelope, batches and digest cache (`step-runners.ts`, `coverage-binding-envelope.ts`, `coverage-binding-batches.ts`), `resealProtectedArtifactSeal` and the reseal CLI's per-path prior/new fingerprints (`protected-artifact-seal.ts`, `reseal-cli.ts`), the repair-obligation store and `restageExistingRemediationTaskStatuses` (`repair-obligations.ts`, `conductor.ts`). |
| Prerequisites | Amendment D16–D20 on `adr-2026-08-31-coverage-binding-judge-step` (written in this pass). `skills/coverage-binding/SKILL.md` gains the amendment-claim contract. No config key: the mechanical layers are always on; judged layers follow the existing `coverage_binding.judge.enabled` (code default `false`, `resolved-config.ts`; this repository enables it in `.ai-conductor/config.yml`). |
| Integration surface | Inside `src/conductor`: coverage-binding inputs/runner/envelope, reseal path, repair-obligation admission, event union + sink registry. Skill prose. No external API beyond existing provider dispatch. |
| Data implications | Envelope entries gain a claim kind and the D18 verdict values; existing envelopes still parse (old entries are criterion claims). The gate verdict gains a reseal void origin. No migration. |
| Performance risk | Mechanical layers are pure parsing. Judged amendment claims are few per feature (0–5 observed) and digest-cached, so a re-run after a reseal re-judges only changed claims. |
| Worktree isolation | All state in the feature worktree's `.pipeline/`. No ports, services, or shared files. |

**Documentation-only?** No — engine, envelope schema, event union, and skill behavior change.

## Alignment

- **Governing ADR, amended not superseded.** `adr-2026-08-31-coverage-binding-judge-step`: D1–D15
  unchanged; D16–D20 widen D4's inputs and D9's events. Its Consequences note that a persisted
  `done` is honored until an operator rewinds — D16 closes exactly that gap for reseals.
- **`adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 7** keeps coverage
  binding non-tree-attesting. Honored: D16 is a write at the reseal, not a predicate re-check, and
  base-advance invalidation stays with that ADR's post-rebase classification. The operator chose
  this over tree-attesting eligibility (2026-09-23, this session).
- **`adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`** — untouched; its D3 read-only
  re-check is not used.
- **`adr-2026-08-03-fail-closed-decide-entry`** and **`adr-2026-08-22-one-owner-per-review-question`**
  — the step never routes to `plan` and never appends tasks; every gap is a `needs-human` refusal
  (D6) and every reopen is a restage of an existing task.
- **`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`** — the `> **Amended …**` form this
  feature reads is the one that ADR mandates; stories are replaced in place, so
  a story change on the branch re-arms the step through D16 and its changed criterion digests.
- **`adr-2026-09-02-adr-decision-citability-contract`** — decision ids come only from
  `parseAdrDecisions`; no second parser.
- **`adr-2026-08-24-refused-step-status`** — no new refusal kind.
- **Event spine** — two new `ConductorEvent` members with sink declarations; no sidecar channel.
- **Focused local pattern basis.** The reopen path follows remediation's existing-task route
  (`Conductor.planRemediation`, existing-task branch; `createRepairObligationStore().admitOrReplay`
  then `restageExistingRemediationTaskStatuses`). Traits to preserve: idempotent admission keyed on
  plan path + source + bindings + HEAD, and restage of only the bound rows. Allowed variation: the
  source authority is `coverage_binding` and the finding id is the claim digest. Rediscover by
  symbol, not line.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| DECIDE-set resolver + ADR-obligation layer | invoked by the `coverage_binding` step runner in `step-runners.ts` before batch dispatch |
| Amendment-claim extraction + judge contract | same runner; claims flow through the existing batch dispatcher |
| Void of `coverage_binding` | called from `dispatchResealCommand` after a successful `resealProtectedArtifactSeal` |
| Completed-task reopen | called from the runner after verdicts are accepted, through the repair-obligation store |
| `coverage_binding_invalidated`, `coverage_binding_task_reopened` | emitted via `ConductorEventEmitter`, registered in the exhaustive sink registry |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The resume clamp does not move back to an unsatisfied `coverage_binding` after a rewind to `build` (inferred 75%) | Technical | Medium | High | Condition C1 |
| A coherence-only edit is not sealed, so it cannot trigger D16 | Technical | Low | Low | Coherence edits accompany a plan edit, which is sealed; the land gate still validates coherence |
| Judge over-reports `contradictsCompleted`, reopening finished work | Technical | Medium | Medium | D13 exact-set validation; reopen is bounded to tasks the plan still contains; each reopen is a spine event |
| Judge disabled in consumer repos leaves amendment claims `unjudged` | Knowledge | High | Low | D17 mechanical layers still run; D7's default is unchanged by design |

## ADRs Created

None. `adr-2026-08-31-coverage-binding-judge-step` amended with D16–D20 and `adr-2026-09-06-reopened-task-resolution` amended with decision 10 (operator-approved 2026-09-23).

## Conflict-check resolutions (2026-09-23, operator-approved)

The pre-plan conflict check narrowed the design: the BUILD-time story-criterion layer is dropped
(criterion validation stays at land per `adr-2026-08-23-criterion-layer-is-structural-at-land` and
`adr-2026-07-26-daemon-decide-preseed-ownership` D4); a seal-reported self-amendment without a
reseal stays the non-fatal advisory of `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
and voids nothing; D19 reopens only after a D16 void, never on a rebase refresh
(`adr-2026-09-11-selective-post-rebase-verification` decision 4), and records digests even with the
judge off; amendment claims are a separate claim kind; `coverage_binding` gains repair authority
with its own ledger key (`adr-2026-09-06-reopened-task-resolution` decision 10). A companion
main-based PR narrows `a-coverage-claim-can-name-a-task-whose-done-when-d` Story 4 so its
judge-disabled guarantee covers judged criterion claims only (PR #2691).

## Conditions

- **C1.** The plan must prove that after a D16 void, a daemon re-dispatch, resume, and an operator
  rewind to `build` each run `coverage_binding` before any build task (the resume clamp and
  `alreadyResolved` path honor the unsatisfied status and verdict).
- **C2.** The void's origin must be a typed value distinct from the rebase kickback, and must not
  enter the rebase-only reopen branch.
- **C3.** Every refusal from D17/D18 must name the artifact path, the clause (decision id,
  criterion, or amendment text), and the plan gap, in both the halt record and `step_refused`.
