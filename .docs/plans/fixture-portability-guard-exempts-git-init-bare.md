# Implementation plan: fixture-portability guard exempts `git init --bare` from branch pinning

Source issue: jstoup111/ai-conductor#528
Track: technical · Tier: S

## Summary

The structural fixture-portability guard vouches for `git init --bare` (no `-b`)
because its matcher exempts `--bare` from the initial-branch requirement. That is a
CI-red hazard when a test reads the bare repo's HEAD. Tighten the matcher so a real
`-b`/`--initial-branch <name>` flag is required (and `--bare` alone is NOT treated as
a pin — despite `"--bare"` containing the substring `"-b"`), add a known-BAD bare-init
falsifiability fixture, and convert the two bare known-good fixtures to pinned/marker
forms. Preserve the `// portability-ok:` escape hatch. Entirely within one test file.

## Design

- **Single change site:** `src/conductor/test/structural/fixture-portability.test.ts`.
- Today `extractGitInitPattern(line)` (lines 125–164) computes, in all five exec-shape
  branches (lines 135, 141, 147, 153, 159), `const hasFlag = line.includes('-b') ||
  line.includes('--bare');` and `scanFileForViolations` (lines 189–191) exempts any
  line with `hasFlag`.
- Replace the `hasFlag` computation with a precise **branch-pin detector** that is
  true only when the line contains `-b` or `--initial-branch` as a real flag token
  followed by a branch name — e.g. a regex like `/(^|\s|['"\[,])(-b|--initial-branch)(\s|=|['"\]])/`
  (a standalone `-b`/`--initial-branch` token, not the `-b` inside `--bare`). Crucially
  it must NOT match `--bare`. Define it once (a helper `hasInitialBranchFlag(line)`)
  and call it from all five branches to remove the duplicated, drift-prone expression.
- Keep the `// portability-ok:` marker detection unchanged (line 131:
  `const markerPresent = line.includes('// portability-ok:');`) and its honoring in
  `scanFileForViolations` (lines 193–196). Bare repos whose HEAD never matters stay
  exempt via the marker.
- **Falsifiability fixtures:**
  - Add a known-BAD entry to `KNOWN_BAD_FIXTURES` (lines 53–59): a bare init without
    `-b`, e.g. `` `await exec('git', ['init', '--bare', '-q'], { cwd: dir });` ``.
  - Convert the bare known-good fixture at line 64 to a pinned form
    (`['init', '--bare', '-b', 'main', '-q']`) and/or a marker-carrying form, and keep
    at least one bare-with-marker entry in `KNOWN_GOOD_FIXTURES` to cover the
    "HEAD never matters" exemption.
  - Update the `detects all four exec shapes correctly` test's bare case at line 347
    (`execFile('git', ['init', '--bare', '-q'])`, currently `shouldViolate: false`) to
    `shouldViolate: true` (or pin/mark it), matching the new rule.

## Prerequisites

- None. The guard is self-contained in the one test file; no production source or
  other module is involved.

## Tasks

### Task 1: Add a precise branch-pin detector helper
**Story:** Story 3 (substring trap) + Story 1 (bare violates)
**Type:** happy-path
**Steps:**
1. Write a failing unit assertion (temporary, promoted in Task 4): `hasInitialBranchFlag("['init', '--bare', '-q']") === false`; `hasInitialBranchFlag("['init', '--bare', '-b', 'main']") === true`; `hasInitialBranchFlag("['init', '--initial-branch', 'main']") === true`; `hasInitialBranchFlag("['init']") === false`.
2. Verify RED.
3. Implement `hasInitialBranchFlag(line: string): boolean` in `fixture-portability.test.ts` using a token-precise regex that matches a standalone `-b`/`--initial-branch` flag and does NOT match `--bare`.
4. Verify GREEN.
**Files:** `src/conductor/test/structural/fixture-portability.test.ts`
**Wired-into:** `src/conductor/test/structural/fixture-portability.test.ts#extractGitInitPattern` (consumed in Task 2)
**Dependencies:** none

### Task 2: Replace the five duplicated `hasFlag` sites with the helper
**Story:** Story 1 (bare violates) + Story 3b (all exec shapes)
**Type:** happy-path
**Steps:**
1. In `extractGitInitPattern` replace each `const hasFlag = line.includes('-b') || line.includes('--bare');` (lines 135, 141, 147, 153, 159) with `const hasFlag = hasInitialBranchFlag(line);`.
2. Leave `scanFileForViolations`'s `if (pattern.hasFlag) continue;` (lines 189–191) and the marker check (lines 193–196) unchanged.
3. Verify the existing structural suite still parses (some fixtures fail until Task 3 updates them — expected).
**Files:** `src/conductor/test/structural/fixture-portability.test.ts`
**Wired-into:** `src/conductor/test/structural/fixture-portability.test.ts#scanFileForViolations`
**Dependencies:** 1

### Task 3: Update falsifiability fixtures (known-BAD + bare known-good)
**Story:** Story 1b (known-bad violate) + Story 2 (pinned/marker pass)
**Type:** happy-path
**Steps:**
1. Add a bare-init-without-`-b` entry to `KNOWN_BAD_FIXTURES` (lines 53–59).
2. Convert the bare known-good fixture at line 64 to a pinned form (`'--bare', '-b', 'main'`) and add/keep a bare-with-`// portability-ok:` marker entry in `KNOWN_GOOD_FIXTURES` (lines 61–70).
3. Update the `detects all four exec shapes correctly` bare case at line 347 to `shouldViolate: true` (or pin/mark it consistently with the new rule).
**Files:** `src/conductor/test/structural/fixture-portability.test.ts`
**Wired-into:** none (fixtures feed the existing falsifiability assertions)
**Dependencies:** 2

### Task 4: Non-regression — substring trap + marker preserved
**Story:** Story 3a (substring trap) + Story 2b (marker)
**Type:** negative-path
**Steps:**
1. Add explicit test cases asserting: a bare line (`['init', '--bare', '-q']`) with no marker VIOLATES; a bare line with `-b main` PASSES; a bare line with a trailing `// portability-ok:` marker PASSES (empty reason still passes); the count assertion `violations.length === KNOWN_BAD_FIXTURES.length` (lines 310–324) holds.
2. Verify RED against pre-fix behavior where feasible, then GREEN against Tasks 1–3.
**Files:** `src/conductor/test/structural/fixture-portability.test.ts`
**Wired-into:** none
**Dependencies:** 3

### Task 5: GREEN + full-suite check
**Story:** all
**Type:** verification
**Steps:**
1. Run the structural suite: `rtk proxy npx vitest run test/structural/fixture-portability.test.ts` in `src/conductor` (each worktree needs its own `npm install`).
2. Confirm no other test file in the repo now trips the tightened guard (search for `git init` bare fixtures elsewhere; pin or mark any that legitimately observe HEAD, or leave as intended violations to fix separately — report, do not silently mass-edit).
3. Keep diffs minimal.
**Files:** `src/conductor/test/structural/fixture-portability.test.ts`
**Wired-into:** none
**Dependencies:** 4

## Files likely touched

- `src/conductor/test/structural/fixture-portability.test.ts` — the only file: matcher
  helper, five call sites, `KNOWN_BAD_FIXTURES`/`KNOWN_GOOD_FIXTURES`, the four-shapes
  bare case, and new regression cases.

## Verification

- [ ] `git init --bare` without `-b`/`--initial-branch` and without a marker is a violation.
- [ ] `git init --bare -b main` and marker-carrying bare inits pass.
- [ ] `--bare` alone is not mis-read as `-b` (substring trap closed).
- [ ] `KNOWN_BAD_FIXTURES` carries a bare-init case and the count assertion holds.
- [ ] Structural suite green; no unrelated fixtures newly tripped without a decision.

## Out of scope

- Fixing every existing bare-init fixture elsewhere in the suite (report offenders; a
  bare origin used as a remote should be pinned in its own follow-up if any remain).
- Extracting the guard into a `src/` module — the fix does not need relocation.
- The runtime default-branch resolution in `daemon-backlog.ts` (the guard is what
  should have caught the fixture; the runtime code is not at fault here).
