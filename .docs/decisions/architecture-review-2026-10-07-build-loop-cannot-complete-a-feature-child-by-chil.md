# Architecture Review: Per-child BUILD region for stacked features (#2942)

**Date:** 2026-10-07
**Stories reviewed:** none yet (pre-stories full review, Tier L). The inputs are the track scope,
the complexity marker, `.docs/architecture/build-loop-cannot-complete-a-feature-child-by-chil.md`,
the explore design and three adversarial reviews.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript engine work and git plumbing (`update-ref` compare-and-swap, `symbolic-ref`, `rev-list`). No new packages or services (verified: every primitive already used in `rebase.ts` / `feature-branch-identity.ts`). |
| Prerequisites | #3019 seams (`child-context.ts`, child-capable `gate-verdicts`/`kickback-ledger`, event `child`) and #3039's `storyOwnership`, `evaluateStackEligibility` and `projectChildOwnership`. All are on main at `d5ca612e4a` (verified). |
| Integration surface | The engine loop, gates, hooks, daemon re-kick, halt records, operator CLIs and the shipped `writing-system-tests` skill. That is far more than three module boundaries, which is why this feature is Large. |
| Data implications | New per-child files under `.pipeline/children/<k>/` (gitignored), new engine refs `refs/conductor/<slug>/closed/c<k>`, new branches `feat/c<k>/<slug>`, and remediation-task child records. With no child, no persisted shape changes. |
| Performance risk | N children run the region N times. The leaf adds one security snapshot. The aggregate suite still runs once. Cost is about 1.6–2× per stacked feature (accepted in the #2940 design §5). |
| Worktree isolation | One worktree per feature switches between child branches. Closure refs live in the shared `.git`, and their names are per-slug, so they cannot collide across features. Self-host live-boundary excludes `.git/` and `.pipeline/` (verified `self-host/live-boundary.ts:73`). |

## Complexity

High. Story-level ratings come with `/stories`. The riskiest areas, in order:
1. The overlay and routed mutation port: every flat reader and writer.
2. The cursor and leaf move: git state the restack ticket must later inherit.
3. The per-child kickback-ledger callers: about ten sites, with atomic receipts.
4. The acceptance gate projection: dispositions, attribution and no-owned-criteria.

## Alignment

- **Governing ADRs reused:**
  - `adr-2026-10-03-stacked-child-plans-identity-and-state` (D1–D15) and
    `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` (D2, D3, D5, D6);
  - `adr-2026-08-01-conduct-state-mutation-port` (region keys route through the port, not ad-hoc
    writes);
  - `adr-2026-08-09-recorded-red-exception-for-remediation` (an already-green child spec);
  - event-spine skill (new variants, not a side file).
- **New structural decision:** `adr-2026-10-07-per-child-build-region`. It covers the cursor and
  closure refs, the branch lifecycle, overlay state, per-child gates and caps, the hook membership
  check, halt-record and rebase guards, and events.
- **Departures recorded as amendments:**
  - umbrella D8–D11 and its halt-record follow-up;
  - acceptance RED D2/D4;
  - rubric container D1;
  - test-suite verification D4/D6;
  - trailer-union 2;
  - cumulative bound D1/D3;
  - livelock bound D1/D4;
  - verdict-aware resume 5;
  - committed halt record 5;
  - finish-mergeability decision 5.
- **Not amended:** `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D2. No `boundTo` or
  Done-when binding exists in engine source (verified by grep), so child-local review is scoped by
  the child-parent base and the plan body stays whole for `Covers:` resolution.
- **Diagram accuracy:** the feature diagram renders (`ai-conductor render-diagrams --check`: 2
  diagrams). The repository has no single maintained component diagram that this changes.
- **Security boundaries:**
  - The commit-hook membership check fails closed on a child branch.
  - Child branches are never pushed: halt records and build-failure escalation refuse a child HEAD.
  - Attribution is still not authority (umbrella D3).
- **Production DI defaults:** all new stores are filesystem or git. Nothing is in memory except the
  stuck-gate map, which is in memory today too.

## Domain Integrity

- `ChildId` stays the only child type. Positions are `ChildId`s, never raw numbers.
- The cursor result is a discriminated union: `no-child | active {child, position, isLeaf} |
  divergent {child} | envelope-missing | detached-head`. Callers switch exhaustively.
- `resolveChildBase` returns a union: `none | parent {sha} | parent-missing | parent-not-ancestor`.
- The acceptance outcome gains `no-owned-criteria` as a typed member, not a boolean.
- The remediation-task child is recorded as a `ChildId` beside the appended id, never a string.

## Wiring Surface

- **`child-cursor.ts`:** `resolveActiveChild`. Callers are the conductor loop at region entry, the
  resume path, `auto-resume`, `halt-clear`, the dashboard and daemon status, recovery CLI defaults,
  `daemon-rekick` and `halt-record`.
- **`child-lifecycle.ts`:** `startChild`, `switchToChild`, `closeChild`, `moveLeaf`. The conductor
  loop calls them at region entry and region exit (the loop tail that returns to
  `acceptance_specs`).
- **`resolveChildBase` (umbrella D11):** consumed by build-review inputs, disposition, full-suite
  selection, autoheal, task seed, amendment claims and acceptance spec attribution in
  `artifacts.ts`.
- **Conduct-state overlay and routed port:**
  - the overlay is read by `selector`, `resume-entry` (or `conductor.ts`), `checkGate`, the
    dashboard and daemon status;
  - region-key writes go through the existing mutation port.
- **`ai-conductor task-membership-check`:** registered in the CLI command table and invoked by the
  commit-msg hook asset in `git-hook-assets.ts`, beside the scope-check shell-out.
- **`kickback-budget raise|reset --child`:** the existing `kickback-budget` CLI parser.
- **New events** `child_started`, `child_closed`, `child_switched`, `rebase_skipped_for_stack` and
  `story_reowned`: declared in `types/events.ts` and `event-sinks.ts`, emitted by
  `child-lifecycle.ts`, `daemon-rekick.ts` and the `coverage_binding` runner.
- **The `stacked_prs.enabled` BUILD consumer:** the cursor's creation path. The config consumer
  registry row is updated from land and `coverage_binding` to also cover BUILD.
- **The position-immutability guard:** the `coverage_binding` runner in `step-runners.ts`, before
  the envelope write.

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over the main surfaces reports only
two stale July spec branches (`spec/daemon-self-host-guardrails`, `spec/self-host-phase6-wiring`).
The material overlap is unbuilt work on main: `decompose-conductor-ts-god-class-target-architectu`
(#1481 feature 1, spec merged in #3049) moves `findResumeIndex`, `resolveRunnableResumeEntry` and
the remediation helpers out of `conductor.ts`. The plan must name stable symbols, not files or
lines, so that BUILD rediscovers them after that move.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A flat reader or writer is missed and writes region state flat while children exist | Data | Medium | High | Overlay and port are the only region accessors. A drift test enumerates `readAllVerdicts`/`readKickbackLedger`/state-port callers. A child-present fixture asserts that no flat region key changes |
| A cursor bug skips an open child or re-runs a closed one | Data | Medium | High | Monotone closure refs. Ancestry divergence halts. Restart and recreate scenario tests |
| N=1 regression on the hottest engine paths | Technical | Medium | High | #3019 golden suite plus new cells for flag-on single-slice and ineligible plans |
| Merge collision with the conductor.ts decomposition build | Integration | High | Medium | Symbol-named tasks. Operator sequencing (see Conditions) |
| Stack goes stale against main until the leaf FINISH rebase (rebase skipped while a non-leaf child is active) | Integration | Medium | Medium | One rebase at the leaf. #2943 restack lifts it. An event records each skip |
| Review laps total N×5 for a stacked feature | Performance | Medium | Medium | Per-child bounds unchanged. Documented in the D9/D3 amendments |
| A commit-hook membership check that fails closed blocks legitimate commits (engine commits, rem tasks) | Technical | Medium | Medium | `CONDUCT_ENGINE_COMMIT` bypass as today. Rem-task child is recorded at append |

## ADRs Created

- `adr-2026-10-07-per-child-build-region`: APPROVED under the operator's delegation of DECIDE
  decisions to this session ("make decisions until the spec is up"). It is flagged for operator
  review on the spec PR.

## Conditions

1. Every task that touches loop or resume code names the symbol it edits (`findResumeIndex`,
   `resolveRunnableResumeEntry`, `selectNextGate`, the stuck-gate map), never a `conductor.ts` line,
   because the decomposition build may move them first.
2. A child-present drift test proves that no region key is written to flat paths. This test lands
   before the overlay and port tasks.
3. The N=1 golden suite stays byte-identical, with the two new cells added before any production
   change.
4. The `writing-system-tests` skill change (per-child stories and paths) lands in the same feature
   as the engine change that reads them.
