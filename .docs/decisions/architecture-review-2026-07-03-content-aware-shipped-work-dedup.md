# Architecture Review: content-aware shipped-work dedup
**Date:** 2026-07-03
**Mode:** lightweight (Tier M, technical track) — feasibility + alignment
**Input reviewed:** explore output + technical intent (#204, #205); stories do not exist yet
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility
- **Stack:** pure engine work — Node fs/crypto + existing git tree source
  (`gitTreeSource` already reads base-branch file content in `daemon-backlog.ts`);
  no new packages, services, or infra.
- **Seams exist and are injectable:** `discoverBacklog(projectRoot, isProcessed,
  log, opts)` already takes `isProcessed` and a `treeSource`; `rekickSweep(deps)`
  takes injected primitives — adding `isProcessed` to `RekickSweepDeps` is
  additive and unit-testable without git.
- **Finish-flow write point:** the marker must be committed on the impl branch
  BEFORE `gh pr create` / final push. Failure to write degrades to current
  behavior (cache-only) and must not block the ship — negative-path story
  required.
- **Hash determinism:** hash the exact committed bytes of plan + stories from
  the base-branch tree (no normalization beyond trailing-newline trim);
  canonicalization rules must be a single shared function used by both the
  finish writer and the discovery matcher.
- **Backfill:** a one-time `.docs/shipped/` commit inside this feature's PR;
  no runtime migration, no `bin/migrate` block needed (no settings/hook/CLI
  schema change).

## Alignment
- **ADR-001 (rebase keystone):** untouched — dedup only *removes* dispatches;
  no new dispatch path is introduced.
- **adr-013 (main-advance rekick):** amended, narrowly — the sweep gains an
  `isProcessed` guard; FR-7/FR-9 semantics otherwise intact.
- **ADR-012 (intake ledger dedup):** unchanged and cited as precedent — this
  ADR gives the *build* loop the same "repo-visible anchor" the intake loop
  got from the `engineer:handled` label.
- **Owner gate (adr-2026-07-01):** dedup runs BEFORE the gate so a shipped spec
  is skipped regardless of identity resolution (fail-closed identity must not
  hide a dedup skip, and dedup must not be maskable by gate config).
- **Isolated-environments direction (2026-06-30):** committed record travels
  with clones — removes a machine-local state dependency; consistent with
  keeping identity/trust seams swappable.
- **Artifact conventions:** `.docs/shipped/` is a new committed artifact class —
  append-only, one small file per feature, stem-named like every other
  spec-keyed artifact. No collision with `.docs/intake/` (issue-origin markers)
  or `.pipeline/` (gitignored run evidence).

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Finish writes marker but PR is never merged (record lost with branch) | Data | Medium | Low | record rides the PR; unmerged PR = unshipped, correct outcome |
| Marker write fails at finish → replay window persists for that spec | Technical | Low | Medium | degrade to cache-only + warn; story asserts the warn path |
| Hash drift from line-ending/canonicalization mismatch | Technical | Medium | High | single shared canonicalize+hash function, pinned by unit tests both sides |
| Renamed AND edited spec evades hash match | Data | Low | Medium | residual by design; warn-once when stem is new and no hash matches but title similarity is high is OUT of scope (keep deterministic) |
| Backfill hash computed from drifted current content vs as-shipped content | Data | Medium | Low | stem-primary matching makes backfilled records effective regardless of hash |

## ADRs Created
- `adr-2026-07-03-committed-shipped-record-dispatch-dedup.md` (DRAFT → requires
  operator approval before stories)

## Conditions
1. Shared canonicalize+hash function with unit tests consumed by BOTH the finish
   writer and the discovery matcher (no duplicated hashing logic).
2. Marker-write failure at finish degrades to current behavior with a warn —
   never blocks the ship, never silently succeeds.
3. Dedup checks execute before the owner gate in `discoverBacklog` and are not
   skippable by configuration.
4. Backfill records land in the same PR as the code (protection is retroactive
   on merge day).
