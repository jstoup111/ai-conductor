# Conflict Check: External-boundary registry and ratchet (#1989)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/external-boundaries-have-no-swappable-seams-rerout.md` (Stories 1–4)
against all 676 files in `.docs/stories/`. Pairs were narrowed to stories that share a gate, file
set, or entity: structural import checks over `src/conductor/src/`, the entry layer, allowlists,
process, git, gh and tmux spawning, and registries.
**Result:** PASSED. Zero blocking conflicts, zero degrading conflicts.

## Pairs examined (both directions)

| Existing story file | Shared surface | A fully satisfied → B holds? | B fully satisfied → A holds? | Verdict |
|---|---|---|---|---|
| `module-layering-is-prose-only-violations-merge-wit.md` (#1988, Stories 1–2) | default-tier AST check over `src/conductor/src/`, entry-layer definition, sorted shrink-only allowlist | Yes. The layer ratchet judges file-to-file edges, and the boundary ratchet judges (file, boundary) touches, in a separate allowlist file. | Yes. Neither rule allowlists or forbids the other's subject. | No conflict |
| `break-the-engine-ui-import-cycle-and-stop-types-im.md` (#1017, Story 1) | same check and file set; dynamic `import()` counted | Yes. #1017 counts dynamic `import()` for upward layer edges. Story 2 here counts dynamic `import()` of external specifiers, which is a different subject with the same treatment. | Yes | No conflict |
| `break-the-engine-ui-import-cycle-and-stop-types-im.md` (#1017, Story 4: `execution/` imports nothing from `engine/`) | `execution/` adapters | Yes. Registering `execution/*-provider.ts` as `llm` adapters adds no import. | Yes | No conflict |
| `decompose-conductor-ts-god-class-target-architectu.md` (Story 3: only `index.ts` and `daemon-cli.ts` import `conductor.js`) | entry-layer files | Yes. Composition roots here are all top-level entry files for adapter imports only. That rule does not widen who may import `conductor.js`. | Yes | No conflict |
| `isolate-real-tmux-tests-from-operator-sessions.md` (Story 5: tmux-access audit) | direct `tmux` spawn detection, justified allowlist with stale-entry failure | Yes. The audit scans test sources, and this ratchet scans only `src/conductor/src/`. | Yes | No conflict (disjoint file sets) |
| `canonical-tracker-client-seam-with-per-backend-tra.md` ("the only production `gh` factory") | `gh` spawning | Yes. The `gh` boundary stays `pending`, and the tracker client's existing spawn is seeded into the allowlist. Nothing in this spec moves or forbids it. | Yes | No conflict |
| `paired-enumerations-that-must-agree-drift-with-no-.md` (matched-pair registry) | declared registries checked by a structural test | Yes. The boundary registry is a separate declaration, and no pair spans it yet. | Yes | No conflict |

No oscillation: in every pair, satisfying the new story leaves the other's gate unchanged, and the
reverse also holds.

## ADRs examined

**Narrowed in, compared against Stories 1–4:**
- `adr-2026-11-07-external-boundary-ports-registry-and-ratchet`: governs these stories, with no
  contradiction.
- `adr-2026-10-07-conductor-decomposition-target-architecture`:
  - D5 (layer ratchet): reused conventions.
  - D6 (one git port, ratchet forbids direct spawns): delivered by the boundary ratchet's `git` row
    once #3043 ports git. Story 2 already rejects new unlisted literal `git` spawns, which is
    consistent with D6.
  - D7 (roadmap): unchanged.
- `adr-2026-10-12-enforced-source-layer-directions`: decision 1 (only entry imports entry) and
  decisions 3–4 (entry-level composition, injected ports) are consistent with Story 3.
- `adr-009-intake-adapter-port` and `adr-2026-07-22-canonical-tracker-client-seam`: the narrower
  seams are untouched.

**Narrowed out:** all other APPROVED ADRs in `.docs/decisions/`. They govern gates, daemon
scheduling, DECIDE artifacts, release, and telemetry semantics, and share no file set, entity, or
gate with a test-only structural check. None was excluded on the basis of supersession.
