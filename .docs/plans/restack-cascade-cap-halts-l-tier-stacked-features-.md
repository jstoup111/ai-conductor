# Implementation Plan: Restack cascade cap is sized by the feature's complexity tier

**Date:** 2026-10-28
**Design:** .docs/decisions/architecture-review-2026-10-28-restack-cascade-cap-halts-l-tier-stacked-features-.md
**Stories:** .docs/stories/restack-cascade-cap-halts-l-tier-stacked-features-.md
**Conflict check:** Clean as of 2026-10-28 (.docs/conflicts/2026-10-28-restack-cascade-cap-halts-l-tier-stacked-features-.md)

## Summary

Resolve each originating child's restack cascade allowance from (config, feature tier), with
defaults S 3 / M 3 / L 8 and no tier → M. A new key, `stacked_prs.max_restack_cascades`, takes an
integer or an S/M/L map. `runRestack` enforces the resolved allowance, and an operator raise in the
`cascades` ref keeps precedence. The raise/reset CLI measures against the same allowance. The halt,
`kickback-budget inspect` and `daemon status` name the tier, allowance and source, and show each
child's consumed/limit before exhaustion.

## Technical Approach

- **Config (`src/conductor/src/engine/config.ts`, `src/conductor/src/types/config.ts`).**
  - `stacked_prs.max_restack_cascades` joins `CONFIG_CONSUMER_KEY_SETS.stacked_prs`.
  - `validateStackedPrsBlock` validates it with the existing `validateRemediationLapCap(raw, path)`.
    That helper already enforces "a positive integer or a map of S, M, L to positive integers" with
    path-named errors.
  - The `stacked_prs` default materialization is untouched, so the key stays absent when no layer
    sets it. `mergeConfigs` merges maps per tier, and an integer replaces a map.
- **Resolver (new `src/conductor/src/engine/restack/cascade-allowance.ts`).** It follows
  `resolveRemediationLapAllowance` in `remediation-caps.ts`.
  - `RESTACK_CASCADE_TIER_DEFAULTS = { S: 3, M: 3, L: 8 }`.
  - `resolveRestackCascadeAllowance(config, tier)` returns `{ limit, tier, source }`. `source` is
    `configured` for an integer or a map entry for the tier, else `default`. An undefined tier
    resolves as M, with `tier` left undefined.
  - `resolveCascadeAllowanceForWorktree(worktree)` loads config from the main checkout:
    `loadConfig(await resolveMainRepoRoot(worktree))`, using `{}` when that is not ok. The default
    child executor hands the conductor this same config (`loadConfig(projectRoot)`), and #3456 and
    #3502 move the read-only budget surfaces to it. Because every cascade surface calls this one
    helper, a feature branch's stale config can never split enforcement from display. It reads
    `complexity_tier` from the feature worktree's feature-wide `.pipeline/conduct-state.json` with
    `readState`, treating an unreadable file as no tier, then resolves.
  - `formatCascadeAllowance(allowance)` renders `tier <T> allowance <l> (<source>)`, or
    `tier unrecorded, treated as M; allowance <l> (<source>)`. This is the #2413 phrase shape.
  - `renderCascadeSummary(counts, allowance)` returns the inspect lines, the status fragment and
    the JSON object for every child in `counts ∪ limits`. A child's limit is `limits[k]` when present
    (`raised: true`), else the allowance.
  - It imports only `types/`, `config.ts`, `state.ts`, `park-marker.ts` (`resolveMainRepoRoot`, which imports only Node built-ins) and `cascade-cap.ts` types.
- **Cap reader (`src/conductor/src/engine/restack/cascade-cap.ts`).**
  - `MAX_RESTACK_CASCADES_PER_CHILD` is deleted.
  - `checkCascadeCap(worktree, slug, originating, defaultLimit, deps)` and
    `applyCascadeAdjustment(worktree, slug, adjustment, defaultLimit, deps)` take the default limit
    as a required argument.
  - An `exhausted` result also carries `raised: boolean`, true when the limit came from
    `limits[k]`.
  - The unreadable-ref fail-closed result keeps count = limit = `defaultLimit`.
- **Enforcement (`src/conductor/src/engine/restack/restack-executor.ts`).**
  - The `feature-repair` branch resolves the allowance for `options.worktree` and passes
    `allowance.limit` to `checkCascadeCap`.
  - It records cap evidence with the returned limit, as today.
  - The halt detail becomes `originating child <k> reached <n>/<l> cascades — <formatCascadeAllowance>`,
    plus `; raised to <l>` when `raised`, then the existing budget block.
- **Stack preflight (`src/conductor/src/engine/restack/stack-preflight.ts`).** Its per-child
  `checkCascadeCap` loop discards its result, so it is deleted. `runRestack` stays the single
  enforcement site, and the preflight's cap-refusal path through `runRestack` is unchanged.
- **Recovery and inspect (`src/conductor/src/engine/kickback-budget-cli.ts`).**
  - `defaultsFor` sets `limits.restack` to the resolved allowance.
  - The restack `currentLimit` becomes `limits[k] ?? allowance.limit`.
  - Both `applyRestackCascadeAdjustment` calls (mutation and crash reconciliation) pass
    `allowance.limit` to `applyCascadeAdjustment`. This keeps halt, stage and ref compare-and-swap on
    one resolution.
  - Inspect appends the cascade summary for a feature with a child view. An unreadable ref renders
    `Restack cascades: unavailable (<detail>)` and makes inspect exit 1, following adr-2026-08-31
    decision 3.
- **Status (`src/conductor/src/engine/daemon-observe-cli.ts`).** `renderPlanGrowthSection` prints
  `RESTACK CASCADES [<slug>]: …` from the same summary for features with an active child view.
- **Builds on #3475.** After #3475, the restack ledger entry stores no limit, and the budget view and
  evidence agreement read the originating child's limit from the cap evidence. This plan changes only
  the default those reads and the `cascades` compare-and-swap fall back to. It does not edit
  `kickback-ledger.ts` or the restack branch of `kickbackBudgetView`.

**Local pattern basis.**
- Tier-keyed resolver: follow `resolveRemediationLapAllowance` / `REMEDIATION_LAP_TIER_DEFAULTS`
  (`remediation-caps.ts`). Preserve the `{ limit, tier, source }` shape, integer-for-every-tier,
  and unrecorded → M rendered as unrecorded. Allowed variation: the table values and the per-child
  `raised` flag.
- Config validation: follow `validateStackedPrsBlock` and reuse `validateRemediationLapCap`
  (`config.ts`). Preserve a typed path-named `ConfigError` and refusal at load, never a clamp.
- Budget surfaces: follow the #2413 ` — tier <T> allowance <l> (<source>)` phrase and the
  `KICKBACK BUDGET [<slug>]` status line shape (`kickback-budget-view.ts`, `daemon-observe-cli.ts`).
  Preserve one shared formatter for the halt, inspect and status.

## Prerequisites

- jstoup111/ai-conductor#3475 merged (restack limit per originating child; recorded as a land
  dependency).
- `ConductState.complexity_tier` exists in the feature-wide conduct state. The daemon seeds it from
  the backlog tier, and stacked delivery requires tier M or L.

## Tasks

### Task 1: Config accepts stacked_prs.max_restack_cascades as an integer or an S/M/L map
**Story:** Story 2 (negative paths 1–5)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement in `config.ts`. Add `max_restack_cascades` to `CONFIG_CONSUMER_KEY_SETS.stacked_prs`, and validate it in `validateStackedPrsBlock` by calling `validateRemediationLapCap(obj.max_restack_cascades, 'stacked_prs.max_restack_cascades')`. Do not add the key to the `stacked_prs` default materialization. In `types/config.ts`, add `max_restack_cascades?: number | Partial<Record<'S' | 'M' | 'L', number>>` to `StackedPrsConfig`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] validateConfig accepts a project config with `stacked_prs.max_restack_cascades` set to `5`, to `{}` and to `{ L: 10 }`, as asserted in config.test.ts.
- [test] loading `stacked_prs.max_restack_cascades: 0` fails with a ConfigError naming `stacked_prs.max_restack_cascades` and stating it must be a positive integer or a map of S, M, L to positive integers, and loading `"8"` fails with a ConfigError naming `stacked_prs.max_restack_cascades` with no coercion to a number.
- [test] loading `stacked_prs.max_restack_cascades: { XL: 9 }` fails with a ConfigError naming `stacked_prs.max_restack_cascades.XL` as an unknown tier, and `{ L: 7.5 }` fails with a ConfigError naming `stacked_prs.max_restack_cascades.L` and stating it must be a positive integer.
- [test] validateConfig on a project config whose `stacked_prs` block sets `enabled: true` and `max_slices: 5` leaves the resolved `stacked_prs` block with `enabled`, `max_slices` and `route_whole_feature_fixes` present and no `max_restack_cascades` key.

**Files likely touched:**
- src/conductor/src/engine/config.ts — allowed key and validation
- src/conductor/src/types/config.ts — `StackedPrsConfig.max_restack_cascades`
- src/conductor/test/engine/config.test.ts — validation and materialization tests

**Dependencies:** none

### Task 2: One tier-aware cascade allowance resolver
**Story:** Story 2 (happy paths 1–4, negative path 1), Story 1 Done When
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/cascade-allowance.test.ts` for every Done-when check below. The worktree-helper case uses a real git repo with a linked worktree, and different `.ai-conductor/config.yml` files in the main checkout and the worktree. The load-path case writes a temp user config through `AI_CONDUCTOR_USER_CONFIG_DIR`, as `remediation-caps.test.ts` does, and a temp project config, and calls `loadConfig`.
2. Verify RED.
3. Implement `src/conductor/src/engine/restack/cascade-allowance.ts` as the Technical Approach describes, following `resolveRemediationLapAllowance` (same result shape, integer applies to every tier, unrecorded → M kept visible as unrecorded). Add the `stacked_prs.max_restack_cascades` entry to `src/conductor/test/engine/config-consumer-registry.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] resolveRestackCascadeAllowance(config, tier) returns limit 3 for tier S, 3 for tier M, 8 for tier L and 3 for an undefined tier when no `stacked_prs.max_restack_cascades` is set, each with source `default`, as asserted in cascade-allowance.test.ts.
- [test] resolveRestackCascadeAllowance yields 5 with source `configured` for S, M, L and an undefined tier under the integer `5`, and under `{ L: 10 }` yields 10 `configured` for tier L and 3 `default` for tier S, tier M and an undefined tier.
- [test] through loadConfig with a temp user config and a temp project config, user `{ M: 2 }` plus project `{ L: 6 }` resolves S 3, M 2, L 6; user `{ L: 6 }` plus project `4` resolves 4 for every tier; and with a project `stacked_prs` block of `enabled: true` and `max_slices: 5` and no key at either layer, the loaded `stacked_prs` block has no `max_restack_cascades` key and tier L resolves 8, never 3.
- [test] resolveCascadeAllowanceForWorktree on a linked worktree resolves 8 when its `.pipeline/conduct-state.json` records tier L and 3 with tier undefined for a missing state file, uses the main checkout's `{ L: 6 }` (6) over the worktree's own `{ L: 9 }`, and formatCascadeAllowance renders `tier L allowance 8 (default)`, `tier M allowance 4 (configured)` and `tier unrecorded, treated as M; allowance 3 (default)`.
- config-consumer-registry.ts declares `stacked_prs.max_restack_cascades` with consumer `src/conductor/src/engine/restack/cascade-allowance.ts`, and config-consumer-registry.test.ts passes.

**Files likely touched:**
- src/conductor/src/engine/restack/cascade-allowance.ts — new resolver, worktree helper, formatter, summary
- src/conductor/test/engine/restack/cascade-allowance.test.ts — resolver, load-path and formatter tests
- src/conductor/test/engine/config-consumer-registry.ts — consumer entry

**Dependencies:** Task 1

### Task 3: The cascade reader takes its default limit from the caller
**Story:** Story 1 Done When
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/cascade-cap.test.ts` for the `checkCascadeCap` checks below.
2. Verify RED.
3. In `cascade-cap.ts`, delete `MAX_RESTACK_CASCADES_PER_CHILD`. Make `defaultLimit` a required parameter of `checkCascadeCap` (after `originatingChildren`) and of `applyCascadeAdjustment` (no default value). Add `raised: boolean` to the `exhausted` result. Until Tasks 4 and 6 wire the resolver, pass each existing caller `RESTACK_CASCADE_TIER_DEFAULTS.M` so the build stays green. In `stack-preflight.ts`, delete the per-child `checkCascadeCap` loop and its import; per `/code-removal`, the surviving behavior is the cap refusal raised inside `runRestack`. In `routed-exit.realgit.test.ts`, replace the deleted constant with `RESTACK_CASCADE_TIER_DEFAULTS.M`. The direct `checkCascadeCap` calls in `cascade-cap.test.ts` and `cascade-cap.sweepG3.realgit.test.ts` pass an explicit default limit of 3.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] checkCascadeCap with defaultLimit 8 returns `clear` for child 1 with 7 charged and no limits entry, `exhausted` with child 1, count 8, limit 8 and raised false at 8 charged, and `exhausted` with limit 5 and raised true when child 1's limits entry is 5 at 5 charged, as asserted in cascade-cap.test.ts.
- [test] checkCascadeCap with defaultLimit 8 over origins 1 and 2, with child 1 at 8 and child 2 at 0, returns `exhausted` naming child 1; for a malformed `cascades` blob it returns `exhausted` with count 8, limit 8 and a detail naming `refs/conductor/demo/cascades`.
- A search of src/conductor/src and src/conductor/test for `MAX_RESTACK_CASCADES_PER_CHILD` returns no match, `stack-preflight.ts` contains no `checkCascadeCap` reference, and both `npm run typecheck` and `npm run typecheck:test` in src/conductor pass (the latter covers the direct test callers in cascade-cap.test.ts and cascade-cap.sweepG3.realgit.test.ts).
- The existing stack-preflight.sweepG4.realgit.test.ts cascade-cap case still records `restack_refused` reasons `cascade-cap` then `deferred-base-refresh`, through the refusal raised inside runRestack.

**Files likely touched:**
- src/conductor/src/engine/restack/cascade-cap.ts — required default limit, `raised`, constant removed
- src/conductor/src/engine/restack/stack-preflight.ts — discarded cap loop removed
- src/conductor/src/engine/restack/restack-executor.ts — interim default argument
- src/conductor/src/engine/kickback-budget-cli.ts — interim default argument
- src/conductor/test/engine/restack/cascade-cap.test.ts — reader tests
- src/conductor/test/engine/routing/routed-exit.realgit.test.ts — constant replaced
- src/conductor/test/engine/restack/cascade-cap.sweepG3.realgit.test.ts — explicit default limit at the direct call

**Dependencies:** Task 2

### Task 4: runRestack enforces the tier-resolved cascade allowance
**Story:** Story 1 (happy paths 1–3, negative paths 1–7), Story 2 (happy path 5)
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/cascade-cap.test.ts` for every Done-when check below. Each fixture records its tier in the worktree's `.pipeline/conduct-state.json` (or omits it), and writes its project config under the main checkout's `.ai-conductor/config.yml`.
2. Verify RED.
3. In the `feature-repair` branch of `runRestack` (`restack-executor.ts`), call `resolveCascadeAllowanceForWorktree(options.worktree)` and pass `allowance.limit` to `checkCascadeCap`, replacing Task 3's interim default. Keep the cap check before the journal, and keep the cap evidence recorded with the returned limit.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] runRestack with cause `feature-repair` on an unconfigured feature recorded at tier L, whose child 1 is charged 7 with no limits entry, writes no HALT, creates the restack journal, and leaves child 1's count at 8 in the `cascades` ref after `applied`; with child 1 charged 3 it likewise writes no HALT, creates the restack journal, and leaves child 1's count at 4 after `applied`, as asserted in cascade-cap.test.ts.
- [test] the same unconfigured tier-L feature with child 1 charged 8 halts with HALT.class `needs-human`, emits `restack_refused` with reason `cascade-cap` and child 1, creates no restack journal ref, and leaves child 1's count at 8; with origins 1 and 2 and child 2 at 0 it halts naming child 1 and leaves both counts unchanged.
- [test] with child 1 charged 3, an unconfigured feature recorded at tier M, one at tier S and one with no recorded tier each halt with HALT.class `needs-human` and reason `cascade-cap` naming child 1 and create no journal ref, while an unconfigured tier-M feature with child 2 charged 2 proceeds and child 2's count becomes 3.
- [test] a tier-L feature with project config `stacked_prs.max_restack_cascades: { L: 10 }` proceeds with child 1 charged 9 and halts with reason `cascade-cap` at 10; and an unconfigured tier-L feature with a malformed `cascades` blob halts `needs-human` with reason `cascade-cap`, a detail naming `refs/conductor/demo/cascades`, and no journal ref.
- [test] runRestack with cause `base-refresh` on an unconfigured tier-M feature whose child 1 is charged 3 writes no cascade-cap HALT and leaves child 1's count at 3.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-executor.ts — allowance resolution at the cap check
- src/conductor/test/engine/restack/cascade-cap.test.ts — tier fixtures through runRestack

**Dependencies:** Task 3

### Task 5: The cascade-cap halt names the tier, allowance and source
**Story:** Story 4 (happy paths 1–3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/cascade-cap.test.ts` for every Done-when check below, reading the written `.pipeline/HALT`.
2. Verify RED.
3. In `runRestack`'s cap halt, build the detail as `originating child <k> reached <n>/<l> cascades — ${formatCascadeAllowance(allowance)}`. Append `; raised to <l>` when the result is `raised`, then the existing runbook line, budget block and halt generation. An unreadable-ref detail keeps its ref diagnostic.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] an unconfigured tier-L runRestack cap halt for child 1 at 8 charged writes a HALT whose detail contains `originating child 1 reached 8/8 cascades — tier L allowance 8 (default)` and `Kickback budget (restack): 8/8 consumed; 0 remaining`, as asserted in cascade-cap.test.ts.
- [test] an unconfigured tier-L cap halt for child 1 whose limits entry is 10, at 10 charged, writes a HALT whose detail contains `originating child 1 reached 10/10 cascades — tier L allowance 8 (default); raised to 10`.
- [test] a tier-M cap halt under `stacked_prs.max_restack_cascades: { M: 4 }` for child 2 at 4 charged contains `originating child 2 reached 4/4 cascades — tier M allowance 4 (configured)`, and an unconfigured no-tier cap halt for child 1 at 3 contains `tier unrecorded, treated as M; allowance 3 (default)`.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-executor.ts — halt detail
- src/conductor/test/engine/restack/cascade-cap.test.ts — halt text tests

**Dependencies:** Task 4

### Task 6: Restack raise, reset and reconciliation measure against the tier allowance
**Story:** Story 3 (happy paths 1–4, negative paths 1–3)
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/kickback-budget-restack.test.ts` for every Done-when check below. Each starts from a real `runRestack` cascade-cap halt, as the existing raise and reset cases do.
2. Verify RED.
3. In `kickback-budget-cli.ts`, resolve the allowance with `resolveCascadeAllowanceForWorktree(worktree)`, and use it for `defaultsFor`'s `restack` limit, the restack `currentLimit` (`limits[k] ?? allowance.limit`), and the `defaultLimit` passed to `applyCascadeAdjustment` from both `applyRestackCascadeAdjustment` call paths (mutation and `reconcilePendingAdjustments`). This replaces Task 3's interim default.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] after a real cascade-cap halt on an unconfigured tier-L feature for child 1 at 8/8, `kickback-budget raise --gate restack --child 1 --by 2` exits 0, appends `kickback_budget_adjustment_authorized` with beforeLimit 8 and afterLimit 10, and sets the `cascades` ref limits entry for child 1 to 10, as asserted in kickback-budget-restack.test.ts.
- [test] after that raise and a halt clear, runRestack with child 1 charged 8 proceeds with no cascade-cap HALT and, once child 1 reaches 10, halts with a detail containing `originating child 1 reached 10/10 cascades`; separately, an unconfigured tier-L runRestack whose limits entry for child 1 is 5 halts with reason `cascade-cap` at 5/5.
- [test] after a real cascade-cap halt on an unconfigured tier-M feature for child 2 at 3/3, `kickback-budget reset --gate restack --child 2` exits 0, appends an authorized adjustment with beforeLimit 3, and sets child 2's count in the `cascades` ref to 0.
- [test] raising child 1 by 2 on a halted tier-L feature whose `cascades` ref holds limits entry 5 for child 2 exits 0, records beforeLimit 8 for child 1 and leaves child 2's limits entry at 5; and after a tier-M halt at 3/3 followed by a project config edit to `{ M: 4 }`, the raise exits 1 printing `current cap evidence is missing or no longer matches the live halt`, leaves the `cascades` ref blob unchanged, and installs no resume authorization.
- [test] with a raise staged and its `kickback_budget_adjustment_authorized` event appended but the `cascades` ref not yet updated, re-running `kickback-budget inspect` reconciles it against the tier-resolved default and updates that child's limits entry once; a second re-run leaves the ref blob unchanged.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — allowance for defaults, currentLimit and both ref compare-and-swap paths
- src/conductor/test/engine/kickback-budget-restack.test.ts — raise, reset, precedence, isolation, stale and reconcile tests

**Dependencies:** Task 4

### Task 7: kickback-budget inspect shows each originating child's cascades and the allowance
**Story:** Story 4 (happy paths 4–5 and 7, negative paths 1–4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts` for every Done-when check below.
2. Verify RED.
3. In the inspect handler, when a child view is selected, read `readCascadeCounts(worktree, command.feature)` and the allowance. Append `renderCascadeSummary` to the human output. Add `restackCascades` to the JSON, or `{ unavailable: <detail> }` for an unreadable ref; that case renders `Restack cascades: unavailable (<detail>)` and makes inspect exit 1. Leave the output for a feature with no child view unchanged.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `kickback-budget inspect --feature <slug>` on a non-halted unconfigured tier-L stacked feature whose `cascades` ref charges child 1 with 4 and child 2 with 3 prints `Restack cascades — tier L allowance 8 (default)` followed by `child 1: 4/8 consumed; 4 remaining` and `child 2: 3/8 consumed; 5 remaining`, as asserted in test/cli/kickback-budget.test.ts.
- [test] the same inspect with `--format json` carries `restackCascades` equal to `{ tier: 'L', allowance: 8, source: 'default', children: [{ child: 1, consumed: 4, limit: 8, remaining: 4, raised: false }, { child: 2, consumed: 3, limit: 8, remaining: 5, raised: false }] }`.
- [test] inspect prints `child 2: 3/10 consumed; 7 remaining (raised)` for a tier-L stacked feature whose child 2 has limits entry 10 and 3 charged, prints `Restack cascades — tier L allowance 8 (default)` followed by `none charged` when no `cascades` ref exists, and prints `Restack cascades — tier unrecorded, treated as M; allowance 3 (default)` with JSON `tier` null for a stacked feature with no recorded tier.
- [test] inspect on a stacked feature with a malformed `cascades` blob prints a line starting `Restack cascades: unavailable (` followed by the ref diagnostic, still prints its other gate budget blocks, and exits 1.
- [test] inspect on a feature with no child state prints no `Restack cascades` line, its JSON carries no `restackCascades` key, and its human and JSON output equal the expected pre-change output for the same ledger.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — inspect cascade summary
- src/conductor/test/cli/kickback-budget.test.ts — inspect human and JSON tests

**Dependencies:** Task 3

### Task 8: daemon status shows the same cascade summary as inspect
**Story:** Story 4 (happy paths 6–7, negative paths 1, 3 and 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-status.test.ts` for every Done-when check below, through `runDaemonStatus`.
2. Verify RED.
3. In `renderPlanGrowthSection` (`daemon-observe-cli.ts`), for a feature with an active child view, read `readCascadeCounts` and `resolveCascadeAllowanceForWorktree(featureRoot)`. Print `  RESTACK CASCADES [<slug>]: <status fragment from renderCascadeSummary>`, or `unavailable (<detail>)` for an unreadable ref, and continue to the next feature.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `daemon status` on a repository with an in-progress unconfigured tier-L stacked feature whose `cascades` ref charges child 1 with 4 and child 2 with 3 prints `RESTACK CASCADES [<slug>]: tier L allowance 8 (default); child 1 4/8, child 2 3/8`, as asserted in stacked-status.test.ts.
- [test] the status line contains `child 2 3/10 (raised)` when child 2 has limits entry 10 and 3 charged, and reads `RESTACK CASCADES [<slug>]: tier L allowance 8 (default); none charged` when no `cascades` ref exists.
- [test] a stacked feature with a malformed `cascades` blob prints a line starting `RESTACK CASCADES [<slug>]: unavailable (` followed by the diagnostic, and the following feature's status lines are still printed.
- [test] `daemon status` for a feature with no child state prints no `RESTACK CASCADES` line.
- The status fragment and the inspect block both come from renderCascadeSummary in cascade-allowance.ts, and neither `daemon-observe-cli.ts` nor `kickback-budget-cli.ts` builds its own tier label string.

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts — status line
- src/conductor/test/engine/stacked-status.test.ts — status tests

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 ─┬→ Task 4 ─┬→ Task 5
                          │          └→ Task 6
                          └→ Task 7 → Task 8
```

## Integration Points

- After Task 4: an unconfigured tier-L stacked feature runs its 4th–8th repair restack on one child without halting, and halts on the 9th.
- After Task 6: a real cascade-cap halt is raised and reset against the tier allowance end to end.
- After Task 8: the halt, `kickback-budget inspect` and `daemon status` agree for one feature.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Only stacked features restack; the cap applies inside `runRestack`, which N=1 never reaches. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | What moves and how ranges are computed is untouched; only the cap's default limit changes. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | no-change | none | Off-worktree replay and path-ownership acceptance are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | no-change | none | The journal and its ref transactions are untouched; the cap is still checked before the journal exists. |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | The atomic move and worktree sync are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | no-change | none | Conflict hand-off to the resolver is untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The preflight's ordered stages (journal recovery, halt-record supersede, automatic repair) are unchanged; the deleted per-child pre-check discarded its result and is not one of them. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | no-change | none | Verdict transitions for the active child and the whole feature are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | Restack triggers and both causes are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | task | task-4, task-6 | with child 1 charged 8 halts with HALT.class `needs-human`, emits `restack_refused` with reason `cascade-cap` and child 1, creates no restack journal ref |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | Force-push leases are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | no-change | none | No new event; `restack_refused` reason `cascade-cap` and `kickback_budget_adjustment_authorized` keep their shapes. |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | The N=1 golden suite is untouched, and no flat-region accessor counted by child-region-access-audit is added. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
