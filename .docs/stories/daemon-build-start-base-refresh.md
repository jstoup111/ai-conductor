# Daemon build-start base refresh (config-driven rebase of feature worktree onto origin/main before task dispatch)

Status: Accepted
Track: technical
Tier: S

## Context (explore synthesis)

**Problem.** The daemon builds features on stale code bases and re-fails on already-merged
fixes. A feature's spec branch is frequently cut off a `main` that has since advanced; by the
time the daemon reaches BUILD, `origin/<default>` contains merged fixes the worktree does not.
Tasks then run against stale code.

**What already exists (verified in source, corrects the operator's premise).** The pipeline
already has an engine-native `rebase` step (`engine/steps.ts:218`, handled by
`Conductor.runRebaseStep` at `engine/conductor.ts:3799`). It calls `performRebase`
(`engine/rebase.ts:361`), whose `resolveBase` helper **fetches `origin` and rebases onto
`origin/<default>` — not local main** (`engine/rebase.ts`, `git fetch origin <default>` →
`origin/<default>`). So the "rebases onto stale local main" framing is inaccurate for that step.

**The actual gap is TIMING, not the base.** The only base-refresh rebase runs at **SHIP**
(`phase: 'SHIP'`, `prerequisites: ['manual_test']`) — i.e. *after* the entire build. Two
consequences:
1. Every task is authored against the pre-fetch base; merged fixes are absent during BUILD and
   only appear at ship, exactly when re-doing work is most expensive.
2. That late rebase moves HEAD *after* evidence-bearing commits exist, re-parenting their
   anchors. This is the direct cause of the judged-attribution `Evidence range: anchor is
   unreachable` completion-check failures (#535 / PR #593, the anchor-unreachable class).

**Design (config-driven, per operator direction on PR #603).** This is **NOT** a new custom
harness step. It is an opt-in, per-project toggle in `.ai-conductor/config.yml`:

- **Config key:** `build_start_base_refresh?: boolean` — a top-level optional boolean added to
  `HarnessConfig` (`src/conductor/src/types/config.ts`), modeled on the existing
  `auto_restart_on_stale_engine` flag. Absent/`false`/malformed → OFF (safe default).
- **Read at daemon startup**, like `owner_gate_cutover` / `auto_restart_on_stale_engine` /
  `attribution_judge_cutover`: validated in `engine/config.ts`, resolved via a
  `resolveBuildStartBaseRefresh(config)` helper in `engine/resolved-config.ts`.
- **Enforced at the BUILD boundary** by a small daemon-only guard in the conductor step loop
  (`engine/conductor.ts`, at the reset-before-first-BUILD-step seam ~`conductor.ts:1587`),
  which runs **once per run** before the first BUILD-phase step (`acceptance_specs`, or `build`
  when acceptance is tier-skipped) dispatches. When the flag is set and `this.daemon`, it
  composes the existing primitives: `discoverLocalBase` → `resolveBase` (origin fetch) →
  `performRebase` → `runGatedRebaseResolution`. **No new `StepName`, no `ALL_STEPS` entry, no
  `Record<StepName, …>` config-map churn.**

**Scope guards.** Project-specific (daemon-only, opt-in via config), NOT a global git hook and
NOT consumer-facing default behavior. Deterministic engine code, NOT an LLM step. Conflicts
fail closed (HALT → existing `/rebase` resolver), never a silent bad merge.

**Sibling relationship — #598.** #598 is the daemon running a stale **engine** binary after an
upstream fix merges. This feature refreshes the **code base** the build runs against. Same root
cause ("daemon does not refresh from origin before acting") at two layers; **kept as separate
efforts / separate PRs**, cross-referenced. They could later share a single `git fetch origin`
primitive, but the engine-swap (#598) and the worktree-rebase (this) have different failure
modes, blast radius, and recovery, so folding them would couple unrelated risk.

## Story 1 — Config-enabled build-start rebase onto latest origin default before any task runs (happy path)

As the daemon build loop, when `build_start_base_refresh: true` is set in the project's
`.ai-conductor/config.yml`, the engine must fetch `origin` and rebase the feature worktree onto
`origin/<default>` **before** the first BUILD-phase step dispatches, so every task is authored
against the newest merged code.

### Happy Path

- **Given** a daemon (auto-mode) run with `build_start_base_refresh: true` whose feature branch
  was cut off a `main` that `origin/<default>` has since advanced past (merged fixes present
  upstream, absent locally),
- **When** the conductor reaches the pre-first-BUILD-step guard,
- **Then** the engine runs `resolveBase` (fetches `origin`, discovers the default branch) and
  `performRebase` onto `origin/<default>`, the worktree HEAD is now a descendant of
  `origin/<default>`, and only then is the first build task (`acceptance_specs`/`build`)
  dispatched — the guard runs exactly once for the run (idempotent; re-entry is a no-op).

## Story 2 — Flag absent / false / non-daemon is a strict no-op (negative path / default-safe)

As any run without the opt-in — a consumer project, an interactive `/conduct`, or the test
suite — the build-start rebase must never fire and never touch git.

### Negative Path

- **Given** a run where `build_start_base_refresh` is absent, `false`, or malformed, **or** any
  non-daemon run (`this.daemon === false`),
- **When** the conductor reaches the BUILD boundary,
- **Then** the guard is skipped entirely — no fetch, no rebase, no verdict change, unchanged loop
  topology — so downstream consumers and interactive users see identical behavior to today, and
  vitest-driven Conductors never touch a live checkout.

## Story 3 — A build-start conflict fails closed to the gated /rebase resolver (negative path)

As the daemon, when the enabled build-start rebase cannot apply cleanly, the engine must not
proceed on a bad merge; it must attempt the gated resolver and otherwise HALT.

### Negative Path

- **Given** an enabled `build_start_base_refresh` rebase that returns `conflict_halt` (a genuine
  overlap between the spec branch's committed `.docs`/code and upstream),
- **When** the guard runs,
- **Then** the engine invokes `runGatedRebaseResolution` (the same resolver cap
  `rebase_resolution_attempts` the ship-time step uses), and if unresolved writes
  `.pipeline/HALT` leaving the rebase paused for the operator's `/rebase` skill — **no build task
  is dispatched and no unrebased/half-merged tree is ever built**.
- **And** the CHANGELOG-only auto-resolve path (`performRebase`'s `changelog_resolved`) still
  applies, so a lone `[Unreleased]` conflict does not HALT.

## Story 4 — No / unreachable origin degrades to a clean no-op, never a HALT (negative path)

As the daemon with the flag on but in a remote-less or unreachable-origin situation, the guard
must complete, not park.

### Negative Path

- **Given** the flag is on but the repo has no `origin` remote, or `git fetch origin` fails
  (offline/unreachable),
- **When** the guard runs,
- **Then** `resolveBase`/`performRebase` degrade to the existing local-base / no-op fallbacks
  (FR-3 spirit already in `performRebase`), the guard returns without error, and the build
  proceeds — base-refresh is best-effort correctness, not a hard remote dependency.

## Story 5 — Evidence anchors are generated on the already-rebased base (negative path / anti-regression)

As the judged-attribution completion check, an enabled build-start rebase must **remove**, not
re-introduce, the `anchor is unreachable` failure class.

### Negative Path

- **Given** a build (flag on) that authors evidence-bearing commits after the build-start guard
  has rebased the worktree onto `origin/<default>`,
- **When** the completion/evidence gate later resolves sha-anchored citations,
- **Then** every anchor is reachable from the current base because it was created *on top of*
  the rebased base (no pre-build commits were re-parented), and the ship-time `rebase` step —
  which remains, to catch merges landing *during* the build — is a `noop` when nothing merged
  in the interim (`isBranchCurrent` short-circuit), so this feature strictly reduces the #535
  exposure window rather than duplicating or fighting PR #593's patch-id anchor translation.
- **And** the ship-time `rebase` step is unchanged; #593's translation still covers the residual
  "merged during build" window this guard cannot (nothing had merged yet at build start).
