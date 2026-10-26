**Status:** Accepted

# Stories: Enforce module layering with the import-graph ratchet (#1988)

Technical track, so there is no PRD. Governing design: `adr-2026-10-07-conductor-decomposition-target-architecture`
D5, as refined by `.docs/decisions/architecture-review-2026-10-24-module-layering-is-prose-only-violations-merge-wit.md`
(operator choices 1–3 and conditions 1–5).

The "ratchet" is the default-tier structural check over `src/conductor/src/`. A "layer" is the
top-level directory that holds a file: `types/`, `execution/`, `engine/` or `ui/`, `tools/`, or the
`src/` root for entry-point files. The chain is `types ← execution ← engine ← ui ← entry`.

A "value edge" is a static `import` declaration that is not type-only, or an `export … from` that is
not type-only. These are not value edges: type-only forms (`import type`, named imports whose
bindings are all marked `type`, `export type … from`, and inline `import('…')` type references) and
dynamic `import()` calls. A fixture is a small synthetic source tree given to the ratchet's checker
in a test.

## Story 1: An upward value import fails the ratchet before merge

**Requirement:** Intake outcome 1 (an import that violates the documented layer direction fails CI before merge, at the point of the mistake)

As a contributor, I want any value import that points up the layer chain to fail the default test tier, so that a layering violation is caught in CI on the PR that introduces it rather than found later by hand.

### Acceptance Criteria

#### Happy Path
- Given the real `src/conductor/src/` tree and its committed allowlist, when the default Vitest tier runs the ratchet, then the ratchet passes and reports a scanned-file count greater than zero.
- Given a fixture in which an `engine/` file value-imports `execution/` and `types/`, a `ui/` file value-imports `execution/`, an entry-point file value-imports another entry-point file, a `tools/` file value-imports `engine/` and `types/`, and a file value-imports a file in its own layer, when the ratchet's checker evaluates it with an empty allowlist, then it reports no violation.
- Given a fixture in which a `types/` file imports from `engine/` using `import type`, using named imports whose bindings are all marked `type`, using `export type … from`, and using an inline `import('…')` type reference, when the checker evaluates it with an empty allowlist, then it reports no violation for those type-only forms.
- Given a fixture in which an `engine/` file reaches a `ui/` module only through a dynamic `import()` call, when the checker evaluates it with an empty allowlist, then it reports no violation for that call.

#### Negative Paths
- Given a fixture in which an `engine/` file has a static value import from `ui/` and no allowlist entry covers it, when the checker evaluates it, then it reports one upward violation naming the importing file, the line number of the import, the imported file, and the edge `engine -> ui`.
- Given a fixture in which an `execution/` file has a value `export { name } from` an `engine/` module and no allowlist entry covers it, when the checker evaluates it, then it reports an upward violation naming the importing file, its line number, and the edge `execution -> engine`.
- Given a fixture in which an `engine/` file has a side-effect import such as `import '../ui/x.js'` and no allowlist entry covers it, when the checker evaluates it, then it reports an upward violation for that line.
- Given a fixture in which an `engine/` file imports `{ type A, b }` from a `ui/` module, so at least one binding is a value, when the checker evaluates it with an empty allowlist, then it reports an upward violation rather than treating the import as type-only.
- Given a fixture in which an `engine/` file value-imports an entry-point file such as `cli-defaults.ts`, when the checker evaluates it with an empty allowlist, then it reports a violation naming the edge `engine -> entry`.
- Given a fixture in which an `engine/` file value-imports a `tools/` file, and a `tools/` file value-imports `ui/` or `execution/`, when the checker evaluates it with an empty allowlist, then it reports a violation for each of those two edges.
- Given a fixture in which a `types/` file value-imports `execution/`, when the checker evaluates it with an empty allowlist, then it reports a violation naming the edge `types -> execution`.

### Done When
- [ ] The ratchet test file sits under `src/conductor/test/`, matches `vitest.config.ts`'s default `include` pattern, and is not matched by its `exclude` patterns, so CI's `conductor` job runs it.
- [ ] Running the ratchet test on the real tree passes, and its output or assertion records a scanned-file count greater than zero.
- [ ] Each violation record carries the importing file path relative to `src/conductor/src/`, a 1-based line number, the imported file path, and the `from -> to` layer edge.

## Story 2: A value edge that closes an import cycle fails the ratchet

**Requirement:** Intake outcome 1, and D5's rule that the check fails on any new value-import cycle

As a contributor, I want a value import that closes an import cycle to fail even when it stays inside one layer, so that new runtime initialization cycles cannot merge.

### Acceptance Criteria

#### Happy Path
- Given a fixture of three `engine/` files with value edges `a -> b` and `b -> c` and no edge back, when the checker evaluates it with an empty allowlist, then it reports no violation.
- Given a fixture in which `engine/a.ts` value-imports `engine/b.ts`, and `engine/b.ts` reaches `engine/a.ts` only through `import type` or a dynamic `import()`, when the checker evaluates it with an empty allowlist, then it reports no cycle violation.

#### Negative Paths
- Given a fixture in which `engine/a.ts` value-imports `engine/b.ts` and `engine/b.ts` value-imports `engine/a.ts`, when the checker evaluates it with an empty allowlist, then it reports a cycle violation for each of the two edges, each naming the importing file, its line number, and the files of the cycle it lies in.
- Given a fixture in which a cycle `a -> b -> c -> a` is closed by a value `export … from` re-export, when the checker evaluates it with an empty allowlist, then it reports every edge of that cycle, including the re-export edge.
- Given a fixture in which a cycle crosses layers, `engine/x.ts` to `ui/y.ts` and back, when the checker evaluates it with an empty allowlist, then it reports the upward edge `engine -> ui` and also reports both edges as lying on a cycle.
- Given a fixture in which all the files of an existing cycle have allowlist entries for each of its edges, and a new value edge between two of those files is added with no entry, when the checker evaluates it, then it reports exactly that new edge as a cycle violation.

### Done When
- [ ] A cycle violation record names the importing file, a 1-based line number, the imported file, and the sorted list of files in the strongly-connected component that holds the edge.
- [ ] A fixture test proves that a type-only or dynamic back edge does not create a cycle violation.

## Story 3: Grandfathered edges pass, and the allowlist can only shrink

**Requirement:** Intake outcome 3 (conforming imports and explicitly listed grandfathered exceptions still pass, and the exception set can only shrink)

As a contributor, I want today's violations listed once each as allowlist entries, with every entry that no longer matches a live violation failing the check, so that existing debt does not block work while the debt list can only get shorter.

> **Amended 2026-10-26 (operator-directed):** entries are lines of one sorted text file, `layer-allowlist.txt`, instead of encoded file names in a directory. The criteria below are restated for that format; see `adr-2026-10-07-conductor-decomposition-target-architecture` D5.

### Acceptance Criteria

#### Happy Path
- Given a fixture with an upward value edge and an allowlist entry for exactly that importing-file and imported-file pair, when the checker evaluates it, then it reports no violation for that edge.
- Given a fixture with a value edge inside a cycle and an allowlist entry for that file pair, when the checker evaluates it, then it reports no violation for that edge.
- Given a fixture in which one importing file has two separate value import statements from the same imported file, which together form one upward edge, when the checker evaluates it with one allowlist entry for that file pair, then it reports no violation.
- Given an allowlisted file pair, when its `from -> to` entry line is parsed, then it yields the same importing-file and imported-file paths, and formatting that pair reproduces the line exactly.
- Given the real tree, when the ratchet runs, then the set of allowlist entries equals the set of value edges that are upward or lie inside a cycle, with no missing entry and no stale entry.

#### Negative Paths
- Given an allowlist entry for a file pair that has no value edge in the fixture, because the import was deleted or made type-only, when the checker evaluates it, then it reports a stale-entry failure naming that allowlist line.
- Given a fixture in which a two-file cycle was broken by removing one of its edges, and the surviving edge is same-layer and still has an allowlist entry, when the checker evaluates it, then it reports the surviving edge's entry as stale because that edge is no longer a violation.
- Given a fixture in which removing one edge frees several entries of a larger cycle at once, when the checker evaluates it, then it reports every freed entry line in one run, not just the first.
- Given an allowlist line that does not parse to a pair of `src/conductor/src/` paths, or that is a duplicate or out of sorted order, when the checker evaluates it, then it fails and names that line as a malformed entry.
- Given an unlisted violation, when the checker reports it, then the failure message includes the exact allowlist line that would cover that edge.

### Done When
- [ ] The allowlist is one sorted text file with one `from -> to` line per allowed edge, and the line alone identifies the edge.
- [ ] The real-tree ratchet test passes with the committed allowlist, and its entry count equals the computed number of upward-or-cycle value edges.
- [ ] A stale-entry failure and a malformed-entry failure each name the offending allowlist line.
- [ ] A round-trip test formats and parses entries, and the checker rejects malformed, duplicate and out-of-order lines.

## Story 4: The ratchet fails closed on input it cannot classify or resolve

**Requirement:** Intake outcome 1 (the check cannot falsely pass), and architecture-review condition 3

As a contributor, I want the ratchet to fail rather than skip when it meets a file outside any known layer or an import it cannot resolve, so that a gap in its view of the tree can never produce a false pass.

### Acceptance Criteria

#### Happy Path
- Given a fixture in which a file imports `./sibling.js` and `./sibling.ts` exists, when the checker evaluates it, then it records the edge to `sibling.ts`.
- Given a fixture in which a file imports `./dir/index.js`, or imports `./dir` and `./dir/index.ts` exists, when the checker evaluates it, then it records the edge to `dir/index.ts`.
- Given a fixture in which a file imports a package specifier such as `typescript` or `node:fs`, when the checker evaluates it, then it records no edge and reports no violation for that import.
- Given a fixture in which `engine/conductor.ts` re-exports names with `export { … } from` from other `engine/` modules, when the checker evaluates it, then those re-exports are recorded as ordinary same-layer value edges, with no special case.

#### Negative Paths
- Given a fixture containing a `.ts` file in a top-level `src/` directory that is not `types`, `execution`, `engine`, `ui` or `tools`, when the checker evaluates it, then it fails naming that file as unclassifiable.
- Given a fixture in which a file has a relative import specifier that resolves to no file under `src/conductor/src/`, when the checker evaluates it, then it fails naming the importing file, the line number, and the unresolved specifier.
- Given a fixture in which a relative specifier resolves to a path outside `src/conductor/src/`, when the checker evaluates it, then it fails naming the importing file, the line number, and the specifier.

### Done When
- [ ] Unclassifiable-file and unresolved-specifier failures are distinct violation kinds, and each carries the file path, plus the line and specifier where they apply.
- [ ] The fixture tests for `.js` to `.ts`, directory `index.ts`, and package specifiers each assert the exact recorded edge set.
