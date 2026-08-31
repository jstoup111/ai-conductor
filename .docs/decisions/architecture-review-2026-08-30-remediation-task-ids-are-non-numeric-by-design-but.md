# Architecture Review: Shared plan-task reference resolver (#2064)
**Date:** 2026-08-30
**Mode:** lightweight (Medium tier, technical track — Sections 2 and 4)
**Stories reviewed:** none yet (pre-stories DECIDE review)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- Pure in-repo TypeScript engine change; no new dependencies, services, migrations, or infra.
- Grammar authority already exists: `plan-task-parse.ts` exports `TASK_ID_PATTERN`; the resolver
  lives beside it (verified, 100%).
- The consumer already computes `activePlanTaskIds` and membership-checks FIXABLE rows
  (`artifacts.ts:4385,4436-4437`) — the seam replaces the `Number()` pre-parse rather than adding
  a new data source (verified, 100%).
- Integration surface: `artifacts.ts` prd_audit parser + downstream consumers of the parsed
  `planTask` field (type moves number → string id). Bounded; enumerate consumers during /plan.
- Worktree isolation: no shared state; parallel-safe.

## Alignment

- Matches single-parser precedents adr-2026-08-08-single-adr-approval-parser-three-rungs and
  adr-2026-08-26-shared-coherence-parser-at-discovery: one grammar, multiple rungs, bespoke
  predicate deleted.
- Producer contract (adr H3/H9 lineage, `remediation-append.ts`) preserved unchanged.
- Skill-contract note: `skills/prd-audit/SKILL.md` says "only FIXABLE rows may name a task", yet
  the observed accurate row was a PASS citing the remediation task that delivered it, and the
  engine parser accepts a task on any grade. Stories must settle this: keep "any row may cite;
  FIXABLE must", and align the skill text in the same diff.
- Repo Design Principle: machinery (deterministic resolver) at the mechanical bookkeeping point;
  no prompt-discipline fix.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| planTask number→string ripples to an unnoticed consumer | Technical | Medium | Medium | Enumerate all readers of the parsed field in /plan; compiler enforces the type change |
| Annotation-stripping accepts garbage as valid | Technical | Low | Medium | Strip only a single trailing parenthesized annotation; everything else rejects with diagnostic |
| #2054 adoption drifts from this contract | Integration | Low | Low | ADR names the artifact-agnostic contract; adoption stays in #2054's lane |

## Wiring Surface

- `resolvePlanTaskReference` (new export, beside `plan-task-parse.ts`) — invoked from
  `artifacts.ts`'s prd_audit Verdict Table row loop (the existing `rawPlanTask` handling it
  replaces); no other production caller in this feature.
- No new config keys, hooks, events, or CLI subcommands.

## ADRs Created

- adr-2026-08-30-shared-plan-task-reference-resolver (DRAFT — pending operator approval).

## Conditions

1. adr-2026-08-30-shared-plan-task-reference-resolver reaches APPROVED before stories.
2. /plan enumerates every downstream consumer of the parsed `planTask` field.
3. `skills/prd-audit/SKILL.md` Plan-task cell text aligned with the resolved citation rule in
   the same feature.
