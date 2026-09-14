# Implementation Plan: Guard module headers that claim no callers

**Date:** 2026-09-06
**Stories:** .docs/stories/guard-module-headers-that-claim-no-callers-against.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change adds one read-only structural meta-test and four comment-only header corrections, and conforms to the existing structural-guard contract: scan a named tree, derive violations from file bytes, fail the ordinary suite with a message that names each offending site.

## Summary

Three bounded tasks deliver #1646. A new structural meta-test resolves no-caller claims made in a TypeScript module's leading comment block against the real import graph, so a claim that stops being true fails at the moment it stops being true. The four engine headers the armed guard rejects are corrected to name their actual consumers. Wording style, dead-code detection, claims below the leading comment block, and the sibling kickback-surface behaviour issue are outside this slice.

## Technical Approach

Add `src/conductor/test/structural/module-header-caller-claims.test.ts`, modelled on the two guards already in that directory. The analysis is a set of small pure functions the test exercises twice: once over synthetic in-memory fixtures, and once over the real engine tree read from disk into the same shape. Both paths call the identical entry point, so the fixtures are genuine falsifiability evidence for the corpus result rather than a parallel implementation.

Scope the scan to TypeScript files under the engine tree, recursively, which is where every observed instance lives. Extract each file's leading comment block: the run of lines from the top of the file that are blank or begin a line comment, a block-comment opener, a block-comment continuation, or a block-comment terminator, stopping at the first line that is none of those. Claims below that block are out of scope by construction, which is what keeps ordinary prose about a runtime gate being inert from ever matching.

Recognise a deliberately small, explicit claim vocabulary inside that block, each classified as module-level or symbol-level: nothing imports it or this module; no callers or no importers; this module is, or remains, inert; and nothing calls, uses, or invokes a backticked identifier. Anything outside the vocabulary is not a claim. The vocabulary is a table in the test so a future addition is one row.

Resolve a module-level claim by walking every other scanned file's relative import specifiers, rewriting the emitted `.js` extension back to `.ts`, resolving each against the importing file's directory, and comparing the resolved path to the claiming file. Path resolution rather than basename matching is what makes the answer exact across the engine's subdirectories. Resolve a symbol-level claim by looking for a word-boundary occurrence of the backticked identifier in any other scanned file. In both cases the claiming file is excluded from its own evidence, and a claim with no consumers is a truthful claim that passes — that is the negative path the issue explicitly preserves.

A violation carries the claiming file's repository-relative path, the claim's line number, the matched sentence, and the sorted list of consumers that contradict it, so the failure message tells the next author exactly what to write instead of only that something is wrong.

Correct the four headers the armed guard rejects. `gate-invalidation.ts` names the three modules that import it and states that both promised functions are live. `gate-code-validity.ts` names the module that calls `gateVerdictStillValid` and drops the task-number promise. `engineer/coherence-validator.ts` and `engineer/coherence-waiver.ts` each name the module that consumes them instead of claiming they are unwired. These are comment-only edits; no exported symbol, signature, or behaviour changes.

Test level is structural: this is a read-only analysis over source bytes with no process, network, service, or LLM boundary, so the isolation policy is satisfied without any injected adapter. Record the new guard in the structural meta-tests section of the contributor testing page, per this repository's documentation-upkeep rule.

## Preconditions and claim ledger

- Operator approved Small scope, the mechanical guard over a one-off comment correction, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/gate-invalidation.ts:4` reads "This module is currently inert — nothing imports it yet", and `conductor.ts:359`, `rebase.ts:18`, and `gate-code-validity.ts:24` each import that module.
- Verified: `src/conductor/src/engine/gate-code-validity.ts:10` reads "Nothing calls `gateVerdictStillValid` yet", while `artifacts.ts:21` imports the symbol and calls it at lines 938, 945, 970, 2998, 3195, 3386, and 3505.
- Verified: `src/conductor/src/engine/engineer/coherence-validator.ts:11` and `src/conductor/src/engine/engineer/coherence-waiver.ts:13` both read "This module is inert until wired into land-spec.ts", while `engineer/land-spec.ts:61` imports `runCoherenceGate` and `coherence-validator.ts:52` imports from the waiver.
- Verified: the same wording appears elsewhere in the engine only below a module's leading comment block, in `daemon.ts:306`, `steps.ts:394`, `halt-pr-rehabilitation.ts:619`, `coherence-validator.ts:1076`, and `engineer/intake/sanitize.ts:155`, none of which is a claim about callers.
- Verified: `src/conductor/test/structural/` contains seven guards today, and `fixture-portability.test.ts` establishes the known-bad/known-good falsifiability-fixture convention this guard reuses.
- Verified: `docs/contributing/testing.md` carries a "Structural meta-tests" section describing each guard in that directory.
- Verified: the aggregate command is `npm test` from `src/conductor`, and a single file runs as `npm test -- test/<path>.test.ts` from the same directory.
- Scope check: harness-repo-only, its own test suite and engine sources; no new skill; provider-agnostic. Event spine: no new channel, only an ordinary test failure.
- Verify-claims verdict: CLEAR. Every path, line, and consumer above was read in the worktree; no load-bearing assumption remains open.

## Tasks

### Task 1: Detect header claims the import graph contradicts
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/structural/module-header-caller-claims.test.ts
**Dependencies:** none

**Steps:**
1. Create the structural guard file with the leading-comment-block extractor, the claim vocabulary table, the relative-import resolver, the symbol-occurrence resolver, and one entry point taking a map of repository-relative path to file content and returning violations.
2. Write known-bad fixtures first and establish RED: a module whose header claims nothing imports it while a sibling fixture imports it by relative specifier, and a module whose header claims nothing calls a backticked export while a sibling fixture references that identifier.
3. Implement until GREEN, asserting the violation carries the claiming path, the claim line number, the matched sentence, and the sorted consumer list.
4. Run the single file with the project's one-file command, then the type-check target that includes the test directory and the lint command, and commit the focused change.

**Done when:**
1. The module-level known-bad fixture yields exactly one violation naming the importing fixture as its consumer.
2. The symbol-level known-bad fixture yields exactly one violation naming the backticked identifier and the referencing fixture.
3. Each violation reports the claiming file's repository-relative path and the one-based line number of the matched claim.

### Task 2: Keep truthful and out-of-scope claims unflagged
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/structural/module-header-caller-claims.test.ts
**Dependencies:** 1

**Steps:**
1. Add a known-good fixture whose header claims nothing imports it and which no other fixture imports, and establish RED against any implementation that flags on phrase alone.
2. Add a fixture whose matching wording sits below the leading comment block, in prose about a runtime gate being inert, and a fixture with no leading comment block at all.
3. Add a fixture whose backticked identifier appears nowhere else in the scanned set, and a fixture that imports a same-named module from a different directory, proving resolution is by resolved path rather than basename.
4. Implement until GREEN without weakening Task 1's detections, run the same one-file, type-check, and lint commands, and commit.

**Done when:**
1. The truthful module-level and symbol-level fixtures each yield no violation.
2. The below-the-block fixture and the no-comment-block fixture each yield no violation.
3. The same-basename-different-directory fixture yields no violation, and Task 1's two known-bad fixtures still yield exactly one violation each.

### Task 3: Arm the guard over the engine tree and correct the stale headers
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/structural/module-header-caller-claims.test.ts, src/conductor/src/engine/gate-invalidation.ts, src/conductor/src/engine/gate-code-validity.ts, src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/src/engine/engineer/coherence-waiver.ts, docs/contributing/testing.md
**Dependencies:** 1

**Steps:**
1. Add the corpus case that recursively reads every TypeScript file under the engine tree into the same map shape and asserts the entry point returns no violations; confirm RED lists exactly the four known stale headers with their consumers.
2. Rewrite the `gate-invalidation.ts` header to name the three modules that import it and to state that both previously promised functions are live, and rewrite the `gate-code-validity.ts` header to name the module that calls `gateVerdictStillValid` instead of promising later wiring.
3. Rewrite the `engineer/coherence-validator.ts` and `engineer/coherence-waiver.ts` headers to name the module that consumes each, removing the claim that they are unwired; change no exported symbol, signature, or behaviour.
4. Add the guard to the structural meta-tests section of the contributor testing page, then run the one-file command, the type-check target covering tests, the lint command, and the aggregate suite once before committing.

**Done when:**
1. The corpus case reported the four known stale headers before the corrections and reports zero violations after them.
2. Each corrected header names at least one module that consumes its exports, and the four diffs change comment lines only.
3. The contributor testing page's structural meta-tests section describes the new guard, its scanned tree, its claim vocabulary, and its truthful-claim escape.
4. The aggregate test suite passes with the guard armed.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a module's leading comment block claims nothing imports it and another module in the scanned tree imports it, when the guard runs, then it fails and names the claiming file, the claim line, and every importing module. | 1 | "The module-level known-bad fixture yields exactly one violation naming the importing fixture as its consumer." | diff-local |
| Story 1 happy: Given a leading comment block claims nothing calls a backticked export and another module in the scanned tree references that identifier, when the guard runs, then it fails and names the claiming file, the identifier, and every referencing module. | 1 | "The symbol-level known-bad fixture yields exactly one violation naming the backticked identifier and the referencing fixture." | diff-local |
| Story 1 negative: Given a module's leading comment block claims nothing imports it and no other module in the scanned tree imports it, when the guard runs, then it reports no violation for that module. | 2 | "The truthful module-level and symbol-level fixtures each yield no violation." | diff-local |
| Story 1 negative: Given the same no-caller wording appears below a module's leading comment block, when the guard runs, then it reports no violation for that module. | 2 | "The below-the-block fixture and the no-comment-block fixture each yield no violation." | diff-local |
| Story 2 happy: Given the engine source tree as committed, when the guard runs over it, then it reports zero unsupported no-caller claims. | 3 | "The corpus case reported the four known stale headers before the corrections and reports zero violations after them." | diff-local |
| Story 2 happy: Given the four engine modules whose headers assert they are inert or uncalled, when a reader opens each header, then it names the modules that consume its exports instead of claiming there are none. | 3 | "Each corrected header names at least one module that consumes its exports, and the four diffs change comment lines only." | diff-local |
| Story 2 negative: Given a header is later edited to re-assert a claim the import graph contradicts, when the aggregate test suite runs, then the guard fails and names that header rather than passing silently. | 1, 3 | "The aggregate test suite passes with the guard armed." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local. Task 1 owns the known-bad detection fixtures, Task 2 owns the known-good and out-of-scope fixtures, and Task 3 owns the corpus case over the real engine tree plus the header corrections it forces. The guard is a read-only source analysis with no process, network, service, or LLM boundary, so no adapter injection or fake is required and no smoke tier is involved. The fixtures and the corpus case share one entry point, so no separate aggregate or end-to-end test is added, and no terminal validation task is created.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
