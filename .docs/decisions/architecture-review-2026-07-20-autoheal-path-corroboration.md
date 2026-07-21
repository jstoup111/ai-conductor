# Architecture Review: Autoheal path-corroboration bounded dirname pass (#707)

**Date:** 2026-07-20
**Mode:** Lightweight (Medium tier — Feasibility + Alignment + ADR)
**Input reviewed:** explore output + technical intent (#707); ADR
`adr-2026-07-20-bounded-dirname-path-corroboration`; sequence diagram
`.docs/architecture/sequences/task-corroboration.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TS change inside `autoheal.ts`; no new deps/services. Confidence 98% (verified: matcher is `fileMatchesPlanPath`, exact/suffix only). |
| Prerequisites | None. No migration, no config schema change. The change is inside an already-reachable function (`deriveCompletion` at conductor.ts:3219). |
| Integration surface | Single subsystem (build-engine evidence attribution). No new cross-module wiring — judge lane untouched. |
| Data implications | Adds a `trailer-dirname` value to the existing evidence-sidecar stamp form; no schema migration. |
| Performance risk | Negligible — one extra `dirname` comparison per already-iterated commit file. |
| Worktree isolation | No new ports/services/shared state. Unaffected. |

## Alignment

- **Determinism-first (CLAUDE.md design principle):** SATISFIED — the new pass is deterministic
  and runs before any LLM dispatch; the judge is only the last resort.
- **No duplication of in-flight work:** SATISFIED — the judge fallback (approach B) already
  exists/armed and #700 closed its resume-dispatch gap; #707 explicitly does not touch it.
- **#445 non-regression (inheritance false-positive):** SATISFIED BY BOUND — dirname match is
  the immediate parent directory only, never any ancestor/repo-root. This is a load-bearing
  constraint and is captured in the ADR decision + follow-up tests.
- **State/representation:** stamp forms remain an explicit enum-like set
  (`trailer` / `trailer-dirname` / `semantic-verified`); no boolean-flag ambiguity introduced.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Unbounded/ancestor dirname match reopens #445 | Data (correctness) | Low (bounded by design) | High | Bound to immediate parent dir; explicit #445 non-regression test (ADR follow-up) |
| Two tasks sharing an immediate parent dir cross-credited by dirname pass alone | Data | Low | Medium | `Task: N` trailer must still match; judge remains arbiter on ambiguity; negative-path story |
| Behavior change when judge cutover is OFF | Integration | Low | Low | Dirname pass is deterministic and independent of cutover; reject fallback unchanged |

One High-impact risk registered (#445 regression) → review-required marker written.

## Wiring Surface

See the ADR's Wiring Surface section: the change lives inside `fileMatchesPlanPath` /
`filesOverlappingTaskPaths` → `deriveCompletion`, already wired at `conductor.ts:3219`; the
`trailer-dirname` stamp uses the existing sidecar consumer. No new production surface.

## ADRs Created

- `adr-2026-07-20-bounded-dirname-path-corroboration.md` — **APPROVED** (operator-approved
  approach "A only, bounded").

## Conditions

None. Clean APPROVED. The #445 bound is not a post-hoc condition — it is the decision itself.
