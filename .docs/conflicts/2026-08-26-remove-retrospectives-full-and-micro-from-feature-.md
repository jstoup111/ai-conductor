# Conflict Check: Remove retrospectives (full and micro) from feature delivery

**Date:** 2026-08-26
**Stories:** `.docs/stories/remove-retrospectives-full-and-micro-from-feature-.md` (Stories 1-6, Accepted)
**ADR corpus:** `repo_wide` (per config)
**Verdict:** CLEAR — zero blocking, zero degrading

## Corpus

Examined: the repo-wide APPROVED corpus was swept in full during this feature's
architecture-review (510 decision files + root `.memory/decisions/`; see
`architecture-review-2026-08-26-remove-retrospectives-full-and-micro-from-feature-.md` for the
examined/amended/cite-and-comply enumeration). For this check the corpus was narrowed to ADRs
whose subject overlaps the stories' behavior (step graph, engineer store, closeout obligations,
docs-write guard, skill dispatch, integrity gates):
adr-2026-08-26-remove-retrospectives-one-shot, adr-2026-08-11-deprecated-no-op-step-retirement,
adr-2026-07-26-rebase-tail-current-branch-before-publication, adr-002-engineer-store-and-retro-redirect,
adr-2026-08-08-pipeline-owned-closeout-timestamps, adr-2026-07-22-phase-scoped-docs-write-guard,
adr-2026-08-04-unresolved-step-command-fails-by-name, adr-2026-07-10-validation-group-join,
adr-2026-07-21-s-tier-pipeline-knobs, adr-2026-08-03-fail-closed-decide-entry,
adr-2026-07-07-audit-trail-event-sink, adr-006-flywheel-lesson-selection-and-provenance,
adr-2026-07-10-session-hook-task-stamping, 001-harness-architecture.
Narrowed out: all remaining APPROVED ADRs (no subject overlap with these stories; enumeration in
the architecture-review sweep). Supersession parsing: only unambiguous full supersessions
excluded (6 files); partially superseded ADRs (including adr-002, superseded in part by this
feature) retained and compared.

## Pairwise Scan (all 6 types, both directions)

- **Story 1 × Story 4** (both own the step graph): Story 4's fail-by-name on stale
  `retro` references and Story 1's serial tail are satisfiable together — fail-by-name fires on
  load/resolve, the tail governs valid state. Both directions hold. No oscillation.
- **Story 3 negative (closeout-event micro-retro rejected) × Story 3 negative (surviving
  obligation still fails closed)**: rejection of an unknown obligation and fail-closed
  enforcement of known ones are the same validation surface, not contention. Holds.
- **Story 2 × Story 4** (engineer store vs run modes): zero-provider-call on `done` holds in
  every mode Story 4 enumerates; halt path is orthogonal. Both directions hold.
- **Story 5 × Story 6** (docs/tests vs issue hygiene): disjoint resources. Holds.
- **Story 6 × residual accepted story** `retro-followups-per-step-provider-routing-927.md`:
  potential state conflict (an Accepted story whose producer is removed) is resolved inside
  Story 6 itself — the residual's disposition is an explicit criterion, not left ambiguous.
- All other pairs share no behavior, entity, field, or gate.

## ADR-versus-story

- **adr-2026-08-11-deprecated-no-op-step-retirement vs Story 1/Story 4:** the incompatibility
  ("delete the name only in a later, separate change" vs one-shot deletion) was surfaced during
  architecture-review and resolved by an explicit operator waiver on 2026-08-26, recorded in
  APPROVED `adr-2026-08-26-remove-retrospectives-one-shot` and scoped to this change only. Not a
  live conflict; the governing ADR for this change is the waiver ADR.
- **adr-2026-08-08 vs Story 3:** the "missing closeout event now fails" clause was amended
  2026-08-26 (roster shrinks in the same change); Story 3's happy path matches the amended
  decision. No opposing sentences remain.
- **adr-002 vs Story 2:** superseded in part; Story 2's surviving halt-narrative behavior matches
  the retained store-format half. No opposing sentences remain.
- **adr-2026-08-04-unresolved-step-command vs Story 4:** aligned — fail-by-name is exactly the
  decided behavior.
- Remaining narrowed corpus: cite-and-comply only (enumerated in the architecture review); no
  opposing sentence exists against any story.

## Historical story files

Retro-era accepted stories of shipped features (e.g. `features/retro/ST-024-dual-retrospective.md`)
are records of past deliveries, not live requirements; they are not comparison parties for new
work and are left untouched (consistent with keeping historical `.docs/retros/`).

## Result

Conflict check passed. Zero blocking, zero degrading, no story edits required, no new ADRs
created by this check. Proceed to `/plan`.
