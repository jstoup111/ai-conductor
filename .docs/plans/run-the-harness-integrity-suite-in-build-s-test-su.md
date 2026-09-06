# Implementation Plan: Harness integrity verification runs in BUILD, not SHIP

**Date:** 2026-09-06
**Stories:** .docs/stories/run-the-harness-integrity-suite-in-build-s-test-su.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing finish-plane contract — the surviving migration sub-gate keeps its classifier, waiver parser, evaluator, and fail-closed uncertainty rule, and the VERSION-approval gate is untouched.

## Summary

Three bounded tasks deliver #658. This repository declares the harness integrity script as a second verification entry of its BUILD test-suite step, and the integrity sub-gate is deleted from the finish-plane release gate so no test runs in SHIP. Model-table drift and every other integrity failure then surfaces where the build loop can act on the remediation the check already prints, instead of terminally halting a finished feature at its ship tail. Self-healing the gate, routing gate failures to a resolving step, and any change to the migration sub-gate or the VERSION-approval gate are outside this slice.

## Technical Approach

The ordered-command capability this plan consumes is not built here. Issue #2358 owns an additive `commands` list of entries carrying a command, an optional working directory, and an optional timeout, run in order with a stop at the first failure, with per-entry evidence and a fingerprint taken over the ordered list. This feature is blocked by #2358 and its build runs after that ships. Task 1 therefore only declares entries against the key #2358 introduces; if #2358's delivered key or entry shape differs from that description, Task 1 adopts the delivered shape and changes nothing else.

The two entries are the existing conductor-package vitest command with the conductor package as its working directory, and `bash test/test_harness_integrity.sh` with the repository root as its working directory. The integrity script anchors every path it touches to a directory derived from its own location rather than from the process working directory, so it behaves identically wherever it is launched from; declaring the repository root as the entry's working directory keeps the invocation identical to the one continuous integration and the deleted sub-gate both used. The vitest entry stays first so the cheaper, more frequently failing suite reports before the shell suite.

The full-suite proof stays content-addressed and its contract is unchanged. The fingerprint's normalizer hashes the suite's declared configuration alongside its inputs and environment, so replacing one command with an ordered list of two is a configuration change that invalidates any prior attestation exactly once, which is the mechanism working as designed rather than a new exemption. The files the integrity script actually reads — the generated model table, the shell scripts, the skill catalog — already fall into the fingerprint's catch-all source category, so drift in them already staled the proof before this change and still does. The counterfactual scoped command is untouched: this repository's verification mode is aggregate, and the normalizer folds the scoped command into the digest only in scoped mode, so the build-review test-quality preflight sees no change at all.

On the gate side the deletion is mechanical. The release-gate module loses the integrity script constant, the default timeout constant, the exec interface, the production exec, the integrity options interface, and the suite function, along with its only process launcher import and the header sentence describing two sub-gates. The composed options interface loses the timeout, access, and exec fields, which exist solely to inject that suite; no caller passes them, so no production call site changes shape. The composed gate then begins at the change-set enumeration, and the migration evaluation with its waiver fallback becomes the whole gate. The classifier, the canonical surface names, the waiver parser, the freshness rule, and the uncertain-change-set fail-closed branch are all untouched.

Two callers carry stale prose rather than stale code. The guardrail bundle's comment describes the release gate as integrity, changelog, and migration, and the conductor's finish-gate method and its call site describe the same set; all three are corrected to name the migration sub-gate alone. Neither the bundle's interface nor the method's argument list changes.

Verification does not weaken. An integrity failure still blocks progression, now at the build loop's own test-suite gate, which fails closed on a non-zero exit, a timeout, or unresolvable evidence. Independently, the repository's continuous-integration workflow runs the same script as a required job on every non-documentation diff, so a merge cannot carry an integrity failure even if a build's evidence were somehow preserved across it.

Tests follow this repository's test-authoring rules. Task 1's drift check is a unit-level assertion that loads this repository's own committed configuration through the real loader from the repository root, in the established pattern of the existing install-banner drift test; it executes neither suite. Task 2's changes belong to the existing release-gate unit test, which already drives the composed entry point with injected seams. Task 3 keeps the existing migration-waiver acceptance test driving the real composed gate with faithful in-memory readers and temporary directories, simply without the stubs for a seam that no longer exists. No test spawns a process, calls a language model, or reaches a network.

Four documentation pages go stale with this change and belong to the documentation step, not to a task here: the self-hosting guide's guardrail table row, its manual-test rationale sentence, and its release-artifact paragraph; the gates explanation's self-host paragraph and its closing "what a gate is not" list, which calls the release gate the thing that runs the integrity suite as its first sub-check; the releases contributing page's release-gate sub-gate section, which documents the integrity sub-gate and its three failure modes as sub-gate one; and the validation contributing page's "where else the suite runs" table, whose self-host finish-gate row names the deleted function. The documentation step owns re-describing the release gate as migration-only and re-pointing the validation table's third context at BUILD's test-suite step.

## Preconditions and claim ledger

- Operator approved the re-scope to relocation over self-healing, the Small tier, the technical track, and both stories on 2026-09-06 (delegated).
- **Blocked by #2358.** The ordered-command list key does not exist yet. This feature's build must not start until #2358 ships, and Task 1 must not add engine support for the key itself.
- Verified: this repository's project configuration declares one command, the conductor package as working directory, an aggregate verification mode, and a comment stating that harness integrity remains a separate self-host gate.
- Verified: the engine's self-host release-gate module defines the integrity script constant, the default timeout, the exec interface, the production exec, the integrity options interface, and the suite function, and the composed gate awaits that suite before enumerating changed files.
- Verified: the composed options interface's timeout, access, and exec fields exist only for the integrity suite, and the conductor's finish-gate method passes none of them.
- Verified: the guardrail bundle forwards the composed gate and describes it in a comment as integrity, changelog, and migration; the conductor's finish-gate method and its call site carry the same stale description.
- Verified: the release-gate unit test has a dedicated integrity describe block plus composed-gate cases for an integrity halt, an emitter-less integrity halt marker failure, and an integrity pass; the migration-waiver acceptance test passes trivially-passing access and exec stubs on every gate invocation.
- Verified: the continuous-integration workflow's integrity job installs the conductor package's dependencies and runs the same script on every diff not classified documentation-only.
- Verified: the full-suite fingerprint's normalizer hashes command, working directory, timeout, inputs, and environment, and adds the scoped command and selectors only when the verification mode is scoped; this repository's mode is aggregate.
- Verified: the integrity script derives its harness directory from its own location, so its checks do not depend on the process working directory.
- Scope check: harness-repo-only on three signals — self-host machinery, this repository's own validation and release gates, and its own project configuration. No new skill. Provider-agnostic. Event spine: no new channel; the integrity outcome rides the existing test-suite step evidence, and the deleted halt reason simply stops being emitted.
- Verify-claims verdict: CLEAR for every claim above, each read from the worktree. The single unverifiable claim is #2358's delivered key shape, which is explicitly handled by the adoption rule in the technical approach.

## Tasks

### Task 1: Declare both verification entries for this repository's build
**Story:** Story 1
**Type:** happy-path
**Files:** .ai-conductor/config.yml, src/conductor/test/self-host-verification-entries.test.ts
**Dependencies:** none

**Steps:**
1. Create the new drift-check test file listed above. It resolves the repository root from the test file's own location, loads the repository's committed project configuration through the real configuration loader, and asserts the resolved test-suite verification entries. Establish RED against today's single-command configuration.
2. Assert the ordered pair: the first entry runs the conductor package's vitest command with the conductor package as its working directory, the second runs the harness integrity script with the repository root as its working directory, and the second entry's script path resolved against the repository root is an existing file.
3. Add a fixture case that copies the loaded configuration, removes the integrity entry, and asserts the same assertion helper reports the missing entry by name rather than passing on the vitest entry alone.
4. Declare the two entries in the project configuration using the ordered list key introduced by issue #2358, and replace the comment that still calls harness integrity a separate self-host gate with one describing the two-entry list.
5. Leave the scoped command, its selector placeholder, the timeout, and the aggregate verification mode untouched, and assert them in the same drift check so a later edit cannot silently move them.
6. Run the focused test through the repository's scoped run, run the typecheck target that covers test files, and commit.

**Done when:**
1. A drift check loads this repository's own committed project configuration through the real loader and finds an ordered list of exactly two verification entries.
2. The first entry runs the conductor package's vitest command with the conductor package as its working directory and the second runs the harness integrity script with the repository root as its working directory.
3. The declared integrity entry resolves to the same script path and the same root that the deleted finish-plane sub-gate used.
4. A fixture configuration with the integrity entry removed makes the drift check fail and name the missing entry.
5. The scoped command, its selector placeholder, and the aggregate verification mode are unchanged by this task's diff and are asserted by the drift check.

### Task 2: Delete the integrity sub-gate from the release gate
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/self-host/release-gate.ts, src/conductor/test/engine/self-host/release-gate.test.ts
**Dependencies:** none

**Steps:**
1. Delete the integrity describe block and the composed-gate integrity cases from the release-gate unit test, and add a case that drives the composed gate against a harness root containing no integrity script with a non-breaking change set, asserting a passing verdict, no halt-marker write, and no process launch.
2. Establish RED, then delete from the module the integrity script constant, the default timeout constant, the exec interface, the production exec, the integrity options interface, and the suite function, plus the now-unused process launcher import.
3. Remove the timeout, access, and exec fields from the composed gate's options interface and remove the integrity call and its halt branch from the composed gate body, so change-set enumeration becomes the gate's first action.
4. Rewrite the module header so it describes one sub-gate rather than two, keeping the fail-closed statement and the distinct-halt-reason statement intact.
5. Run the focused unit test through the repository's scoped run, run the typecheck target that covers test files, and commit.

**Done when:**
1. The release-gate module exports no integrity script constant, no default integrity timeout, no integrity exec seam, no integrity options interface, and no integrity suite function, and imports no process launcher.
2. The composed gate's options interface carries no timeout field, no access field, and no exec field.
3. With a harness root containing no integrity script and a non-breaking change set, the composed gate returns a passing verdict, writes no halt marker, and launches no process.
4. Typecheck over both source and test files passes with no remaining reference to a removed integrity symbol.
5. The migration classifier, the canonical surface names, the waiver parser, the freshness rule, and the migration evaluator are unchanged by this task's diff.

### Task 3: Retire the integrity stubs and stale wording in the gate's callers
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/acceptance/self-host-release-gate-migration-waiver.acceptance.test.ts, src/conductor/src/engine/self-host/wiring.ts, src/conductor/src/engine/conductor.ts
**Dependencies:** 2

**Steps:**
1. Remove the trivially-passing access and exec stubs from the acceptance fixture's gate invocation and the preamble sentence that explains why they were stubbed, keeping every waiver scenario and every assertion exactly as they are.
2. Establish RED on the fixture's temporary harness root by asserting that it contains no integrity script, then confirm each existing waiver scenario keeps its prior verdict without the stubs.
3. Add an acceptance case proving a canonical breaking surface with no runnable migration block and no fresh waiver still halts with the migration-block reason, and one proving an undeterminable change set still halts fail-closed on the migration requirement without offering a waiver path.
4. Correct the guardrail bundle's release-gate comment and the conductor's finish-gate method doc comment and call-site comment so none of the three describes the gate as running an integrity suite; change neither the bundle's interface nor the method's argument list.
5. Run the focused acceptance test through the repository's scoped run, run the typecheck target that covers test files, and commit.

**Done when:**
1. The migration-waiver acceptance fixture invokes the composed gate with no integrity stubs and every existing waiver scenario keeps its prior verdict.
2. A breaking-surface change with no runnable migration block and no fresh waiver halts with the migration-block reason in a harness root that contains no integrity script.
3. An undeterminable change set halts fail-closed on the migration requirement without offering a waiver path.
4. No comment in the guardrail bundle or in the conductor's finish-gate method and call site describes the release gate as running an integrity suite.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given this repository's committed project configuration, when its test-suite verification entries are resolved, then they form an ordered list whose first entry runs the conductor package's vitest command in the conductor package directory and whose second entry runs the harness integrity script with the repository root as its working directory. | 1 | "The first entry runs the conductor package's vitest command with the conductor package as its working directory and the second runs the harness integrity script with the repository root as its working directory." | diff-local |
| Story 1 happy: Given the declared integrity entry, when its command and working directory are resolved against the repository root, then they name the same script and the same root that the deleted finish-plane sub-gate used. | 1 | "The declared integrity entry resolves to the same script path and the same root that the deleted finish-plane sub-gate used." | diff-local |
| Story 1 negative: Given a configuration whose verification entries omit the integrity entry, when the configuration drift check runs, then it fails and names the missing integrity entry instead of passing on the vitest entry alone. | 1 | "A fixture configuration with the integrity entry removed makes the drift check fail and name the missing entry." | diff-local |
| Story 2 happy: Given a harness self-build reaches the finish-plane release gate, when the gate runs against a harness root containing no integrity script and a non-breaking change set, then it returns a passing verdict, writes no halt marker, and launches no process. | 2 | "With a harness root containing no integrity script and a non-breaking change set, the composed gate returns a passing verdict, writes no halt marker, and launches no process." | diff-local |
| Story 2 negative: Given a self-build changes a canonical breaking surface with no runnable migration block and no fresh waiver, when the finish-plane release gate runs, then it halts with the migration-block reason. | 3 | "A breaking-surface change with no runnable migration block and no fresh waiver halts with the migration-block reason in a harness root that contains no integrity script." | diff-local |
| Story 2 negative: Given a self-build whose change set cannot be determined, when the finish-plane release gate runs, then it halts fail-closed on the migration requirement without offering a waiver path. | 3 | "An undeterminable change set halts fail-closed on the migration requirement without offering a waiver path." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-06-30-halt-based-release-gates#D1 | task | task-1 | The first entry runs the conductor package's vitest command with the conductor package as its working directory and the second runs the harness integrity script with the repository root as its working directory. |
| adr-2026-06-30-halt-based-release-gates#D2 | task | task-2 | The release-gate module exports no integrity script constant, no default integrity timeout, no integrity exec seam, no integrity options interface, and no integrity suite function, and imports no process launcher. |
| adr-2026-06-30-halt-based-release-gates#D3 | task | task-3 | An undeterminable change set halts fail-closed on the migration requirement without offering a waiver path. |

## Test dispositions and integration ownership

All six criteria are diff-local against controlled inputs. Task 1 owns the configuration drift check at unit level, loading this repository's own committed configuration through the real loader and executing neither suite; the omitted-entry case uses an in-memory copy of that configuration rather than a hand-written fixture, so the negative case cannot drift away from the positive one. Task 2 owns the composed release gate's unit coverage, including the harness-root-without-a-script case that replaces the deleted missing-script halt. Task 3 owns acceptance coverage for the surviving migration sub-gate through the real composed entry point with temporary directories and in-memory readers. Existing waiver-parser, classifier, and evaluator unit coverage remains authoritative and is deliberately not duplicated. No smoke test is added: neither suite is executed by any test in this feature. No terminal validation task is added.

## Task Dependency Graph

Task 2 -> Task 3

Task 1 has no dependencies and no dependants: the configuration declaration is independent of the gate deletion and may run in parallel with it.
