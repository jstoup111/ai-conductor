# Implementation Plan: External-boundary registry and ratchet (#1989)

**Date:** 2026-11-07
**Stories:** .docs/stories/external-boundaries-have-no-swappable-seams-rerout.md
**Conflict check:** Clean as of 2026-11-07

## Summary

Seven tasks add a test-side registry of the eight external boundaries, a TypeScript-AST boundary ratchet that rejects new direct external touches outside registered adapters and composition roots, and a seeded shrink-only allowlist. No production module changes, and no boundary is migrated.

## Technical Approach

- **Governing records.** Decision: `adr-2026-11-07-external-boundary-ports-registry-and-ratchet` D1–D6. Review: `.docs/decisions/architecture-review-2026-11-07-external-boundaries-have-no-swappable-seams-rerout.md`.
- **Scope of changes.** Every change is under `src/conductor/test/structural/`. The only existing files edited are `layer-ratchet.ts`, which exports existing helpers and gains the shared source walk, and `layer-ratchet.test.ts`, which switches to that shared walk.
- **Registry.** `boundary-registry.ts` exports a `BoundaryName` union of exactly eight literals and `BOUNDARY_REGISTRY: Readonly<Record<BoundaryName, BoundaryEntry>>`.
  - Status is the discriminated union `{ kind: 'ported' } | { kind: 'pending'; issue: number }`, so a pending entry without an issue does not compile.
  - Entry fields: `port` (type name or `null` while pending), `adapterModules` (paths relative to `src/conductor/src/`), `specifiers` (exact module names; `@opentelemetry/` is a prefix match), `clockCalls` (clock only), and `commandLiterals` (`git`, `gh` and `tmux`, carried on their own entries).
- **Ratchet entry point.** `boundary-ratchet.ts` exports the pure function `checkBoundaryRatchet({ files, allowlist, registry })`. `files` is a map from path to source and `allowlist` holds lines. It returns `{ touches, violations }`, and the registry is a parameter so fixtures can supply a synthetic registry.
- **Touch kinds.** The ratchet classifies touches with the TypeScript compiler API (`typescript` 6.0.3, already used by `layer-ratchet.ts`), never regex. There are four kinds:
  - **Specifier imports.** Static `import`, `export … from`, and dynamic `import()` of a registered specifier. The `node:` prefix is stripped before matching. Type-only imports (`import type`, or all bindings marked `type`) are not touches.
  - **Clock calls.** `Date.now()`, a `new Date` with zero arguments, and `performance.now()`.
  - **Command-literal spawns.** A call whose first argument is a string literal in a boundary's `commandLiterals`, where the callee identifier (or namespace member) is bound by an import from `child_process`, `execa`, or a registered `process` adapter module. The call touches that boundary and `process`.
  - **Adapter imports.** A value import that resolves to a registered adapter module.
- **Verdict.** A touch passes in three cases:
  - its file is a registered adapter of that boundary;
  - it is an adapter import from a composition root, meaning a file whose `layerFor` is `entry`, which is a top-level file under `src/conductor/src/`;
  - the line `«file» -> «boundary»` is allowlisted.
- **Allowlist lines.** Each line is strictly ascending, uses the D5 separator ` -> `, and names a registered boundary. A line with no matching unpermitted touch is stale.
- **Local pattern: `test/structural/layer-ratchet.ts` and `layer-ratchet.test.ts`.** Preserve these traits:
  - a pure check over an in-memory `files` map plus allowlist lines, with the file walk in the test;
  - AST classification;
  - sorted, malformed, and stale allowlist failures;
  - violation messages naming the file and line.

  Allowed variation: entries key on (file, boundary), not (file, file). Search hints: `checkLayerRatchet`, `readAllowlistEntries`, `parseAllowlistEntry`, `resolveSpecifier`, `layerFor`, and `sourceFiles`. Tasks 2 and 7 export `resolveSpecifier`, `layerFor` and the source walk from `layer-ratchet.ts` instead of copying them.
- **Sequencing.** Task 1 provides the registry type that every ratchet task consumes. Task 2 provides the check skeleton. Tasks 3–6 each add one touch kind or allowlist rule and are independent of each other. Task 7 generates the seed and runs the check on the real tree.

## Prerequisites

- The follow-on intakes #3633–#3639 exist and are blocked by #1989 (filed 2026-11-07). #3043 is blocked by #1989.

## Tasks

### Task 1: Declare the eight-boundary registry with a typed status
**Story:** 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `boundary-registry.test.ts`:
   - the registry's keys equal the eight boundary names exactly;
   - `llm` is ported, with port `LLMProvider` and the three provider adapter paths;
   - the other seven are pending, with issues git 3043, gh 3637, tmux 3639, process 3634, clock 3638, otel 3635 and filesystem 3636, and no adapters;
   - every adapter path exists under `src/conductor/src/`;
   - a `// @ts-expect-error` fixture assigns `{ kind: 'pending' }` with no issue to a `BoundaryStatus`.
2. Verify the tests fail (RED).
3. Implement `boundary-registry.ts`:
   - `BoundaryName`, `BoundaryStatus` and `BoundaryEntry` types, and `BOUNDARY_REGISTRY` typed as `Readonly<Record<BoundaryName, BoundaryEntry>>`;
   - specifiers per ADR D1: process `child_process` and `execa`; filesystem `fs`, `fs/promises` and `chokidar`; otel `@opentelemetry/`;
   - clock calls `Date.now`, zero-argument `new Date` and `performance.now`;
   - command literals `git`, `gh` and `tmux` on their entries.

   Add `expectedBoundaryNames` and `missingAdapterPaths(registry, files)` helpers that report differences by name.
4. Verify the tests pass (GREEN). `npm run typecheck:test` passes, which proves the `@ts-expect-error` line still errors.
5. Commit: "test(structural): declare the external-boundary registry"

**Done when:**
- [test] The registry-completeness test asserts `Object.keys(BOUNDARY_REGISTRY)` equals exactly `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`, and a fixture registry missing `clock` or carrying an extra `network` key makes the completeness helper report that name.
- [test] The entry-status test asserts status `ported`, port `LLMProvider`, and adapter modules `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts` for `llm`, and that each other entry has status `pending` with issue process 3634, otel 3635, filesystem 3636, gh 3637, clock 3638, tmux 3639 and git 3043, and an empty adapter list.
- [test] The membership test asserts the real `BOUNDARY_REGISTRY` matches ADR D1 exactly. The specifiers are `child_process` and `execa` for `process`, `fs`, `fs/promises` and `chokidar` for `filesystem`, and the prefix `@opentelemetry/` for `otel`. The clock calls are `Date.now`, zero-argument `new Date` and `performance.now`. The command literals are `git`, `gh` and `tmux` on their own entries, and every other entry's specifier, clock-call and command-literal fields are empty.
- [test] The adapter-path test asserts that `missingAdapterPaths` returns no path for the real registry, and that for a fixture entry with adapter `execution/missing.ts` it returns that entry name and path.
- `npm run typecheck:test` passes with the `@ts-expect-error` fixture that assigns `{ kind: 'pending' }` without an issue to `BoundaryStatus`, so a pending status without an issue number fails compilation.

**Files:** `src/conductor/test/structural/boundary-registry.ts`, `src/conductor/test/structural/boundary-registry.test.ts`

### Task 2: Detect external specifier imports and judge them against adapters and the allowlist
**Story:** 2
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing fixture tests in `boundary-ratchet.test.ts` with the real `BOUNDARY_REGISTRY`. The own-adapter case alone uses a synthetic registry:
   - `import { readFile } from 'node:fs/promises'` in unlisted `engine/a.ts` fails, naming `engine/a.ts`, line 1, and `filesystem`;
   - `import fs from 'fs'` fails as `filesystem`;
   - `await import('node:child_process')` fails as `process`;
   - `export { x } from 'fs'` fails as `filesystem`;
   - `import { trace } from '@opentelemetry/api'` fails as `otel`;
   - `import type { Stats } from 'node:fs'` and `import { type Stats } from 'fs'` report no touch;
   - a fixture registry that registers `execution/fs-adapter.ts` as a filesystem adapter lets that file import `node:fs` with no violation;
   - an allowlisted `engine/a.ts -> filesystem` passes;
   - the formatted message names `pending #3636` for a pending boundary, and the adapter module paths for a ported boundary. The ported case uses a hand-built violation or a synthetic registry, because the real `llm` entry has no specifiers.
2. Verify the tests fail (RED).
3. Export `resolveSpecifier` and `layerFor` from `layer-ratchet.ts` with no behavior change; Tasks 4 and 5 use them. Implement `checkBoundaryRatchet` and `formatBoundaryViolations`:
   - walk `moduleReferences`-style nodes per file with the TypeScript compiler API;
   - strip a `node:` prefix, then match each specifier against registry `specifiers` (exact name, or prefix for an entry ending in `/`);
   - skip type-only forms;
   - record a touch `{ file, line, boundary, kind }`;
   - permit it when the file is in that boundary's `adapterModules` or `«file» -> «boundary»` is in the allowlist;
   - otherwise emit an `unlisted-touch` violation;
   - the formatter's exhaustive switch over violation kinds prints file:line, boundary, and either `pending #N` or the adapter list.
4. Verify the tests pass (GREEN).
5. Commit: "test(structural): reject unlisted external specifier imports"

**Done when:**
- [test] `checkBoundaryRatchet` reports an `unlisted-touch` violation naming file `engine/a.ts`, line 1 and boundary `filesystem` for `import { readFile } from 'node:fs/promises'` under the real `BOUNDARY_REGISTRY`, as asserted by the node-specifier fixture test.
- [test] `checkBoundaryRatchet` reports `filesystem` for a bare `import fs from 'fs'` and for `export { x } from 'fs'`, `process` for `await import('node:child_process')`, and `otel` for `@opentelemetry/api`, all under the real `BOUNDARY_REGISTRY`, as asserted by the specifier-form fixture tests.
- [test] `checkBoundaryRatchet` reports no touch for `import type { Stats } from 'node:fs'` or `import { type Stats } from 'fs'`, and no violation when the importing file is a registered adapter of that boundary, as asserted by the type-only and own-adapter fixture tests.
- [test] `formatBoundaryViolations` output for a pending-boundary violation contains `pending #3636`, and for a ported-boundary violation contains each registered adapter module path, as asserted by the message fixture test.
- `layerFor` and `resolveSpecifier` are exported from `test/structural/layer-ratchet.ts` with unchanged bodies, and the existing `layer-ratchet.test.ts` cases pass.

**Files:** `src/conductor/test/structural/boundary-ratchet.ts`, `src/conductor/test/structural/boundary-ratchet.test.ts`, `src/conductor/test/structural/layer-ratchet.ts`

### Task 3: Detect clock reads
**Story:** 2
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Write failing fixture tests with the real `BOUNDARY_REGISTRY`:
   - `Date.now()`, `new Date()`, `new Date` with no argument list, and `performance.now()` in an unlisted file each fail as `clock` with their line;
   - `new Date(timestamp)` and `new Date('2026-01-01')` report no clock touch.
2. Verify the tests fail (RED).
3. Implement: in the AST walk, record a `clock` touch for:
   - a `CallExpression` whose callee is the property access `Date.now` or `performance.now`;
   - a `NewExpression` of identifier `Date` whose `arguments` is undefined or empty.
4. Verify the tests pass (GREEN).
5. Commit: "test(structural): reject unlisted clock reads"

**Done when:**
- [test] `checkBoundaryRatchet` reports an `unlisted-touch` violation with boundary `clock` and the expression's line for each of `Date.now()`, `new Date()`, `new Date` and `performance.now()` in an unlisted file under the real `BOUNDARY_REGISTRY`, as asserted by the clock-read fixture test.
- [test] `checkBoundaryRatchet` reports no `clock` touch for `new Date(timestamp)` or `new Date('2026-01-01')`, as asserted by the dated-constructor fixture test.

**Files:** `src/conductor/test/structural/boundary-ratchet.ts`, `src/conductor/test/structural/boundary-ratchet.test.ts`

### Task 4: Attribute literal git, gh and tmux spawns through imported spawn callees
**Story:** 2
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Write failing fixture tests with the real `BOUNDARY_REGISTRY`, plus a synthetic registry for the process-adapter case:
   - `import { execa } from 'execa'; execa('git', ['status'])` in an unlisted file reports unlisted touches for both `git` and `process`;
   - `import * as cp from 'node:child_process'; cp.execFile('gh', [])` reports `gh` and `process`;
   - `import { spawnSync } from 'child_process'; spawnSync('tmux', [])` reports `tmux` and `process`;
   - a file that declares its own `function execa(cmd: string) {}` and calls `execa('git')` reports no `git` touch;
   - `execa(cmd)` with a non-literal first argument reports only the `process` import touch;
   - with a synthetic registry registering `execution/proc.ts` as a `process` adapter, top-level `cli.ts` doing `import { run } from './execution/proc.js'; run('git', [])` reports an unlisted `git` touch.
2. Verify the tests fail (RED).
3. Implement: collect, per file, the local bindings (named, default, and namespace) introduced by value imports from `child_process` or `execa`, or from any module registered as a `process` adapter. For each `CallExpression` whose callee is one of those identifiers, or a property access on a namespace binding, and whose first argument is a string literal matching an entry's `commandLiterals`, record a touch on that boundary. The import itself already records the `process` touch.
4. Verify the tests pass (GREEN).
5. Commit: "test(structural): attribute literal git, gh and tmux spawns"

**Done when:**
- [test] `checkBoundaryRatchet` reports unlisted touches naming both `git` and `process` for `execa('git', ['status'])` with `execa` imported from `execa` under the real `BOUNDARY_REGISTRY`, as asserted by the execa-git fixture test.
- [test] `checkBoundaryRatchet` reports `gh` for `cp.execFile('gh', [])` via a `node:child_process` namespace import and `tmux` for `spawnSync('tmux', [])`, as asserted by the namespace and named-import fixture tests.
- [test] `checkBoundaryRatchet` reports no `git` touch for a call to a locally declared function named `execa` with the literal `'git'`, as asserted by the shadowed-callee fixture test.
- [test] `checkBoundaryRatchet` reports an unlisted `git` touch for `cli.ts` calling `run('git', [])`, where `run` is imported from a registered `process` adapter module `execution/proc.ts`, as asserted by the process-adapter-callee fixture test.

**Files:** `src/conductor/test/structural/boundary-ratchet.ts`, `src/conductor/test/structural/boundary-ratchet.test.ts`

### Task 5: Permit adapter imports only from adapters, composition roots and the allowlist
**Story:** 3
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Write failing fixture tests with a registry whose `llm` adapters include `execution/claude-provider.ts`:
   - top-level `cli.ts` value-importing `./execution/claude-provider.js` passes with an empty allowlist;
   - `engine/a.ts` value-importing `../execution/claude-provider.js` fails, naming `engine/a.ts`, its line, `llm`, and the text `only composition roots import adapters`;
   - `engine/a.ts` with `import type { ClaudeProvider } from '../execution/claude-provider.js'` reports no adapter touch;
   - `engine/cli-entry.ts` value-importing the adapter fails;
   - `execution/provider-catalog.ts` value-importing it passes when `execution/provider-catalog.ts -> llm` is allowlisted.
2. Verify the tests fail (RED).
3. Implement:
   - resolve each relative value import with `resolveSpecifier`, which Task 2 exported, and record an `adapter-import` touch when the target is in any boundary's `adapterModules`;
   - permit it when `layerFor(file) === 'entry'`, when the file is itself an adapter of that boundary, or when it is allowlisted;
   - the formatter names the composition-root rule for an `adapter-import` violation.
4. Verify the tests pass (GREEN).
5. Commit: "test(structural): restrict adapter imports to composition roots"

**Done when:**
- [test] `checkBoundaryRatchet` reports no violation for top-level `cli.ts` value-importing a registered `llm` adapter with an empty allowlist, and none for `execution/provider-catalog.ts` when `execution/provider-catalog.ts -> llm` is allowlisted, as asserted by the root and allowlisted-importer fixture tests.
- [test] `checkBoundaryRatchet` reports an `unlisted-touch` violation for `engine/a.ts` value-importing `execution/claude-provider.ts` whose formatted message names `engine/a.ts`, the import line, `llm` and `only composition roots import adapters`, as asserted by the engine-importer fixture test.
- [test] `checkBoundaryRatchet` reports no adapter touch for a type-only import from `execution/claude-provider.ts`, and reports a violation for nested `engine/cli-entry.ts` value-importing it, as asserted by the type-only and nested-file fixture tests.

**Files:** `src/conductor/test/structural/boundary-ratchet.ts`, `src/conductor/test/structural/boundary-ratchet.test.ts`

### Task 6: Reject stale, malformed and unknown-boundary allowlist lines
**Story:** 4
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Write failing fixture tests:
   - `engine/a.ts -> filesystem` with no fs import in `engine/a.ts` fails as `stale-entry`, naming the line;
   - a line for a file now registered as that boundary's adapter fails as `stale-entry`;
   - lines `b.ts -> clock` before `a.ts -> clock`, and a duplicated line, each fail as `malformed-entry`, naming the line;
   - `src/x.ts -> network` fails as `unknown-boundary`;
   - `engine/a.ts filesystem`, ` -> clock` and `engine/a.ts -> ` each fail as `malformed-entry`;
   - a fixture pair where the file drops its fs import and its allowlist line is removed passes with no violation.
2. Verify the tests fail (RED).
3. Implement allowlist validation in `checkBoundaryRatchet`:
   - parse each line with the D5 separator ` -> ` into (file, boundary), requiring both sides to be non-empty;
   - require strictly ascending order;
   - require the boundary to be a registry key;
   - mark a line stale when no touch by that file on that boundary exists, or when every such touch is permitted without the line;
   - extend the formatter's exhaustive switch with `stale-entry`, `malformed-entry` and `unknown-boundary`.
4. Verify the tests pass (GREEN).
5. Commit: "test(structural): keep the boundary allowlist shrink-only and well-formed"

**Done when:**
- [test] `checkBoundaryRatchet` reports a `stale-entry` violation naming the line `engine/a.ts -> filesystem` when `engine/a.ts` has no fs touch, and when `engine/a.ts` is a registered filesystem adapter, as asserted by the two stale-entry fixture tests.
- [test] `checkBoundaryRatchet` reports a `malformed-entry` violation naming the line for an out-of-order line, a duplicated line, a line without ` -> `, and lines with an empty file or boundary side, as asserted by the malformed-entry fixture tests.
- [test] `checkBoundaryRatchet` reports an `unknown-boundary` violation for `src/x.ts -> network`, as asserted by the unknown-boundary fixture test.
- [test] `checkBoundaryRatchet` returns no violation for a fixture where `engine/a.ts` no longer imports `fs` and its `engine/a.ts -> filesystem` line is removed, as asserted by the migrated-file fixture test.

**Files:** `src/conductor/test/structural/boundary-ratchet.ts`, `src/conductor/test/structural/boundary-ratchet.test.ts`

### Task 7: Seed the allowlist and run the ratchet over the real source tree in the default tier
**Story:** 2
**Story:** 3
**Story:** 4
**Type:** happy-path
**Dependencies:** Tasks 1, 3, 4, 5, 6

**Steps:**
1. Write the failing real-tree test in `boundary-ratchet.test.ts`. It reads every `.ts` file under `src/conductor/src/` with the shared source walk, reads `boundary-allowlist.txt` with `readAllowlistEntries`, and calls `checkBoundaryRatchet` with `BOUNDARY_REGISTRY`. It asserts zero violations and a scanned-file count greater than zero.
2. Verify the test fails (RED: the allowlist does not exist yet).
3. Implement:
   - move the `sourceFiles` walk from `layer-ratchet.test.ts` into an exported `readSourceTree()` in `layer-ratchet.ts`, used by both tests;
   - generate `boundary-allowlist.txt` from `checkBoundaryRatchet`'s unpermitted touches on the implementation HEAD, as one sorted, de-duplicated `«file» -> «boundary»` line per pair;
   - commit the generated file. Do not hand-edit lines.
4. Verify the test passes (GREEN). `layer-ratchet.test.ts` still passes.
5. Commit: "test(structural): seed the boundary allowlist and ratchet the real tree"

**Done when:**
- [test] The real-tree test in the default Vitest tier runs `checkBoundaryRatchet` over every `.ts` file under `src/conductor/src/` with `BOUNDARY_REGISTRY` and the committed `boundary-allowlist.txt`, and asserts zero violations and a scanned-file count greater than zero, passing `formatBoundaryViolations(result.violations)` as the assertion message so a failure prints file, line, boundary and the adapter or pending issue.
- [test] The real-tree test asserts that every line of the committed `boundary-allowlist.txt` parses as `«file» -> «boundary»`, the lines are strictly ascending, and the check reports no `stale-entry` for any line, so every line matches a current, otherwise unpermitted touch.
- [test] The real-tree test asserts that the allowlist contains `execution/provider-catalog.ts -> llm` and that the check reports no violation for that file's value import of a registered `llm` adapter.
- `boundary-ratchet.test.ts` sits under `src/conductor/test/structural/`, matches `vitest.config.ts`'s default `include` pattern and no `exclude` pattern, so the CI `conductor` job runs it.

**Files:** `src/conductor/test/structural/boundary-allowlist.txt`, `src/conductor/test/structural/boundary-ratchet.test.ts`, `src/conductor/test/structural/layer-ratchet.ts`, `src/conductor/test/structural/layer-ratchet.test.ts`

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┬─▶ Task 3 ──┐
                    ├─▶ Task 4 ──┤
                    ├─▶ Task 5 ──┼─▶ Task 7
                    └─▶ Task 6 ──┘
Task 1 ─────────────────────────▶ Task 7
```

## Integration Points

- After Task 2, a fixture-level ratchet rejects unlisted specifier imports.
- After Task 7, the default Vitest tier and the CI `conductor` job fail on any new direct external touch in `src/conductor/src/`. This is the feature's only production boundary: CI before merge.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the boundary registry, when it is read, then it holds exactly eight entries, named `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`. | 1 | "asserts `Object.keys(BOUNDARY_REGISTRY)` equals exactly `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`" | diff-local |
| Story 1 happy: Given the `llm` entry, when it is read, then its status is ported, its port is `LLMProvider`, and its adapter modules are `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`. | 1 | "asserts status `ported`, port `LLMProvider`, and adapter modules `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`" | diff-local |
| Story 1 happy: Given each of the other seven entries, when it is read, then its status is pending, it names its open follow-on intake issue (`process` #3634, `otel` #3635, `filesystem` #3636, `gh` #3637, `clock` #3638, `tmux` #3639, `git` #3043), and it lists no adapter modules. | 1 | "each other entry has status `pending` with issue process 3634, otel 3635, filesystem 3636, gh 3637, clock 3638, tmux 3639 and git 3043, and an empty adapter list" | diff-local |
| Story 1 negative: Given a registry edited to drop one of the eight boundaries or add a ninth, when the structural test suite runs, then the registry completeness check fails and names the missing or extra boundary. | 1 | "a fixture registry missing `clock` or carrying an extra `network` key makes the completeness helper report that name" | diff-local |
| Story 1 negative: Given an entry whose registered adapter module path does not exist under `src/conductor/src/`, when the structural test suite runs, then the check fails and names that entry and path. | 1 | "for a fixture entry with adapter `execution/missing.ts` it returns that entry name and path" | diff-local |
| Story 1 negative: Given a pending entry that names no issue number, when the registry is type-checked, then compilation fails, because a pending status without an issue cannot be expressed. | 1 | "so a pending status without an issue number fails compilation" | diff-local |
| Story 2 happy: Given the current source tree and the seeded allowlist, when the boundary ratchet test runs, then it passes with no violations. | 7 | "asserts zero violations and a scanned-file count greater than zero" | diff-local |
| Story 2 happy: Given a file that imports a boundary port only as a type, when the ratchet runs, then the file is not reported as a touch. | 2 | "reports no touch for `import type { Stats } from 'node:fs'` or `import { type Stats } from 'fs'`" | diff-local |
| Story 2 happy: Given a registered adapter module that imports its own boundary's external specifier, when the ratchet runs, then that touch passes without an allowlist line. | 2 | "no violation when the importing file is a registered adapter of that boundary" | diff-local |
| Story 2 negative: Given an unlisted `src/` file that adds `import { readFile } from 'node:fs/promises'`, when the ratchet runs, then it fails, naming the file, the line, and the boundary `filesystem`. | 2 | "reports an `unlisted-touch` violation naming file `engine/a.ts`, line 1 and boundary `filesystem`" | diff-local |
| Story 2 negative: Given an unlisted file that adds a bare-specifier `import fs from 'fs'` or a dynamic `await import('node:child_process')`, when the ratchet runs, then it fails, naming the `filesystem` or `process` boundary respectively. | 2 | "reports `filesystem` for a bare `import fs from 'fs'` and for `export { x } from 'fs'`, `process` for `await import('node:child_process')`" | diff-local |
| Story 2 negative: Given an unlisted file that adds `Date.now()`, zero-argument `new Date()`, or `performance.now()`, when the ratchet runs, then it fails, naming the boundary `clock`. | 3 | "reports an `unlisted-touch` violation with boundary `clock` and the expression's line for each of `Date.now()`, `new Date()`, `new Date` and `performance.now()`" | diff-local |
| Story 2 negative: Given an unlisted file that adds `new Date(timestamp)` with an argument, when the ratchet runs, then it does not report a `clock` touch. | 3 | "reports no `clock` touch for `new Date(timestamp)`" | diff-local |
| Story 2 negative: Given an unlisted file that adds `execa('git', ['status'])` with `execa` imported from `execa`, when the ratchet runs, then it fails, naming both `git` and `process`. | 4 | "reports unlisted touches naming both `git` and `process` for `execa('git', ['status'])` with `execa` imported from `execa`" | diff-local |
| Story 2 negative: Given an unlisted file that calls a locally defined function named `execa` with the literal `'git'`, when the ratchet runs, then it does not report a `git` touch. | 4 | "reports no `git` touch for a call to a locally declared function named `execa` with the literal `'git'`" | diff-local |
| Story 2 negative: Given an unlisted file that adds an import of `@opentelemetry/api`, when the ratchet runs, then it fails, naming the boundary `otel`. | 2 | "and `otel` for `@opentelemetry/api`" | diff-local |
| Story 2 negative: Given a violation for a pending boundary, when the failure message is printed, then it names that boundary's follow-on issue, and for a ported boundary it names the registered adapter modules to use instead. | 2 | "output for a pending-boundary violation contains `pending #3636`, and for a ported-boundary violation contains each registered adapter module path" | diff-local |
| Story 3 happy: Given an entry-layer file directly under `src/conductor/src/`, when it value-imports a registered `llm` adapter module, then the ratchet passes it without an allowlist line. | 5 | "reports no violation for top-level `cli.ts` value-importing a registered `llm` adapter with an empty allowlist" | diff-local |
| Story 3 happy: Given a seeded allowlist line for an existing non-root importer of an `llm` adapter, when the ratchet runs, then that import passes. | 7 | "asserts that the allowlist contains `execution/provider-catalog.ts -> llm` and that the check reports no violation for that file's value import of a registered `llm` adapter" | diff-local |
| Story 3 negative: Given an unlisted `engine/` file that adds a value import of `execution/claude-provider.ts`, when the ratchet runs, then it fails, naming the file, the line, the boundary `llm`, and the rule that only composition roots import adapters. | 5 | "whose formatted message names `engine/a.ts`, the import line, `llm` and `only composition roots import adapters`" | diff-local |
| Story 3 negative: Given an unlisted `engine/` file that adds a type-only import from `execution/claude-provider.ts`, when the ratchet runs, then it does not report an adapter-import touch. | 5 | "reports no adapter touch for a type-only import from `execution/claude-provider.ts`" | diff-local |
| Story 3 negative: Given a file nested one directory below `src/conductor/src/` (for example `engine/cli-entry.ts`), when it value-imports a registered adapter without an allowlist line, then the ratchet fails, because only top-level entry files are composition roots. | 5 | "reports a violation for nested `engine/cli-entry.ts` value-importing it" | diff-local |
| Story 4 happy: Given the seeded `boundary-allowlist.txt`, when it is read, then every line has the form `«file» -> «boundary»`, the lines are in strictly ascending order, and every line matches a current touch that is not otherwise permitted. | 7 | "every line of the committed `boundary-allowlist.txt` parses as `«file» -> «boundary»`, the lines are strictly ascending, and the check reports no `stale-entry` for any line" | diff-local |
| Story 4 happy: Given a migration that removes every `fs` import from a listed file, when the matching allowlist line is deleted in the same change, then the ratchet passes. | 6 | "returns no violation for a fixture where `engine/a.ts` no longer imports `fs` and its `engine/a.ts -> filesystem` line is removed" | diff-local |
| Story 4 negative: Given an allowlist line whose file no longer touches that boundary, when the ratchet runs, then it fails as a stale entry and names the line to delete. | 6 | "reports a `stale-entry` violation naming the line `engine/a.ts -> filesystem` when `engine/a.ts` has no fs touch" | diff-local |
| Story 4 negative: Given an allowlist line for a file that has become a registered adapter for that boundary, when the ratchet runs, then it fails as a stale entry, because the touch is now permitted. | 6 | "and when `engine/a.ts` is a registered filesystem adapter" | diff-local |
| Story 4 negative: Given an allowlist line that is out of order or duplicated, when the ratchet runs, then it fails as a malformed entry and names the line. | 6 | "reports a `malformed-entry` violation naming the line for an out-of-order line, a duplicated line" | diff-local |
| Story 4 negative: Given an allowlist line naming a boundary that is not in the registry, such as `src/x.ts -> network`, when the ratchet runs, then it fails as an unknown-boundary entry. | 6 | "reports an `unknown-boundary` violation for `src/x.ts -> network`" | diff-local |
| Story 4 negative: Given an allowlist line missing the ` -> ` separator or with an empty side, when the ratchet runs, then it fails as a malformed entry. | 6 | "a line without ` -> `, and lines with an empty file or boundary side" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D1 | task | task-1 | asserts the real `BOUNDARY_REGISTRY` matches ADR D1 exactly |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D2 | no-change | none | Decision 2 fixes the shape of `Boundaries`, `createProductionBoundaries()` and root construction, and states they land with the first migration (#3043), not in this spec. This feature adds no production module, so it has no port parameter, adapter default, or root to change. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D3 | task | task-1 | each other entry has status `pending` with issue process 3634, otel 3635, filesystem 3636, gh 3637, clock 3638, tmux 3639 and git 3043 |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D4 | task | task-2, task-3, task-4, task-5, task-6 | reports an `unlisted-touch` violation naming file `engine/a.ts`, line 1 and boundary `filesystem` |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D5 | task | task-7 | asserts zero violations and a scanned-file count greater than zero |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D6 | existing | none | Follow-on intakes #3633–#3639 were filed on 2026-11-07, each natively blocked by #1989, and #1989 was added as a native blocker of #3043, as the GitHub `dependencies/blocked_by` lists show. Task 1 records each pending issue number in the registry. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
