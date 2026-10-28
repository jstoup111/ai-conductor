# Implementation Plan: Enforce module layering with the import-graph ratchet (#1988)

**Date:** 2026-10-25
**Design:** `adr-2026-10-07-conductor-decomposition-target-architecture` D5, refined by `.docs/decisions/architecture-review-2026-10-24-module-layering-is-prose-only-violations-merge-wit.md` (technical track, no PRD)
**Stories:** `.docs/stories/module-layering-is-prose-only-violations-merge-wit.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-24 (one degrading sequencing conflict with slice 3, accepted)

## Summary

This plan builds roadmap slice 2: the D5 import-graph ratchet. It is a pure TypeScript-AST checker
plus a default-tier structural test over `src/conductor/src/`, with a committed allowlist that has
one file per allowed edge and can only shrink. There are 8 tasks.

## Technical Approach

### Modules and their shape

- **Checker module** `src/conductor/test/structural/layer-ratchet.ts`. It is pure, so it does no
  filesystem access and no process work. It exports:
  - `checkLayerRatchet({ files, allowlist })`. `files` is a `ReadonlyMap` from a path relative to
    `src/conductor/src/` (POSIX separators) to that file's source text. `allowlist` is the list of
    entry file names. It returns `{ scannedFileCount, edges, violations }`.
  - `encodeAllowlistName(from, to)` and `decodeAllowlistName(name)`.
  - `formatRatchetViolations(violations)`, which renders one failure line per violation.
- **Structural test** `src/conductor/test/structural/layer-ratchet.test.ts`. It holds the fixture
  tests and the one real-tree test. The real-tree test is the only code that touches the
  filesystem. It reads every `.ts` file under `src/conductor/src/` and the names in
  `src/conductor/test/structural/layer-allowlist/`, with paths resolved from `import.meta.url` and
  never from the process cwd.
- **Allowlist directory** `src/conductor/test/structural/layer-allowlist/`. It holds one empty file
  per allowed edge, and the file name is the whole key.

### Edge model (operator choice 1)

- **Parsing.** Each file is parsed with `ts.createSourceFile`. Only top-level statements are read.
- **Static `import` declarations.** One is a value edge unless the import clause has `isTypeOnly`,
  or it has named bindings that are all marked `type`. A clause with any value binding, a default
  binding or a namespace binding counts as value. A clause-less side-effect `import './x.js'` also
  counts as value.
- **`export … from` declarations.** One is a value edge unless the declaration has `isTypeOnly`, or
  its named exports are all marked `type`.
- **Never edges:** dynamic `import()` calls and `ImportTypeNode`s (inline `import('…')` types).
- **Resolution.** Only specifiers that start with `.` resolve, against the importing file's
  directory:
  - `x.js` maps to `x.ts`.
  - A specifier whose `.ts` form is absent maps to `<spec>/index.ts`, as in `./dir` or
    `./dir/index.js`.
  - A target outside `src/conductor/src/`, or a target missing from `files`, is an
    `unresolved-specifier` violation.
  - Package and `node:` specifiers are ignored.
- **Identity.** Edge identity is the (importing file, imported file) pair. Several statements
  between the same pair are one edge, which keeps the line of the first statement.

### Layers and rules

- **Classification.** A file's layer is its first path segment when that segment is `types`,
  `execution`, `engine`, `ui` or `tools`. It is `entry` for a file at the root of `src/`. Any other
  top-level directory yields an `unclassifiable-file` violation.
- **Ranks:** `types` 0, `execution` 1, `engine` 2, `ui` 3, `entry` 4.
- **Forbidden edges.** A cross-layer edge `A -> B` is forbidden (kind `upward`, edge label
  `` `${A} -> ${B}` ``) when any of the following holds:
  - B is `tools` and A is not `tools`.
  - A is `tools` and B is not `engine` or `types`.
  - B is `entry` and A is not `entry`.
  - Otherwise, when rank(B) > rank(A).
- **Cycles.** Value-graph strongly-connected components are found with iterative Tarjan (no
  recursion, so a deep graph cannot overflow the stack). An edge whose two files share an SCC of
  size 2 or more is a `cycle` violation, carrying the sorted file list of that SCC. One edge can be
  both `upward` and `cycle`.

### Allowlist (operator choices 2 and 3)

- **Encoding.** The entry name is `` `${encodeURIComponent(from)}+${encodeURIComponent(to)}.edge` ``.
  `encodeURIComponent` escapes `/` and `+`, so the single `+` separator is unambiguous. The longest
  name on today's tree is 106 bytes.
- **Decoding.** A name decodes only when all of the following hold. Anything else is a
  `malformed-entry` violation.
  - It ends in `.edge` and contains exactly one `+`.
  - Both halves decode, and each is a relative POSIX path to a `.ts` file with no `..`, no leading
    `/` and no empty segment.
  - Re-encoding reproduces the name exactly, so no two names can denote one pair.
- **Coverage.** An entry covers every `upward` and `cycle` violation of its pair.
- **Staleness.** An entry is `stale-entry` with reason:
  - `edge-missing` when its pair has no value edge;
  - `not-a-violation` when the edge exists but is neither upward nor in an SCC.
- **Messages.** Every uncovered `upward` or `cycle` violation carries the `allowlistName` that would
  cover it, and `formatRatchetViolations` prints it.
- **Additions.** Adding an entry by hand stays possible. There is no diff-relative guard.

### Pattern context

Follow the shape of the in-test-tree AST guard in `src/conductor/test/structural/conductor-shape-guard.ts`
(`parseSource`, `checkConductorImports`) and its test `conductor-shape.test.ts`:

- pure checker functions return typed violation records that carry a file and a 1-based line;
- fixture-string tests exercise each rule, and a separate test runs the checker against the real tree;
- paths come from `import.meta.url`.

Allowed variation: this checker takes a whole in-memory file map and computes a graph, where the
shape guard parses one file at a time.

### Sequencing

- Resolution and classification come first (Task 1).
- Then the upward rule (Task 2), then edge kinds (Task 3), then cycles (Task 4).
- Then the allowlist name codec (Task 5), allowlist coverage (Task 6) and staleness (Task 7).
- Last, the real-tree test plus the seeded allowlist (Task 8). It is the only task that can make
  the real tree pass, and it is the CI integration owner.

## Prerequisites

- None. `typescript` 6.0.3 is already in `src/conductor/package.json`. `vitest.config.ts`'s default
  `include: ['test/**/*.test.ts']` already picks up `test/structural/`.

## Tasks

### Task 1: Classify layers and resolve relative specifiers, failing closed
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing fixture tests in `src/conductor/test/structural/layer-ratchet.test.ts` that call `checkLayerRatchet({ files, allowlist: [] })` with in-memory file maps:
   - `engine/a.ts` imports `./sibling.js`, and `engine/sibling.ts` exists;
   - `engine/a.ts` imports `./dir/index.js`, and in a second fixture `./dir`, with `engine/dir/index.ts` present;
   - `engine/a.ts` imports `typescript` and `node:fs`;
   - `misc/x.ts` exists;
   - `engine/a.ts` imports `./missing.js`;
   - `engine/a.ts` imports `../../outside.js`.
2. Verify RED (the module does not exist).
3. Implement `checkLayerRatchet` in `src/conductor/test/structural/layer-ratchet.ts`:
   - layer classification, with an `unclassifiable-file` violation carrying `file`;
   - extraction of plain static `import` declarations only;
   - relative-specifier resolution (`.js` to `.ts`, then `<spec>/index.ts`; package and `node:` specifiers ignored);
   - an `unresolved-specifier` violation carrying `file`, a 1-based `line` and `specifier`, for a target that is missing or outside the map root;
   - the returned `edges` (importing file, imported file, line) and `scannedFileCount`.
   Follow the conductor-shape-guard pattern: a pure function, typed violation records with file and line, and `ts.createSourceFile`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that `checkLayerRatchet` records exactly the edge `engine/a.ts -> engine/sibling.ts` for an `./sibling.js` import, and exactly `engine/a.ts -> engine/dir/index.ts` for both the `./dir/index.js` and the `./dir` imports.
- [test] the layer-ratchet fixture tests assert that `typescript` and `node:fs` imports produce an empty `edges` list and an empty `violations` list.
- [test] the layer-ratchet fixture tests assert that a `misc/x.ts` file yields one violation of kind `unclassifiable-file` whose `file` is `misc/x.ts`.
- [test] the layer-ratchet fixture tests assert that `./missing.js` and `../../outside.js` each yield a violation of kind `unresolved-specifier` carrying `file` `engine/a.ts`, the import's 1-based `line`, and the exact specifier string, and that neither is recorded as an edge.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — new pure checker module.
- `src/conductor/test/structural/layer-ratchet.test.ts` — new structural test file.

**Dependencies:** none

### Task 2: Report upward and forbidden cross-layer value edges
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing fixture tests, each with an empty allowlist:
   - a conforming fixture: `engine/` imports `execution/` and `types/`; `ui/` imports `execution/`; `index.ts` imports `cli.ts`; `tools/` imports `engine/` and `types/`; and a same-layer `engine/` import;
   - an `engine/` value import from `ui/`;
   - an `engine/` import of `cli-defaults.ts`;
   - an `engine/` import of a `tools/` file;
   - a `tools/` import of `ui/` and a `tools/` import of `execution/`;
   - a `types/` import of `execution/`.
2. Verify RED.
3. Implement the rank table and the forbidden-edge rules from Technical Approach in `checkLayerRatchet`. Each forbidden edge yields one `upward` violation per file pair, carrying `file`, the 1-based `line` of the first import of that pair, `imported`, and `edge` as `` `${A} -> ${B}` ``.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that the conforming fixture (`engine/` importing `execution/` and `types/`, `ui/` importing `execution/`, an entry file importing another entry file, `tools/` importing `engine/` and `types/`, and a same-layer import) yields an empty `violations` list.
- [test] the layer-ratchet fixture tests assert that an `engine/` static value import from `ui/` yields exactly one `upward` violation naming the importing file, the import's 1-based line number, the imported file, and the edge `engine -> ui`.
- [test] the layer-ratchet fixture tests assert that an `engine/` import of `cli-defaults.ts` yields an `upward` violation with edge `engine -> entry`, and a `types/` import of `execution/` yields one with edge `types -> execution`.
- [test] the layer-ratchet fixture tests assert that an `engine/` import of a `tools/` file, a `tools/` import of `ui/` and a `tools/` import of `execution/` yield three `upward` violations, one per edge.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — rank table and forbidden-edge rule.
- `src/conductor/test/structural/layer-ratchet.test.ts` — upward-rule fixtures.

**Dependencies:** Task 1

### Task 3: Classify each import form as a value edge or not
**Story:** Story 1, Story 4
**Type:** negative-path

**Steps:**
1. Write failing fixture tests, each with an empty allowlist:
   - a `types/` file reaching `engine/` through `import type { A }`, through `import { type A, type B }`, through `export type { A } from`, and through an inline `import('../engine/x.js').X` type reference;
   - an `engine/` file whose only path to `ui/` is `await import('../ui/x.js')`;
   - an `execution/` file with `export { name } from '../engine/x.js'`;
   - an `engine/` file with `import '../ui/x.js'`;
   - an `engine/` file with `import { type A, b } from '../ui/x.js'`;
   - an `engine/conductor.ts` with `export { a } from './a.js'` and `export { b } from './b.js'`.
2. Verify RED.
3. Implement the edge model from Technical Approach in the extraction step of `checkLayerRatchet`:
   - side-effect imports, mixed bindings, default bindings and namespace bindings are value edges;
   - value `export … from` is a value edge;
   - type-only clauses, all-`type` named bindings, `export type … from`, `ImportTypeNode` and dynamic `import()` calls are never edges.
   There is no special case for `conductor.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that the `types/` fixture using `import type`, all-`type` named bindings, `export type … from` and an inline `import('…')` type reference to `engine/` yields an empty `edges` list and an empty `violations` list.
- [test] the layer-ratchet fixture tests assert that an `engine/` file reaching `ui/` only through a dynamic `import()` call yields no edge and no violation.
- [test] the layer-ratchet fixture tests assert that an `execution/` value `export { name } from` an `engine/` module yields an `upward` violation naming the importing file, the re-export's 1-based line number, and the edge `execution -> engine`.
- [test] the layer-ratchet fixture tests assert that an `engine/` side-effect `import '../ui/x.js'` yields an `upward` violation for that statement's line, and that `import { type A, b }` from `ui/` yields an `upward` violation rather than being treated as type-only.
- [test] the layer-ratchet fixture tests assert that `engine/conductor.ts`'s `export { … } from` re-exports of two `engine/` modules are recorded in `edges` as the two same-layer value edges `engine/conductor.ts -> engine/a.ts` and `engine/conductor.ts -> engine/b.ts`, with no violation.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — edge-kind classification.
- `src/conductor/test/structural/layer-ratchet.test.ts` — import-form fixtures.

**Dependencies:** Task 2

### Task 4: Report every value edge that lies on an import cycle
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing fixture tests, each with an empty allowlist:
   - three `engine/` files with value edges `a -> b` and `b -> c` only;
   - `engine/a.ts` value-imports `engine/b.ts`, which reaches `a` only through `import type`, and in a second fixture only through dynamic `import()`;
   - `engine/a.ts` and `engine/b.ts` value-import each other;
   - a cycle `a -> b -> c -> a` closed by `export { x } from './a.js'` in `c`;
   - `engine/x.ts` value-imports `ui/y.ts`, and `ui/y.ts` value-imports `engine/x.ts`.
2. Verify RED.
3. Implement iterative Tarjan SCC over the value-edge graph in `layer-ratchet.ts`. Every edge whose endpoints share an SCC of size 2 or more yields a `cycle` violation carrying `file`, 1-based `line`, `imported`, and `cycle`, the sorted list of that SCC's files. It is reported in addition to any `upward` violation of the same edge.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that the acyclic three-file `engine/` fixture `a -> b -> c` yields an empty `violations` list, and that the fixtures whose back edge is only `import type` or only a dynamic `import()` each yield no `cycle` violation.
- [test] the layer-ratchet fixture tests assert that two `engine/` files value-importing each other yield exactly two `cycle` violations, each naming the importing file, its 1-based line number, the imported file, and `cycle` equal to the sorted pair of both files.
- [test] the layer-ratchet fixture tests assert that a three-file cycle closed by a value `export … from` yields three `cycle` violations, one for each edge including the re-export edge.
- [test] the layer-ratchet fixture tests assert that the `engine/x.ts` and `ui/y.ts` mutual-import fixture yields an `upward` violation with edge `engine -> ui`, and also yields `cycle` violations for both edges.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — SCC detection and the `cycle` violation kind.
- `src/conductor/test/structural/layer-ratchet.test.ts` — cycle fixtures.

**Dependencies:** Task 3

### Task 5: Encode and decode allowlist entry names
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - for `encodeAllowlistName` and `decodeAllowlistName`, a round trip of `engine/conductor.ts` to `ui/events.ts` and of `engine/engineer/intake/x.ts` to `cli.ts`;
   - two pairs whose naive `/`-to-`-` encodings would collide, such as `engine/a-b.ts` to `ui/c.ts` and `engine/a/b.ts` to `ui/c.ts`, encode to different names;
   - an allowlist containing `not-an-edge.txt`, a name with two `+`, a name whose half decodes to `../x.ts`, and a non-canonical name such as `engine%2fa.ts+ui%2Fb.ts.edge` each yields a `malformed-entry` violation from `checkLayerRatchet`.
2. Verify RED.
3. Implement the encoding and the decoding rules from Technical Approach. In `checkLayerRatchet`, each name that does not decode yields `{ kind: 'malformed-entry', entry }`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet tests assert that `decodeAllowlistName(encodeAllowlistName(from, to))` returns the same `from` and `to` for both sample pairs, and that the two collision-prone pairs encode to different names.
- [test] the layer-ratchet tests assert that `checkLayerRatchet` reports a `malformed-entry` violation whose `entry` is the exact file name for each of `not-an-edge.txt`, the two-`+` name, the `../x.ts` name, and the non-canonical lower-case `%2f` name.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — the name codec and malformed-entry handling.
- `src/conductor/test/structural/layer-ratchet.test.ts` — codec tests.

**Dependencies:** Task 1

### Task 6: Let allowlist entries cover listed violations, and name the entry an unlisted one needs
**Story:** Story 3, Story 2
**Type:** happy-path

**Steps:**
1. Write failing fixture tests:
   - an `engine/` to `ui/` upward edge with `encodeAllowlistName('engine/a.ts', 'ui/b.ts')` in the allowlist;
   - a same-layer two-file cycle with entries for both edges;
   - `engine/a.ts` with two separate value imports of `ui/b.ts` and one entry for that pair;
   - a three-file `engine/` cycle `a -> b -> c -> a` with all three edges allowlisted, plus a new unlisted value edge `a -> c` between two of its files;
   - an unlisted upward violation rendered by `formatRatchetViolations`.
2. Verify RED.
3. Implement coverage in `checkLayerRatchet`:
   - a decoded entry removes every `upward` and `cycle` violation of its pair;
   - every remaining `upward` or `cycle` violation carries `allowlistName = encodeAllowlistName(file, imported)`.
   Implement `formatRatchetViolations` to render one line per violation that includes its kind, its file and line, its edge or cycle, and its `allowlistName` when present.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that an allowlisted upward edge, an allowlisted same-layer cycle (both edges listed), and two import statements of one pair covered by a single entry each yield an empty `violations` list.
- [test] the layer-ratchet fixture tests assert that when every edge of the cycle `a -> b -> c -> a` is allowlisted and a new unlisted value edge `a -> c` is added between two of its files, `checkLayerRatchet` reports exactly that new edge as a `cycle` violation and nothing else.
- [test] the layer-ratchet fixture tests assert that `formatRatchetViolations` output for an unlisted `engine -> ui` violation contains the exact string `encodeAllowlistName('engine/a.ts', 'ui/b.ts')`.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — allowlist coverage and `formatRatchetViolations`.
- `src/conductor/test/structural/layer-ratchet.test.ts` — coverage fixtures.

**Dependencies:** Tasks 4, 5

### Task 7: Fail on every allowlist entry that no longer covers a live violation
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing fixture tests:
   - an entry for `engine/a.ts` to `ui/b.ts` in a fixture where `engine/a.ts` imports `ui/b.ts` only with `import type`, and again where it has no import of it at all;
   - a two-file `engine/` cycle broken by deleting `b -> a`, where the surviving `a -> b` still has an entry;
   - a four-file `engine/` cycle `a -> b -> c -> d -> a`, all four entries listed, with `d -> a` removed and its entry deleted.
2. Verify RED.
3. Implement staleness in `checkLayerRatchet`. A decoded entry yields `{ kind: 'stale-entry', entry, reason }`:
   - `reason: 'edge-missing'` when its pair has no value edge;
   - `reason: 'not-a-violation'` when the edge exists but is neither `upward` nor in an SCC.
   Every stale entry is collected in one pass, without stopping at the first.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] the layer-ratchet fixture tests assert that an entry whose pair has only a type-only import, and one whose pair has no import, each yield a `stale-entry` violation with `reason` `edge-missing` whose `entry` is that exact file name.
- [test] the layer-ratchet fixture tests assert that after a two-file cycle loses one edge, the surviving same-layer edge's entry yields a `stale-entry` violation with `reason` `not-a-violation`.
- [test] the layer-ratchet fixture tests assert that after the four-file cycle loses `d -> a`, a single `checkLayerRatchet` call reports all three remaining entries (`a -> b`, `b -> c`, `c -> d`) as `stale-entry` violations naming each file name.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.ts` — stale-entry evaluation.
- `src/conductor/test/structural/layer-ratchet.test.ts` — staleness fixtures.

**Dependencies:** Task 6

### Task 8: Run the ratchet on the real tree in the default tier, and seed the allowlist
**Story:** Story 1, Story 3
**Type:** infrastructure

**Steps:**
1. Write the real-tree test in `src/conductor/test/structural/layer-ratchet.test.ts`. It:
   - reads every `.ts` file under `src/conductor/src/` (resolved from `import.meta.url`) into a map keyed by its POSIX path relative to that directory;
   - reads every file name in `src/conductor/test/structural/layer-allowlist/`;
   - calls `checkLayerRatchet`, and asserts `scannedFileCount > 0` and an empty `violations` list, using `formatRatchetViolations` output as the failure message;
   - asserts that every committed entry name decodes, and that re-encoding it returns the same name.
2. Verify RED: with an empty allowlist directory, the test fails and lists every current violation with its `allowlistName`.
3. Seed `src/conductor/test/structural/layer-allowlist/` with one empty file for each distinct `allowlistName` that the failing run reports. Use a throwaway command, not a committed generator. On 2026-10-24 the expected size was about 263 entries.
4. Verify GREEN: the real-tree test passes with the seeded directory, and the fixture tests still pass.
5. Commit the test and the seeded directory in the same commit.

**Done when:**
- [test] the layer-ratchet real-tree test asserts that `checkLayerRatchet` over every `.ts` file under `src/conductor/src/` and the committed `layer-allowlist/` names returns `scannedFileCount` greater than zero and an empty `violations` list, so no allowlist entry is missing, stale or malformed.
- [test] the layer-ratchet real-tree test asserts that every committed `layer-allowlist/` file name round-trips through `decodeAllowlistName` and `encodeAllowlistName` to the same name.
- The number of files in `src/conductor/test/structural/layer-allowlist/` equals the number of distinct file pairs carrying an `upward` or `cycle` violation when `checkLayerRatchet` runs on the real tree with an empty allowlist.
- `src/conductor/test/structural/layer-ratchet.test.ts` matches `vitest.config.ts`'s default `include` pattern `test/**/*.test.ts` and none of its `exclude` patterns, so CI's `conductor` job (`npm test`) runs it.

**Files likely touched:**
- `src/conductor/test/structural/layer-ratchet.test.ts` — the real-tree test.
- `src/conductor/test/structural/layer-allowlist/` — the seeded entry files.

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 ──► Task 2 ──► Task 3 ──► Task 4 ──┐
   │                                      ├──► Task 6 ──► Task 7 ──► Task 8
   └──────────────► Task 5 ───────────────┘
```

## Integration Points

- After Task 4, the checker reports every upward and cycle violation, without an allowlist.
- After Task 7, the allowlist semantics are complete on fixtures.
- After Task 8, the default Vitest tier, and therefore CI's `conductor` job, fails on any new layering
  violation in `src/conductor/src/`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the real `src/conductor/src/` tree and its committed allowlist, when the default Vitest tier runs the ratchet, then the ratchet passes and reports a scanned-file count greater than zero. | 8 | "returns `scannedFileCount` greater than zero and an empty `violations` list" | diff-local |
| Story 1 happy: Given a fixture in which an `engine/` file value-imports `execution/` and `types/`, a `ui/` file value-imports `execution/`, an entry-point file value-imports another entry-point file, a `tools/` file value-imports `engine/` and `types/`, and a file value-imports a file in its own layer, when the ratchet's checker evaluates it with an empty allowlist, then it reports no violation. | 2 | "the conforming fixture (`engine/` importing `execution/` and `types/`, `ui/` importing `execution/`, an entry file importing another entry file, `tools/` importing `engine/` and `types/`, and a same-layer import) yields an empty `violations` list" | diff-local |
| Story 1 happy: Given a fixture in which a `types/` file imports from `engine/` using `import type`, using named imports whose bindings are all marked `type`, using `export type … from`, and using an inline `import('…')` type reference, when the checker evaluates it with an empty allowlist, then it reports no violation for those type-only forms. | 3 | "yields an empty `edges` list and an empty `violations` list" | diff-local |
| Story 1 happy: Given a fixture in which an `engine/` file reaches a `ui/` module only through a dynamic `import()` call, when the checker evaluates it with an empty allowlist, then it reports no violation for that call. | 3 | "reaching `ui/` only through a dynamic `import()` call yields no edge and no violation" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file has a static value import from `ui/` and no allowlist entry covers it, when the checker evaluates it, then it reports one upward violation naming the importing file, the line number of the import, the imported file, and the edge `engine -> ui`. | 2 | "yields exactly one `upward` violation naming the importing file, the import's 1-based line number, the imported file, and the edge `engine -> ui`" | diff-local |
| Story 1 negative: Given a fixture in which an `execution/` file has a value `export { name } from` an `engine/` module and no allowlist entry covers it, when the checker evaluates it, then it reports an upward violation naming the importing file, its line number, and the edge `execution -> engine`. | 3 | "yields an `upward` violation naming the importing file, the re-export's 1-based line number, and the edge `execution -> engine`" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file has a side-effect import such as `import '../ui/x.js'` and no allowlist entry covers it, when the checker evaluates it, then it reports an upward violation for that line. | 3 | "an `engine/` side-effect `import '../ui/x.js'` yields an `upward` violation for that statement's line" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file imports `{ type A, b }` from a `ui/` module, so at least one binding is a value, when the checker evaluates it with an empty allowlist, then it reports an upward violation rather than treating the import as type-only. | 3 | "`import { type A, b }` from `ui/` yields an `upward` violation rather than being treated as type-only" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file value-imports an entry-point file such as `cli-defaults.ts`, when the checker evaluates it with an empty allowlist, then it reports a violation naming the edge `engine -> entry`. | 2 | "an `engine/` import of `cli-defaults.ts` yields an `upward` violation with edge `engine -> entry`" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file value-imports a `tools/` file, and a `tools/` file value-imports `ui/` or `execution/`, when the checker evaluates it with an empty allowlist, then it reports a violation for each of those two edges. | 2 | "an `engine/` import of a `tools/` file, a `tools/` import of `ui/` and a `tools/` import of `execution/` yield three `upward` violations, one per edge" | diff-local |
| Story 1 negative: Given a fixture in which a `types/` file value-imports `execution/`, when the checker evaluates it with an empty allowlist, then it reports a violation naming the edge `types -> execution`. | 2 | "a `types/` import of `execution/` yields one with edge `types -> execution`" | diff-local |
| Story 2 happy: Given a fixture of three `engine/` files with value edges `a -> b` and `b -> c` and no edge back, when the checker evaluates it with an empty allowlist, then it reports no violation. | 4 | "the acyclic three-file `engine/` fixture `a -> b -> c` yields an empty `violations` list" | diff-local |
| Story 2 happy: Given a fixture in which `engine/a.ts` value-imports `engine/b.ts`, and `engine/b.ts` reaches `engine/a.ts` only through `import type` or a dynamic `import()`, when the checker evaluates it with an empty allowlist, then it reports no cycle violation. | 4 | "the fixtures whose back edge is only `import type` or only a dynamic `import()` each yield no `cycle` violation" | diff-local |
| Story 2 negative: Given a fixture in which `engine/a.ts` value-imports `engine/b.ts` and `engine/b.ts` value-imports `engine/a.ts`, when the checker evaluates it with an empty allowlist, then it reports a cycle violation for each of the two edges, each naming the importing file, its line number, and the files of the cycle it lies in. | 4 | "two `engine/` files value-importing each other yield exactly two `cycle` violations, each naming the importing file, its 1-based line number, the imported file, and `cycle` equal to the sorted pair of both files" | diff-local |
| Story 2 negative: Given a fixture in which a cycle `a -> b -> c -> a` is closed by a value `export … from` re-export, when the checker evaluates it with an empty allowlist, then it reports every edge of that cycle, including the re-export edge. | 4 | "a three-file cycle closed by a value `export … from` yields three `cycle` violations, one for each edge including the re-export edge" | diff-local |
| Story 2 negative: Given a fixture in which a cycle crosses layers, `engine/x.ts` to `ui/y.ts` and back, when the checker evaluates it with an empty allowlist, then it reports the upward edge `engine -> ui` and also reports both edges as lying on a cycle. | 4 | "yields an `upward` violation with edge `engine -> ui`, and also yields `cycle` violations for both edges" | diff-local |
| Story 2 negative: Given a fixture in which all the files of an existing cycle have allowlist entries for each of its edges, and a new value edge between two of those files is added with no entry, when the checker evaluates it, then it reports exactly that new edge as a cycle violation. | 6 | "reports exactly that new edge as a `cycle` violation and nothing else" | diff-local |
| Story 3 happy: Given a fixture with an upward value edge and an allowlist entry for exactly that importing-file and imported-file pair, when the checker evaluates it, then it reports no violation for that edge. | 6 | "an allowlisted upward edge, an allowlisted same-layer cycle (both edges listed), and two import statements of one pair covered by a single entry each yield an empty `violations` list" | diff-local |
| Story 3 happy: Given a fixture with a value edge inside a cycle and an allowlist entry for that file pair, when the checker evaluates it, then it reports no violation for that edge. | 6 | "an allowlisted same-layer cycle (both edges listed)" | diff-local |
| Story 3 happy: Given a fixture in which one importing file has two separate value import statements from the same imported file, which together form one upward edge, when the checker evaluates it with one allowlist entry for that file pair, then it reports no violation. | 6 | "two import statements of one pair covered by a single entry each yield an empty `violations` list" | diff-local |
| Story 3 happy: Given an allowlisted file pair, when its allowlist entry's file name is decoded, then it yields the same importing-file and imported-file paths, and two different file pairs never encode to the same file name. | 5 | "returns the same `from` and `to` for both sample pairs, and that the two collision-prone pairs encode to different names" | diff-local |
| Story 3 happy: Given the real tree, when the ratchet runs, then the set of allowlist entries equals the set of value edges that are upward or lie inside a cycle, with no missing entry and no stale entry. | 8 | "returns `scannedFileCount` greater than zero and an empty `violations` list, so no allowlist entry is missing, stale or malformed" | diff-local |
| Story 3 negative: Given an allowlist entry for a file pair that has no value edge in the fixture, because the import was deleted or made type-only, when the checker evaluates it, then it reports a stale-entry failure naming that allowlist file. | 7 | "an entry whose pair has only a type-only import, and one whose pair has no import, each yield a `stale-entry` violation with `reason` `edge-missing` whose `entry` is that exact file name" | diff-local |
| Story 3 negative: Given a fixture in which a two-file cycle was broken by removing one of its edges, and the surviving edge is same-layer and still has an allowlist entry, when the checker evaluates it, then it reports the surviving edge's entry as stale because that edge is no longer a violation. | 7 | "the surviving same-layer edge's entry yields a `stale-entry` violation with `reason` `not-a-violation`" | diff-local |
| Story 3 negative: Given a fixture in which removing one edge frees several entries of a larger cycle at once, when the checker evaluates it, then it reports every freed entry by file name in one run, not just the first. | 7 | "a single `checkLayerRatchet` call reports all three remaining entries (`a -> b`, `b -> c`, `c -> d`) as `stale-entry` violations naming each file name" | diff-local |
| Story 3 negative: Given a file in the allowlist directory whose name does not decode to a pair of `src/conductor/src/` paths, when the checker evaluates it, then it fails and names that file as a malformed entry. | 5 | "reports a `malformed-entry` violation whose `entry` is the exact file name" | diff-local |
| Story 3 negative: Given an unlisted violation, when the checker reports it, then the failure message includes the exact allowlist file name that would cover that edge. | 6 | "`formatRatchetViolations` output for an unlisted `engine -> ui` violation contains the exact string `encodeAllowlistName('engine/a.ts', 'ui/b.ts')`" | diff-local |
| Story 4 happy: Given a fixture in which a file imports `./sibling.js` and `./sibling.ts` exists, when the checker evaluates it, then it records the edge to `sibling.ts`. | 1 | "records exactly the edge `engine/a.ts -> engine/sibling.ts` for an `./sibling.js` import" | diff-local |
| Story 4 happy: Given a fixture in which a file imports `./dir/index.js`, or imports `./dir` and `./dir/index.ts` exists, when the checker evaluates it, then it records the edge to `dir/index.ts`. | 1 | "exactly `engine/a.ts -> engine/dir/index.ts` for both the `./dir/index.js` and the `./dir` imports" | diff-local |
| Story 4 happy: Given a fixture in which a file imports a package specifier such as `typescript` or `node:fs`, when the checker evaluates it, then it records no edge and reports no violation for that import. | 1 | "`typescript` and `node:fs` imports produce an empty `edges` list and an empty `violations` list" | diff-local |
| Story 4 happy: Given a fixture in which `engine/conductor.ts` re-exports names with `export { … } from` from other `engine/` modules, when the checker evaluates it, then those re-exports are recorded as ordinary same-layer value edges, with no special case. | 3 | "are recorded in `edges` as the two same-layer value edges `engine/conductor.ts -> engine/a.ts` and `engine/conductor.ts -> engine/b.ts`, with no violation" | diff-local |
| Story 4 negative: Given a fixture containing a `.ts` file in a top-level `src/` directory that is not `types`, `execution`, `engine`, `ui` or `tools`, when the checker evaluates it, then it fails naming that file as unclassifiable. | 1 | "a `misc/x.ts` file yields one violation of kind `unclassifiable-file` whose `file` is `misc/x.ts`" | diff-local |
| Story 4 negative: Given a fixture in which a file has a relative import specifier that resolves to no file under `src/conductor/src/`, when the checker evaluates it, then it fails naming the importing file, the line number, and the unresolved specifier. | 1 | "`./missing.js` and `../../outside.js` each yield a violation of kind `unresolved-specifier` carrying `file` `engine/a.ts`, the import's 1-based `line`, and the exact specifier string" | diff-local |
| Story 4 negative: Given a fixture in which a relative specifier resolves to a path outside `src/conductor/src/`, when the checker evaluates it, then it fails naming the importing file, the line number, and the specifier. | 1 | "`./missing.js` and `../../outside.js` each yield a violation of kind `unresolved-specifier` carrying `file` `engine/a.ts`, the import's 1-based `line`, and the exact specifier string" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
