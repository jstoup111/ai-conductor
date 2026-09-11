# Implementation Plan: Refuse unsupported plugin kinds at load

**Date:** 2026-09-06
**Stories:** .docs/stories/refuse-unsupported-plugin-kinds-step-and-hook-at-l.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing plugin contract — the manifest validator remains the single gate on `kind`, discovery keeps its skip-with-warning behavior for a rejected manifest, and the four consumed kinds keep their current registration and retrieval paths untouched.

## Summary

Three bounded tasks deliver #1931. The two plugin kinds that no runtime seam retrieves leave the kind union and the valid-kind list; a manifest declaring one is refused at validation with a message naming the kind as unsupported and listing the supported kinds; discovery therefore skips such a plugin directory with its existing warning instead of registering something nothing can run. A typed retrieval-site guard keeps the remaining list honest. Designing a step-plugin or hook-plugin execution seam, changing discovery order or shadowing, and altering how the four supported kinds are resolved or invoked are all outside this slice.

## Technical Approach

Reduce `PluginKind` to the four kinds with a verified retrieval site and reduce `VALID_PLUGIN_KINDS` to match, keeping the union and the list in the same declaration order so the two cannot drift. Add a module-level list of the retired kind names next to them, with a comment recording that each was registrable but unreachable and that reintroducing one requires its retrieval site to land in the same change. The retired list is deliberately data the validator reads, not a second source of truth about validity: membership in it is what selects the more specific refusal message, while `VALID_PLUGIN_KINDS` stays the only definition of what is accepted.

In `validateManifest`, keep the existing kind branch as the general refusal and add one preceding check: when the declared kind is a retired name, throw `PluginManifestError` whose message names the kind, states that no runtime seam retrieves it so a plugin of that kind would never run, and lists the supported kinds. Any other unrecognized kind keeps today's `Invalid kind "<x>". Valid kinds are: ...` wording, so the existing refusal fixtures stay valid. Both refusals remain the same error class, which is what lets `discoverPlugins` keep its current behavior with no edit: a `PluginManifestError` is caught, reported through the existing `console.warn` naming the plugin directory, and the loop continues to the next directory. That is the whole delivery of the outcome — refusal at load with a message saying the kind is unsupported — and it needs no new channel, no new event, and no change to the loader.

The type reduction has one mechanical consequence in the existing suite: a registry test asserts an empty list for a retired kind, which stops compiling once the kind leaves the union. Retarget that assertion at a supported kind that the same fixture does not register, preserving what it proves — that `list` isolates one kind from another — rather than deleting it.

Guard the remaining list with a map from kind to the module that retrieves it, declared in the type-surface test as a record keyed over the kind union. The keying is the machinery: a future kind added to the union without a retrieval-site entry fails the typecheck that covers test files, before any assertion runs. At runtime the guard reads each mapped module and asserts it contains a registry retrieval naming that kind, so an entry cannot be satisfied by a stale or unrelated path, and asserts that every valid kind appears in the map and no retired kind appears in either. Two kinds legitimately map to the same module, which the guard permits. This is a test-local file read of repository source, not a new production dependency, so nothing about it belongs in production code.

Documentation upkeep rides in the same task as the behavior change rather than a task of its own: the page that already carries the plugin manifest contract gains the supported-kind list and a sentence on the retired-kind refusal, so the contract is not left half-stated.

Tests follow the repository's test-authoring rules. Manifest validation is a pure function, so its cases are unit tests at that function. Discovery is exercised as an integration test through the real `discoverPlugins` against temporary plugin directories, because the filesystem is the boundary under test; no conductor run, no provider, and no third party is involved. The retrieval-site guard is a unit test over the type surface. Tests may vary fixture builders and assertion grouping; they must preserve the observable boundaries named in each task's done-when items.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, refusal over seam-building, and both stories on 2026-09-06 (delegated).
- Verified: the plugin kind union at `src/conductor/src/types/plugin.ts:8` and `VALID_PLUGIN_KINDS` at `:13-20` both carry six members, including the two retired here.
- Verified: `validateManifest` at `src/conductor/src/engine/plugin-manifest.ts:51-56` accepts any member of that list and throws `PluginManifestError` for anything else.
- Verified: `discoverPlugins` in `src/conductor/src/engine/plugin-loader.ts` catches `PluginManifestError`, warns with `Skipping plugin <dir>: <message>`, and continues; an existing loader test asserts that exact warning shape for a rejected visualizer.
- Verified: the four retained kinds each have a registry retrieval — `llm_provider` at `src/conductor/src/engine/provider-runtime.ts:104`, `ui_renderer` at `src/conductor/src/index.ts:1414`, `visualizer` at `src/conductor/src/index.ts:257`, `memory_provider` at `src/conductor/src/engine/config.ts:2710` — and neither retired kind has one anywhere in the engine source.
- Verified: issue #1516, cited by the filer as leaving `visualizer` unretrieved, is closed and its selection seam is live at the index retrieval above.
- Verified: outside the type surface, the only remaining reference to a retired kind in the repository is a registry test assertion at `src/conductor/test/engine/plugin-registry.test.ts:123`; no documentation page and neither shipped example manifest declares one.
- Verified: the self-host release gate's breaking-surface classifier at `src/conductor/src/engine/self-host/release-gate.ts:123-139` matches only the conduct CLI, the install script, hook paths, settings JSON, and removed or renamed skill directories, so no migration block or waiver is owed.
- Scope check: consumer-facing, no new skill, provider-agnostic. Event spine: no new channel — the refusal uses the existing error class and the existing discovery warning.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Retire the unreachable kinds and refuse them by name
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/plugin.ts, src/conductor/src/engine/plugin-manifest.ts, src/conductor/test/engine/plugin-manifest.test.ts, src/conductor/test/engine/plugin-registry.test.ts, docs/contributing/extending.md
**Dependencies:** none

**Steps:**
1. Add manifest unit cases for each retired kind, asserting the error class and a message that names the kind and the supported kinds, and add a case pinning the unchanged wording for a kind that was never valid. Establish RED.
2. Reduce the kind union and the valid-kind list to the four retrieved kinds, in matching order, and add the retired-kind list beside them with the comment recording why they were removed and what reintroducing one requires.
3. Add the retired-kind branch to the manifest validator ahead of the general kind refusal, leaving the general refusal's wording untouched.
4. Retarget the registry test assertion that named a retired kind at a supported kind the fixture does not register, so it still proves list isolation between kinds.
5. Extend the plugin manifest section of the extending guide with the supported kinds and a sentence stating that a manifest declaring a retired kind is refused at load and the plugin is skipped.
6. Run the focused manifest, registry, and type-surface tests through the project's scoped runner, run the typecheck target that covers test files, and commit.

**Done when:**
1. The kind union and the valid-kind list each contain exactly the four kinds with a verified retrieval site, in the same order.
2. Validating a manifest that declares either retired kind throws the manifest error class with a message naming that kind as unsupported and listing the supported kinds.
3. Validating a manifest that declares a kind that was never valid produces the pre-existing invalid-kind message unchanged.
4. The registry list-isolation assertion compiles against the reduced union and still proves one kind's list excludes another kind's entries.
5. The extending guide names the supported plugin kinds and states that a retired kind is refused at load.

### Task 2: Prove discovery refuses a retired-kind plugin directory
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/plugin-loader.test.ts
**Dependencies:** 1

**Steps:**
1. Add a discovery integration case that writes two temporary plugin directories: one whose manifest declares a retired kind, and one declaring a supported kind with a conforming entrypoint.
2. Spy on the console warning the loader already uses, run the real discovery against the temporary directories, and establish RED against the pre-change behavior where the retired-kind plugin registers silently.
3. Assert the warning names the refused plugin directory and carries the unsupported-kind message, and assert the registry exposes the valid sibling while holding nothing for the refused plugin.
4. Restore the spy and remove the temporary directories through the existing fixture teardown, so no state leaks to neighboring files.
5. Run the focused loader tests through the project's scoped runner, run the typecheck target that covers test files, and commit.

**Done when:**
1. Discovery over a directory set containing a retired-kind plugin emits a warning naming that plugin and the unsupported kind.
2. The valid sibling plugin in the same discovery run registers and is retrievable after initialization.
3. The registry exposes no entry attributable to the refused plugin after discovery completes.

### Task 3: Bind every valid kind to a real retrieval site
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/types/plugin-kind.test.ts
**Dependencies:** 1

**Steps:**
1. Declare a record keyed over the kind union mapping each kind to the engine module that retrieves it, using the four verified module paths, so an unmapped future kind fails the typecheck before any assertion runs.
2. Assert every entry in the valid-kind list appears in the map, and that neither retired kind appears in the list or the map.
3. For each mapped kind, resolve its module path relative to the test file, assert the file exists, and assert its contents contain a registry retrieval naming that kind, so a stale or unrelated path cannot satisfy an entry.
4. Add a case that feeds the guard's own checking helper a kind list containing a retired kind and asserts the helper reports the missing site, so the guard is proven to fail rather than merely proven to pass.
5. Keep the existing assertion that the valid-kind list includes the memory provider kind, so the earlier decision it pins is not silently dropped.
6. Run the focused type-surface tests through the project's scoped runner, run the typecheck target that covers test files, and commit.

**Done when:**
1. Every kind in the valid-kind list maps to a module path that exists and whose contents name that kind at a registry retrieval call.
2. Neither retired kind appears in the valid-kind list or in the retrieval-site map.
3. Feeding the guard a kind list containing a kind absent from the retrieval-site map reports that kind as unsited rather than passing.
4. The pre-existing memory provider kind assertion still passes unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plugin directory whose manifest declares a supported kind, when discovery runs, then the plugin registers and stays retrievable from the registry unchanged. | 2 | "The valid sibling plugin in the same discovery run registers and is retrievable after initialization." | diff-local |
| Story 1 happy: Given a manifest declares a retired kind, when the manifest is validated, then validation fails with a message naming that kind as unsupported and listing the kinds that are supported. | 1 | "Validating a manifest that declares either retired kind throws the manifest error class with a message naming that kind as unsupported and listing the supported kinds." | diff-local |
| Story 1 negative: Given a plugin directory whose manifest declares a retired kind, when discovery runs, then the directory is skipped with a warning naming the plugin, and the registry holds no entry for that kind. | 2 | "Discovery over a directory set containing a retired-kind plugin emits a warning naming that plugin and the unsupported kind." | diff-local |
| Story 1 negative: Given a manifest declares a kind that was never valid, when the manifest is validated, then the pre-existing invalid-kind refusal is returned unchanged. | 1 | "Validating a manifest that declares a kind that was never valid produces the pre-existing invalid-kind message unchanged." | diff-local |
| Story 2 happy: Given every kind in the valid-kind list, when the retrieval-site guard runs, then each kind maps to an engine module that exists and retrieves that kind from the registry. | 3 | "Every kind in the valid-kind list maps to a module path that exists and whose contents name that kind at a registry retrieval call." | diff-local |
| Story 2 negative: Given a retired kind is reintroduced into the valid-kind list, when the retrieval-site guard runs, then the guard fails rather than accepting a kind with no site. | 3 | "Feeding the guard a kind list containing a kind absent from the retrieval-site map reports that kind as unsited rather than passing." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures; nothing here reaches an LLM, GitHub, a package registry, or any other third party, so no smoke coverage is owed. Task 1 owns the unit cases at the manifest validator, the pure boundary that decides acceptance, and repairs the one existing registry assertion the type reduction breaks. Task 2 owns the single discovery integration, running the real loader against temporary plugin directories because the filesystem is the boundary under test; it deliberately stops at discovery and never starts a conductor run, since registration and refusal are observable there. Task 3 owns the type-surface guard as a unit test, including the negative case that proves the guard can fail. Existing manifest coverage supplies the unchanged missing-field, bad-name, bad-YAML, and unreadable-file refusals, and existing loader coverage supplies the version-incompatibility and bad-entrypoint paths; none of that is duplicated here. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
