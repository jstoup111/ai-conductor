# Daemon build-start base refresh (rebase feature worktree onto origin/main before task dispatch)

Status: Accepted
Track: technical
Tier: M

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

**Seam.** A build-start refresh belongs at the BUILD phase boundary — after `plan`, strictly
before `acceptance_specs` and `build` (the first steps that author code/evidence). It should
reuse `resolveBase` + `performRebase` + `runGatedRebaseResolution` verbatim and mirror the
existing `rebase` step's daemon gating (`if (!this.daemon) → noop`; interactive humans rebase
manually; the test suite never touches real git).

**Scope guards.** Project-specific (daemon / self-host build flow only), NOT a global git hook
and NOT consumer-facing. Deterministic engine step, NOT an LLM step. Conflicts fail closed
(HALT → existing `/rebase` resolver), never a silent bad merge.

**Sibling relationship — #598.** #598 is the daemon running a stale **engine** binary after an
upstream fix merges. This feature refreshes the **code base** the build runs against. Same root
cause ("daemon does not refresh from origin before acting") at two layers; **kept as separate
efforts / separate PRs**, cross-referenced. They could later share a single `git fetch origin`
primitive, but the engine-swap (#598) and the worktree-rebase (this) have different failure
modes, blast radius, and recovery, so folding them would couple unrelated risk.

## Story 1 — Build-start rebase onto latest origin default before any task runs (happy path)

As the daemon build loop, when a feature reaches the BUILD phase, the engine must fetch
`origin` and rebase the feature worktree onto `origin/<default>` **before** dispatching
`acceptance_specs`/`build`, so every task is authored against the newest merged code.

### Happy Path

- **Given** a daemon (auto-mode) run whose feature branch was cut off a `main` that
  `origin/<default>` has since advanced past (merged fixes present upstream, absent locally),
- **When** the pipeline enters the new `base_refresh` step (ordered after `plan`, before
  `acceptance_specs` and `build`),
- **Then** the engine runs `resolveBase` (fetches `origin`, discovers the default branch) and
  `performRebase` onto `origin/<default>`, the worktree HEAD is now a descendant of
  `origin/<default>`, the step records a satisfied verdict + structured event, and only then is
  the first build task dispatched.

## Story 2 — A build-start conflict fails closed to the gated /rebase resolver (negative path)

As the daemon, when the build-start rebase cannot apply cleanly, the engine must not proceed on
a bad merge; it must attempt the gated resolver and otherwise HALT.

### Negative Path

- **Given** a `base_refresh` rebase that returns `conflict_halt` (a genuine overlap between the
  spec branch's committed `.docs`/code and upstream),
- **When** the step runs,
- **Then** the engine invokes `runGatedRebaseResolution` (the same resolver cap the ship-time
  step uses), and if unresolved writes `.pipeline/HALT` leaving the rebase paused for the
  operator's `/rebase` skill — **no task is dispatched and no unrebased/half-merged tree is ever
  built**.
- **And** the CHANGELOG-only auto-resolve path (`performRebase`'s `changelog_resolved`) still
  applies, so a lone `[Unreleased]` conflict does not HALT.

## Story 3 — Interactive and test runs are a strict no-op (negative path / gating)

As interactive `/conduct` (or the test suite), the `base_refresh` step must never touch real
git, exactly like the existing `rebase` step.

### Negative Path

- **Given** a non-daemon run (`this.daemon === false`) — interactive use or any vitest-driven
  Conductor whose `projectRoot` resolves to a live checkout,
- **When** the pipeline reaches `base_refresh`,
- **Then** the engine records a `noop` verdict + event and advances, performing **no** fetch and
  **no** rebase (humans rebase manually; the guard prevents the real-git corruption class the
  ship-time rebase guard was added for).

## Story 4 — No / unreachable origin degrades to a clean no-op, never a HALT (negative path)

As the daemon in a remote-less or unreachable-origin situation, the step must complete, not park.

### Negative Path

- **Given** a repo with no `origin` remote, or a `git fetch origin` that fails
  (offline/unreachable),
- **When** `base_refresh` runs under the daemon,
- **Then** `resolveBase`/`performRebase` degrade to the existing local-base / no-op fallbacks
  (FR-3 spirit already in `performRebase`), the step records `noop`, and the build proceeds —
  base-refresh is best-effort correctness, not a hard remote dependency.

## Story 5 — Evidence anchors are generated on the already-rebased base (negative path / anti-regression)

As the judged-attribution completion check, build-start rebasing must **remove**, not
re-introduce, the `anchor is unreachable` failure class.

### Negative Path

- **Given** a build that authors evidence-bearing commits after `base_refresh` has rebased the
  worktree onto `origin/<default>`,
- **When** the completion/evidence gate later resolves sha-anchored citations,
- **Then** every anchor is reachable from the current base because it was created *on top of*
  the rebased base (no pre-build commits were re-parented), and the ship-time `rebase` step —
  which remains, to catch merges landing *during* the build — is a `noop` when nothing merged
  in the interim (`isBranchCurrent` short-circuit), so this feature strictly reduces the #535
  exposure window rather than duplicating or fighting PR #593's patch-id anchor translation.
- **And** the ship-time `rebase` step is unchanged; #593's translation still covers the residual
  "merged during build" window this step cannot (nothing had merged yet at build start).
