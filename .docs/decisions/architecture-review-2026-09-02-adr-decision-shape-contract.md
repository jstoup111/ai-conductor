# Architecture Review: ADR Decision-Shape Contract (issue #2054)
**Date:** 2026-09-02
**Stories reviewed:** none yet (pre-stories DECIDE review, lightweight/Medium)
**Verdict:** APPROVED

## Feasibility
Pure engine + template work in the existing stack (TypeScript, Vitest). Seams verified in
source: predicate home `src/conductor/src/engine/artifacts.ts` (beside `adrApprovalStatus`,
~line 4048); gate rung inside the existing 4e ADR loop in
`src/conductor/src/engine/engineer/land-spec.ts` (~lines 384-400); the only decision-shape
parser today is the AB-R12 regex in `src/conductor/src/engine/conductor.ts` (~lines 646-660),
sole production call site ~line 3969. No migrations, no external services, no new
infrastructure; worktree-safe.

## Alignment
Full 546-file `.docs/decisions/` sweep performed. Governing set and dispositions:
- adr-2026-08-08-single-adr-approval-parser-three-rungs — followed: same shared-parser pattern
  and hygiene rules (fence exclusion, line anchoring, fail-closed unparseable, empty set passes).
- adr-2026-08-30-shared-plan-task-reference-resolver — decision 5 pre-authorizes this feature
  adopting the resolver contract; the parser yields the id set, resolution goes through the seam.
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route — wire format preserved:
  stem + decision number stays resolvable.
- adr-2026-08-26-shared-coherence-parser-at-discovery (amended) — no-silent-loss corpus test
  over both predicates is a required deliverable.
- adr-2026-08-18-content-anchored-finding-reference-schema — not touched: decision ids remain
  transient diagnostics, never a persisted reference kind (scoping note in the new ADR).
- adr-2026-08-24 / adr-2026-08-22-one-owner / adr-2026-08-23-criterion-layer /
  adr-2026-07-03-idempotent-land / adr-2026-07-22-coherence-gate-placement — gate is a
  land-only, fail-closed, non-waivable, refuse-only rung in the existing ladder.
- adr-2026-08-13-markdown-default-inversion — template edit treated as runtime-source change.
Operator constraint honored: parser is a strict superset; gate is diff-scoped to the spec's own
new/edited ADRs; no corpus migration.

## Domain Integrity
Parser returns a typed result (decision id set | structural diagnostic), no boolean flags;
consumers cannot re-derive validity with their own regexes (adr-2026-08-30 decision 1).

## Wiring Surface
- `parseAdrDecisions` (new export, `src/conductor/src/engine/artifacts.ts`) — called from the
  engineer land gate rung in `land-spec.ts` and from `resolveAsBuiltGoverningClause` in
  `conductor.ts` (which reaches production via the as-built validation group dispatch).
- Land citability rung — invoked inside `landSpec`'s existing gate chain, reached from
  `src/conductor/src/engine/engineer-cli.ts` land command dispatch.
- Template guidance (`templates/adr.md.template`) — consumed by the architecture-review skill at
  ADR authoring time.

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Parser superset misses a corpus shape and un-cites a legacy decision | Data | Low | High | No-silent-loss corpus test over all 546 files, both predicates |
| Diff-scoping bug re-validates legacy ADRs at land | Technical | Low | Medium | Gate keyed to the spec branch's base...HEAD changed-file set with unit tests |
| Amendment-note decisions counted inconsistently | Technical | Medium | Medium | Explicit amendment-shape fixtures from real corpus files |

## ADRs Created
- adr-2026-09-02-adr-decision-citability-contract (pending operator approval this session)
