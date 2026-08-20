# Architecture Review: Rebase-invalidated test_suite proof HALTs build_review

**Date:** 2026-08-19
**Intake:** jstoup111/ai-conductor#1729
**Tier:** Medium — lightweight mode (Feasibility + Alignment; complexity and domain pre-check
delegated per the skill's Medium-tier rules)
**Stories reviewed:** none yet — this review runs before `/stories`, against the technical intent in
`.docs/track/rebase-invalidated-test-suite-proof-halts-build-re.md`
**Base:** `0b71bec78`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. Every mechanism — `checkStepCompletion`, `classifyRetryDecision`, `ConductStateStore`, the event spine — already exists and is in production use. |
| **Prerequisites** | None. No migration, no new config key (the retry change reuses `retry_routing`, `adr-2026-07-13` D6). One additive field on `StepDefinition` and one on the step-runner result. |
| **Integration surface** | Six modules: `conductor.ts` (the loop boundary and the retry branch), `steps.ts` (the eligibility declaration), `rebase.ts` + `daemon-rekick.ts` (the pre-verify set), `retry-classify.ts`, and a new CLI module. Above the 3-boundary flag, but the first four are one call chain and the change follows it end to end; the CLI verb is independent and separable. |
| **Data implications** | None persisted that is new. The rewind verb writes existing `conduct-state.json` fields through the existing port. No `.pipeline/` file changes shape, so no migration and no backfill. |
| **Performance risk** | Two additional local predicate evaluations per BUILD-region loop iteration. `build`'s walks git evidence; `test_suite`'s hashes the declared input set, which is the more expensive and scales with tracked-input count. Neither dispatches an agent. Condition 3 requires this be measured rather than asserted. |
| **Worktree isolation** | Clean. Every read and write is under the feature's own `.pipeline/`. `.pipeline/` is in `MACHINERY_AUTHORED_PATHS` (`build-review-inputs.ts:66`), so none of it enters the graded diff. |

## Alignment

**Machinery-by-default — satisfied, and this is the review's central alignment finding.** The
repository's design principle asks first whether the engine can do this mechanically. Every one of
the four changes is deterministic engine code over engine-written records; no LLM participates in any
decision. The principle's softened form (PR #1625) does not apply because none of these questions is
judgement-shaped: "is this proof current for this tree" is a hash comparison, and
`adr-2026-07-25` already made it one.

**Extension bars are met as published, not relaxed — verified against both ADRs.** This was the
review's main risk and it holds up:

- `adr-2026-07-08` states the pre-verify eligibility bar in general terms and explicitly invites
  extension: "a future gate whose predicate becomes tree-attesting can be added by meeting that bar,
  not by listing it." Its own table marked `test_suite` absent because the content-addressed
  `test_suite` did not exist at that date.
- `adr-2026-07-25` D5 supplies the qualifying property in its own words — the fingerprint, not the
  commit SHA, is the reuse key — and D8 already anticipated the consequence.

ADR-1 D6 supersedes `adr-2026-07-08`'s scope sentence for `test_suite` only, and leaves
`build_review` and `manual_test` excluded with that ADR's own reasoning restated. That is
using a published mechanism, not widening a scope.

**A rejected option is not re-opened — checked deliberately.** `adr-2026-07-11` rejected Option C
(reconcile state from verdicts) for three reasons: side-effectful read, two authorities, and
fighting `scanKickbackVerdicts`. ADR-1 D3 makes the re-check read-only and mutate nothing, so none of
the three applies. Its D7 leaves `checkGate` state-only (that ADR's D4) and `gateSatisfied` pure
(that ADR's D5). The review specifically considered whether ADR-1 is Option C in disguise and
concludes it is not: Option C copied one ledger into the other, whereas ADR-1 consults neither and
asks the tree.

**Route-on-kind — satisfied.** `adr-2026-08-18` D1 removed the last reason-text prefix match in this
codebase one day ago. ADR-2 D1 keys on the `TestSuiteProofError` class, and D2 adds a typed facet
rather than a string. The temptation to `startsWith('build_review input assembly failed')` is named
and refused in that ADR's Options.

**Event-spine principle — satisfied.** No new channel. ADR-2 D5 extends the existing `retry_decision`
member's `signal` vocabulary rather than adding a union member, so
`adr-2026-07-26-event-sink-registry-exhaustiveness` obliges no new sink. ADR-3 D5 puts the rewind on
the spine precisely because a durable state mutation with no event is the corollary violation.

**Fail direction — satisfied and load-bearing.** ADR-1 D5 dispatches on an unreadable predicate;
`adr-2026-07-08`'s "never skip on doubt" is preserved verbatim. ADR-2's non-adoption degrades to
today's retry. ADR-3 D4 orders the rewind so a mid-operation failure leaves the feature halted, not
half-rewound. Every degradation lands on current behavior or on a strictly safer state.

**Operator-lever invariant — discharged.** `adr-2026-08-05` requires the marker to name the action
that resumes it; ADR-2 D3's halt names the step that must re-run and ADR-3 supplies the command. The
two halves were designed together, which is why splitting them out of scope would have left the
invariant nominally satisfied and practically not.

**No ADR violated.** `adr-2026-07-20-post-rebase-delta-aware-invalidation` owns the
preserve/invalidate partition and is consumed unchanged — nothing here recomputes it.
`adr-2026-08-01` is applied as published for the rewind mutation. `adr-2026-07-13`'s Non-goals
(no new routing mechanism, no new budgets, no LLM, `build` excluded) are each honored.
`adr-2026-08-04`'s fail-by-name rule governs ADR-3 D1's step validation.

**Consumer-facing determination.** All four changes are shipped engine code and a shipped CLI, so
this is consumer-facing, not repo-only — the mechanism exists in every consumer project that runs the
conductor, which is the deciding test. Two behavior changes need release notes: a project whose
`test_suite` fingerprint is unstable across identical trees now re-runs the suite on resume rather
than stranding, and `build_review` may terminate after one attempt where it previously took three.

## Wiring Surface

Design-time commitments — where each new or changed production surface is called from.

| Surface | Production caller |
|---|---|
| `StepDefinition` tree-attesting declaration | Read by the loop boundary check in `conductor.ts` and by `applyRebaseVerdicts`'s pre-verify selection in `rebase.ts` |
| Loop-boundary predicate re-check | `conductor.ts` step loop, immediately before the `alreadyResolved` short-circuit (`:4351`), reached on every iteration |
| Pre-verify over the eligible set | `applyRebaseVerdicts` (`rebase.ts`), already called by `runRebaseStep` (`conductor.ts`) and `resumeRebaseFirst` (`daemon-rekick.ts:540`) |
| Unretryable facet on the step result | Set where `TestSuiteProofError` is caught (`step-runners.ts:2198`); read by `classifyRetryDecision` |
| Signal (c) in `classifyRetryDecision` | Called from the step-runner failure branch (`conductor.ts:6729`), a path reached on every step failure |
| `rewind` CLI verb | Operator-invoked only, by design (ADR-3 D6); registered in the `conduct-ts` command table beside `reseal` and `decide-grant` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The re-check is placed after the `alreadyResolved` skip and ships inert | Technical | **Medium** | **High** | Condition 1 — placement is the entire fix and a plausible-looking wrong placement produces zero test failures unless a test asserts the strand itself |
| `test_suite`'s fingerprint proves unstable across identical trees, turning the re-check into a suite re-run on every resume | Performance | Low | Medium | Condition 3 — measure before asserting; `adr-2026-07-25` D5 claims stability but it has never been measured at this call frequency |
| The eligibility declaration is added to a non-tree-attesting step later, causing permanent re-dispatch | Technical | Low | High | ADR-1 D1 makes adding one an ADR-level act; a story asserts the declared set is exactly `{build, test_suite}` |
| Signal (c) fires on a failure wrongly typed unretryable, losing legitimate retries | Technical | Low | Medium | Keyed on an error class, not a heuristic; `retry_routing.enabled: false` reverts wholesale |
| The rewind leaves a derived record uncleared, so the feature resumes from a contradictory position | Technical | Medium | Medium | ADR-3 D4's ordering plus Condition 2 |
| The release gate's classifier flags the new CLI verb as a breaking surface | Integration | Medium | Low | Additive verb; `adr-2026-07-06-migration-gate-waiver` covers it. Condition 4 |
| ADR-1 and ADR-3 both alter what a resumed feature does, and could disagree | Integration | Low | Medium | ADR-3 D2's `stale` target is chosen so the loop's own predicates agree; conflict-check adjudicates |

## ADRs Created

All three created at `Status: APPROVED` per the engineer loop's no-draft gate.

- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md` — the loop re-checks an eligible
  gate's mechanical predicate before honoring a persisted `done`; eligibility is a declared step
  property tested by `adr-2026-07-08`'s bar; `test_suite` joins the post-rebase pre-verify set.
  *Structural basis:* it changes the dispatch authority of the engine's main loop and re-partitions
  which gates a rebase pre-verifies — a control-flow boundary every consumer's build passes through.
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md` — a typed unretryable facet, a
  third classifier signal at the step-runner seam, and a `needs-human` halt that names the blocking
  step. *Structural basis:* it extends an approved classifier to a second seam and adds a terminal
  disposition, changing when a run stops.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md` — a `rewind` verb over
  `ConductStateStore`, backward-only, clearing verdicts and the halt atomically. *Structural basis:*
  a new consumer-visible CLI surface and a new authorized mutation path into engine state.

**Governing-ADR reuse check.** `adr-2026-07-08` governs the pre-verify and is extended by its own
published bar, not duplicated. `adr-2026-07-11` governs resume entry and gate satisfaction and is
left intact. `adr-2026-07-13` governs retry classification and gains a signal rather than a rival.
`adr-2026-08-01` governs state mutation and is applied as written. `adr-2026-07-20` governs
invalidation and is untouched. No existing ADR covers the loop's dispatch-boundary authority, the
step-runner retry seam, or an operator rewind verb.

## Conditions

1. **A story must assert the strand itself, not only the components.** The defect is a placement:
   the clamp already selects `test_suite` and the loop skips it anyway. A test that exercises the
   re-check in isolation passes with the check placed after the short-circuit, where it is inert.
   `/stories` must carry a scenario whose fixture is the observed state — gate verdict unsatisfied,
   `conduct-state.json` `test_suite: done`, `last_step: build_review` — asserting that `test_suite`
   is dispatched. The second variant (verdict `satisfied: true`, proof STALE) needs its own scenario,
   because a fix that only reads verdicts passes the first and fails the second.

2. **The rewind's atomicity must be asserted, not assumed.** ADR-3 D4 states an ordering; `/stories`
   must pin it with a negative scenario in which a mid-rewind failure leaves the feature halted and
   its state unchanged, rather than partially demoted. A rewind that half-applies is worse than the
   hand-edit it replaces.

3. **Measure the re-check's cost before the plan asserts it is negligible.** The feasibility table
   calls it negligible on the strength of `adr-2026-07-25` D5's stability claim, which has never been
   measured at per-iteration frequency on this repository's own tracked-input set. A plan task must
   time `FullSuiteVerifier.inspect()` in-tree and record the number; if it is not comfortably below
   the loop's existing per-iteration cost, ADR-1 D2's placement stands but the plan must add
   memoization within a single loop pass, which is a design change this review has not evaluated.

4. **Classify the release surface before the build finishes, not at the gate.** The new verb is
   additive, but the release gate's classifier is path-based. The plan must decide up front whether a
   waiver under `adr-2026-07-06-migration-gate-waiver` is owed and, if so, commit
   `.docs/release-waivers/rebase-invalidated-test-suite-proof-halts-build-re.md` in the same diff —
   naming every touched canonical surface, since partial coverage halts.

5. **Do not recompute `adr-2026-07-20`'s partition at the pre-verify site.** ADR-1 D6 changes which
   gates are pre-verified before invalidation; it must not change which gates are invalidated. The
   pre-verify consumes `classifyGateInvalidation`'s existing output. A second implementation of that
   partition is a rejection at build review.

## Notes

**Overlap scan.** `conduct-ts overlap-scan` was run over `conductor.ts`, `rebase.ts`,
`daemon-rekick.ts`, `selector.ts`, and `state.ts`. It reported no overlap and no open blockers. Each
of the four open PRs (#1720, #1687, #1581, #1168) was checked separately; none touches these files.
This is a genuinely uncontended surface, which is unusual for engine work in this repository and is
worth spending — the same files are contended in most other lanes.

**The scope question was put to the operator and answered.** The issue's six outcomes span four
mechanisms, and a narrower spec covering only the loop fix was offered. The operator chose all four
on 2026-08-19. This review records that the narrower option was genuinely viable — outcomes 1, 2 and
6 are closed by ADR-1 alone — and that the wider scope is justified by `adr-2026-08-05`'s
operator-lever invariant, which ADR-2's named halt and ADR-3's command discharge as a pair.

**One framing claim in the intake is not adopted.** The issue infers that "the disagreement between
the two records is what let the tail select `build_review`", marking it explicitly as untraced. The
verified mechanism is narrower and more actionable: the selector and the clamp both behaved
correctly and chose `test_suite`; the loop's own state-only short-circuit discarded that choice. A
design aimed at the inferred cause would have reconciled the two records — `adr-2026-07-11`'s
rejected Option C — and would have missed the second variant entirely.
