# Implementation Plan: daemon-build-start-base-refresh

Stem: daemon-build-start-base-refresh
Track: technical
Tier: S

## Goal

Add an opt-in, config-driven, daemon-only build-start refresh: when the project's
`.ai-conductor/config.yml` sets `build_start_base_refresh: true`, the conductor runs
`git fetch origin` + rebase of the feature worktree onto `origin/<default>` at the BUILD
boundary — before the first BUILD-phase step (`acceptance_specs`, or `build` when
acceptance is tier-skipped) dispatches, before any evidence commit exists — so every build
task is authored against the newest merged code and evidence anchors are created on the
already-rebased base (removing, not re-introducing, the #535/PR-593 `anchor is unreachable`
class). Reuse `resolveBase`/`performRebase`/`runGatedRebaseResolution` verbatim.
**No new `StepName`; no `Record<StepName, …>` config-map churn.**

## Files

- `src/conductor/src/types/config.ts` — add optional `build_start_base_refresh?: boolean` to
  `HarnessConfig`, documented like `auto_restart_on_stale_engine` (absent/false → off).
- `src/conductor/src/engine/config.ts` — add the key to the recognized-keys list and validate
  it (boolean; invalid → warn + treat as false, never throw), mirroring
  `auto_restart_on_stale_engine` validation.
- `src/conductor/src/engine/resolved-config.ts` — add `resolveBuildStartBaseRefresh(config)`
  returning a plain boolean (false for absent/malformed), mirroring the existing boolean-flag
  resolvers.
- `src/conductor/src/engine/conductor.ts` — a daemon-only, run-once guard at the
  reset-before-first-BUILD-step seam (~`conductor.ts:1587`) that invokes the base-refresh helper
  when the resolved flag is true.
- `src/conductor/test/` — unit tests (config validation + guard behavior: on/off, non-daemon,
  conflict, no-origin, run-once, anchor-safety).
- `CHANGELOG.md` — required `## [Unreleased]` entry (harness repo gate).
- `src/conductor/README.md` — document the new `build_start_base_refresh` config key
  (docs-track-features convention).

## Non-goals

- **No new `StepName` / `ALL_STEPS` entry / `Record<StepName,…>` churn.** (This is the explicit
  correction from PR #603 review: config-driven, not a hardcoded custom step.)
- **No change to the ship-time `rebase` step.** It stays (catches merges landing *during* the
  build). #593's patch-id anchor translation still covers that residual window.
- **No new git logic.** The guard composes existing, tested primitives.
- **No consumer-facing default.** Absent/false → off; interactive `/conduct` is a no-op.
- **Not #598.** The stale-engine (binary) refresh is a separate effort; cross-reference, do not fold.
- **No VERSION bump** (frozen 0.99.19). New additive config key is MINOR-worthy; versioning is
  deferred to 1.0 per repo policy.

## Approach note (load-bearing decisions surfaced)

1. **Config-driven, not a new step** (operator-mandated on PR #603). Modeled on
   `auto_restart_on_stale_engine`: a top-level optional boolean, safe-by-default, read at
   startup. Eliminates the `StepName`/config-map ripple that made the first draft M → now **S**.
2. **BUILD-boundary guard, run once.** Placed at the reset-before-first-executed-step seam so it
   fires before `acceptance_specs`/`build` (the first steps that author code/evidence) and never
   twice per run.
3. **Daemon-gated.** The operator wants project-specific/self-host behavior, not consumer-imposed;
   the guard early-returns when `!this.daemon`, reusing the exact rationale of `runRebaseStep`
   (real-git corruption in test/interactive contexts).
4. **Deterministic.** Mechanical git via `resolveBase`/`performRebase`/`runGatedRebaseResolution`
   — no LLM dispatch.

## Tasks (2–5 min each)

1. **Add the config key** `build_start_base_refresh?: boolean` to `HarnessConfig` in
   `types/config.ts` with a doc comment mirroring `auto_restart_on_stale_engine` (absent/false →
   off; daemon/self-host only; runs the build-start origin rebase). Compile clean.

2. **Register + validate the key** in `engine/config.ts`: add `'build_start_base_refresh'` to the
   recognized-keys list; validate `typeof === 'boolean'` (invalid → single warning + treat as
   false, never throw), copying the `auto_restart_on_stale_engine` validation branch.

3. **Add the resolver** `resolveBuildStartBaseRefresh(config?: HarnessConfig): boolean` in
   `engine/resolved-config.ts` returning `config?.build_start_base_refresh === true` (false for
   absent/malformed). Unit-test the resolver in isolation (true/false/absent/non-boolean).

4. **RED: unit-test the guard contract** in `src/conductor/test/`: (a) flag off / absent →
   guard is a no-op, no git; (b) flag on but `!this.daemon` → no-op; (c) flag on + daemon + stale
   base → calls `performRebase`, HEAD becomes descendant of `origin/<default>`; (d) flag on +
   `conflict_halt` → `runGatedRebaseResolution` then `.pipeline/HALT`, no build dispatch; (e) flag
   on + no-origin/failed-fetch → no-op, build proceeds; (f) guard runs at most once per run. Use
   the existing rebase-test git-runner stubs.

5. **GREEN: implement the guard** in `conductor.ts` at the reset-before-first-BUILD-step seam
   (~1587): compute `const doBaseRefresh = this.daemon && resolveBuildStartBaseRefresh(this.config)`
   once; when true and entering the first BUILD-phase step for this run, call a private
   `runBuildStartBaseRefresh()` that does `makeGitRunner` → `discoverLocalBase` →
   `performRebase(git, this.projectRoot, localBase)` → `runGatedRebaseResolution` → on
   `conflict_halt` write `.pipeline/HALT` and stop the loop before dispatch. Guard a run-once
   flag so re-entry (retries) does not re-rebase.

6. **Wire the no-origin / clean-degrade path**: confirm `performRebase`'s existing
   remote-less/failed-fetch/`noop` fallbacks return without HALT and the guard lets the build
   proceed (Story 4). No new code — assert via test (d)/(e).

7. **Anchor-safety test** (Story 5 / #535): a daemon run with the flag on where the guard
   rebased, then a subsequent commit's sha-anchor is reachable from the rebased base; and the
   ship-time `rebase` is a `noop` when nothing merged in between (`isBranchCurrent`).

8. **Docs**: document `build_start_base_refresh` in `src/conductor/README.md` (config reference)
   and add the `## [Unreleased] → Added` CHANGELOG line.

9. **Validate**: run `test/test_harness_integrity.sh` and the conductor vitest suite
   (`cd src/conductor && rtk proxy npx vitest run`) from the correct cwd; confirm green.

## Migration

Additive optional config key only — no `settings.json`/hook/CLI/symlink schema change and no
change to existing behavior (absent → off) → no migration block required. If the self-host
release gate's path classifier flags `engine/`/`types/` as a breaking surface, attach a
`.docs/release-waivers/daemon-build-start-base-refresh.md` waiver (internal-only: additive,
default-off, no consumer-visible CLI/hook/schema change) rather than an empty migration block.
