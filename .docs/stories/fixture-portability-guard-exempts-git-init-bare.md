# Stories: fixture-portability guard exempts `git init --bare` from branch pinning

Status: Accepted

Source issue: jstoup111/ai-conductor#528

These stories specify the behavior of the structural fixture-portability guard's
`git init` matcher (`extractGitInitPattern` / `scanFileForViolations` in
`src/conductor/test/structural/fixture-portability.test.ts`). Acceptance criteria are
Given/When/Then and are the authority for this technical-track fix (no PRD).

---

## Story 1 — A bare repo without a pinned branch now violates the guard (happy path)

**As** a harness maintainer
**I want** the guard to flag `git init --bare` that lacks an initial-branch pin
**So that** a bare repo whose HEAD a test observes cannot silently default to
`master` on CI and cause a repo-red false failure.

### Scenario 1a: bare, no `-b`, no marker → violation

- **Given** a test-file line `await exec('git', ['init', '--bare', '-q'], { cwd: dir });`
  with no `-b`/`--initial-branch` flag and no `// portability-ok:` marker,
- **When** `scanFileForViolations` runs over it,
- **Then** the line is reported as a violation (it is NOT exempted by `--bare`).

### Scenario 1b: the known-BAD fixtures all violate

- **Given** `KNOWN_BAD_FIXTURES` now includes a bare-init-without-`-b` case,
- **When** the guard's falsifiability test asserts every known-bad fixture violates,
- **Then** the count assertion holds (`violations.length === KNOWN_BAD_FIXTURES.length`),
  so the exemption cannot regress back in unnoticed.

---

## Story 2 — Pinned or marker-carrying bare repos still pass (negative path)

**As** a test author
**I want** a bare repo whose branch is pinned, or whose HEAD genuinely never matters,
to keep passing the guard
**So that** legitimate fixtures are not false-flagged.

### Scenario 2a: bare with `-b main` passes

- **Given** a line `await exec('git', ['init', '--bare', '-b', 'main', '-q'], { cwd: dir });`,
- **When** the guard scans it,
- **Then** no violation is reported (the initial branch is pinned).

### Scenario 2b: bare with `// portability-ok:` marker passes

- **Given** a bare-init line carrying a trailing `// portability-ok: HEAD never observed`
  marker,
- **When** the guard scans it,
- **Then** no violation is reported — the existing marker escape hatch (empty reason
  still passes) is preserved for bare repos whose HEAD genuinely never matters.

---

## Story 3 — The `-b`-inside-`--bare` substring trap does not resurrect the exemption (negative path / regression)

**As** the guard
**I want** to detect `-b`/`--initial-branch` as a real flag token, not as a substring
**So that** `git init --bare` is not accidentally treated as branch-pinned because the
literal characters `-b` appear inside `--bare`.

### Scenario 3a: `--bare` alone does not count as `-b`

- **Given** the matcher's branch-pin detection,
- **When** it evaluates a line whose only relevant token is `--bare` (the string
  `"--bare"` contains the substring `"-b"`),
- **Then** the detector reports the line as **not** branch-pinned (a naive
  `line.includes('-b')` would wrongly report pinned),
- **And** consequently Scenario 1a's bare-without-`-b` line violates as specified.

### Scenario 3b: other exec shapes stay consistent

- **Given** the four/five exec shapes the guard recognizes (`exec`, `execFile`,
  `execSync`, `spawn`, and the array/inline forms),
- **When** each is given a bare-without-`-b` line,
- **Then** every shape reports a violation (no shape retains the old blanket `--bare`
  pass), and the `detects all four exec shapes correctly` test reflects this
  (`shouldViolate: true` for bare-without-`-b`).
