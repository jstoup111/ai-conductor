# Architecture Review: DECIDE-time unmerged-overlap scan (#523, Scope A)

**Date:** 2026-07-21
**Tier:** Medium (lightweight review — Feasibility + Alignment + Wiring Surface)
**Reviewed:** explore output + technical intent (stories/plan do not exist yet); ADR
`adr-2026-07-21-decide-time-unmerged-overlap-scan`; diagrams
`components-unmerged-overlap-scan.md`, `sequences/decide-time-overlap-scan.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|-------|------------|
| Stack compatibility | ✅ No new deps. Reuses `rebase.ts#changedPathsBetween` (git) and the `blocker-resolver` gh-runner factory. New code is one engine module + one `conduct-ts` subcommand. |
| Prerequisites | None. Runs against the local worktree + `gh` (already required by the engineer/daemon flow). |
| Integration surface | git (branch enumeration + diff) and `gh` (blocker API, via existing resolver). Two subsystems, both with existing wrappers; no new external service. |
| Data implications | None. Read-only, stateless — no schema, no migration, no persisted marker (that is Scope B). |
| Performance risk | Bounded: one `git diff --name-only` per unmerged `spec/*`/open-PR branch, plus one `blocked_by` API call. Branch count is small (per-repo in-flight specs). Resolver already memoizes per instance. Cap enumeration to the repo's own `spec/*` + open PR heads — no full-history walk. |
| Worktree isolation | ✅ Read-only; touches no ports, DBs, or shared writable state. Safe under parallel worktrees. Reads sibling branches via `git`, never checks them out. |

## Alignment

- **Design Principle (deterministic where possible).** ✅ The scan is machinery (a
  `conduct-ts` primitive), not a prompt-level "remember to check." This is the correct side of
  the repo's stated principle — the DECIDE skills invoke a deterministic command and render its
  output.
- **Existing patterns.** ✅ Reuses the injected-runner pattern (`blocker-resolver`'s
  `BlockerRunner`, `rebase.ts`'s `GitRunner`) so the scan module is unit-testable with fakes,
  matching repo precedent. New subcommand joins the commander `.command(...)` table in `cli.ts`
  dispatched via `index.ts`, like the engineer subcommands.
- **Boundary respect.** ✅ Build side (`daemon-backlog`, `gitTreeSource`) is untouched — the
  scan lives entirely in the DECIDE/authoring path. No coupling introduced between authoring and
  the build gate.
- **Base-ref resolution.** ✅ Design reuses `rebase.ts#resolveBase` semantics
  (`origin/«default»`, degrade to local) — never hardcodes `main`, matching the codebase's
  no-hardcoded-main convention.
- **State management.** ✅ No new persistent state; advisory output only. No boolean-flag or
  invalid-state modeling concerns (nothing is stored).

## Wiring Surface

New production surfaces this feature introduces and where each is called from in production:

1. **`OverlapScan` engine module** (new, `src/conductor/src/engine/…`) — invoked from the new
   `conduct-ts` scan subcommand handler in `index.ts`. Internally calls the reused
   `changedPathsBetween` and `blocker-resolver.resolve`.
2. **`conduct-ts` scan subcommand** (new `.command(...)` in `cli.ts`, dispatched in `index.ts`)
   — invoked by the `/architecture-review` skill step (Medium/Large, over `## Wiring Surface`
   paths) and the `/plan` skill step (over the authoritative `**Files:**` set). Also directly
   runnable by an operator and reusable by the engineer DECIDE chain.
3. **`/architecture-review` SKILL.md step** (new step) — wired into the DECIDE chain the
   conductor/engineer already runs; emits the advisory into the review flow before `/plan`.
4. **`/plan` SKILL.md step** (new step) — wired into the DECIDE chain as the authoritative
   final overlap check before the plan is committed.

Reused (not new surfaces, no wiring added): `rebase.ts#changedPathsBetween`,
`blocker-resolver` factory + `gh` runner.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|------|------|------------|--------|------------|
| False negative — a real overlap missed (e.g. a rename not caught by name-only diff) silently reintroduces #523's gap | Technical | Medium | Medium | Diff at path granularity against candidate Files; document that pure renames are a known limit; stories include a file-accurate-intersect happy path |
| False-positive noise erodes author trust (flags unrelated paths) | Technical | Medium | Medium | Intersect strictly on the plan's declared `**Files:**` / Wiring Surface paths, not a fuzzy match; quiet negative path proven by a story |
| Branch enumeration or `gh` failure blocks authoring | Integration | Low | Medium | Advisory-only: any failure degrades to a skip-note, never blocks the plan (story-covered) |
| Enumeration cost grows with branch count | Performance | Low | Low | Scope enumeration to `spec/*` + open-PR heads; one diff per branch; resolver memoizes |

No High-impact risks.

## ADRs Created

- `adr-2026-07-21-decide-time-unmerged-overlap-scan` — **APPROVED**. Deterministic primitive,
  dual hook point (`/architecture-review` + `/plan`), advisory/stateless, build side untouched.

## Verdict

**APPROVED.** Feasible with reused primitives, aligned with the repo's deterministic-machinery
principle and injected-runner patterns, no High-impact risks, and no unconfirmed load-bearing
assumptions. Proceed to `/stories`.
