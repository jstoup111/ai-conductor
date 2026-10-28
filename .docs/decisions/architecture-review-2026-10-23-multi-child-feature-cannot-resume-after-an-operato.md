# Architecture Review: Remove the coverage_binding step so stacked features resolve their children from the sealed plan

**Date:** 2026-10-23
**Inputs reviewed:** explore output and track marker
(`.docs/track/multi-child-feature-cannot-resume-after-an-operato.md`), complexity assessment (Tier L),
approved architecture diagram (`.docs/architecture/multi-child-feature-cannot-resume-after-an-operato.md`),
intake jstoup111/ai-conductor#3365 (folds #3366), and source traces of the resume preflight, child
cursor, reseal void, stacked restack, and every coverage-binding envelope reader.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** The work uses only existing TypeScript engine modules and no new
  dependency. The topology functions already exist as pure functions in `plan-slices.ts`
  (`validatePlanSlices`, `deriveStoryOwnership`, `evaluateStackEligibility`,
  `customStepsInPerChildRegion`) (verified). Their impure composition is currently inline in
  `runCoverageBinding` (`step-runners.ts`) and moves to the new loader.
- **Prerequisites.** None. The positions ref is already written by compare-and-swap at the first
  child's creation (`child-lifecycle.ts` startChild, verified). `describeResealRecovery`
  (`reseal-cli.ts`, #3372) already prints a safe reseal command (verified).
- **Integration surface.** The work stays inside the engine, but it is wide. About fifteen
  production readers of `.pipeline/coverage-binding.json` move to the loader: child cursor, child
  lifecycle, task progress, task CLI, task-membership commit hook, acceptance evidence, acceptance
  child input, finish publication, routing, dashboard, and observe. Step wiring is removed from the
  registry, gate predicate, rebase refresh and clamp, gate invalidation, code-stamp identity,
  defaults, model policy, and event sinks. That crosses more than three modules, but each change is
  a mechanical re-source or a removal.
- **Data implications.** No schema migration. Persisted leftovers are a `coverage_binding` key in
  conduct state, its gate verdict file, the envelope, and the code-stamp sidecar. They become
  unread. `readState` only rejects a `retro` key, and the selector walks the registry, so a leftover
  key is ignored (verified for state, inferred for the verdict file). Top-level config keys are
  strict (`config.ts`), so `coverage_binding` must join `RETIRED_TOP_LEVEL_KEYS`.
  `steps.coverage_binding` would otherwise be read as a custom step that needs `after`, so it needs
  a new retired-built-in-step ignore path (verified).
- **Performance.** The loader re-parses the plan and stories on each read, including the
  task-membership commit hook. That is in-memory text processing over files of a few hundred lines
  (inferred, 85%, not load-bearing for correctness).
- **Worktree isolation.** No new ports, services, or shared state. The loader reads only committed
  files in the feature worktree plus the shared git ref store the positions ref already lives in.

## Complexity

High, because one step's removal is wide, but there are no unknowns: every change is either a
re-source onto existing pure functions or a deletion. The estimated plan is 18–22 tasks, under the
30-task land ceiling. **Split decision (§3a):** the operator delegated design calls on 2026-10-23,
and this review keeps it as one spec. Splitting would ship a loader with no production caller in
one spec and the step removal in another, which leaves an unreachable primitive or a dead step for
a release. No skill directory is deleted, because `skills/coverage-binding/` stays as the plan §7a
judge policy, so the repository's two-feature deletion rule does not apply.

## Alignment

- **Governing ADRs.** `adr-2026-08-31-coverage-binding-judge-step` is amended: its step decisions
  D4–D9 and D12–D24 are retired, and its land-time criterion decisions D1–D3, D10, and D11 stand.
  The judge was retired by #3164, and its D16 void is the #3365 trigger. The approved ADRs that name
  the envelope as topology authority get amendment notes, committed as `spec: amend …` before land:
  - `adr-2026-10-07-per-child-build-region` decisions 1, 2, 4, 5, 13;
  - `adr-2026-10-03-stacked-child-plans-identity-and-state` decisions 5, 7, 8;
  - `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` decisions 5, 6, 7;
  - `adr-2026-09-29-plan-slice-manifest` decisions 2, 5, 6, 7.

  `adr-2026-09-11-selective-post-rebase-verification` names `coverage_binding` only as context.
  Its D4 decision stays valid with one fewer gate, so it is cited, not amended. A scan of spec
  worktrees and open PRs on 2026-10-23 found no competing amendment to any of these ADRs.
- **Pattern consistency.**
  - The loader follows the existing split between pure `plan-slices.ts` predicates and impure
    callers, the same split `land-spec.ts` uses. The plan-slices consumer-boundary test changes its
    allowlist from `runCoverageBinding` to `slice-topology.ts`.
  - Retiring config keys follows the `RETIRED_TOP_LEVEL_KEYS` precedent (#3122).
  - The preflight HALT follows its own `divergent` branch (`haltRestack`), and the recovery text
    reuses `describeResealRecovery`.
- **State management.** The loader's result is a discriminated union (`unsliced` | `sliced` |
  `unavailable{cause}`) with a closed cause set, and the cursor's `envelope-missing` kind becomes
  `topology-unavailable` carrying it. Both are exhaustively matched, with no boolean flags. Stack
  eligibility is split from ownership. That removes today's
  `storyOwnership !== undefined`-as-eligibility proxy, an implicit encoding.
- **Event spine.** No new channel. Removed event variants leave the union and `EVENT_SINKS`
  together, and the HALT emits the existing `loop_halt`.
- **Diagram accuracy.** The approved diagram shows the loader, its readers, the reseal guard, the
  preflight HALT, and the removed nodes. The project-level step docs (`docs/reference/steps.md`) and
  `ARCHITECTURE.md` drop the step as part of the plan.
- **Security boundaries.** No new input surface. `reseal` gains a refusal, not a capability.
- **Production DI defaults.** No in-memory default is introduced. The loader reads the filesystem
  and git.

**Focused local pattern basis.** For the retired-built-in-step ignore path, the role is to keep a
removed built-in step name in an in-flight feature's committed config from failing validation.
- **Traits to keep:** warn once, delete the key before validation, and never treat it as a custom
  step.
- **Precedent:** `RETIRED_TOP_LEVEL_KEYS` in `config.ts` (stable symbol), which handles the same
  problem one level up.
- **Allowed variation:** a parallel map keyed by step name under `steps`.
- **Verified no-fit:** `retro`'s current loud failure (`config.ts`, the retired `retro` step-name
  branch) is the wrong pattern here. It halts in-flight features.

## Domain Integrity

- The loader's cause is a closed union, so no catch-all default is needed.
- Positions stay a `ChildId` (`parseChildId`) and do not become raw integers.
- The reseal guard parses both position sets once, at the boundary, and compares typed values.
- No primitive obsession is introduced. The slug passed to the loader is the existing feature-slug
  string the cursor already takes.

## Wiring Surface

| New or changed production surface | Production caller |
|---|---|
| `slice-topology.ts` loader | Called by `resolveActiveChild` and `resolveSealedLeaf`/`resolveSealedFirst` (child cursor), child-lifecycle start and region entry, `resolveChildTaskScope` (task progress), the task CLI and task-membership commit hook, acceptance evidence grounding and acceptance child input (artifacts, step runners), finish publication, conductor routing, the daemon dashboard, and daemon observe. Each replaces its current `readCoverageBindingEnvelope` call. |
| Cursor kind `topology-unavailable` | Consumed by the resume stack preflight, region activation's refusal text, `rewind`'s refusal message, and the kickback-budget CLI. These are the same call sites that receive `envelope-missing` today. |
| Preflight HALT with recovery command | Written inside `runStackPreflight`'s unresolvable branch. Every existing preflight caller (conductor resume and daemon re-kick) therefore inherits it. |
| Reseal position guard | Runs inside the existing `reseal` CLI command, before it rebaselines a plan path. |
| Retired config keys | Run inside the existing `loadConfig` validation path. |

The advisory overlap scan over these paths (2026-10-23) reported only stale legacy spec branches,
none of them in flight. Open PR #3373 also edits `conductor.ts`, a textual merge-conflict risk
only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A missed envelope reader keeps reading a file nothing writes, and silently treats a stacked feature as flat | Technical | Medium | High | Delete the envelope module so any remaining import fails typecheck. Add a stacked-feature test per reader class. |
| An in-flight feature branch cut before this change carries `steps.coverage_binding` or `coverage_binding:` config and halts at config validation | Integration | High | High | Decision 6's retired-key ignore paths, with tests that load such a config. |
| Live re-derivation picks up a plan amendment that the snapshot would have hidden until the step re-ran | Technical | Low | Medium | Plan and stories are sealed, so changes go through `reseal`. Position moves are refused there, and the loader re-checks against the positions ref (ADR A1, A4). |
| N=1 golden fixtures drift for reasons other than the removed step | Technical | Medium | Medium | The plan regenerates goldens only by removing the step's lines and asserts no other diff. |
| Removing the rebase coverage refresh changes the rebase continuation for flat features | Technical | Low | High | Keep `selective-post-rebase-verification` D4's decision shape, with a regression test that a flat feature's post-rebase continuation is otherwise unchanged. |
| About 156 test files change and the diff is hard to review | Knowledge | High | Medium | Plan tasks group test updates by directory and keep production removals separate from fixture churn. |

## ADRs Created

- `adr-2026-10-23-slice-topology-from-sealed-plan`: **APPROVED** under the operator's 2026-10-23
  delegation. It amends `adr-2026-08-31-coverage-binding-judge-step`, retiring that ADR's step
  decisions.

## Conditions

1. The plan's Architecture Obligation Coverage table carries a row for every decision of the new ADR
   and of each amended ADR listed under Alignment.
2. Each removed production module is deleted in the same task that re-sources its last reader, so no
   intermediate commit leaves an unreachable loader or a dead reader.
3. The N=1 golden fixtures change only by the removed `coverage_binding` lines.
4. A stacked-feature test covers both #3365 triggers end to end: an operator reseal that changes a
   DECIDE artifact, and a worktree whose `.pipeline/` was removed. Each resumes the active child with
   no manual state edit.
5. `skills/plan/SKILL.md` §7a's statement that "the engine's `coverage_binding` step is a no-op" is
   updated to say the step no longer exists. Its use of `skills/coverage-binding/SKILL.md` as the
   judge policy is unchanged, and the model-table presence check gains an allowlist entry for that
   skill.
