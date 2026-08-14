# Complexity: FINISH publication burns its retry budget on an unreachable transition

Tier: M

## Rationale

Signals weighed against the standard set (models, integrations, auth, state machines, story count):

- **Data models:** none added. The change extends two existing closed unions
  (`PublicationTransition` outcomes and `HumanRequiredReason`) and adds an internal
  observation-fingerprint type. No persisted schema, no migration.
- **Integrations:** none added. `gh` is already an observed boundary; the only new read is
  `labels` in the existing `gh pr view --json` field list
  (`finish-publication-production.ts:233`).
- **Auth:** untouched.
- **State machines:** one, and it is the crux. `nextFinishPublicationTransition`
  (`finish-publication.ts:357-400`) plus the eight-branch executor in
  `advanceFinishPublication` (`:1216-1516`) gains a fixed-point guard, and the prose
  classifier (`finish-publication-production.ts:120-133`) gains deterministic halt
  detection. This is the single signal pushing above Small.
- **Story count:** ~5-6, all within one subsystem.
- **Blast radius:** two source files plus the conductor's disposition routing; a
  well-established test surface already exists at every tier
  (`test/engine/finish-publication.test.ts`, `finish-pr-prose-authoring.test.ts`,
  `conductor-finish-publication.test.ts`,
  `test/acceptance/unattended-finish-publication.acceptance.test.ts`,
  `finish-publication-progress-budget.acceptance.test.ts`).
- **Documentation:** ~5 canonical pages carry the retry/halt contract verbatim
  (`docs/runbooks/stalled-or-stuck-feature.md`, `docs/explanation/gates.md`,
  `docs/reference/skills.md`, `docs/reference/steps.md`, `docs/reference/models.md`).

Not Large: no new subsystem, no cross-cutting contract change, no consumer-visible CLI,
hook, or `settings.json` surface. Not Small: it alters a live state machine's advance
semantics and the halt vocabulary an operator reads, so conflict-check, an architecture
diagram, and an architecture review with an ADR are all warranted.

Consistent with the intake issue's own `size: M` label.
