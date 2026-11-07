# Complexity: Enforce module layering with the import-graph ratchet (#1988)

Tier: M

## Rationale

- The new code is one structural check: a TypeScript-AST import-graph scan over `src/conductor/src/`
  that classifies each file's layer, finds upward value edges and value edges that close a cycle, and
  compares the result with a per-edge allowlist directory. It changes no runtime behavior.
- The allowlist starts at about 330 entry files. On 2026-10-24 the tree had 34 upward value file
  pairs and 297 value edges inside SCCs, and the largest SCC held 94 files. Seeding those entries is
  mechanical, but it is a large diff, and the edge-identity and file-naming scheme has to stay stable
  for slice 3 and for parallel lanes.
- There is no documentation edit. The repository's `maintain-documentation` pre-finish gate owns the
  refresh of `docs/contributing/code-organization.md`.
- Hazards that justify Medium over Small:
  - Edge identity and SCC semantics are design choices that slice 3 (#1017/#3042) builds on, so they
    need an architecture-review approval point.
  - The check has to handle `.js`-suffixed specifiers, `index.ts` resolution, re-export shims and
    dynamic `import()` correctly, or it gives false passes.
  - It must stay fast enough for the default tier.
- Not Large: there is no new layer, no runtime change, no new dependency and no external surface.
  ADR-2026-10-07 D5 already decides the mechanism.
