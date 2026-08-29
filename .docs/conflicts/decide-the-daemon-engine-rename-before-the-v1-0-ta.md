# Conflict Check: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

**Date:** 2026-08-28
**Stories checked:** .docs/stories/decide-the-daemon-engine-rename-before-the-v1-0-ta.md (Stories 1–4, Accepted)
**ADR corpus:** change_set — adr-2026-08-26-music-vocabulary-player-composer-rename (rewritten 2026-08-28, APPROVED)
**Result:** CLEAN — zero blocking, zero degrading

> Overwrites the 2026-08-26 report (player/composer scope, resolved by the ADR's supersession
> ruling). The player rename left scope entirely; this report covers the surviving stories.

## Pairs examined (both directions)

- **Story 1 (compose verb) × Story 3 (composer skill):** verb `compose` vs skill `composer` is a
  deliberate ADR Decision 2 distinction, not a resource contention; the delegate's no-fork
  criterion keeps one instruction source. No conflict.
- **Story 2 (binary alias) × Story 4 (internal repoint):** satisfying S2 (conduct-ts warns) does
  not break S4 (no warnings in daemon logs) because S4 repoints every internal caller to
  `ai-conductor`; satisfying S4 does not break S2 (operator-typed conduct-ts still warns).
  Checked both directions — not an oscillation.
- **Story 1 × Story 4:** internal launch of the idea→spec loop goes through the delegate/canonical
  names; `engineer` alias warning appears only on operator-typed invocations. Compatible.
- **Story 2 × Story 2 (installer idempotence):** re-run updates the symlink in place, matching
  the existing conduct-ts pattern — no sequencing assumption between install and first use beyond
  "install creates the name," which S4's repo-relative-spawn criterion deliberately does not rely on.
- **ADR × each story:** stories derive directly from the rewritten ADR; no opposing sentences found.

## Cross-feature interactions (verified, non-blocking)

- **Existing stories referencing `conduct-ts`/`engineer` as shipped behavior** (e.g.
  `engineer-handoff-pushes-spec-branch-331.md`, `daemon-supervised-hosting.md`): the alias layer
  keeps every described behavior true verbatim (`conduct-ts …` and `… engineer …` still execute
  identically, plus a stderr warning). No contradiction; those artifacts are historical records
  and are not edited.
- **Daemon-session entry guard** (`src/conductor/src/execution/daemon-session.ts`): keys on the
  session boundary, not the invoked binary name — both names hit the same entrypoint and stay
  guarded; its message string is repointed under Story 4.
- **#226 (bin/conduct removal, installer cutover):** sequencing dependency, not a story conflict —
  #226 lands after this spec and targets `ai-conductor` as the surviving binary (recorded in the
  ADR and the architecture review's overlap note).
- **#885 / #1918:** namespace prefix and verdict vocabulary remain sequenced after; no story here
  touches their surfaces.
- **Open spec branches overlapping `src/conductor/src/index.ts` / `bin/install`** (14+ per the
  advisory overlap scan): textual merge contention on central seams, not semantic conflict; the
  parser/installer changes here are small and additive.

## Conflicts

None.
