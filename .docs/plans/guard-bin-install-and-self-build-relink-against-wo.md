# Implementation Plan: Guard bin/install and self-build relink against worktree-rooted global installs (#363)

**Date:** 2026-07-06
**Design:** `.docs/decisions/adr-2026-07-06-installed-root-resolution-for-global-writes.md` (APPROVED)
**Stories:** `.docs/stories/guard-bin-install-and-self-build-relink-against-wo.md` (Accepted, TR-1…TR-5)
**Conflict check:** Clean as of 2026-07-06
**Tier:** M

## Summary

Adds two independent guards so a build-worktree checkout can never repoint operator globals:
a self-root refusal in `bin/install` and an installed-root resolver used by the self-build
relink preflight and sandbox provisioning. 14 tasks.

## Technical Approach

- **`bin/install` (bash):** add a guard at the top of `install()` — resolve the physical root
  (`cd "$HARNESS_DIR" && pwd -P`); if it matches `*/.worktrees/*` and `ALLOW_WORKTREE_ROOT`
  is not set, print the root + remedy and exit 1 before any global write. New flag
  `--allow-worktree-root` (parsed before the mode `case`, combinable with `--update`).
  `--check`, `--help`, `--uninstall` bypass the guard.
- **`install-freshness.ts` (TS):** new exported `resolveInstalledHarnessRoot(opts)` returning a
  discriminated result — `{ status: 'ok', root }` | `{ status: 'rejected', reason, detail }` |
  `{ status: 'unresolved' }`. Ladder per the ADR: module probe → worktree detection (path
  contains `/.worktrees/` OR injected git runner's `rev-parse --git-common-dir` resolves outside
  the probed root) → derive main checkout from the common dir → assert `bin/install` exists →
  reject any final `/.worktrees/` root or failed derivation → advisory registry cross-check
  (warn-only, reuse `registry.ts` readers). Seams: git runner, fs access, registry path, log —
  matching the module's existing injectable style. **`resolveHarnessRoot` is not modified**
  (detector identity seam).
- **`relinkSkillsForSelfBuild`:** resolve via the new function. `rejected` → throw
  `InstallStaleError` naming the root, installer never invoked. `unresolved` → existing
  log-and-skip. `ok` → existing runner call at the root.
- **Wiring + conductor:** add `resolveInstalledHarnessRoot` to the `SelfHostGuardrails` bundle;
  `runSelfBuildDispatch` uses it (ok → root, else `projectRoot`) for `provisionSandbox`'s
  `harnessRoot` so settings retargeting (main → worktree) actually fires.
- **Sequencing:** bash guard first (standalone, caller-independent backstop), then the TS
  resolver bottom-up (resolver → preflight → wiring/conductor), regression tests last.

## Prerequisites

- `src/conductor` deps installed in the build worktree (`npm install`); run vitest via
  `rtk proxy npx vitest run` if RTK is active.

## Tasks

### Task 1: bin/install worktree-root guard + `--allow-worktree-root` flag
**Story:** TR-1 — refusal happy path + override + inert-flag criteria
**Type:** infrastructure
**Steps:**
1. Add `ALLOW_WORKTREE_ROOT=false`; parse/strip `--allow-worktree-root` from `$@` before the
   mode `case`; add `guard_worktree_root()` computing the physical root and refusing
   (`exit 1`, message names root + remedy) when it matches `*/.worktrees/*`.
2. Call the guard from `install()` only (default + `--update` paths); leave `--check`,
   `--uninstall`, `--help` untouched. Document the flag in `--help`.
3. `bash -n bin/install` passes.
**Files:** `bin/install` — guard function, flag parsing, help text.
**Dependencies:** none

### Task 2: Real-binary smoke — refusal leaves globals byte-for-byte unchanged
**Story:** TR-1 — negative paths (no mutation, message content, symlinked path)
**Type:** negative-path
**Steps:**
1. Write `test/test_install_worktree_guard.sh` (model on existing `test/test_conduct_worktree.sh`
   style): copy the checkout to `<tmp>/repo`, `git worktree`-like layout at
   `<tmp>/repo/.worktrees/x` (a plain copy at that path suffices — the guard keys on the path),
   run the REAL `bin/install` with `HOME=<throwaway>`; assert non-zero exit, message contains
   the resolved root, and the throwaway `HOME` tree is unchanged (diff before/after snapshot).
2. Add a symlink case: invoke via a logical path whose symlink hides `.worktrees`; assert the
   guard still fires (physical resolution).
3. Verify RED before the guard exists is not applicable (guard landed in Task 1) — instead
   assert the script fails against a stubbed-out guard (temporarily) or trust the assertion
   granularity; keep the script self-contained and idempotent.
**Files:** `test/test_install_worktree_guard.sh` (new).
**Dependencies:** Task 1

### Task 3: Smoke — override flag proceeds; read-only modes unaffected
**Story:** TR-1 — override happy path, `--check`/`--help` criteria, inert flag on main root
**Type:** happy-path
**Steps:**
1. Extend the smoke script: same worktree-rooted copy with `--allow-worktree-root` exits 0 and
   links into the throwaway `HOME`; `--check` and `--help` run guard-free; the flag on a
   non-worktree root is accepted and inert.
2. Hook the script into the repo's test entry point the same way the other `test/test_*.sh`
   scripts run (CI workflow or integrity suite conventions — mirror `test_conduct_worktree.sh`).
**Files:** `test/test_install_worktree_guard.sh`; CI/workflow file only if other test scripts
are enumerated there.
**Dependencies:** Task 2

### Task 4: `resolveInstalledHarnessRoot` — happy path at the main checkout
**Story:** TR-2 — main-checkout probe criterion
**Type:** happy-path
**Steps:**
1. RED: in `src/conductor/test/engine/install-freshness.test.ts`, spec the new export: probe
   resolves a non-worktree root with `bin/install` → `{ status: 'ok', root }` (injected fs +
   git seams; git reports the root's own `.git`).
2. GREEN: implement the result type + probe reuse (share the probe loop with
   `resolveHarnessRoot` via a private helper WITHOUT changing that function's exported
   behavior).
**Files:** `src/conductor/src/engine/install-freshness.ts`, its test.
**Dependencies:** none

### Task 5: Worktree detection + git-common-dir derivation
**Story:** TR-2 — worktree-dist derivation criterion
**Type:** happy-path
**Steps:**
1. RED: probed root at `<main>/.worktrees/x` (path match) AND a probed root whose injected
   `git rev-parse --git-common-dir` resolves outside it (linked worktree at a non-`.worktrees`
   path) → both derive `<main>` and return `ok` when `<main>/bin/install` exists.
2. GREEN: implement detection (path test OR common-dir comparison) + derivation
   (`dirname(commonDir)` for `<main>/.git`).
**Files:** same as Task 4.
**Dependencies:** Task 4

### Task 6: Resolver rejection branches
**Story:** TR-2 — negative paths (git failure, missing installer, still-worktree root, null probe)
**Type:** negative-path
**Steps:**
1. RED, one test per branch: git runner throws → `rejected`; derived root lacks `bin/install`
   → `rejected`; derived root still under `/.worktrees/` → `rejected`; probe finds nothing →
   `unresolved` (parity with existing null semantics). Resolver itself never throws.
2. GREEN: implement; every `rejected` carries a human-readable `detail` naming the offending
   path.
**Files:** same as Task 4.
**Dependencies:** Task 5

### Task 7: Advisory registry cross-check
**Story:** TR-2 — registry missing/unreadable/disagreeing criteria
**Type:** negative-path
**Steps:**
1. RED: with a registry recording a different path → result unchanged, warning logged via
   injected log; registry missing/unreadable → result unchanged, no throw, at most a debug log.
2. GREEN: read via `registry.ts` (`resolveRegistryPath`/`readRegistry`) inside a try/catch;
   never block resolution on it.
**Files:** same as Task 4 (+ import from `registry.ts`).
**Dependencies:** Task 6

### Task 8: Preflight uses the resolver — rejection throws, runner never invoked
**Story:** TR-3 — rejection negative path + null-skip preservation + happy path
**Type:** negative-path
**Steps:**
1. RED: `relinkSkillsForSelfBuild` with a resolver seam returning `rejected` → throws
   `InstallStaleError` whose message names the rejected root; injected runner records ZERO
   calls. `unresolved` → resolves, logs skip, zero runner calls (existing behavior re-asserted
   against the new seam). `ok` → runner invoked once with `['--update']` at the root.
2. GREEN: swap the preflight's root discovery to `resolveInstalledHarnessRoot`; keep
   `RelinkPreflightOptions.harnessRoot` override semantics for existing tests (an explicit
   string override behaves as `ok`).
**Files:** `install-freshness.ts`, its test.
**Dependencies:** Task 6 (Task 7 independent)

### Task 9: Wiring bundle exposes `resolveInstalledHarnessRoot`
**Story:** TR-4 — plumbing for the sandbox criterion
**Type:** infrastructure
**Steps:**
1. RED: `wiring.test.ts` asserts the default bundle member forwards to the real function.
2. GREEN: add the member to `SelfHostGuardrails` + `defaultSelfHostGuardrails`.
**Files:** `src/conductor/src/engine/self-host/wiring.ts`, `wiring.test.ts`.
**Dependencies:** Task 6

### Task 10: Conductor passes the installed root to `provisionSandbox`
**Story:** TR-4 — happy path + fallback negative path; TR-3 conductor-level HALT
**Type:** happy-path
**Steps:**
1. RED (conductor integration tests, spy bundle): self-build dispatch with resolver → `ok:<main>`
   asserts `provisionSandbox` received `harnessRoot: <main>`; resolver `unresolved`/`rejected`
   → `harnessRoot: projectRoot` (fallback unchanged); a `relink` that throws
   `InstallStaleError` still parks the run with `.pipeline/HALT` and dispatches nothing
   (existing contract re-asserted).
2. GREEN: `runSelfBuildDispatch` calls `guardrails.resolveInstalledHarnessRoot()` instead of
   `guardrails.resolveHarnessRoot()` at the sandbox call site only.
**Files:** `src/conductor/src/engine/conductor.ts` (~line 754), conductor tests.
**Dependencies:** Task 9

### Task 11: Sandbox retarget content assertion
**Story:** TR-4 — before/after settings rewrite + personal-hooks invariant
**Type:** happy-path
**Steps:**
1. RED: `sandbox-build-env.test.ts` case with `harnessRoot=<main>`, `worktreeRoot=<wt>`, and a
   settings.json containing a `<main>/hooks/...` command, a `<main>`-prefixed statusLine, and a
   personal `~/.claude/hooks/...` command → sandbox copy has the first two rewritten to `<wt>`
   and the personal path untouched; zero `<main>`-prefixed harness paths remain.
2. GREEN: expected to pass with existing retarget code (this is a coverage lock, not new
   behavior); fix only if the assertion exposes a gap.
**Files:** `src/conductor/test/engine/self-host/sandbox-build-env.test.ts`.
**Dependencies:** Task 10 (for the end-to-end meaning; test itself is standalone)

### Task 12: Detector regression proof
**Story:** TR-5 — all three criteria
**Type:** negative-path
**Steps:**
1. Add to `detector.test.ts`: resolver seam returning a worktree checkout root +
   `buildRepoRoot` at that same (realpath-identical) worktree → `isSelfHost === true`;
   non-harness repo → false; null root → false. (First case is the new lock; latter two exist —
   extend, don't duplicate.)
2. Assert the diff leaves `resolveHarnessRoot`'s body untouched: full existing
   `install-freshness` + `self-host` suites pass unmodified.
**Files:** `src/conductor/test/engine/self-host/detector.test.ts`.
**Dependencies:** Task 8

### Task 13: Docs
**Story:** repo convention (docs track features)
**Type:** infrastructure
**Steps:**
1. `README.md` + `src/conductor/README.md`: document the installer guard, the
   `--allow-worktree-root` flag, and the preflight HALT behavior.
2. `CHANGELOG.md` `[Unreleased]`: **Fixed** — #363 incident class; **Added** —
   `--allow-worktree-root`. No Migration block (additive flag; no settings/hook/symlink/CLI
   breakage).
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`.
**Dependencies:** Tasks 1, 8, 10

### Task 14: Full validation sweep
**Story:** all — Done When gates
**Type:** infrastructure
**Steps:**
1. `test/test_harness_integrity.sh` green; `bash -n` on all bin/ scripts.
2. `rtk proxy npx vitest run` in `src/conductor` green (full suite, not just new files).
3. New smoke script green from a clean checkout copy.
**Files:** none (verification only).
**Dependencies:** all prior

## Task Dependency Graph

```
T1 ─ T2 ─ T3 ──────────────────────────┐
T4 ─ T5 ─ T6 ─┬─ T7 ────────────────┐  │
              ├─ T8 ─ T12 ──────────┤  ├─ T13 ─ T14
              └─ T9 ─ T10 ─ T11 ────┘  │
                                       │
```

## Integration Points

- After Task 3: the caller-independent backstop is live and smoke-proven — the incident's
  trigger path 2 is closed end-to-end.
- After Task 8: a worktree-run engine HALTs at the preflight instead of relinking — trigger
  path 1 closed at the unit level.
- After Task 10: closed at the conductor level, and sandbox retargeting is correct end-to-end.

## Coverage

| Story criterion | Task(s) |
|---|---|
| TR-1 happy (main root unchanged, worktree refusal, override) | 1, 2, 3 |
| TR-1 negatives (zero mutation, symlink, read-only modes, inert flag) | 2, 3 |
| TR-2 happy (main probe, worktree derivation) | 4, 5 |
| TR-2 negatives (git failure, missing installer, still-worktree, registry, null) | 6, 7 |
| TR-3 happy + negatives (HALT, zero runner calls, null-skip) | 8, 10 |
| TR-4 happy + negatives (retarget fires, fallback, personal hooks) | 9, 10, 11 |
| TR-5 all (detector unchanged) | 12 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
