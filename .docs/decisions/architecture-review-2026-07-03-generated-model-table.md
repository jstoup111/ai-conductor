# Architecture Review: Generated HARNESS.md Model-Selection Table

**Date:** 2026-07-03
**Mode:** Lightweight (tier M — feasibility + alignment)
**Input reviewed:** explore output + technical intent (technical track; stories not yet written), approved diagrams `.docs/architecture/generated-model-table.md`, `.docs/architecture/sequences/2026-07-03-generated-model-table.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | **`tsx` is NOT currently in `src/conductor` devDependencies** (verified `package.json`: tsup/typescript/vitest only). Condition C1: add `tsx` as a devDependency; forbid `npx -y` (network fetch at check time). |
| Prerequisites | `npm install` in `src/conductor` for dev/CI checkouts — already true for the test suite; worktrees need their own install (known). No migrations, no external accounts. |
| Integration surface | Three files/subsystems, one seam: engine metadata (new data-only module), `bin/generate-model-table`, `test/test_harness_integrity.sh`. `resolveStepConfig` precedence untouched. |
| Data implications | None (no schema, no persistent state). Generated region in HARNESS.md is the only mutated committed artifact. |
| Performance risk | Negligible — tsx cold start (~1s) once per suite run. |
| Worktree isolation | No ports/DBs/shared services. Generator writes only the repo's own HARNESS.md. **Never rebuilds `dist/`** — honors the shared-dist rebuild hazard (#215). |

Current-drift evidence justifying the feature: engine step `complexity` (sonnet) has **no row**
in today's table; `architecture_review_as_built` exists only as prose in the
architecture-review row. The generator makes both explicit.

## Alignment

- **Convention over precedent:** CLAUDE.md/HARNESS.md currently instruct "when you change one,
  change all three" — this feature supersedes that prose. Condition C3: the same PR must update
  the HARNESS.md surrounding prose and CLAUDE.md's validation-suite list (Docs-track-features
  rule) + CHANGELOG `[Unreleased]`.
- **Pattern consistency:** typed `Record<StepName, …>` exports match the existing
  `DEFAULT_STEP_*` idiom; new pattern (generated committed region) is documented in the ADR.
- **State management:** n/a (stateless generator; data-only module).
- **Diagram accuracy:** feature diagrams approved 2026-07-03; no existing diagrams invalidated.
- **Security:** no new inputs beyond repo files; no endpoints.
- **Bash/TS boundary:** exactly one seam (`bin/generate-model-table`); the suite never parses
  TypeScript — consistent with existing bin/ wrapper conventions.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Generated-region markers deleted/mangled by a manual HARNESS.md edit | Technical | Medium | Medium | Hard error on missing/malformed markers (C2); drift check catches content edits |
| tsx missing at check time (fresh checkout/worktree) | Technical | High | Low | Warn-and-skip degradation; presence-only check 5 still runs |
| Pin check false-positives on skills with no engine step | Technical | Medium | Medium | Explicit `PIN_EXEMPT_SKILLS` with per-entry rationale; unmapped+unexempted skill = fail (forces a decision) |
| Fable availability ladder (#186) later changes defaults | Integration | Medium | Low | That's the payoff: single-file edit + regenerate; interim-fallback note stays hand-authored outside the region |
| Table shape change (new Effort column, new rows) surprises readers | Knowledge | Low | Low | ADR documents shape; PR diff shows full regenerated table |

## ADRs Created

- `adr-2026-07-03-generated-model-table-single-source.md` (DRAFT → pending operator approval)

## Conditions

- **C1:** Add `tsx` to `src/conductor` devDependencies; wrapper uses the local binary, never `npx -y`.
- **C2:** Missing/malformed generated-region markers are a hard error in both write and check modes.
- **C3:** Same-PR docs updates: HARNESS.md surrounding prose (drop "change all three"), CLAUDE.md validation-suite list gains the new checks, CHANGELOG `[Unreleased]` entry.
