# Implementation Plan: remove the unattended one-shot inline run (--auto remnants)

**Date:** 2026-08-26
**Stories:** .docs/stories/remove-the-unattended-one-shot-inline-run-auto-the.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Six tasks: point the `--auto` rejection at the daemon guide, delete `deriveMode`'s dead arm,
record the engine-branch audit (deletes nothing), and retire the broken inline example with its
dedicated test while re-pointing the shared example tests at surviving flows.

## Technical Approach

- The behavioral break already shipped (#1509): `deriveMode` in `src/conductor/src/index.ts`
  rejects `--auto` with `process.exit(1)` before the `'auto'` return arm, making that arm dead.
  This plan improves the rejection text (adds the guide path `docs/guides/running-the-daemon.md`),
  deletes the dead arm, and leaves the `RunMode` union and every engine branch alone — four
  APPROVED ADRs (validation-group-join, fail-closed-decide-entry, remove-retrospectives-one-shot,
  engine-owned-resumable-finish-publication) pin every `this.mode === 'auto'` branch in
  `src/conductor/src/engine/conductor.ts` as daemon-dispatched contract (`daemon-cli.ts`
  constructs the Conductor with `mode: 'auto'`). The audit task therefore records evidence and
  deletes no engine code.
- Example retirement per `/code-removal`: the surviving observable behavior is the four-flow
  example suite with the daemon as the unattended demo. `test_examples_common_prompt.sh` and
  `test_examples_common_timeout.sh` exercise `examples/lib/common.sh` directly (labels only
  mention "inline"); `test_examples_common_sandbox.sh:126` and
  `test_examples_readme_and_usage.sh:45` use `examples/inline.sh` as their fixture and must be
  re-pointed to a surviving flow script before the deletion lands, so every intermediate commit
  keeps the suite green.
- Human-facing documentation pages (quickstart, CLI/steps reference, examples README rows,
  HARNESS/README mentions) are NOT plan tasks per the documentation boundary; the repository's
  maintain-documentation pre-finish gate owns those edits, keyed off this diff. Story 3's grep
  criterion is satisfied by that gate's output in the same PR.

## Prerequisites

- None. All touched files exist at HEAD; no migrations or config changes.

## Tasks

### Task 1: Rejection message names the daemon guide
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend `src/conductor/test/cli/mode-derivation.test.ts` (existing deprecation tests at lines ~23 and ~50) to assert the `--auto` rejection stderr contains both `conduct-ts daemon start` and `docs/guides/running-the-daemon.md`, and that the process-exit path fires before any pipeline construction.
2. Verify test fails (RED) — current message lacks the guide path.
3. Implement: edit the deprecation `console.error` string in `deriveMode` (`src/conductor/src/index.ts`) to name both.
4. Verify test passes (GREEN); confirm the `--auto --interactive` mutual-exclusion assertion still passes unchanged, and assert an unknown option (e.g. `--bogus`) still yields commander's normal unknown-option error (the deprecation stub did not widen flag parsing).
5. Commit with message: "feat(cli): point --auto rejection at the daemon guide"

**Done when:**
- [ ] The updated mode-derivation tests assert both substrings and pass
- [ ] The mutual-exclusion test passes unchanged
- [ ] `conduct-ts inline "x" --auto` exits non-zero printing both substrings (manual or test-captured output)
- [ ] An unknown option still yields the normal unknown-option error (regression assertion)

**Files likely touched:**
- src/conductor/src/index.ts — rejection message text
- src/conductor/test/cli/mode-derivation.test.ts — new assertions

**Dependencies:** none

### Task 2: Delete deriveMode's dead 'auto' return arm
**Story:** Story 1
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Per `/code-removal`: the dead code is the `'auto'` branch of the final ternary in `deriveMode` (`src/conductor/src/index.ts`), unreachable because the deprecation `process.exit(1)` precedes it. Surviving behavior: no flag → `'default'`, `--interactive` → `'interactive'`, `--auto` → rejection.
2. Write/adjust tests: mode-derivation tests assert `deriveMode` returns `'interactive'` and `'default'` for the surviving inputs; remove any assertion that expected an `'auto'` return.
3. Implement: replace the ternary with the two-way derivation; do not change the `RunMode` type (the daemon still passes `'auto'` directly).
4. Verify: `npm test` for the conductor package green; TypeScript compiles.
5. Commit with message: "refactor(cli): remove deriveMode's unreachable 'auto' arm"

**Done when:**
- [ ] `deriveMode` has no `'auto'` return path and the package compiles
- [ ] Mode-derivation tests cover default and interactive derivation and pass
- [ ] The `RunMode` union in src/conductor/src/types/steps.ts is unchanged in the diff

**Files likely touched:**
- src/conductor/src/index.ts — ternary simplification
- src/conductor/test/cli/mode-derivation.test.ts — surviving-behavior assertions

**Dependencies:** Task 1

### Task 3: Record the engine 'auto'-branch audit (no deletions)
**Story:** Story 4
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Enumerate every `this.mode === 'auto'` / `this.mode !== 'auto'` site in `src/conductor/src/engine/conductor.ts` (at authoring HEAD: 6212, 9361, 9405, 9430, 9589, 9836, 10807, 11070, 12164 — re-derive by grep at build HEAD).
2. For each site record verdict `keep` with its governing authority: validation-group-join (fan-out gate, checkpoint pause), fail-closed-decide-entry (complexity short-circuit), remove-retrospectives-one-shot (advisory auto-skip), daemon stall-remediation sites gated on `this.daemon`, engine-owned-resumable-finish-publication (publication intent).
3. Verify mechanically: `git grep -n "mode === 'auto' && !this.daemon" src/conductor/src` returns nothing (there is no one-shot-only composite gate). Note: local grep is shimmed to ugrep with binary-skip; run via `git grep` for evidence.
4. Confirm the full conductor unit suite is green with zero daemon-mode expectation changes.
5. Complete via an empty commit carrying the audit table in the message body, trailers `Task: 3` and `Evidence: skipped audit-only, no code change required`.

**Done when:**
- [ ] The commit message carries the site-by-site table, every verdict `keep`, each with its governing authority
- [ ] `git grep -n "mode === 'auto' && !this.daemon" src/conductor/src` output is empty and quoted in the table
- [ ] Conductor unit suite green with no changes under src/conductor/src/engine in this task

**Files likely touched:**
- none

**Dependencies:** none

### Task 4: Re-point the sandbox wedging fixture off inline.sh
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Read `test/test_examples_common_sandbox.sh` (INLINE_SCRIPT at ~line 126): it wedges `examples/inline.sh` to prove the timeout kill path prints `FAIL inline/small: timeout` and exits non-zero.
2. Write the replacement RED first: swap the fixture to a surviving flow script (prefer `examples/daemon.sh`; any surviving flow sourcing `examples/lib/common.sh` with a tier arg is allowed variation) and update the expected `FAIL <flow>/small: timeout` string to that flow's name.
3. Verify the negative-path assertion still exercises kill + FAIL print + sandbox_down + non-zero exit end-to-end.
4. Run `./test/test_examples_common_sandbox.sh` green.
5. Commit with message: "test(examples): wedge fixture uses a surviving flow"

**Done when:**
- [ ] `test/test_examples_common_sandbox.sh` contains no reference to inline.sh and passes
- [ ] The timeout negative path still asserts the FAIL print and non-zero exit for the new fixture flow

**Files likely touched:**
- test/test_examples_common_sandbox.sh — fixture swap

**Dependencies:** none

### Task 5: Re-point the usage-test representative script
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. `test/test_examples_readme_and_usage.sh` (~lines 45-75) uses `examples/inline.sh` as the representative script for `--help` and unknown-tier usage assertions.
2. Swap the representative to a surviving flow script (prefer `examples/interactive.sh`; allowed variation: any surviving tiered flow), keeping the same assertions: `--help` exits non-zero naming valid tiers, unknown tier `xl` exits non-zero naming valid tiers.
3. Run `./test/test_examples_readme_and_usage.sh` green.
4. Commit with message: "test(examples): usage assertions use a surviving flow"

**Done when:**
- [ ] `test/test_examples_readme_and_usage.sh` contains no reference to inline.sh and passes
- [ ] Both usage negative assertions (help, unknown tier) remain and pass against the new representative

**Files likely touched:**
- test/test_examples_readme_and_usage.sh — representative swap

**Dependencies:** none

### Task 6: Delete the inline example and its dedicated test
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Per `/code-removal`: delete `examples/inline.sh` and `test/test_examples_inline.sh`; remove the `test_examples_inline.sh` entry from `test/run_examples_acceptance_specs.sh`; update the flow-label strings in `test/test_examples_common_timeout.sh` (labels only — it tests lib/common.sh in isolation) so no assertion names the retired flow.
2. Surviving observable behavior: four example flows; `run_examples_acceptance_specs.sh` runs only existing tests; common lib tests keep their PASS/FAIL/timeout coverage under a surviving label.
3. Run `bash test/run_examples_acceptance_specs.sh` and `test/test_harness_integrity.sh` green.
4. Commit with message: "chore(examples): retire the inline --auto one-shot example"

**Done when:**
- [ ] `examples/inline.sh` and `test/test_examples_inline.sh` are absent from the tree
- [ ] `bash test/run_examples_acceptance_specs.sh` passes with the entry removed
- [ ] `test/test_harness_integrity.sh` passes
- [ ] `git grep -ln "examples/inline.sh" -- test examples src` output is empty

**Files likely touched:**
- examples/inline.sh — deleted
- test/test_examples_inline.sh — deleted
- test/run_examples_acceptance_specs.sh — entry removed
- test/test_examples_common_timeout.sh — label strings

**Dependencies:** Task 4
**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ──> Task 2
Task 3 (independent)
Task 4 ──┐
Task 5 ──┴──> Task 6
```

## Integration Points

- After Task 2: the whole surviving CLI mode surface is testable end-to-end (`inline`,
  `inline --interactive`, `inline --auto` rejection).
- After Task 6: the examples suite is testable end-to-end via run_examples_acceptance_specs.sh.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s34-1: Remove the four dangling references to the deleted test/test_examples_inline.sh from the test tree, replacing each pointer with the rationale stated inline (one or two sentences: conduct-ts is stubbed at the PATH boundary so the run completes fast and deterministically without a real credentialed provider session) so no comment cites a file absent from the tree: test/test_examples_daemon.sh:8-9, test/test_examples_engineer.sh:9-10, test/test_examples_intake_loop.sh:8-9, and test/test_examples_interactive.sh:8-10. Comment text only — change no assertion, fixture, stub, or control flow in these files, and leave test/test_helpers.sh:192 ('inline|daemon)' stubs the surviving conduct-ts inline subcommand) untouched. Verify with: git grep -n 'test_examples_inline' -- test/ returns nothing, and bash test/test_harness_integrity.sh plus bash test/run_examples_acceptance_specs.sh stay green (293/0 and 7/7).
**Gate:** prd-audit
**Rationale:** Four surviving test files cite the deleted test/test_examples_inline.sh as the authority for their PATH-stubbing rationale — test/test_examples_daemon.sh:8, test/test_examples_engineer.sh:9, test/test_examples_intake_loop.sh:8, test/test_examples_interactive.sh:9 — while the file itself is absent (deleted in b3e291adf), so the criterion's 'no reference to the retired example or its test' clause fails even though test/test_harness_integrity.sh passes 293/0. Plan Task 6 already owns removing every reference to the retired example and its test from the test tree, so this is conforming documentation drift, not a planning omission or an architecture question. Swept the whole class: git grep -n 'test_examples_inline' returns exactly these four test-tree sites plus .docs/ records; nothing is orphaned by the fix (comment-only edits remove no code, test, or assertion), test/run_examples_acceptance_specs.sh:14-20 already dropped the deleted entry, and test/test_helpers.sh:192's 'inline|daemon)' case stubs the surviving conduct-ts inline SUBCOMMAND (src/conductor/src/index.ts:1021-1043), not the retired example, so it must not be touched. Found and deliberately excluded: the .docs/ mentions in .docs/plans/, .docs/stories/, .docs/decisions/architecture-review-2026-08-26-*, .docs/architecture/flow-examples.md:34,43,56-58 and .docs/decisions/adr-2026-07-22-headless-vs-guided-examples.md:30 — these are sealed DECIDE-owned artifacts (this feature's own plan/stories, and the flow-examples feature's ADR and architecture record, whose 2026-08-26 amendment at lines 17-21 already supersedes the stale enumeration); amending them from build would raise protected-artifact self-amendment and they are historical records of when the example existed, not live pointers in the validation suite.
**Criterion:** S3.4
**Parent task:** 6
**Done when:**
- S3.4 is satisfied by this task.
