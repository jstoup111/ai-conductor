# Track: cheap-gate-first — wiring_check before build_review (#879)

Track: technical

Engine-internal step-topology and dispatch change (`src/conductor/src/engine/steps.ts`,
`conductor.ts`, `step-runners.ts`). No user-facing product surface, no new CLI verb, no
config schema change — acceptance criteria live in stories; no PRD.

## Problem statement (from intake #879)

Step order is `build → build_review → wiring_check`. `build_review` is an LLM grader
dispatch; `wiring_check`'s verdict is derived from a deterministic probe whose inputs (the
git diff and the plan's `Wired-into:` contracts) do not depend on build_review's verdict.
On a wiring-broken HEAD the expensive judged gate is therefore paid for first and the
subsequent wiring kickback rebuilds and re-grades anyway — that grader dispatch bought
nothing.

## Desired outcomes (from intake #879)

1. On a build whose diff has wiring-reachability gaps, the wiring verdict is produced and
   the kickback to `build` happens **without an LLM grader dispatch having been paid for
   that HEAD**.
2. On a wiring-clean build, `build_review` still runs exactly once for that HEAD, and the
   `build → … → manual_test` progression is unchanged.
3. Kickback/re-run semantics after a rebuild are unchanged (both gates re-evaluate the new
   HEAD).
4. The decision is informed by **measured** wiring_check FAIL frequency, not the single
   observed instance.

## Filer's hypothesis (candidate, NOT the chosen approach)

- Swap the order (`wiring_check` before `build_review`).
- Or run them concurrently via the validation-group machinery.

Both were carried into discovery as candidates. See
`.docs/decisions/adr-2026-07-23-cheap-gate-first-wiring-before-build-review.md` for what
DECIDE actually chose, including a root cause the intake did not have.

## Discovery findings (measured, this repo)

Log sweep over `.daemon/daemon.log` + `.daemon/daemon.log.1` (2026-07-21 → 2026-07-23):

| Signal | Count |
| --- | --- |
| `wiring_check` step executions | 57 completed (+3 terminal failures) |
| retries caused by `wiring-reachability gaps found` | 13, across 8 distinct gap signatures |
| retries caused by `wiring-evidence.json is stale` | 22 |
| `build_review` dispatches | 55 (`▶`), 34 completed |
| completed `build_review` wall clock | median **141 s**, mean 142 s, range 69–279 s |
| completed `wiring_check` wall clock | median **118–135 s**, mean 186–243 s, max **1157 s** |

Outcome 4 is satisfied: wiring FAILs are a real, recurring minority (~8 build episodes in
two days), each of which under today's order burned a ~141 s grader dispatch first.

**The measurement also falsified an intake premise.** `wiring_check` is documented as
engine-native ("no skill dispatch" — `step-runners.ts:48-51`) but is NOT in the conductor's
engine-native bypass list (`conductor.ts:3249-3253` covers only `complexity`, `worktree`,
`rebase`). It therefore falls through to `stepRunner.run()` and spawns a real Claude session
on the `/conduct wiring-check` prompt (sonnet / low effort per `resolved-config.ts:42,69`).
The median 118–135 s runtime and 1157 s tail are inconsistent with a git-diff + import-graph
walk and consistent with an LLM session; the 22 stale-evidence retries are explained by that
session moving HEAD after the predicate recorded evidence.

So the gate the intake calls "deterministic, token-free" is token-free only in its
*predicate*. Reordering alone would satisfy outcome 1 only in the narrow letter (no
*grader* dispatch) while leaving a larger unmetered LLM dispatch in front of it.
