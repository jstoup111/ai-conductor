**Status:** Accepted

# Stories: decide the daemon→engine rename before the v1.0 tag

Technical track — no PRD. Derived from the technical intent and APPROVED
adr-2026-08-26-music-vocabulary-player-composer-rename. The deliverable is the rename-scope and
migration scoping record for the daemon→player / engineer→composer rename; the rename itself is
future work bound to the #226 major.

## Story 1: Rename-scope enumeration is committed and verifiable

**Requirement:** ADR decision 2 (the two renamed concepts and their surfaces)

As a contributor building the rename feature, I want a committed scope document enumerating every
daemon→player and engineer→composer surface so that the rename plan can be written without
re-deriving the surface and without silently missing one.

### Acceptance Criteria

#### Happy Path
- Given the approved ADR, when the scope document at `docs/contributing/music-vocabulary-rename-scope.md` is read, then it enumerates each of the five surface classes — CLI subtree (`conduct daemon …` subcommands by name), engineer CLI/skill surface, config keys, `.daemon/` state-directory contents needing migration or dual-read, and the affected docs/skills file list — each with the shell command that re-derives it.
- Given the scope document, when each listed re-derivation command is run at the document's recorded commit, then its output matches the counts and names the document records.
- Given the scope document, when the live-state section is read, then every entry currently present under `.daemon/` (pid file, logs, grants, parked-restore lists, blocked/gated state, evals-raw) is classified as migrate, dual-read, or leave-in-place with a one-line reason.

#### Negative Paths
- Given a surface class named in ADR decision 2, when the scope document lacks a section for it, then the feature's own verification checklist in the document fails that class by name and the document states it is incomplete rather than presenting partial coverage as total.
- Given a re-derivation command whose current output no longer matches the recorded enumeration, when the document's recorded commit differs from HEAD, then the document's staleness note instructs re-running the commands rather than trusting the recorded counts.
- Given the event spine, when the scope document is read, then `ConductorEvent` identifiers are explicitly listed as out of scope citing the ADR's verified zero-count, so a later reader cannot infer they were forgotten.

### Done When
- [ ] `docs/contributing/music-vocabulary-rename-scope.md` exists, committed, covering all five surface classes with re-derivation commands and recorded counts
- [ ] Every current `.daemon/` entry class is dispositioned migrate / dual-read / leave-in-place with a reason
- [ ] The document names its base commit and carries a staleness note

## Story 2: Migration and alias posture for the #226 major is scoped

**Requirement:** ADR decisions 3 and 7 (transition layer; sequencing with #226)

As the operator cutting the 1.0 major, I want the migration block and alias/deprecation posture
drafted and recorded so that the #226 cutover PR can carry them without re-opening the decision.

### Acceptance Criteria

#### Happy Path
- Given the scope document, when its migration section is read, then it contains a draft runnable `## Migration` fence covering config-key rename and state-directory migration, ready to travel in the #226-major PR body per the release-gate contract.
- Given the scope document, when its alias section is read, then it states the posture verbatim from the ADR: old `daemon`/`engineer` command names forward to the new names with a deprecation warning, and alias removal is deferred to a later major.
- Given the sequencing constraint, when the document's sequencing section is read, then it states the rename implementation lands inside the #226 major train and records the cli.ts overlap with the #552 spec branches as the reason.

#### Negative Paths
- Given a breaking surface enumerated in Story 1, when the draft migration fence does not cover it, then the document's coverage checklist marks that surface uncovered by name instead of omitting it silently.
- Given a reader looking for the verdict vocabulary (attacca/fermata and the wider table), when they read the document, then it states that work is out of scope and deferred to #1918, so the migration draft is not extended to cover it.

### Done When
- [ ] The scope document carries a draft `## Migration` fence and a per-surface coverage checklist with no silently uncovered surface
- [ ] Alias/deprecation posture and #226/#552 sequencing are recorded verbatim from the ADR
- [ ] #1918 deferral is stated
