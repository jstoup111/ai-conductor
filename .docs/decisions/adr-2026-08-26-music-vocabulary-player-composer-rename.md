# ADR: v1.0 naming — engineer→Composer, ai-conductor as the canonical CLI; daemon stays

**Status:** APPROVED
**Date:** 2026-08-26 (rewritten 2026-08-28 — see Context)
**Source:** #227 (operator-confirmed); music-system tables in the #227 comments; operator
reversal 2026-08-28
**Related:** #226 (cutover major), #885 (namespace prefix, sequenced after this), #1918
(non-breaking verdict vocabulary, deferred), adr-2026-06-29-brainstorm-rename-migration
(precedent for a boundary-only rename)

## Context

The `daemon` (autonomous builder) and `engineer` (idea→spec loop) names were slated for a rename
"at 1.0" since #227. The 1.0 major (#226, removing `bin/conduct`) is the last cheap breaking
window. The operator initially selected a music vocabulary renaming both concepts
(daemon→Player, engineer→Composer, spec #1921). On 2026-08-28 — before any implementation
reached main (the build was parked at 0/38 tasks) — the operator rescinded the Player half and
instead directed that the **installed CLI binary** take the repository's own name. Because the
rejected Player scope never produced code, this ADR is rewritten in place rather than carrying
an amendment trail; the filename keeps its original stem for reference stability.

Surface size (verified 2026-08-28): `detectEngineerCommand` keys on `argv[2] === 'engineer'` at
one parser boundary; ~10 `src/conductor/src/` files and 11 hook/skill files invoke `conduct-ts`
by name; `bin/install` manages the `conduct-ts` symlink idempotently. The `ConductorEvent`
union carries zero daemon-named identifiers (grep-verified 2026-08-26).

## Decision

1. **`daemon` stays.** The worker keeps its name: CLI subtree (`… daemon <sub>`), `.daemon/`
   durable state root, and all config keys are unchanged. No state migration, no config-key
   normalization, no `.player/` root ships — ever, under this decision.
2. **`engineer`→`composer` at the public boundary.** The canonical CLI verb for the idea→spec
   loop is **`compose`**; the skill/persona is **`composer`** (`skills/composer` canonical,
   `skills/engineer` a thin compatibility delegate for both supported host discovery
   mechanisms: Claude `/composer`, Codex `$composer`). `engineer` remains a deprecated CLI
   alias that forwards to the same typed dispatch and warns once per invocation. Internal
   module/file names (`engineer-cli.ts`) are not renamed.
3. **`ai-conductor` is the canonical installed CLI binary.** `bin/install` symlinks
   `ai-conductor` at the same TS dist entrypoint; `conduct-ts` is retained as a deprecated
   alias that warns once per invocation (invoked-name check on `$0` in the launcher, before
   symlink resolution). Internal harness call sites (engine spawns, hooks, skill text, docs)
   invoke `ai-conductor`, so the deprecated alias is operator-facing only. The `docs` half of
   that sweep is sequenced across two features — see the 2026-08-29 amendment below. The `bin/conduct`
   bash CLI is untouched here; its removal and the installer's hard-requirement cutover remain
   #226, which targets `ai-conductor` as the surviving binary.
4. **Aliases never own a second implementation.** Both the verb alias and the binary alias
   forward to the single existing dispatch/entrypoint. Alias removal is a later major, not
   scheduled here.
5. **Persisted event schema does not rename.** The `ConductorEvent` union carries no
   daemon-named identifiers; the event spine is out of the breaking surface.
6. **Rejected alternatives:**
   - **daemon→player (the original #1921 scope):** rescinded by the operator 2026-08-28 before
     implementation; the daemon vocabulary is kept, eliminating the durable-state migration and
     config-normalization machinery that dominated that plan's risk.
   - `daemon`→`engine`, `engineer`→`brain`: "engine" collides with Rails Engines and this
     repo's `src/conductor/src/engine/` internals; "brain" has no metaphor behind it.
   - Rail/Switchyard vocabulary: renames the repository itself — the largest migration risk in
     the major, for no gain.
   - Verdict vocabulary at 1.0: additive and non-breaking; deferred to #1918.
   - Re-defer everything: forfeits the last cheap breaking window before v1.0.

## Consequences

- #227 closes with a recorded decision; #885 and #226 proceed against a fixed vocabulary, and
  #226's installer cutover targets `ai-conductor`.
- The compatibility boundary is exactly three seams: the `compose`/`engineer` verb alias, the
  `composer`/`engineer` skill delegate, and the `ai-conductor`/`conduct-ts` binary alias.
- The v1 migration block covers: re-run `bin/install` (creates the `ai-conductor` symlink),
  optional continued use of `conduct-ts`/`engineer` under deprecation warnings.
- Docs and skills speak `ai-conductor` / `compose` / `composer`; `daemon` wording is correct
  and stays. The rename feature delivers the operator entry-point docs; the bulk `docs/`
  prose repoint follows in its own feature (2026-08-29 amendment).

## Amendment — 2026-08-29: the documentation repoint lands across two features

**Trigger.** The rename feature's `prd_audit` graded criterion S4.1 PLAN_GAP: Decision 3 and the
Consequences bullet above promise that docs speak `ai-conductor`, but the accepted plan's repoint
tasks scoped only `src/conductor/src/`, `hooks/`, and `skills/`. At the time of the audit
`grep -rln conduct-ts docs/` listed 27 files carrying 396 hits, none repointed, alongside
`README.md`, `HARNESS.md`, and `bin/lib/harness-common.sh:66`.

**Decision.** The documentation half of Decision 3 is sequenced, not rescinded. The rename feature
delivers the operator entry points — `README.md`, `HARNESS.md`, `docs/reference/cli.md`, and
`docs/reference/skills.md` — together with the harness's own `bin/lib/` config read. Those four
pages are the surface a new operator reads first, and the two reference pages are independently
required in the rename PR by this repository's Documentation Upkeep rule, since the feature adds
the `compose` verb and the `composer` skill. The bulk repoint of the remaining `docs/` prose is
its own feature with its own spec.

**Why sequenced rather than delivered whole.** The bulk sweep is wide and mechanical, and mixing
it into the rename diff would bury the behavioral seams — the verb alias, the skill delegate, and
the binary alias — under several hundred prose edits. Splitting keeps each diff reviewable. The
split is bounded by machinery rather than intent: the legacy-CLI guard's scanned set is the
enumeration of what is repointed, so the follow-up feature is complete exactly when the remaining
`docs/` paths join that set and the guard still passes.

**What is NOT waived.** The guard must be fail-closed before either half can be trusted. As
audited it ended in `|| true`, so a missing `rg` — the default on a checkout without ripgrep —
made it print PASS while scanning nothing, and integrity check 12b recorded that vacuous pass.
The rename feature repairs that in the same amendment that narrows its own scope.

**Consequence.** Until the follow-up feature lands, `docs/` prose outside the two reference pages
still spells `conduct-ts`. That is a documented deprecation-window state, not drift: the alias
keeps working and warns once per invocation.

## Assumptions (verify-claims)

- "`bin/conduct-ts` launcher works under a second symlink name" — verified: it resolves its
  real path via `readlink -f "$0"` (bin/conduct-ts:6); the warning check reads `basename "$0"`
  before resolution.
- "Event union carries no daemon identifiers" — verified (grep, 2026-08-26).
- "One parser boundary for the engineer verb" — verified (`engineer-cli.ts:111-114`).
