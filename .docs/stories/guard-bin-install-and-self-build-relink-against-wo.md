**Status:** Accepted

# Stories: Guard bin/install and self-build relink against worktree-rooted global installs (#363)

Track: technical — acceptance criteria derived from the technical intent + approved ADR
`adr-2026-07-06-installed-root-resolution-for-global-writes`. Tier M.

## Story: bin/install refuses to mutate operator globals from a worktree root

**Requirement:** TR-1 (installer self-root guard — caller-independent backstop)

As the operator, I want `bin/install` to refuse global-mutating runs when its own checkout
root is a build worktree, so that no caller — daemon preflight, build agent, or a human in
the wrong directory — can repoint my bins, skills, and hooks at a directory that will be
deleted at ship time.

### Acceptance Criteria

#### Happy Path
- Given `bin/install` resolved at the main checkout (physical path not containing
  `/.worktrees/`), when it runs in default or `--update` mode, then it links globals exactly
  as today (no behavior change).
- Given `bin/install` whose physically resolved root (`pwd -P`) contains `/.worktrees/`,
  when it runs in default or `--update` mode without the override flag, then it exits
  non-zero BEFORE any global write, printing the resolved root and the remedy (run from the
  main checkout, or pass `--allow-worktree-root`).
- Given the same worktree-rooted installer, when it is invoked with `--allow-worktree-root`,
  then the guard is bypassed and the install proceeds.

#### Negative Paths
- Given a worktree-rooted `bin/install`, when it refuses, then `~/.local/bin/conduct`,
  `~/.local/bin/conduct-ts`, every `~/.claude/skills/*` symlink, and
  `~/.claude/settings.json` are byte-for-byte unchanged (asserted by comparing
  before/after state in the smoke test).
- Given a worktree reached through a symlinked logical path (logical path hides
  `.worktrees`, physical path contains it), when default install runs, then the guard still
  fires (physical-path resolution, not logical).
- Given a worktree-rooted `bin/install`, when it runs `--check` or `--help`, then no guard
  fires and the exit code reflects the mode's normal semantics (read-only modes stay
  usable for diagnostics).
- Given the override flag on a NON-worktree root, when default install runs, then the flag
  is accepted and inert (no error, no behavior change).

### Done When
- [ ] A real-binary smoke test copies the harness into a `<tmp>/.worktrees/x/` path, runs
      the actual `bin/install` (no mocks) with `HOME` pointed at a throwaway dir, and
      asserts: non-zero exit, error message names the root, and the throwaway `HOME` is
      unchanged.
- [ ] The same smoke run with `--allow-worktree-root` exits zero and links into the
      throwaway `HOME`.
- [ ] `bash -n bin/install` passes and `test/test_harness_integrity.sh` is green.
- [ ] `bin/install --help` documents `--allow-worktree-root`.

## Story: resolveInstalledHarnessRoot derives the main checkout, never a worktree

**Requirement:** TR-2 (installed-root resolution ladder)

As the daemon engine, I want a resolver that returns the installed main-checkout root even
when the running module lives in a worktree's dist, so that operator-global writes are only
ever authorized against a durable checkout.

### Acceptance Criteria

#### Happy Path
- Given the module runs from the main checkout's dist, when the resolver runs, then it
  returns the main checkout root (same result as the existing probe).
- Given the module runs from a worktree dist (probed root's path contains `/.worktrees/` or
  its `git rev-parse --git-common-dir` resolves outside the probed root), when the resolver
  runs, then it returns the main checkout derived from the git common dir, and that root
  contains `bin/install`.

#### Negative Paths
- Given a worktree whose git common-dir derivation fails (git errors, common dir
  unresolvable), when the resolver runs, then it returns a rejection (not the worktree
  root, not a throw from the resolver itself).
- Given a derived main root that lacks `bin/install`, when the resolver runs, then it
  returns a rejection.
- Given a derived root that STILL sits under `/.worktrees/`, when the resolver runs, then
  it returns a rejection.
- Given `~/.ai-conductor/registry.json` is missing, unreadable, or disagrees with the
  derived root, when the resolver succeeds via git derivation, then the result is unchanged
  and the disagreement is logged as a warning only (registry is advisory — never blocks,
  never crashes).
- Given the module-relative probe finds no root at all (unusual layout), when the resolver
  runs, then it returns null exactly like the existing resolver (callers keep their
  skip-with-log behavior).

### Done When
- [ ] Unit tests cover every ladder branch above with injected seams (git runner, fs,
      registry path) — no test touches the real `~/.ai-conductor` or `~/.claude`.
- [ ] The existing `resolveHarnessRoot` function body is untouched by the diff (detector
      identity seam preserved).

## Story: Self-build relink preflight HALTs instead of relinking to a worktree

**Requirement:** TR-3 (fail-loud preflight)

As the operator, I want a self-build whose engine would relink globals against a worktree to
HALT before dispatch, so that the failure is a visible parked build instead of a bricked
environment discovered hours later.

### Acceptance Criteria

#### Happy Path
- Given the resolver returns the main checkout root, when `relinkSkillsForSelfBuild` runs,
  then `bin/install --update` executes rooted at the main checkout (current behavior at the
  correct root).

#### Negative Paths
- Given the resolver rejects (worktree-derived root, failed derivation, or missing
  installer at the derived root), when the preflight runs, then it throws
  `InstallStaleError` naming the rejected root and the install runner is NEVER invoked
  (asserted via the injected runner recording zero calls).
- Given the thrown `InstallStaleError`, when the self-build dispatch path handles it, then
  the run writes `.pipeline/HALT` and no build step is dispatched (existing
  conductor error contract — asserted at the conductor level).
- Given the resolver returns null (no root found anywhere, non-worktree), when the
  preflight runs, then it logs and skips without throwing (existing TR-4 negative
  preserved).

### Done When
- [ ] Preflight unit tests assert the runner is not called on every rejection branch.
- [ ] A conductor-level test asserts a rejected preflight parks the run with a HALT and
      dispatches nothing.

## Story: Sandbox provisioning receives the installed root so settings retargeting fires

**Requirement:** TR-4 (sandbox harnessRoot correctness)

As the self-build sandbox, I want `provisionSandbox` to receive the installed main-checkout
root as `harnessRoot`, so that the copied `settings.json`'s main-checkout hook paths are
actually rewritten to the build worktree instead of silently left pointing at live globals.

### Acceptance Criteria

#### Happy Path
- Given an engine running from a worktree dist and operator settings whose hook commands
  reference the main checkout, when the sandbox is provisioned for a self-build, then the
  sandbox copy of `settings.json` has every main-checkout prefix rewritten to the build
  worktree (before/after content asserted, not just "provision succeeded").

#### Negative Paths
- Given the installed root cannot be resolved, when the sandbox is provisioned, then
  `harnessRoot` falls back to `projectRoot` exactly as today (no new failure mode; the
  relink story's HALT already covers the dangerous case upstream).
- Given operator settings with hook paths OUTSIDE the harness checkout (personal hooks),
  when retargeting runs, then those paths are untouched (existing invariant preserved).

### Done When
- [ ] A test provisions a sandbox with `harnessRoot` = main and `worktreeRoot` = worktree
      and asserts the rewritten settings content includes worktree-prefixed hook commands
      and zero main-checkout-prefixed ones (for harness-owned paths).

## Story: Self-host detection is regression-proofed against the resolver split

**Requirement:** TR-5 (review condition 1 — detector unchanged)

As the guardrail bundle, I want self-host detection to keep classifying a worktree-run
self-build as self-host, so that splitting root resolution cannot silently disable the
sandbox and every self-host gate.

### Acceptance Criteria

#### Happy Path
- Given an engine whose module-relative probe resolves a worktree checkout and a build repo
  at that same worktree, when `PathSelfHostDetector.isSelfHost` runs, then it returns true
  (byte-for-byte pre-fix behavior).

#### Negative Paths
- Given a non-harness repo, when detection runs, then it returns false (positive-only
  invariant untouched).
- Given an unresolved harness root, when detection runs, then it returns false without
  throwing (existing invariant).

### Done When
- [ ] A regression test constructs the worktree-engine scenario (probe → worktree root,
      buildRepoRoot = same worktree) and asserts `isSelfHost === true` with the new code in
      place.
- [ ] Full existing detector + self-host test suites pass unmodified.
