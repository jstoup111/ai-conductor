# Implementation Plan: Consolidate duplicate halt-marker and task-status declarations

**Date:** 2026-09-06
**Stories:** .docs/stories/consolidate-duplicate-halt-marker-and-taskstatusfi.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the slice only removes duplicate declarations and adds the import edges that replace them, so it conforms to the existing halt-marker, task-status, and restart-marker contracts without altering any on-disk path, schema, or gate verdict.

## Summary

Four bounded tasks deliver #1016 by collapsing three duplicated declarations to one source each and registering the surviving import edges in the matched-pair registry that #1833 already shipped. On-disk marker names, the task-status document shape, the two distinct restart pipelines, and the #408 unification of those pipelines are outside this slice.

## Technical Approach

The user-input halt marker is one concept spelled twice. The task-progress module is the natural owner: it already exports the constant plus the path, existence, read, and clear helpers, and the completion-check module already imports from it, so the import edge costs nothing and introduces no cycle. Delete the duplicate constant from the completion-check module and import the task-progress constant under its existing name. The unrelated park-for-human marker of the same name keeps its own module and its own value; nothing about it changes.

The task-status file type is one concept spelled three times, and one of those three is both dead and wrong. The seeding module writes the document, so its interface is authoritative: export it and its record type, and widen the record type with the optional commit field that the translator needs, which today rides an index signature. The translator drops both of its local look-alike interfaces and imports the exported pair; its existing array guards already tolerate the writer's optional task list, so no runtime behavior changes. The record-map alias in the shared state types and the task-status type it depends on have no importer anywhere in the repository, and their shape contradicts what is actually written, so both are deleted rather than reconciled; the shared state module is otherwise untouched.

Enforcement reuses the existing registry rather than adding a second mechanism. Both collapsed pairs are declared in derivation mode with a rationale and this issue as the reference, which the structural check verifies by parsing the deriving module, locating the import of the named export from the named source module, and confirming a reference outside the import. The registry's seed-count assertion is updated to match. The re-fork failure is proved with a synthetic source string through the same assertion helper the structural suite already uses for its fixtures, so no production module is mutated to produce a failure.

The stale-engine restart suppression path stops being an independent literal and becomes the marker constant plus the suffix, which makes the pair unable to disagree by construction. The value is byte-identical, so no marker is renamed, no migration runs, and the queued-restart marker of the other pipeline is untouched. The daemon state reference is corrected in the same task: it currently omits the stale-engine marker and attributes the suppression record to the hyphenated queued-restart marker it does not belong to, and it still carries a known-limitation note for the duplicate declarations this feature removes.

Tests follow the repository test-authoring rules. Every assertion here is a unit or narrow integration one over real temporary directories or synthetic source strings; nothing spawns a conductor, a provider, a process, or a network call, and no fixture reaches a third party.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, derivation over a new checker, and all three stories on 2026-09-06 (delegated).
- Verified: the completion-check module declares the user-input halt marker at line 508 and reads it only at lines 2634 and 2637, and it already imports from the task-progress module, so the replacement edge exists.
- Verified: the task-progress module declares the same literal at line 339 and owns the path, existence, read, and clear helpers around it.
- Verified: the park-for-human marker constant of the same name is a different value in a different module, imported by every other consumer; it is out of scope and unmodified.
- Verified: the seeding module declares the authoritative record and file interfaces at lines 14 and 21; the translator re-declares look-alikes at lines 138 and 144 and guards both read sites with an array check.
- Verified: the record-map alias and its task-status type in the shared state module at lines 77 and 81 have no importer in engine, UI, CLI, or test sources.
- Verified: the restart-intent module spells the stale-engine marker at line 18 and its suppression sibling at line 21 as separate literals; the hyphenated queued-restart marker at line 17 of the restart-marker module is a different file for a different pipeline, owned by open issue #408.
- Verified: the registry supports derivation-mode declarations with a rationale and an issue reference, its seed test asserts an exact set of three ids, and the structural suite already exercises accepted and rejected derivation fixtures.
- Verified: no changed path matches the release gate's breaking-surface classifier, so no migration block and no waiver are required.
- Scope check: harness-repo-only engine declaration hygiene; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report is added or changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the working tree; no pending product or scope assumption remains.

## Tasks

### Task 1: Collapse the user-input halt marker to one declaration
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/artifacts.test.ts
**Dependencies:** none

**Steps:**
1. Write a failing unit assertion that the completion-check module's halt detection resolves the same relative path the task-progress module exports, by creating a temporary project directory, writing the marker at the task-progress path, and asserting the build completion result reports not done for that reason.
2. Establish RED, then delete the duplicate constant from the completion-check module and add the task-progress constant to the existing import from that module, aliasing it to the local name so the two read sites and the reason string are unchanged.
3. Confirm the module declares no remaining occurrence of the marker literal and that the reason string still names the same path.
4. Run the focused test file and the repository typecheck target that includes tests, then commit.

**Done when:**
1. The completion-check module contains no declaration of the user-input halt marker literal and imports the constant from the task-progress module.
2. A unit test writes the marker at the exported path and observes the build completion check report not done with the reason naming that path.
3. The task-progress module and the park-for-human marker module are unchanged.

### Task 2: Collapse the task-status file type to one declaration
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/task-seed.ts, src/conductor/src/engine/rebase-translate.ts, src/conductor/src/types/state.ts, src/conductor/test/engine/rebase-translate.test.ts
**Dependencies:** none

**Steps:**
1. Write failing translator tests over a temporary pipeline directory covering an absent task list, a task list that is not an array, and a normal array whose rows carry commit shas, asserting the file is left byte-identical in the first two cases and that the derived pending id set is empty for them.
2. Establish RED, then export the record and file interfaces from the seeding module and add an optional commit field to the record type so the translator's narrowing no longer relies on the index signature.
3. Delete both look-alike interfaces from the translator and import the exported pair, keeping the existing array guards and rewrite logic untouched.
4. Delete the record-map file alias and the task-status type it depends on from the shared state types, and confirm no module references either name.
5. Run the focused translator and seeding test files and the repository typecheck target that includes tests, then commit.

**Done when:**
1. The translator declares no local task-status file or task interface and imports the exported pair from the seeding module.
2. The shared state types declare neither the record-map file alias nor its task-status type, and a repository search finds no reference to either name.
3. Translator tests assert an unchanged file and an empty derived id set for an absent task list and for a non-array task list.
4. A translator test asserts a normal array of rows still has its commit shas rewritten through the translation map.

### Task 3: Register both collapsed pairs and prove a re-fork fails
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/matched-pairs.ts, src/conductor/test/engine/matched-pairs.test.ts, src/conductor/test/structural/matched-pair-registry.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Add a fixture assertion to the structural suite that runs the existing derivation-link helper against a synthetic source string for each new pair id, one with the import edge present and one with it absent, expecting the absent case to throw an error naming the deriving module, the source module, and the export.
2. Establish RED, then add the two derivation-mode entries to the registry, each with the deriving module, the source module, the imported export, a rationale, and this issue as the reference.
3. Update the registry well-formedness test so its expected id set and count include the two new entries.
4. Run both registry test files and the repository typecheck target that includes tests, then commit.

**Done when:**
1. The registry declares a derivation entry for the halt-marker pair and one for the task-status type pair, each carrying a non-empty rationale and an issue reference.
2. The structural derivation check passes against the real deriving modules for both new entries.
3. A synthetic deriving source without the import edge makes the derivation assertion throw an error naming both modules and the export.
4. The registry well-formedness test asserts the new expected id set and count.

### Task 4: Derive the restart suppression path and correct the daemon state reference
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/restart-intent.ts, src/conductor/test/engine/restart-intent.test.ts, docs/reference/artifacts.md
**Dependencies:** 3

**Steps:**
1. Write a failing assertion that the exported suppression constant equals the exported stale-engine marker constant with the suppression suffix appended, that its literal value is unchanged from the pre-change value, and that the queued-restart marker constant of the other pipeline differs from both.
2. Establish RED, then express the suppression constant in terms of the marker constant and leave every read and write site as it is.
3. Add an assertion that a suppression record written at the pre-change location is still read back after the change, using the existing temporary-directory fixture style in that file.
4. Correct the daemon state reference table so it lists the stale-engine marker alongside the queued-restart marker, attributes the suppression record to the stale-engine marker, and updates the stated path count; remove the resolved known-limitation note about duplicate halt-marker and task-status declarations.
5. Run the focused restart-intent test file and the repository documentation and integrity checks, then commit.

**Done when:**
1. The suppression constant is expressed in terms of the marker constant and its resolved value is unchanged.
2. A test asserts the suppression path equals the marker path with the suppression suffix and that the queued-restart marker path is distinct from both.
3. A test writes a suppression record at the pre-change location and reads it back unchanged after the derivation.
4. The daemon state reference lists both restart markers with the suppression record attributed to the stale-engine marker and a corrected path count.
5. The known-limitation note about duplicate halt-marker and task-status declarations is removed from the reference page.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the build completion check and the task-progress halt helpers, when each resolves the user-input halt marker, then both read the single exported constant declared in the task-progress module. | 1 | "The completion-check module contains no declaration of the user-input halt marker literal and imports the constant from the task-progress module." | diff-local |
| Story 1 happy: Given the collapsed halt-marker pair, when the structural matched-pair check runs, then the registry declares it satisfied by derivation and the check verifies the real import edge and its use. | 3 | "The structural derivation check passes against the real deriving modules for both new entries." | diff-local |
| Story 1 negative: Given a completion-check module that drops the import and re-declares the marker literal locally, when the structural matched-pair check evaluates it, then the check fails naming the deriving module, the source module, and the export. | 3 | "A synthetic deriving source without the import edge makes the derivation assertion throw an error naming both modules and the export." | diff-local |
| Story 2 happy: Given the task-status writer and the rebase evidence translator, when each types a parsed task-status document, then both use the single exported interface declared by the writer, including its optional array of task records. | 2 | "The translator declares no local task-status file or task interface and imports the exported pair from the seeding module." | diff-local |
| Story 2 happy: Given the shared state types, when a reader looks for a task-status file type, then only the writer's declaration exists and the incompatible record-map alias is gone. | 2 | "The shared state types declare neither the record-map file alias nor its task-status type, and a repository search finds no reference to either name." | diff-local |
| Story 2 negative: Given a task-status document whose task list is absent or is not an array, when the rebase evidence translator translates citations and derives pending task ids, then it rewrites nothing and derives no ids. | 2 | "Translator tests assert an unchanged file and an empty derived id set for an absent task list and for a non-array task list." | diff-local |
| Story 3 happy: Given the stale-engine restart marker path constant, when the suppression record path is resolved, then it is that constant with the suppression suffix appended rather than a second independently spelled literal. | 4 | "The suppression constant is expressed in terms of the marker constant and its resolved value is unchanged." | diff-local |
| Story 3 happy: Given the daemon state reference documentation, when a reader looks up restart state, then both restart markers are listed and the suppression record is attributed to the marker it actually belongs to. | 4 | "The daemon state reference lists both restart markers with the suppression record attributed to the stale-engine marker and a corrected path count." | diff-local |
| Story 3 negative: Given a suppression record written at the pre-change location, when the daemon reads suppression state after this change, then it is found at that same unchanged location and no marker file is renamed or migrated. | 4 | "A test writes a suppression record at the pre-change location and reads it back unchanged after the derivation." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the completion-check unit assertion over a temporary project directory. Task 2 owns the translator integration over a temporary pipeline directory, including both malformed-input guards. Task 3 owns the registry and structural derivation assertions, including the synthetic re-fork fixture. Task 4 owns the restart-intent unit assertions and the documentation correction. Existing halt-marker, seeding, translator, and restart-intent suites supply the unchanged behavioral permutations; no new aggregate, conductor-run, provider, or external-service test is required, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 3
Task 2 -> Task 3
Task 3 -> Task 4

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No ADR is created or amended; the two restart pipelines keep the structure their approved decision records describe, and unifying them remains open issue #408.
