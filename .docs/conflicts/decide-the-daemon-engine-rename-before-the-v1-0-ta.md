# Conflict Check: decide the daemon→engine rename before the v1.0 tag

**Date:** 2026-08-26
**ADR corpus:** `change_set` (config `conflict_check.adr_corpus` unset) —
adr-2026-08-26-music-vocabulary-player-composer-rename (this spec's sole ADR)
**Stories scanned:** the feature's 2 stories against `.docs/stories/` inventory, focused on
v1-window and naming-adjacent work: `v1-0-self-host-config-key-teardown`, daemon-lock/lifecycle
stories, and the unmerged #552/#226/#885/#1918 tracks.

**Result: PASSED — zero blocking, zero degrading conflicts.**

## Pairs examined (both directions)

- **Story 1 ↔ Story 2 (this feature):** Story 2's migration draft covers the surfaces Story 1
  enumerates — a one-directional dependency, not an oscillation (satisfying either does not
  re-break the other). Clean.
- **Stories ↔ ADR (change-set corpus):** stories were derived from the ADR after approval; each
  criterion cites the ADR decision it implements (decisions 2, 3, 7). No opposing sentences.
- **Story 1/2 ↔ `v1-0-self-host-config-key-teardown`:** both touch config keys in the v1 window,
  but disjoint key sets — teardown removes `owner_gate_cutover` / attribution-cutover residue;
  this feature scopes renaming player-side keys (e.g. `auto_restart_on_stale_engine`). No
  resource contention; verified by reading the teardown story's key list.
- **Stories ↔ daemon lifecycle stories (`daemon-lock-exclusivity…`, `daemon-releases-the-lock…`):**
  those stories assert daemon runtime behavior; this feature ships no runtime change (scoping
  docs only), and the future rename's alias shim preserves old command names, so those stories'
  Given/When/Then remain satisfiable under the rename. Clean in both directions.
- **Stories ↔ #1918 (verdict vocabulary):** explicit deferral is written into Story 2's negative
  path; no overlap by construction.
- **Stories ↔ #552/#226 (unmerged spec branches):** not story artifacts in this checkout;
  the cli.ts overlap is recorded as a sequencing constraint in the architecture review and in
  Story 2's sequencing criterion (rename rides the #226 major train). Constraint, not conflict.

## Accepted degrading conflicts

None.
