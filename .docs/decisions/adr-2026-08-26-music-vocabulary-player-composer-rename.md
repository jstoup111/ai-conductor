# ADR: Adopt the music vocabulary — daemon→Player, engineer→Composer at 1.0

**Status:** APPROVED
**Date:** 2026-08-26
**Source:** #227 (operator-confirmed); music-system tables in the #227 comments
**Related:** #226 (cutover major), #885 (namespace prefix, sequenced after this), #1918
(non-breaking verdict vocabulary, deferred), adr-2026-06-29-brainstorm-rename-migration
(precedent for a state-key-safe rename)

## Context

The `daemon` (autonomous builder) and `engineer` (idea→spec loop) names were slated for a rename
"at 1.0" since #227 was filed. The 1.0 major (#226, removing `bin/conduct`) is the last cheap
breaking window. Two candidate vocabularies were developed in #227's comments: a rail/Switchyard
system and a music/orchestration system. The operator selected the music system.

Surface size (verified 2026-08-26 in this worktree): 1,532 `daemon` occurrences across 134 src
files, 414 test files, 49 docs/skills files, 111 `.daemon/` path literals; 422 `engineer`
occurrences. The `ConductorEvent` union (`src/conductor/src/ui/types.ts`) contains zero
`daemon`-named identifiers (verified: grep count 0).

## Decision

1. **The music/orchestration vocabulary is the canonical naming system** for this project:
   Conductor (this repo — the gate service), Player (the worker, replaces `daemon`), Composer
   (the idea→spec loop, replaces `engineer`), with Score/Part/Cue/Take/rehearsal/performance
   available for future use where the concepts already exist.
2. **The 1.0 major renames exactly two concepts:** `daemon`→`player` and `engineer`→`composer`,
   across: the `conduct daemon …` CLI subtree, the `engineer` CLI/skill surface, config keys
   (e.g. `auto_restart_on_stale_engine`), the `.daemon/` runtime state directory, and docs.
   The rename ships in the same major as cutover PR #226.
3. **Transition layer:** old command names (`daemon`, `engineer`) remain accepted as aliases
   that forward to the new names and print a deprecation warning; the major carries a
   `## Migration` block covering config-key and state-directory migration. Alias removal is a
   later major, not scheduled here.
4. **The repository keeps the `ai-conductor` name.** Bare `conductor` is not usable as a name
   (operator-verified); under the music system the repo is the Conductor and needs no rename —
   this removes the largest migration risk (install paths, symlinks, CLI entrypoints) from the
   major. `conduct`/`conduct-ts` entrypoints are unchanged.
5. **Persisted event schema does not rename.** The `ConductorEvent` union carries no
   daemon-named identifiers (verified above), so the event spine is out of the rename's breaking
   surface. Daemon-worded human-readable log strings are cosmetic and follow the docs sweep.
6. **Rejected alternatives:**
   - `daemon→engine`, `engineer→brain` (original proposal): "engine" collides with Rails
     Engines and with this repo's own `src/conductor/src/engine/` internals; "brain" has no
     metaphor behind it.
   - Rail/Switchyard vocabulary: renames the repository itself (install paths, symlink
     targets, CLI, model table) — the largest migration risk in the major, for no gain the
     music system doesn't also deliver.
   - Full music adoption at 1.0 including verdict vocabulary: the verdict table
     (attacca/dissonance/dal segno/da capo/rest/fermata) is a semantic labeling of existing
     states, not a rename; it is additive and non-breaking, so it is deferred to #1918 rather
     than ballooning the major.
   - Re-defer everything: forfeits the last cheap breaking window before v1.0.
7. **This spec delivers the decision and scoping only.** The rename implementation is its own
   feature, sequenced with #226; #885's namespace prefix decision unblocks on this ADR.

   > **Amended 2026-08-26 by operator review of #1921:** this spec now delivers the complete
   > rename implementation. `player` and `composer` are the canonical CLI/skill names; `daemon`
   > and `engineer` remain temporary compatibility aliases that warn once per invocation. The
   > canonical config keys are `player_verbose` and `player_auto_restart_on_stale_engine`; the
   > legacy keys remain accepted at the config-normalization boundary and emit the existing
   > `config_deprecated_key` event, with canonical values winning when both forms are present.
   > Player state writes only to `.player/`; mutating commands migrate an old-only `.daemon/`
   > tree, read-only observers may read an old-only tree without mutation, and an ambiguous
   > old+new pair is reported without overwriting either tree. Internal `engine` terminology
   > remains correct for the Conductor runtime and is not mechanically renamed.

## Consequences

- #227 closes with a recorded decision; #885 and #226 can proceed against a fixed vocabulary.
- The rename feature must follow the brainstorm-rename precedent
  (adr-2026-06-29-brainstorm-rename-migration): state-key/path migration performed at load,
  no retroactive reshuffling of in-flight features, old names mapped only at the boundary shim.
- Live operational state under `.daemon/` (pid, logs, grants, parked-restore lists, evals-raw)
  must be migrated or dual-read during the transition; this is enumerated in the rename scope,
  not solved in this ADR.
- Until the rename ships, docs and code keep `daemon`/`engineer`; no piecemeal renaming outside
  the scoped feature.

### Consequence amendment — complete implementation in this spec

- This spec's BUILD implements the rename; there is no later rename-scope feature.
- Canonical CLI and skill entrypoints are additive during the compatibility window, while legacy
  entrypoints remain aliases rather than separate runtime owners.
- Config values normalize to Player keys before consumers read them; legacy-key observability stays
  on the existing event spine.
- `.player/` becomes the only new-write root. Legacy state is retained through old-only migration or
  read-only observation, and ambiguous/partial conflicts require operator reconciliation rather than
  automatic merging.

## Assumptions (verify-claims)

- "Bare `conductor` unusable as a name" — operator-stated, unverified mechanically; impact if
  wrong: none to this decision (repo keeps `ai-conductor` either way).
- "Event union carries no daemon identifiers" — verified (grep, 2026-08-26); impact if wrong:
  scope line 5 widens, decision otherwise unchanged.
- "Verdict vocabulary is non-breaking" — inferred (labels layered on existing states); owned by
  #1918's own DECIDE, not load-bearing here.
