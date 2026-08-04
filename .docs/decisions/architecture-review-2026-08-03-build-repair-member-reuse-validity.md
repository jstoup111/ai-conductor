# Architecture Review: BUILD-verification member reuse after a repair

**Date:** 2026-08-03
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** Make the group join the sole authority that declares a
BUILD-verification member satisfied, so a repaired BUILD rejoins verification instead of parking
`needs-human`, while each member's existing evidence anchor keeps deciding whether real work runs.
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Feasible with existing engine modules and Vitest. No package, external
  service, schema migration, config key, or runtime infrastructure is added.
- **Prerequisites:** All exist and are APPROVED — the concurrent group core and its single-writer join,
  `clampToRunnablePrerequisite`, the `event-sinks.ts` registry and daemon renderer, `wiring_check`'s
  head-anchored evidence predicate, and the content-addressed full-suite proof.
- **Integration surface:** three seams — the deterministic BUILD kickback branches
  (`conductor.ts:3722-3737`), member reuse at the group engagement site
  (`conductor.ts:3328`, `:7942-7987`), and `advanceTail`'s selection (`conductor.ts:7352-7390`) —
  plus event emission and its daemon.log rendering.
- **Data implications:** none. No artifact format changes, no new persisted field, no migration. The
  gate verdict record keeps `{satisfied, reason, checkedAt, kickback?}` exactly.
- **Performance:** one extra deterministic member dispatch per post-repair round in the case where the
  repair could not have affected that member. Bounded to the wiring probe (seconds, engine-computed,
  no LLM dispatch) or a fingerprint compare that short-circuits to `REUSED`. No LLM cost is added, and
  `build_review` still runs only after the join is green, so the token-cost property of
  `adr-2026-07-29` is preserved.
- **Worktree isolation:** every read stays inside the feature worktree. No port, database, queue, or
  shared mutable service is introduced.

## Alignment

- Follows the repository's deterministic-first principle: every input to the satisfaction decision is
  mechanical, and no LLM judgement participates in it.
- **Removes** rather than adds an authority. `adr-2026-07-11` decision 5 forbids a new satisfaction
  predicate, and `adr-2026-07-26` explicitly reconciles the surface-delta mechanism against the
  progress mechanism as different questions with correctly different keys. The rejected Option B would
  have layered a third, coarser code-state authority over two gates that already carry exact ones;
  the chosen option does not.
- Extends `adr-2026-07-29-deterministic-build-verification-fanout` without altering its topology,
  concurrency cap, single-writer join, or its no-review-tokens-on-deterministic-failure property. That
  ADR's follow-up list already names a "stale-at-join" path to cover; this is it.
- Mirrors the mechanism that resolved #920 for the SHIP group — recompute each member and force
  non-green members `'stale'` before re-entry rather than concluding from a stale verdict file —
  instead of inventing a different reconciliation for BUILD.
- Preserves `adr-2026-07-11-verdict-aware-resume-entry`: the selector stays verdict-authoritative,
  `checkGate` stays state-only, and the clamp stays backward-only.
- Honors `adr-2026-07-12-wiring-check-gate` and `adr-2026-07-25-content-addressed-full-suite-proof` by
  leaving both members' evidence formats and validity rules untouched.
- Provider-neutral: both members are engine-computed and nothing here can cause an LLM dispatch for
  either.
- Builds on merged `74050ce97` (#1253), which staled the synthetic group keys; this change addresses
  the plain member key and the satisfaction authority, and does not revisit those keys.

## Wiring Surface

- **Kickback member reconciliation** — invoked by both branches of the deterministic BUILD kickback
  (`conductor.ts:3727-3736`); leaves every member of that round in the one status both satisfaction
  predicates read alike, and is the sole writer of that status on this path. Scoped to the
  BUILD-verification branches; the rebase reset path is not a consumer.
- **Post-repair round membership** — invoked at the group engagement site (`conductor.ts:3328`);
  excludes a member only by the existing skip rules, never by an on-disk gate verdict, so the join
  becomes the sole declarer of member satisfaction.
- **Tail-selection prerequisite resolution** — invoked at `advanceTail`'s selection site
  (`conductor.ts:7352-7390`) using the existing `clampToRunnablePrerequisite` and the same `checkGate`
  predicate the loop's entry check uses, so a selected step is never one the very next check rejects.
- **Member settle-decision events** — emitted by the group join from each member's own evidence
  outcome, declared in the `event-sinks.ts` registry, persisted through the existing `EventPersister`,
  and rendered by `daemon-cli.ts` on the same path `verdict_freshness` uses.

## Advisory Overlap Scan

The central engine files (`conductor.ts`, `selector.ts`, `state.ts`) appear in many open spec branch
diffs, so broad candidate-file overlap is expected and is advisory merge risk rather than a design
blocker. The semantically adjacent merged change, `74050ce97` (#1253), is complementary. The
conflict-check report at `.docs/conflicts/build-repair-preserves-stale-wiring-pass-and-halts.md`
enumerates the four accepted assertions this change interacts with and their dispositions; two carry
amendment notes authored in DECIDE and neither reverses an accepted intent. No blocking overlap
found. Implementation stays scoped to the named seams; the sanctioned finish-time rebase resolves
upstream movement.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| The tail-selection resolution changes behavior for gates outside the BUILD group, since `stepSatisfied` is shared. | Technical | Medium | High | Scope the resolution to the selector-versus-gate disagreement case; adversarial coverage proving the agreement case is unchanged on a non-BUILD gate. |
| Reconciling the kickback status is applied too broadly and changes the rebase reset path. | Technical | Medium | High | Scope strictly to the BUILD-verification kickback branches; a negative-path test pins the rebase reset target and its enumerated invalidation set unchanged. |
| Always re-dispatching erases the concurrent group's latency benefit. | Performance | Low | Medium | Each member's own anchor short-circuits: the suite returns `REUSED` on a fingerprint match and wiring re-derives only on a head mismatch. The new events make the actual reuse rate measurable. |
| A member settles from evidence it could not confirm. | Correctness | Low | High | Both anchors already fail closed to deriving fresh evidence; this change adds no preserve branch to either. Pinned by a negative-path test. |
| New event types break the registry's pre-refactor sink-membership equivalence assertion. | Integration | Medium | Medium | The registry is a total record, so an undeclared type fails compilation; the equivalence assertion is scoped to the types it was written to cover, and a test pins that it still holds. |
| Two accepted story assertions describe behavior that changes shape. | Integration | High | Low | Both amended with a dated note in DECIDE and committed with this spec, following the established precedent for refining a pinned assertion. A BUILD task could not do it: the phase-scoped `.docs` write-guard, the protected-artifact seal's own-feature-only rule, and `build_review`'s Scope rubric each forbid a build agent editing another feature's `.docs/stories/` file. |
| The reproduction test cannot reproduce the observed sequence, invalidating the reconstructed mechanism. | Technical | Low | High | It is the plan's first task and a hard precondition on every fix task; failure to reproduce stops the plan and re-derives the mechanism before any fix is written. |

## ADRs Created

- `.docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md` — **APPROVED**

## Conditions on Implementation

1. The reproduction acceptance test lands first and fails RED for the stated reason before any fix
   task begins.
2. The kickback reconciliation lands as its own task, with the observed park proven green by that
   test, before the membership and selection work starts.
3. No task may widen `stepSatisfied`'s meaning, make the selector state-authoritative, introduce a
   third satisfaction predicate, or add a second validity authority over either member's evidence.
4. No task may modify `wiring_check`'s evidence format or head-anchoring rule, or the full-suite
   fingerprint contract.
5. Every new production surface declares a design-derived `Wired-into:` contract naming a consumer from
   this review's Wiring Surface section.
6. No implementation task writes any `.docs/` path. DECIDE artifacts — including the two amended
   stories — are authored in DECIDE and committed with the spec; BUILD touches only `src/`, `test/`,
   and the human-facing `docs/` tree.
