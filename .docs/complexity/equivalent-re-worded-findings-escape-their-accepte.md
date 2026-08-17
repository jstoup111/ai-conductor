# Complexity: Equivalent re-worded findings escape their accepted dispositions across laps

Tier: M

## Rationale

Signals weighed against the standard set (models, integrations, auth, state machines, story count):

- **Data models:** one, and it is a versioned contract change rather than an additive field. The
  rubric result contract's identity inputs change shape — `concernKind` and the classification
  anchor fields become closed vocabularies, the prose subject fields leave the identity — so
  `contractVersion` goes `v1` → `v2` and `parseBuildReviewRubricContractVersion` must accept both
  while only `v2` is emitted. Per `adr-2026-08-13` that bump is *required* to invalidate old
  dispositions rather than silently rematch them, so the migration is a deliberate one-time
  invalidation that has to be reported, not a data migration.
- **Integrations:** none added. No new provider dispatch, no new boundary, no new store. This is
  the direct consequence of conforming to the ADR instead of adding a tolerant matcher — the
  withdrawn design would have added one.
- **Auth:** untouched. Dispositions stay operator-authored under the existing interactive-TTY and
  local-operator gate; nothing in this change can write one.
- **State machines:** two. The `build_review` FAIL block in `conductor.ts` gains one pure predicate
  consulted adjacent to each of seven exits, which then decide on the effective verdict instead of
  the raw aggregate — four terminal HALT paths and the kickback ledger's budget consumption among
  them. The ordering is itself ADR-governed (`adr-2026-07-27`'s cap-first rule), so getting it wrong
  either masks a ping-pong reason or turns a recoverable lap into a wrong HALT, and the exit set has
  to be grep-derived rather than enumerated by hand. Second, the grader dispatch loop: an
  out-of-vocabulary `concernKind` becomes a contract violation routed through #1605's existing
  bounded repair turn, which changes when a rubric settles as an infrastructure failure.
- **Story count:** 6.
- **Blast radius:** four engine modules and the four shipped rubric `SKILL.md` contracts. The
  reasoning radius is wider than the diff, and it is concentrated in one place: **choosing the
  vocabularies**. Too narrow and graders jam distinct concerns into one member, collapsing
  identities and silently extending an acceptance over new substance — the High-impact risk
  `architecture-review-2026-08-13-build-review-rubric-dispositions` already named. Too broad and
  the drift the feature exists to stop simply moves to a different member. That is genuine
  architectural work and needs an ADR, not a plan-task footnote.
- **Test surface:** well established at every tier —
  `test/engine/build-review-finding-identity.test.ts`,
  `test/engine/build-review-domain.test.ts`, `test/engine/build-review-disposition-race.test.ts`,
  `test/engine/step-runners.test.ts`, and `test/engine/build-review-rubric-skills.test.ts`, which
  already pins the rubric contract text and must now pin each vocabulary.
- **Documentation:** `docs/explanation/gates.md:312-317` carries the disposition-routing contract
  #1605 wrote and must state both the closed vocabulary and the hoisted re-resolution.
- **Event spine:** one additive `ConductorEvent` variant so a contract-version invalidation of
  accepted dispositions is observable rather than silent. No new channel, no new ledger.

Not Large: no new subsystem, no new integration, no consumer-visible CLI, hook, or `settings.json`
surface, and the disposition store's own schema is unchanged.

Not Small: it changes a versioned contract that ships to consumers, deliberately invalidates
operator-accepted risk once, and reorders a live state machine's terminal exits under an ordering
rule that another ADR fixes. Tiering this S would skip the conflict sweep and the architecture
review — and the sweep is precisely what caught that the first design contradicted an approved ADR.

**Agreement with the intake label.** ai-conductor#1611 carries `size: M`, which matches. The
production diff is moderate; the decision that produces it took a repo-wide sweep of 479 ADRs and
one full reversal of direction.
