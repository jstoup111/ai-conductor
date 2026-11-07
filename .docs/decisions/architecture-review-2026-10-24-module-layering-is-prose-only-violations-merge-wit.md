# Architecture Review: Enforce module layering with the import-graph ratchet (#1988)

**Date:** 2026-10-24
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** the explore output and track marker
(`.docs/track/module-layering-is-prose-only-violations-merge-wit.md`), the complexity assessment, the
components diagram (`.docs/architecture/module-layering-is-prose-only-violations-merge-wit.md`), and
the governing ADRs `adr-2026-10-07-conductor-decomposition-target-architecture` (D5, D7) and
`adr-2026-10-12-enforced-source-layer-directions` (D1, D6).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All measurements below were taken on 2026-10-24, on this spec's base, with a throwaway TypeScript
compiler-API scan of `src/conductor/src/` (657 `.ts` files).

| Check | Finding | Basis |
| --- | --- | --- |
| Stack compatibility | `typescript` 6.0.3 is already a dependency of `src/conductor/package.json`, and `test/structural/` already holds compiler-API checks (`conductor-shape-guard.ts`). D5 forbids madge and dependency-cruiser, so no new package is needed. | verified |
| Prerequisites | Slice 1 (#1481) is closed and recorded under `.docs/shipped/decompose-conductor-ts-god-class-target-architectu.md`, so #1988 has no open blocker. It blocks #1017, #3042, #1989 and #1993. | verified (GitHub dependency API) |
| Integration surface | The change is test-tier only: a pure graph module and a structural test under `src/conductor/test/structural/`, plus an allowlist directory. Nothing in `src/` changes. | verified |
| Data implications | There is no schema or runtime state. The allowlist is a committed data directory of about 263 entry files. | measured |
| Performance | A syntactic `createSourceFile` scan of all 657 files, with Tarjan SCC, took 0.9 s. A full `createProgram` type-checker scan took 1.5 s. Both fit the default tier. | measured |
| Worktree isolation | The allowlist has one file per edge, so parallel lanes that remove different edges delete different files and never conflict. No ports, services or shared state are involved. | inferred (D5 design) |

**Edge-classification accuracy.** `tsconfig.json` sets `isolatedModules` but not
`verbatimModuleSyntax`, so an unmarked `import { X }` of a type-only symbol is legal and is elided at
runtime. A syntactic scan therefore counts such an import as a value edge. Measured impact: 3 such
imports, and zero difference in upward pairs or SCC membership against the checker-based
classification. The syntactic classification is accepted. It errs toward reporting, and it keeps the
check free of a full program build. Confidence 90%, verified by measurement.

**Today's violation set** (static value edges only, under the confirmed edge rules below):

- 33 upward value file pairs: `engine → ui` 20, `execution → engine` 11, and `engine → entry` 2.
  The `engine → entry` pairs are `engine/daemon-command.ts → cli-defaults.ts` and
  `engine/kickback-budget-cli.ts → cli.ts`. Neither is recorded in #1017 or in the module map.
- Nine value-import SCCs, of sizes 63, 10, 5, 4, 2, 2, 2, 2 and 2. They hold 233 intra-SCC value
  edges, 230 of which are not also upward. The 63-file SCC spans the rebase, restack, routing,
  as-built, gate-verdict and task-progress modules.
- The seed allowlist is therefore about 263 entries. Dynamic `import()` is excluded; counting it would
  grow the largest SCC to 94 files, because lazy loads are the codebase's existing way to break a
  cycle.

## Alignment

**Governing decisions, reused and not duplicated.** This feature is D7 slice 2 and implements D5 as
written:

- the layer chain `types ← execution ← engine ← ui ← entry`;
- a TypeScript-AST check;
- failure on any unlisted upward value edge, or any unlisted value edge that closes a cycle;
- one allowlist file per allowed edge;
- failure on a stale entry;
- no file-size or line-count budget.

The `tools/` and entry-point rules are the ones `adr-2026-10-12-enforced-source-layer-directions` D1
records: `tools/` may import `engine/` and `types/`; nothing at runtime imports `tools/`; only an
entry file imports an entry file. This slice does not touch slice 3's extension (type-only imports,
type-only re-exports and dynamic `import()` in the upward rule) or its emptying of upward entries.
This slice's identity and staleness rules are the contract slice 3 builds on.

**No new ADR.** The design makes no uncovered structural decision. The mechanism, the layer chain and
the allowlist model are all D5's. The operator-confirmed choices below refine how D5's "value edge"
and "shrink-only" terms are evaluated. They are compatible with D5's text, which says the check
fails when an allowlisted edge no longer exists; this design adds one more stale condition and
removes nothing. They are recorded here as conditions for the plan, not as a new decision record.

**Operator-confirmed design choices (2026-10-24):**

1. **Edge kinds.** An edge is a static, non-type-only `import` declaration (including a side-effect
   `import './x.js'`), or a non-type-only `export … from`, whose specifier resolves to a file under
   `src/conductor/src/`.
   - Type-only forms are excluded: `import type`, all-`type` named bindings, `export type … from`,
     and inline `import('…')` type nodes.
   - Dynamic `import()` is excluded.
   - Classification is syntactic.
2. **Staleness.** An allowlist entry is stale, and fails the check, when its edge no longer exists or
   when its edge is no longer a violation, meaning it is neither upward nor inside a value-import
   SCC. So the allowlist always equals the exact current violation set. Breaking a cycle can free
   many entries at once, and the failure lists every one by name.
3. **Additions.** Adding an entry file by hand in a PR stays possible and visible in review, as D5
   allows. No diff-relative "no new entry" guard is added.

**Pattern basis (focused local precedent).**

- **Role:** the in-test-tree AST guard. `checkConductorShape` and `checkConductorImports` in
  `src/conductor/test/structural/conductor-shape-guard.ts` are consumed by
  `conductor-shape.test.ts`.
- **Traits to preserve:**
  - Pure checker functions take source text or a file set and return typed violation records with a
    file and a line.
  - Fixture-string tests exercise each rule, and a separate test runs the checker against the real
    tree.
  - Path resolution comes from `import.meta.url`, never from the process cwd.
- **Why it applies:** the ratchet is the same kind of guard, a structural invariant over
  `src/conductor/src/` that is judged from the AST.
- **Allowed variation:** the graph module walks the whole `src/` tree and computes SCCs, which the
  shape guard does not.
- **Rediscovery hints:** `src/conductor/test/structural/conductor-shape-guard.ts` (`parseSource`,
  `checkConductorImports`), `src/conductor/test/structural/conductor-shape.test.ts`.

**Domain boundaries and coupling.** The ratchet reads `src/` and imports nothing from it, so it adds
no production coupling. `checkConductorImports` and the `non-autonomy.test.ts` scanner stay as they
are, which is the operator-confirmed Balanced scope. The `conductor.ts` shim re-exports are ordinary
value re-export edges, which makes D7's "shim … in its allowlist model" hold with no special case.

**Diagram accuracy.** The components diagram matches this design.

**Docs drift.** This spec does not edit `docs/contributing/code-organization.md` and adds no
doc-consistency check. The repository's `maintain-documentation` pre-finish gate refreshes that prose
during the build. Its stale counts and its "Dependency direction" table are that gate's input, and
they impose no constraint on this design.

## Wiring Surface

These are design-time commitments; §12 verifies them at SHIP.

- **Graph and ratchet module** (`src/conductor/test/structural/`, scanner, SCC and allowlist
  comparison). Its only consumer is the ratchet structural test below. It is not a production module,
  and nothing in `src/` imports it.
- **Ratchet structural test.** The default Vitest tier picks it up through `vitest.config.ts`
  `include: ['test/**/*.test.ts']`. CI runs it in the `conductor` job (`npm test` shards), which the
  CI `summary` job requires, so a violation fails CI before merge.
- **Allowlist directory.** It is read only by the ratchet test. Each entry's file name encodes the
  edge's (importing file, imported file) pair, as paths relative to `src/conductor/src/`, and the
  encoding must be reversible. The plan fixes the encoding, and the ratchet's failure messages print
  the exact file name to create or delete.

Advisory overlap scan (`ai-conductor overlap-scan` over these candidate paths) reported no unmerged
dependent work.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| In-flight daemon features that add a value edge inside the 63-file SCC fail `test_suite` after this lands. On 2026-10-24, 38 of 256 recent `src/` commits touched two or more SCC files. | Integration | Medium | Medium | The failure names the file, the line and the exact allowlist file to add, so the fix is mechanical and reviewable (choice 3). |
| An edge-identity encoding that is not stable or not reversible breaks slice 3 and parallel lanes. | Technical | Low | High | Fix the encoding in the plan. Test that it round-trips, and that two different edges never map to one file name. |
| A specifier that resolves wrongly (`.js` → `.ts`, `dir/index.ts`, or a path that does not exist) hides an edge and gives a false pass. | Technical | Medium | High | Test each resolution form with fixtures. An unresolvable relative specifier under `src/` is reported, not skipped. |
| A file in an unrecognized top-level `src/` directory escapes the rules. | Technical | Low | Medium | A file whose layer cannot be classified fails the check. |
| The seed of about 263 entry files makes a large diff. | Knowledge | High | Low | Seed it mechanically from the checker's own "missing entries" output in one task, so review can trust the generator, not each file. |

## ADRs Created

None. `adr-2026-10-07-conductor-decomposition-target-architecture` D5 and D7 govern this work, and
`adr-2026-10-12-enforced-source-layer-directions` D1 governs the `tools/` and entry rules. Both are
cited and reused.

## Conditions

1. Implement the confirmed edge kinds, staleness rule and addition policy (choices 1–3) exactly.
   Story criteria must test each of them.
2. Each failure names the importing file, its line number, and either the layer edge
   (`engine -> ui`) or the cycle it closes. A stale-entry failure names the entry file.
3. An unclassifiable `src/` file and an unresolvable relative specifier each fail. Neither is
   silently skipped.
4. The allowlist file-name encoding is reversible and collision-free, and a test proves it.
5. The seeded allowlist equals the checker's computed violation set on the final tree, so the ratchet
   passes on the real tree in the same commit that seeds it.
