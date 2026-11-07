# Architecture Review: External-boundary ports, registry, and ratchet (#1989)
**Date:** 2026-11-07
**Inputs reviewed:** explore output and track marker (`.docs/track/external-boundaries-have-no-swappable-seams-rerout.md`, technical),
the approved component diagram (`.docs/architecture/external-boundaries-have-no-swappable-seams-rerout.md`), and intake #1989.
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependency. The ratchet uses the `typescript` 6.0.3 compiler API already used by
  `test/structural/layer-ratchet.ts` (verified).
- **Prerequisites:** none. The D5 layer ratchet (#1988) is on main and provides the conventions to
  reuse: `checkLayerRatchet({ files, allowlist })` input shape, `readAllowlistEntries`, and the
  sorted-text allowlist format (verified at `test/structural/layer-ratchet.ts:66,83,216`).
- **Integration surface:** test-only. The spec adds no production module, so no runtime path changes.
- **Data:** none.
- **Performance:** the scan parses about 713 files once, which is the same cost class as the layer
  ratchet already in the default tier (inferred, 85%).
- **Worktree isolation:** reads source files only. No ports, databases, or shared state.

## Complexity

Medium for code (one scanner, one registry module, one test, one generated allowlist). The
L tier comes from cross-cutting governance: the ADR binds every later external-call change and
eight follow-on migrations. Estimated plan size is 5–8 tasks, well under the 20-task split
threshold, so no split is needed (§3a).

## Alignment

- **D5** (`adr-2026-10-07-conductor-decomposition-target-architecture`) is reused: same scan scope,
  entry-layer definition, allowlist grammar, and shrink-only staleness rule. The boundary ratchet is a
  second rule over the same files, not a competing layer mechanism, because it checks external
  specifiers and adapter imports, not layer edges.
- **D6** is delivered through this mechanism: the git row of the boundary ratchet is the
  "ratchet forbids new direct spawns" D6 promises. No amendment is needed, because D6's decision is unchanged.
- **D7:** #3043 stays slice 4 and becomes the first migration under the new ADR. It gains #1989 as a
  blocker.
- `adr-2026-10-12-enforced-source-layer-directions` decisions 3–4 (entry-level composition, injected
  ports) are generalized to external boundaries.
- `adr-009-intake-adapter-port` and `adr-2026-07-22-canonical-tracker-client-seam` remain valid.
  Those narrower seams become adapters behind `gh` at its migration.
- **Documentation drift noted, not fixed here:** `code-organization.md` claims `execution/` is the only
  third-party layer. The ratchet now makes the real state enumerable, and each migration moves the
  code toward the claim.
- **Diagram change during review:** the registry moved from `types/` to `test/structural/`. Its only
  reader is the ratchet, and a production module read only by a test is an unreachable rung at the
  SHIP sweep. The diagram change log records this.

### Focused local pattern basis

- **Precedent:** `test/structural/layer-ratchet.ts` (`checkLayerRatchet`, `readAllowlistEntries`,
  `parseAllowlistEntry`) together with `layer-allowlist.txt` and `layer-ratchet.test.ts`.
- **Role:** the structural-ratchet shape the boundary ratchet copies.
- **Traits to preserve:**
  - a pure check function over an in-memory `files` map plus allowlist lines, with the file walk
    in the test;
  - TypeScript AST classification, not regex;
  - strictly ascending allowlist lines, with malformed and unsorted lines failing;
  - stale lines failing so the list only shrinks;
  - violation messages naming the file and line.
- **Variation allowed:** the boundary verdict keys on (file, boundary) pairs instead of (file, file)
  edges, and touches are specifiers, calls, and adapter imports instead of relative imports.

## Domain Integrity

- **Boundary names:** a closed string-literal union of eight names. An exhaustive registry
  keyed by that union means a missing or extra boundary fails to type-check.
- **Status:** a discriminated union, `{ kind: 'ported' }` or `{ kind: 'pending'; issue: number }`,
  not a free string.
- **Violation kinds:** a discriminated union (`unlisted-touch`, `stale-entry`, `malformed-entry`,
  `unknown-boundary`), handled by an exhaustive switch in the formatter.

## Wiring Surface

- **`boundary-registry.ts`:** consumed by `boundary-ratchet.ts` and by the registry completeness
  assertion in `boundary-ratchet.test.ts`.
- **`boundary-ratchet.ts`:** `checkBoundaryRatchet` is called by `boundary-ratchet.test.ts`,
  which runs in the default Vitest tier and so in the CI conductor job, as the layer ratchet does.
- **`boundary-allowlist.txt`:** read by `boundary-ratchet.test.ts`.
- **No production surface.** `Boundaries`, `createProductionBoundaries`, and root construction land
  with #3043 (ADR decision 2).

Overlap scan over the paths above returned no conflicting unmerged work. The four new files do not
exist yet.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| False-positive touches fail unrelated features | Technical | Low | Medium | Spawn-literal touches count only when the callee is an import from `child_process` or `execa`, or a registered process-adapter export. Clock touches use exact call shapes. |
| Indirect spawns through runner variables escape per-binary attribution | Technical | Medium | Low | They are still caught as `process`, and each binary's migration ports its runner (ADR A1). |
| Large seed allowlist (about 450 lines) causes textual merge conflicts | Integration | Medium | Low | One line per pair, sorted. Same accepted cost as the D5 amendment. |
| Follow-on migrations stall, leaving boundaries enumerable but not swappable | Knowledge | Medium | Medium | Each pending entry names its intake issue, and the allowlist line count is a visible measure. |

## ADRs Created

- `adr-2026-11-07-external-boundary-ports-registry-and-ratchet` (APPROVED by operator 2026-11-07).

## Conditions

None.
