# ADR: Stacked slice topology is derived from the sealed plan; the coverage_binding step is removed

**Date:** 2026-10-23
**Status:** APPROVED
**Deciders:** James Stoup (operator; delegated the design calls on 2026-10-23), composer DECIDE session for jstoup111/ai-conductor#3365 (folds #3366)

Amends: adr-2026-08-31-coverage-binding-judge-step (retires decisions D4–D9 and D12–D24; D1–D3, D10 and D11 stand)

## Context

`coverage_binding` was introduced as a pre-BUILD judge (`adr-2026-08-31-coverage-binding-judge-step`).
The operator disabled the judge on 2026-10-06 and #3164 made the step a no-op on 2026-10-10. Since
then its only remaining job is to copy the plan's slice topology into a gitignored cache,
`.pipeline/coverage-binding.json` (the envelope). The topology consists of slice positions,
task-to-slice membership, titles, and story ownership. Every value in it is computed by pure
functions over committed DECIDE artifacts in `plan-slices.ts`: `validatePlanSlices`,
`deriveStoryOwnership`, and `evaluateStackEligibility`.

Stacked features treat that cache as authority. `child-cursor.ts` refuses to resolve the active child
unless the envelope status is `disabled` or `done`, and returns `envelope-missing` when child state
exists. Two ordinary events leave the cache unusable:

- An operator `reseal` that changes a DECIDE artifact voids it to `invalidated` (judge-step ADR D16).
- Recreating a worktree deletes `.pipeline/` entirely.

In both cases the resume stack preflight (`restack/stack-preflight.ts`) maps the refusal to
`unavailable`, and `conductor.ts` returns without writing a HALT. `coverage_binding` would have
rebuilt the cache, but it never runs, so the daemon re-dispatches forever with "loop ended without
DONE or HALT marker" (#3365). The same step's feature-level gate is also what the stacked pre-finish
rebase reopened when it crashed in #3366.

## Options Considered

### Option A: Let the cursor accept an `invalidated` envelope checked against the positions ref
- **Pros:** Smallest change. Fixes the reseal case.
- **Cons:** A recreated worktree or a corrupt cache still strands the feature, and no command can
  recover it (`rewind` refuses an unresolvable cursor). It keeps a dead step alive only to refill a
  cache.

### Option B: Defer child resolution until `coverage_binding` has rebuilt the cache
- **Pros:** Covers reseal and worktree recreation.
- **Cons:** Three entry points (resume preflight, region activation, daemon re-kick) learn a special
  ordering rule, all to keep a no-op step.

### Option C: Remove the step and derive topology from the sealed plan (chosen)
- **Pros:** Removes the failure class: no cache can go stale, voided, or missing. The plan and
  stories are sealed protected artifacts and committed to the branch, so they survive worktree
  recreation. It deletes code instead of adding a special case.
- **Cons:** The diff is large, about fifteen readers plus wiring and tests. Topology is re-derived on
  each read instead of read from a snapshot.

## Decision

1. **The `coverage_binding` lifecycle step and its engine code are removed.** The step leaves the
   step registry, the gate predicate, retries and review defaults, the rebase coverage refresh and
   continuation clamp, the gate-invalidation surface, the code-stamp identity, model policy and the
   generated model table, and the cursor refusal text. The `coverage-binding-envelope`,
   `coverage-binding-void`, and `coverage-binding-decide-set` modules are deleted, and so is the
   step runner. Its event variants (`coverage_binding_*`, `plan_slices_changed`, `story_reowned`)
   leave the `ConductorEvent` union and `EVENT_SINKS`. `skills/coverage-binding/SKILL.md` stays: plan
   authoring §7a still loads it as the plan-time coverage-judge policy. It gets a model-table
   allowlist entry in place of the engine-step row.

2. **One loader derives slice topology from the sealed plan.** A new `slice-topology.ts` exposes one
   loader that reads the feature's plan (`resolveFeaturePlanPath`), its stories
   (`resolvePlanStoriesPath`), and the project configuration. It composes the existing pure
   functions in `plan-slices.ts` and returns a typed result:
   - `unsliced`;
   - `sliced`, with ordered positions, task-to-position membership (engine-appended remediation ids
     excluded, as today), titles, and story ownership;
   - `unavailable`, with a typed cause: `plan-missing`, `plan-invalid`, `positions-changed`,
     `positions-ref-unreadable`, or `git-error` (a failing git invocation while probing durable child
     state or reading the positions ref).

   Story ownership is derived whenever the plan is sliced and its stories resolve. It no longer
   depends on the `stacked_prs` flag. Stack eligibility (flag, tier sign-off, `max_slices`,
   per-child-region custom steps) is a separate verdict of the same loader. It is consulted only
   where children are created. Every former envelope reader uses this loader, and no topology cache
   file is written.

3. **Positions are immutable once children exist, and the check happens at reseal.** When child
   state exists (child branches, closure refs, or `.pipeline/children/`), the loader compares the
   plan's positions with `refs/conductor/<slug>/positions`. A mismatch returns `positions-changed`,
   and an unreadable ref returns `positions-ref-unreadable`. `reseal` applies the same comparison
   before it rebaselines a plan, and refuses a reseal that would move, add, or remove a position. The
   refusal names the recorded and the proposed positions. This replaces the step's
   position-immutability guard. A reseal that leaves positions unchanged proceeds as today, and voids
   nothing.

4. **The child cursor resolves from the loader.** `resolveActiveChild` takes positions from the
   loader instead of the envelope. Its `envelope-missing` kind becomes `topology-unavailable`, and
   that kind carries the loader's cause. With child state present and a `sliced` topology, the
   cursor resolves exactly as before (closure refs, divergence, repair-pending). With no child state
   it returns `no-child` unless the loader is `sliced` and eligible, so flat features are unchanged.

5. **An unresolvable cursor writes its own HALT with a recovery command.** When the resume stack
   preflight cannot resolve the cursor (`topology-unavailable`, `git-error`, or `detached-head`), it
   writes a `needs-human` HALT itself and emits `loop_halt` on the existing event spine. It does this
   the same way its `divergent` branch already halts. The daemon's generic "loop ended without DONE
   or HALT marker" is therefore never the outcome. The HALT names the cause and one recovery
   command:
   - **`plan-missing`, `plan-invalid`, or `positions-changed`:** restore the plan, then run the
     `ai-conductor reseal … --clear-halt` command printed through `describeResealRecovery`.
   - **`positions-ref-unreadable`:** the `git update-ref refs/conductor/<slug>/positions` command that
     re-records the plan's positions.
   - **`detached-head`:** the `git switch` to the active feature branch.
   - **`git-error`:** clear the halt and re-dispatch.

   The preflight's own durable-child-state probe halts the same way when it cannot inspect child
   state, instead of returning `unavailable`.

   Region activation's refusal text carries the same cause and command.

6. **Retired configuration and leftover state still load.** The top-level `coverage_binding` key
   joins `RETIRED_TOP_LEVEL_KEYS`: it is warned about and ignored. `steps.coverage_binding` joins a new
   retired-built-in-step list that is warned about and ignored, instead of being treated as a custom
   step that needs `after`. A leftover `coverage_binding` key in conduct state, a
   `.pipeline/gates/coverage_binding.json` verdict, `.pipeline/coverage-binding.json`, and
   `.pipeline/coverage-binding-code-stamp.json` are never read and never block. Historical
   `events.jsonl` lines carrying removed event types stay plain JSON that no consumer rejects.

7. **N=1 behavior is unchanged apart from the step's absence.** Flat features run the same steps
   minus `coverage_binding`, and write no ref, child state, or new event. The N=1 golden fixtures
   change only by the removed step.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The plan and stories are sealed protected artifacts (`protected-artifact-seal.ts` `PROTECTED_ARTIFACT_DIRECTORIES` lists `.docs/plans` and `.docs/stories`), so in-BUILD changes go through `reseal` and the decision 3 guard sees them. | verified | 95% | yes | An unsealed plan edit could move positions without the reseal guard. The loader's own ref comparison still fails closed. | — |
| A2 | `refs/conductor/<slug>/positions` is written by compare-and-swap at first child creation, and creation is refused if the write fails (`child-lifecycle.ts` startChild). | verified | 95% | yes | Child state could exist without the ref. The loader would then return `positions-ref-unreadable` and halt with the update-ref recovery. | — |
| A3 | No production reader needs the envelope's judge fields (`entries`, digests, `predecessor`). The judge is retired (#3164), and the 2026-10-23 inventory found only topology fields read. | verified | 90% | yes | A missed reader would lose data at build time. Typecheck flags any remaining envelope import. | — |
| A4 | Deriving topology live is equivalent to the snapshot, because the void (judge-step ADR D16) already forced the snapshot to be rebuilt after every DECIDE change. | inferred | 85% | yes | A reader relying on a stale snapshot across an amendment would see the amended plan instead. | APPROVED by operator 2026-10-23 |
| A5 | Re-parsing the plan on each read (including the task-membership commit hook) is cheap enough. The plan parse is in-memory text processing. | inferred | 85% | no | Slower commits or CLI calls, not wrong results. A per-process memo can be added. | — |
| A6 | No other open spec, spec PR, or spec worktree amends the ADRs this decision amends (scan of `.worktrees/engineer-*` and open PRs, 2026-10-23). | verified | 90% | no | Competing amendments would need sequencing before land. | — |

## Consequences

### Positive
- A reseal or a recreated worktree can no longer strand a stacked feature. Both #3365 triggers and
  #3366's reopen trigger are gone.
- One source of truth for slice topology: the sealed, committed plan.
- Less code and fewer lifecycle steps. One fewer gate to reopen, refresh, clamp, or budget.

### Negative
- A large diff across about fifteen readers and about 156 test files.
- Topology is recomputed on each read.
- `rewind --to coverage_binding` and configuration that names the step stop doing anything. They
  warn, and do not fail.

### Follow-up Actions
- [ ] Implement decisions 1–7 under this feature's plan.
- [ ] Add amendment notes to `adr-2026-08-31-coverage-binding-judge-step` (retiring D4–D9 and D12–D24)
      and to the approved ADRs that name the envelope as topology authority.
