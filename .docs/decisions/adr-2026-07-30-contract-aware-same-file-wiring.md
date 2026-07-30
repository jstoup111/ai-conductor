# ADR: Contract-aware same-file wiring requires symbol and root proof

**Date:** 2026-07-30
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#880
**Supersedes:** Clause 3's unconditional outside-defining-file requirement in `adr-2026-07-12-wiring-check-gate` for the narrow same-file composition case only
**Approved by:** James Stoup, 2026-07-30

## Context

The universal Layer 1 orphan backstop currently removes every reference from an export's defining file before evaluating production use. That rule catches self-referential or test-only exports, but it also rejects a common module-composition shape: an exported, directly testable helper is called by a production orchestrator in the same file, while that file is transitively reachable from a configured production entry point.

The current Layer 2 graph proves only module reachability. The current declared-site verifier proves only that the `path#symbol` text exists in the named file. Neither proof alone is sufficient: module reachability can coexist with a dead helper, and text matching can be fooled by a declaration, comment, or shadowed identifier.

The desired refinement must pass the composed helper without allowing a genuinely unused export, a test-only export, an unreachable module, or a project without applicable reachability analysis to pass.

## Options Considered

### Option A: Contract-aware same-file exception with symbol identity and root proof

- **Pros:** Narrowly fixes the false gap; reuses the accepted plan contract and Layer 2 roots; keeps unsupported projects fail-closed; produces deterministic, auditable evidence.
- **Cons:** Requires a symbol-aware TypeScript analysis seam and coordination between Layer 1 and Layer 2 results.

### Option B: Full symbol-level reachability graph from every root

- **Pros:** Provides the strongest end-to-end proof and could detect more dead symbols in reachable modules.
- **Cons:** Substantially expands compiler analysis, performance cost, and failure modes; remains language-specific; exceeds the incident's required scope.

### Option C: Forbid exported helpers used only inside their module

- **Pros:** Preserves the existing gate unchanged and is simple to explain.
- **Cons:** Forces testing through module roots, rejects intentional testable seams, and does not satisfy the accepted outcome.

## Decision

Choose Option A. A newly added export whose production references are confined to its defining file may replace the Layer 1 orphan gap with a typed `same-file-composition` proof only when all conditions below hold:

1. The export belongs to a task with a declared `Wired-into: path#caller` site whose path is the export's defining file.
2. TypeScript symbol analysis resolves `caller` in that file and proves that the caller's implementation references the exact new export declaration. A same-name token, comment, import, declaration, or shadowed local is not proof.
3. Configured Layer 2 is applicable and proves the defining module reachable from at least one production entry point through non-test import edges.
4. The final `WiringEvidence` records a typed proof naming the export, caller, defining file, and root-reachability chain. Successful exceptions are visible evidence, not merely the absence of a gap.
5. The SHIP-time as-built architecture review applies the same semantic rule independently: it may count an own-module caller only when it cites the exact caller-to-export reference and a production-entry-point chain reaching that module. An own-module reference alone still does not count.

The TypeScript program/checker used for symbol proof and the import graph must be created once per probe run and shared; the exception must not double the compiler-program construction cost.

If any condition is missing, ambiguous, or cannot be computed, the existing `orphan-export` gap remains. Layer 2 `not-applicable`, `skipped`, and `bad-root` states never authorize the exception. Cross-file production references, test exclusions, contract contradictions, waiver rules, kickback behavior, and non-TypeScript behavior remain unchanged.

## Consequences

### Positive

- Same-module production composition stops producing false wiring failures in configured TS/JS projects.
- Genuinely dead symbols inside otherwise reachable modules remain gaps because caller-to-export identity is required.
- Test-only and unsupported-project behavior stays fail-closed.
- Evidence explains why an exception passed, making later regressions and audits diagnosable.

### Negative

- Layer 1 and Layer 2 can no longer be evaluated as entirely independent collections; the orchestrator must join their per-export facts for the narrow exception.
- Symbol-aware fixtures are more involved than the current injected grep fixtures.
- Other language ecosystems receive no exception until they provide an equivalent reachability adapter.

### Follow-up Actions

- [ ] Add a pure same-file composition evaluator over new exports, task contracts, symbol-reference facts, and module-reachability facts.
- [ ] Refactor TypeScript analysis so one lazily loaded program/checker supplies both import reachability and symbol identity.
- [ ] Extend `WiringEvidence` with a validated typed proof for successful same-file exceptions.
- [ ] Add negative coverage for missing contracts, wrong callers, shadowing, test-only paths, unreachable modules, skipped Layer 2, and unsupported projects.
- [ ] Update canonical wiring-gate documentation and the changelog; no CLI, hook, settings schema, or migration surface changes.
- [ ] Align `architecture-review --as-built` so BUILD and SHIP use the same three-proof definition while retaining independent verification.
