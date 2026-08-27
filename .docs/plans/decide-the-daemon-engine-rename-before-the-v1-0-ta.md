# Implementation Plan: decide the daemon→engine rename before the v1.0 tag

**Date:** 2026-08-26
**Stories:** .docs/stories/decide-the-daemon-engine-rename-before-the-v1-0-ta.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Builds the committed rename-scope and migration-scoping document
`docs/contributing/music-vocabulary-rename-scope.md` required by
adr-2026-08-26-music-vocabulary-player-composer-rename, in 5 tasks. No runtime code changes.

## Technical Approach

One deliverable file, assembled incrementally so each section is verifiable on its own. Every
enumeration section records the exact shell command that derives it (grep/ls over the repo) plus
the command's output summary (names and counts), and the document header records the base commit
the commands were run at with a staleness note. "Complete coverage" is closed by mechanism, not
adjective: a final per-surface coverage checklist section lists the five surface classes from ADR
decision 2 and, for the migration draft, checks each enumerated breaking surface off by name — an
unchecked row is the documented incompleteness signal. Section order = task order; tasks 1–3
build the enumerations, tasks 4–5 build the migration/alias scoping on top of them.

## Prerequisites

- APPROVED ADR adr-2026-08-26-music-vocabulary-player-composer-rename (present in this spec).

## Tasks

### Task 1: Scope doc skeleton + CLI and composer-surface enumeration
**Story:** 1
**Type:** happy-path

**Steps:**
1. Create `docs/contributing/music-vocabulary-rename-scope.md` with title, purpose paragraph citing the ADR stem, a `Base commit:` line set to the current HEAD SHA, and a staleness note stating the enumerations hold at that commit and must be re-derived by re-running the recorded commands if HEAD differs.
2. Add section "CLI subtree": list every `conduct daemon` subcommand by name (derive from the daemon command registration in `src/conductor/src/cli.ts` and `src/conductor/src/engine/daemon-command.ts`), with the derivation command recorded verbatim.
3. Add section "Composer surface": the engineer CLI subcommands (claim, projects, worktree, land, handoff, the launcher) and the engineer skill/agent files, with the derivation command recorded.

**Done when:**
- The document exists with `Base commit:` naming a real SHA and the staleness note (Story 1 negative path 2).
- The CLI section lists each daemon subcommand name and a runnable derivation command whose output at the base commit matches the listed names.
- The composer section does the same for the engineer command surface.

**Files likely touched:**
- docs/contributing/music-vocabulary-rename-scope.md — created

**Dependencies:** none

### Task 2: Config-key and `.daemon/` state-directory enumeration with dispositions
**Story:** 1
**Type:** happy-path

**Steps:**
1. Add section "Config keys": every config key whose name carries daemon/engine/engineer vocabulary (e.g. `auto_restart_on_stale_engine`), derived by a recorded grep over the config schema sources, with counts.
2. Add section "State directory": enumerate the entry classes currently present under the daemon state directory (pid file, logs, grants, parked-restore lists, blocked/gated state, evals-raw) and classify each as migrate, dual-read, or leave-in-place with a one-line reason (Story 1 happy path 3).
3. Record the `.daemon/` path-literal count in src (recorded grep command + count).

**Done when:**
- Every entry class observed under the live state directory at the base commit appears with exactly one disposition and a reason.
- The config-key section's recorded grep, run at the base commit, returns exactly the keys listed.

**Files likely touched:**
- same

**Dependencies:** Task 1

### Task 3: Docs/skills file list + event-spine out-of-scope statement
**Story:** 1
**Type:** happy-path

**Steps:**
1. Add section "Docs and skills sweep": the recorded grep listing files under docs/, skills/, agents/, HARNESS.md, README.md containing daemon/engineer vocabulary, with the file count.
2. Add section "Out of scope": state that `ConductorEvent` identifiers do not rename, citing the ADR's verified zero-count grep of `src/conductor/src/ui/types.ts`, and that repo name and `conduct`/`conduct-ts` entrypoints are unchanged (Story 1 negative path 3).

**Done when:**
- The docs-sweep grep at the base commit reproduces the recorded file count.
- The out-of-scope section names the event union, the zero-count evidence command, and the unchanged entrypoints.

**Files likely touched:**
- same

**Dependencies:** Task 1

### Task 4: Draft migration fence + per-surface coverage checklist
**Story:** 2
**Type:** happy-path

**Steps:**
1. Add section "Migration (draft for the #226 major)": a runnable fenced bash migration block covering config-key rename mapping and state-directory migration, written to the release-gate contract's shape for PR-body migration sections.
2. Add the coverage checklist: one row per surface class from ADR decision 2 (CLI subtree, composer surface, config keys, state directory, docs sweep), each row stating whether the migration draft covers it or why no migration is needed (docs sweep needs none); an uncovered breaking surface is left unchecked and named (Story 2 negative path 1; Story 1 negative path 1 — a missing surface class fails the checklist by name).

**Done when:**
- The migration fence is runnable bash (parses under `bash -n` when extracted) and covers config-key rename and state-directory migration.
- The checklist has exactly five surface rows; every breaking surface row is either checked with a covering fence reference or explicitly named as uncovered.

**Files likely touched:**
- same

**Dependencies:** Task 2, Task 3

### Task 5: Alias/deprecation posture, sequencing, and deferral sections
**Story:** 2
**Type:** happy-path

**Steps:**
1. Add section "Alias posture": verbatim from the ADR — old `daemon`/`engineer` command names forward to the new names with a deprecation warning; alias removal deferred to a later major (Story 2 happy path 2).
2. Add section "Sequencing": the rename implementation lands inside the #226 major train; record the cli.ts overlap with the #552 spec branches as the reason (Story 2 happy path 3).
3. Add section "Deferred": the verdict vocabulary and wider music table are out of this scope, deferred to issue #1918 (Story 2 negative path 2).

**Done when:**
- The alias section's posture sentences match the ADR's decision 3 wording.
- The sequencing section names #226 and #552 with the overlap reason.
- The deferral section names #1918 and states the migration draft does not cover verdict vocabulary.

**Files likely touched:**
- same

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ──> Task 2 ──┐
     └──> Task 3 ──┴──> Task 4 ──> Task 5
```

## Integration Points

- After Task 3: all Story 1 enumerations verifiable by re-running the recorded commands.
- After Task 5: full document complete; Story 2 criteria verifiable by reading it against the ADR.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (S1n1→T4, S1n2→T1, S1n3→T3, S2n1→T4, S2n2→T5)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block; "complete coverage" is closed by the named checklist mechanism
- [ ] Dependencies are explicit and acyclic
