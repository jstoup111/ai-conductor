# Implementation Plan: daemon-build-start-base-refresh

Stem: daemon-build-start-base-refresh
Track: technical
Tier: M

## Goal

Add a deterministic, engine-native, daemon-gated `base_refresh` step to the conductor
pipeline that runs `git fetch origin` + rebase of the feature worktree onto
`origin/<default>` at the BUILD phase boundary — after `plan`, strictly before
`acceptance_specs` and `build` — so every build task is authored against the newest merged
code, and evidence anchors are created on the already-rebased base (removing, not
re-introducing, the #535/PR-593 `anchor is unreachable` class). Reuse
`resolveBase`/`performRebase`/`runGatedRebaseResolution` verbatim; mirror the existing
`rebase` step's `if (!this.daemon) → noop` gating and conflict→HALT fail-closed behavior.

## Files

- `src/conductor/src/types/steps.ts` — add `base_refresh` to the `StepName` union.
- `src/conductor/src/engine/steps.ts` — add the `base_refresh` `StepDefinition`; re-point
  `acceptance_specs` and `build` prerequisites to `['base_refresh']`.
- `src/conductor/src/engine/resolved-config.ts` — add `base_refresh` entries to
  `DEFAULT_STEP_MODELS`, `DEFAULT_STEP_EFFORT`, `DEFAULT_STEP_RETRIES`, `DEFAULT_STEP_REVIEW`.
- `src/conductor/src/engine/artifacts.ts` — add `base_refresh` to `STEP_ARTIFACT_GLOBS`.
- `src/conductor/src/engine/model-table-metadata.ts` — add `base_refresh` to `STEP_RATIONALE`.
- `src/conductor/src/engine/conductor.ts` — new `runBaseRefreshStep` handler + dispatch wiring.
- `src/conductor/test/` — new unit tests for the handler (daemon/non-daemon/conflict/no-origin).
- `CHANGELOG.md` — required `## [Unreleased]` entry (harness repo gate).

## Non-goals

- **No change to the ship-time `rebase` step.** It stays (catches merges landing *during* the
  build). #593's patch-id anchor translation still covers that residual window.
- **No new git logic.** The step composes existing, tested primitives; it introduces no new
  fetch/rebase/merge code.
- **No consumer-facing surface.** Daemon/self-host only; interactive `/conduct` is a no-op.
- **Not #598.** The stale-engine (binary) refresh is a separate effort; this covers the code base
  the build runs against only. Cross-reference, do not fold.
- **No VERSION bump** (frozen 0.99.19); MINOR-worthy (new step) but versioning is deferred to 1.0.

## Approach note (load-bearing decisions surfaced)

1. **Discrete step, not inline.** Chosen for verdict/event/selector auditability and parity with
   the blessed `rebase` step. Cost: `Record<StepName,…>` ripple (each map must gain a key or TS
   fails to compile). The S downscope (inline at build entry, no new StepName) is documented in
   the complexity note as the fallback if reviewers reject the added surface.
2. **Insertion after `plan`, before `acceptance_specs`+`build`.** Last moment before code/evidence
   is authored; DECIDE artifacts already exist by then, so rebasing here cannot disturb the
   spec/plan the build consumes.
3. **Daemon-gated.** The operator explicitly wants project-specific/self-host behavior, not
   consumer-imposed. Reuses the exact `if (!this.daemon)` guard rationale from `runRebaseStep`
   (real-git corruption in test/interactive contexts).
4. **Engine-native (no `skillName`).** Deterministic mechanical git — no LLM dispatch; matches
   `worktree`/`complexity`/`rebase`.

## Tasks (2–5 min each)

1. **Add `base_refresh` to the `StepName` union** in `types/steps.ts` with a comment noting it is
   the BUILD-start engine-native base-refresh (sibling of the SHIP-time `rebase`). Compile —
   observe the `Record<StepName,…>` errors that enumerate every map needing an entry (RED signal).

2. **Add the `StepDefinition`** to `ALL_STEPS` in `engine/steps.ts`: `name: 'base_refresh'`,
   `label: 'Base Refresh'`, `phase: 'BUILD'`, `enforcement: 'structural'`,
   `prerequisites: ['plan']`, `skippableForTiers: []`, `isCheckpoint: false`, no `skillName`,
   `loopGate: false`. Order it immediately before the `acceptance_specs` entry.

3. **Re-point downstream prerequisites**: change `acceptance_specs.prerequisites` and
   `build.prerequisites` from `['plan']` to `['base_refresh']` so the step is a hard gate before
   any code is authored. Verify the selector still linearizes SETUP→…→plan→base_refresh→
   acceptance_specs→build.

4. **Populate the four `resolved-config.ts` maps** with `base_refresh` entries mirroring the
   engine-native `rebase`/`worktree` rows (e.g. model `auto`/n-a for a non-dispatch step, effort
   `low`, retries per `rebase`, review `auto`). Compile clean.

5. **Add `STEP_ARTIFACT_GLOBS['base_refresh']`** in `artifacts.ts` (mirror `rebase` — no authored
   artifact globs; the step emits a `.pipeline` verdict/event, not a `.docs` artifact).

6. **Add `STEP_RATIONALE['base_refresh']`** in `model-table-metadata.ts` describing the
   engine-native build-start rebase (so any table generation covers it). Run
   `bin/generate-model-table` and confirm no unexpected HARNESS.md drift (engine-native steps are
   not skill rows).

7. **RED: unit-test the new handler contract** in `src/conductor/test/`: (a) non-daemon → `noop`,
   no git; (b) daemon + stale base → calls `performRebase`, satisfied verdict + event; (c) daemon
   + `conflict_halt` → `runGatedRebaseResolution` invoked then `.pipeline/HALT`, no advance;
   (d) no-origin/failed-fetch → `noop`, advances. Use the existing rebase-test git-runner stubs.

8. **GREEN: implement `runBaseRefreshStep`** in `conductor.ts` mirroring `runRebaseStep`:
   `if (!this.daemon) { noop verdict+event+recordCompletion; return }`; else
   `makeGitRunner` → `discoverLocalBase` → `performRebase(git, projectRoot, localBase)` (its
   `resolveBase` does the origin fetch) → `runGatedRebaseResolution` → apply verdict / emit event
   / on `conflict_halt` write HALT. Wire dispatch so `step.name === 'base_refresh'` routes here.

9. **Wire the merged-PR guard reuse (optional, mirror runRebaseStep)**: at build start the PR
   usually does not exist yet, so `checkMergedPrGuard` is a no-op — confirm it degrades cleanly
   when `state.pr_url` is absent (guard returns non-`merged`), no synthetic-ship path fires.

10. **Assert anchor-safety in a test**: a daemon run where `base_refresh` rebased, then a
    subsequent commit's sha-anchor is reachable from the rebased base; and the ship-time `rebase`
    is a `noop` when nothing merged in between (`isBranchCurrent`). Guards Story 5 / #535.

11. **CHANGELOG**: add under `## [Unreleased] → Added`: "Daemon build-start `base_refresh` step —
    fetches origin and rebases the feature worktree onto `origin/<default>` before any build task
    runs, so builds use the newest merged code and evidence anchors sit on the rebased base
    (reduces the #535 anchor-unreachable window). Daemon/self-host only; interactive is a no-op."

12. **Validate**: run `test/test_harness_integrity.sh` (StepName/model-table/section checks) and
    the conductor vitest suite (`cd src/conductor && rtk proxy npx vitest run`) from the correct
    cwd; confirm green before the spec PR is marked ready.

## Migration

No `settings.json`/hook/CLI/symlink schema change (new internal engine step only) → no migration
block required. If the self-host release gate's path classifier flags `engine/` as a breaking
surface, attach a `.docs/release-waivers/daemon-build-start-base-refresh.md` waiver
(internal-only: no consumer-visible CLI/hook/schema change) rather than an empty migration block.
