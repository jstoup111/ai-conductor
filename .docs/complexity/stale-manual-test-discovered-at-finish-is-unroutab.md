# Complexity: Stale manual_test discovered at FINISH is unroutable

Tier: M

## Rationale

Signals weighed against the standard set (models, integrations, auth, state machines, story count):

- **Data models:** none added or changed. No persisted schema, no migration, no config key, and no
  change to `GateVerdict`'s shape. The router's condition handling becomes a total mapping over an
  existing closed union.
- **Integrations:** none. No new boundary and no new export — the primary change deletes a disjunct
  from an existing guard clause (`conductor.ts:1609`).
- **Auth:** untouched.
- **State machines:** one, and it is the crux — this is the signal that keeps the work above Small.
  Restoring the fence changes *when publication is authorized*: a run that previously dispatched
  `finish` may now be redirected into the validation group first. That is the governing ADR's
  intent, but it alters live SHIP-tail navigation for every in-flight feature, and getting the
  redirect target or the preservation semantics wrong trades one non-terminating loop for another.
- **Story count:** 5.
- **Blast radius:** two source files, but the reasoning radius is much wider than the diff. The
  change reconciles four APPROVED ADRs — it conforms to `adr-2026-07-26`, deliberately declines
  `adr-2026-08-01` D5's SHIP clause, and must satisfy `adr-2026-07-13`'s no-op prohibition and
  `adr-2026-07-22`/`adr-2026-07-20`'s preserve-when-unchanged rule. Deciding that reconciliation is
  genuine architectural work and needed an ADR, not a plan-task footnote; the first design was
  withdrawn precisely because it got it wrong.
- **Test surface:** well established at every tier —
  `test/engine/conductor-finish-publication.test.ts`,
  `test/engine/finish-publication.test.ts` (pins the current four-code halt at `:836-865`), and
  `test/acceptance/unattended-finish-publication.acceptance.test.ts`.
- **Documentation:** the halt and kickback contract is stated in `docs/explanation/gates.md`,
  `docs/reference/steps.md`, and `docs/runbooks/stalled-or-stuck-feature.md`, whose manual recovery
  this change automates.

Not Large: no new subsystem, no cross-cutting contract change, and no consumer-visible CLI, hook, or
`settings.json` surface.

Not Small: it changes when a live state machine authorizes publication, and it required an
architecture review with an ADR plus a repo-wide conflict sweep to establish which of two
plausible designs was safe — exactly the work the S-tier exemption skips. Had this been tiered S,
conflict-check would not have run and the withdrawn FINISH→BUILD design would have shipped against
three APPROVED decisions.

**Deliberate disagreement with the intake label.** ai-conductor#1613 carries `size: S`. That
estimate was made from the symptom ("wire the already-named `nextAction` to a routing rule") before
exploration found the disabled fence, the single-commit root cause, and the four-ADR reconciliation.
The final production diff may well be S-sized — one disjunct and one mapping — but the decision that
produces it is not.
