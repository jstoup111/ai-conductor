# Architecture Review: FINISH publication burns its retry budget on an unreachable transition

**Date:** 2026-08-13
**Feature:** ai-conductor#1487 — technical track, Tier M (lightweight review: feasibility +
alignment; complexity and domain pre-check skipped per tier)
**Reviewed against:** HEAD `92734d3e7`
**Stories reviewed:** none yet — this review runs before `/stories`, per
`adr-2026-06-29-architecture-before-stories-convergent-kickback`. Its input is the technical
intent in `.docs/track/finish-publication-burns-its-retry-budget-on-an-un.md` and the five
desired outcomes in `.pipeline/intake-outcomes.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | No new dependency, runtime, or service. The guard is a pure comparison over `PublicationSnapshot` values the coordinator already obtains; the halt short-circuit adds one field to an existing `gh pr view --json` invocation (`finish-publication-production.ts:233`). |
| **Prerequisites** | None. No migration, no config key, no external account. |
| **Integration surface** | Three files: `finish-publication.ts` (guard, dimension map, new `HumanRequiredReason` + guidance row), `finish-publication-production.ts` (`labels` field, halt classification via the existing predicate), and the guidance/runbook prose. `conductor.ts` is unchanged — a `human_required` disposition already routes to a halt at `:6207`. |
| **Data implications** | None. No schema, no persisted state, no new ledger or sidecar file. The fingerprint lives for the duration of one `advanceFinishPublication` call. |
| **Performance risk** | Net negative cost. A halt-state PR currently pays one provider session before looping; under the short-circuit it pays none. The guard itself is a value comparison over an observation already made. |
| **Worktree isolation** | Unaffected — no ports, services, files, or shared state introduced. |

**Reuse over new code.** The four-signal halt test already exists as `hasHaltSignal`
(`halt-pr-rehabilitation.ts:500-505`) covering title prefix, `needs-remediation` label, banner
sentinel, and the `<!-- conductor:needs-remediation -->` body marker. It is unreachable from the
coordinator today only because it lives inside `repairPresentation`, gated behind `ready_pr` and
therefore behind prose already being `accepted`. The design reuses it rather than authoring a
second halt predicate — two disagreeing halt tests would recreate the very defect class under
review.

## Alignment

**Deterministic where possible; LLM only where necessary.** Directly served. The current design
pays a provider session to have an LLM judge a condition the engine can read off two string
markers and a label. Both halves of this change move judgement from the provider to the engine.

**Extend the existing event spine; never add a parallel channel.** Satisfied with nothing new.
The guard's outcome travels on the existing `finish_publication_transition` and
`finish_publication_disposition` events and the existing `loop_halt` reason string. No watcher,
no poller, no sidecar, no timestamp stamped for later read-back. The schema-not-file test does
not trigger: no new observation is being persisted, only an existing one compared against itself.

**Re-observation remains the sole routing authority** (`adr-2026-08-01-engine-owned-resumable-finish-publication`).
The guard adds a comparison between two observations the coordinator already performs. It never
makes a previously-returned transition authoritative — which is precisely why Option B was
rejected. Explicitly checked and not violated.

**Bounded progress allowance retained** (`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`).
The allowance is untouched and still discharges the termination obligation for advances the guard
legitimately admits. This change means it is no longer the mechanism that catches a *stuck*
transition first. That ADR recorded a per-transition stuck cap as an available follow-up and
declined to build it; this decision does not build that cap either — it removes the need for one by
making a non-advance not count as progress at all.

**Halt is a state on the PR** (`adr-2026-08-09-one-pr-per-branch-halt-is-a-state`). The halt
short-circuit is an application of this governing ADR to a second reader, not a new decision — so
no ADR was written for it, per the reuse check in §7.

**State management.** The change tightens rather than loosens the state model: `advanced` stops
being a claim the effect makes about itself and becomes a fact derived from the observation. The
dimension map is exhaustive over `PublicationTransition`, so a transition added later cannot
silently opt out of the guard.

**Exhaustive matching.** `HumanRequiredReason` is a closed union rendered by
`renderHumanRequiredHaltReason` (`finish-publication.ts:619-631`) against a guidance table
(`:469-510`). The new member requires a guidance entry; the existing exhaustiveness checking makes
omitting it a compile error rather than a runtime gap.

**Production DI defaults.** Not applicable — no injected store, in-memory or otherwise, is added.

## Wiring Surface

Design-time commitment for each production surface this feature introduces or materially changes.
No `file:line` for new code, which does not exist yet; the §12 as-built sweep verifies shipped
callers independently at SHIP.

| Surface | Where it is called from in production |
|---|---|
| Dimension map over `PublicationTransition` (new, module-internal to `finish-publication.ts`) | Read by the fixed-point guard inside `advanceFinishPublication`, on the existing mandatory re-observation path each effect already runs (`:1216-1516`). |
| Fixed-point guard (new, module-internal) | Invoked by every transition arm of `advanceFinishPublication` at the point each currently calls `advancedPublicationTransition` (`:1202-1210`) — that helper is the single choke point, so the guard is wired by changing it rather than by adding seven call sites. |
| New `HumanRequiredReason` member + guidance row (extends existing closed union, `:402-…`, table `:469-510`) | Rendered by `renderHumanRequiredHaltReason` (`:619-631`), reached from `routeFinishPublicationDisposition`'s `human_required` arm (`:641-683`) and written to the halt marker by the conductor at `conductor.ts:6207`. No new routing. |
| Halt classification in `prProse` (changed, `finish-publication-production.ts:120-133`) | Called by `observePullRequest` (`:233`), which is one of the seven ports composed by `observePublicationSnapshot` (`finish-publication.ts:175-209`) — already wired at both the foreground and daemon composition roots, asserted by `test/engine/finish-publication-production-wiring.test.ts`. |
| `labels` in the `gh pr view --json` field list (changed, `finish-publication-production.ts:233`) | Same call site; an added field on an existing request, consumed only by the halt classification above. |
| Pre-judgment halt resolution (new branch in `advanceFinishPublication`) | Placed ahead of the `isPrProseJudgmentNeeded` branch (`:1332`), reached on every FINISH entry through the existing conductor dispatch. |

**Early overlap scan.** `conduct-ts overlap-scan` over the four candidate paths reports 39
overlapping branches on `finish-publication.ts`, all `origin/spec/*` branches for specs already
merged or long dormant. Advisory only; no unmerged dependent work was identified that would
collide with a task breakdown. Noted here because a silent "no overlap" would misrepresent a
scan that returned a large, uniformly stale result set.

## Assumptions

Per `/verify-claims`. Basis is `verified` (read directly at HEAD `92734d3e7`), `inferred`
(derived from adjacent evidence), or `unverified`.

| # | Assumption | Basis | Confidence | Impact if wrong |
|---|---|---|---|---|
| 1 | Cycle A is live at HEAD: a halt-classified PR whose judge returns `revision_required/placeholder` re-selects judgment forever and exhausts the 6-attempt budget. | verified — selector `:379/:383`, `isPrProseAuthoringNeeded` `:996-1000`, mapping `:1176-1186`, transition discarded at `:671-674`, memo at `finish-publication-production.ts:288-296` | 97% | If wrong, the feature's primary regression test targets a path that cannot occur, and the fix is speculative. |
| 2 | Cycle B is reachable: an `accepted` verdict on a PR that observes `halt` yields 14 refunded laps. | inferred — every code hop is verified (`:1141`, `:655`, `conductor.ts:6105-6121`); what is not observed is an LLM actually returning `accepted` for halt boilerplate | 75% | Low. The guard covers it either way; only the story's framing of Cycle B as "observed" would be wrong, so it is written as reachable-by-construction, not as an incident. |
| 3 | The dimension map admits every legitimate revisit — notably `establish_pr` re-running after `write_shipped_record` leaves the branch unpushed. | verified — that revisit moves `branchPushed` from non-`valid` to `valid`, which is inside `establish_pr`'s owned dimension; the case is the one `adr-2026-08-06-bounded-progress-allowance` cites from #1342 | 92% | High if wrong — a false halt on a healthy publication run, the exact failure that ADR warned about. Mitigated by Condition 2. |
| 4 | `pr.prose === 'indeterminate'` cannot currently reach the guard, because preflight blocks indeterminate snapshots. | verified, **with a caveat** — `validatePublicationSnapshot` (`:314-340`) treats only `outcomeRecord` and `pr.identity` as indeterminate; `pr.prose` is **not** covered, and `prProse` (`finish-publication-production.ts:120-133`) never returns `indeterminate` today | 90% | Material. Unreachable now, but a future adapter that degrades prose to `indeterminate` would turn a transient `gh` failure into a human-required halt. Addressed by Condition 1. |
| 5 | No consumer outside this module depends on `advanced` meaning "the effect ran" rather than "the dimension moved". | inferred — `conductor.ts:6101-6121` is the only consumer of `progress_finish`, and it uses the transition for telemetry and halt text only | 85% | Moderate — a hidden consumer would see fewer progress ticks. Cheap to settle during BUILD with one grep; recorded as Condition 3. |

No assumption is both load-bearing and unconfirmed, so the review does not hard-block. Assumptions
2, 4, and 5 are carried into the conditions below rather than left implicit.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A dimension mapped too narrowly false-halts a healthy publication run | Technical | Medium | High | Condition 2 — an acceptance test per transition asserting the legitimate revisit still advances; the `establish_pr`-after-`write_shipped_record` case from #1342 is mandatory coverage |
| Degraded observation (`indeterminate` in the guarded dimension) is read as a non-advance | Technical | Low | Medium | Condition 1 — indeterminate is "cannot determine", which retries; only a determinate unchanged value halts |
| New halt vocabulary leaves operators without a recovery path | Knowledge | Medium | Medium | Guidance-table row is compulsory for the union member; runbook section updated in the same PR |
| Widening halt detection to four signals reclassifies a PR that legitimately mentions the banner text | Technical | Low | Medium | The four-signal predicate is the one already used by `hasHaltSignal` in production for the same purpose; no new signal is invented |
| Documentation carries a stale allowance figure | Knowledge | High (already true) | Low | `docs/explanation/gates.md:265` says 12; the constant is 14 (`finish-publication.ts:348`). Fixed in this PR |

No Impact=High risk is left unmitigated.

## ADRs Created

- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md`
  — **APPROVED**. Establishes the fixed-point advance rule and the total dimension map over
  `PublicationTransition`; records Options B and C as rejected with reasons.

**ADRs reused, not duplicated:** `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` governs the
deterministic halt short-circuit (halt is a state to be read, not judged), so no second ADR was
written for it. `adr-2026-08-01-engine-owned-resumable-finish-publication` and
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication` are cited and preserved, not
superseded.

## Conditions

1. **Indeterminate is not a non-advance.** The guard fires only when the guarded dimension is
   determinate on both observations and unchanged. An `indeterminate` post-effect value means the
   comparison could not be made and MUST route to the existing `publication_retry` path, never to
   `human_required`. This keeps degraded observation fail-open, as `safelyObserve`
   (`finish-publication.ts:211`) intends.
2. **Every transition carries a legitimate-revisit test.** For each of the seven transitions, an
   acceptance test asserts that its genuine repeat still reports `advanced`. The
   `establish_pr`-after-`write_shipped_record` revisit documented in
   `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` is mandatory coverage — it is
   the known case a naive bound would break.
3. **Confirm no external consumer of `advanced` semantics.** Before the guard lands, grep for
   consumers of `progress_finish` and `publication_progress` outside
   `conductor.ts:6101-6121` and record the result in the plan. If another consumer treats
   `advanced` as "the effect ran", this review is re-opened.
4. **Documentation lands in the same PR.** `docs/runbooks/stalled-or-stuck-feature.md` §"FINISH
   publication halts" (`:253-296`) gains the new halt shape and its recovery;
   `docs/explanation/gates.md:265` is corrected from 12 to 14; `docs/reference/skills.md:633-650`
   and `docs/reference/steps.md:96-105` are checked for the changed advance semantics.
5. **`skills/finish/SKILL.md` is left alone unless the verdict vocabulary changes.** It is parsed
   as test input by `test/engine/finish-pr-prose-judgment.test.ts:15`. This design does not change
   the provider contract; if the plan finds it must, that is a scope change requiring operator
   confirmation.

Conditions are tracked in the plan and checked by the evaluator at code review. Unmet conditions
at `/finish` are blocking.
