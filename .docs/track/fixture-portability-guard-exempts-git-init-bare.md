# Track: fixture-portability guard exempts `git init --bare` from branch pinning

Track: technical

## Why technical

This is a defect fix in an internal test-infrastructure guard
(`fixture-portability.test.ts`'s `git init` matcher). There is no user-facing
product surface, no new product behavior, and nothing PRD-worthy — the acceptance
criteria are purely mechanical (a bare repo whose HEAD a test can observe must fail
the guard unless its initial branch is pinned or a `// portability-ok:` marker is
present). Acceptance criteria live in the stories, not a PRD.

## Context (verified against `main`)

The structural fixture-portability guard scans test files for `git init` calls that
fail to pin an initial branch — a portability hazard because on CI runners without a
global `init.defaultBranch`, a repo's HEAD defaults to `master` while pushed branches
are `main`. The guard lives entirely inside one test file:
`src/conductor/test/structural/fixture-portability.test.ts`.

The matcher is `extractGitInitPattern(line)` (lines 125–164). Its `hasFlag`
computation is repeated verbatim in all five exec-shape branches (lines 135, 141,
147, 153, 159):

```ts
const hasFlag = line.includes('-b') || line.includes('--bare');
```

`scanFileForViolations` (lines 189–191) treats `hasFlag` as satisfying the guard:

```ts
// If pattern has -b or --bare, it's OK
if (pattern.hasFlag) { continue; }
```

So `git init --bare` (no `-b`) is vouched for. That is exactly wrong when a test
**reads the bare repo's HEAD** (uses it as an origin/remote): the origin HEAD points
at `master` while every pushed branch is `main`, default-branch resolution misses,
and the suite fails **on every fresh PR CI run** while passing locally (operator
gitconfig sets `init.defaultBranch=main`). Live incident 2026-07-11: 10 heal-integration
tests in `test/engine/daemon-backlog.test.ts` red on CI, green locally; bisect proof
`GIT_CONFIG_GLOBAL=/dev/null npx vitest run …` → 10 failed. Fixed instance: commit
d50b88e8 (PR #453) pinned the bare origin with `-b main`. The guard ran green over the
bad shape the whole time.

**Root-cause subtlety (must be handled):** `"--bare".includes("-b")` is `true`, so
simply deleting `|| line.includes('--bare')` does NOT make `git init --bare` fail —
the naive `-b` substring check still matches the `-b` inside `--bare`. The matcher
must distinguish a real `-b`/`--initial-branch <name>` flag (a standalone token
followed by a branch name) from the `--bare` substring.

## Approaches considered

1. **Tighten `extractGitInitPattern` to match `-b`/`--initial-branch` as a real
   flag, not a substring; drop the blanket `--bare` exemption; add a known-BAD
   bare-init fixture (chosen).** Replace the five `line.includes('-b') ||
   line.includes('--bare')` sites with a precise branch-pin detector (regex for
   `-b <name>` / `--initial-branch <name>` as a token), so `git init --bare` alone
   fails and `git init --bare -b main` passes. Keep the `// portability-ok:` escape
   hatch (lines 131, 193–196) for bare repos whose HEAD genuinely never matters. Add
   a known-BAD entry to `KNOWN_BAD_FIXTURES` (lines 53–59) so the exemption cannot
   regress unnoticed, and convert the bare known-good fixtures (line 64 and the
   four-shapes case at line 347) to either pinned or marker-carrying forms. One file.

2. **Special-case only bare repos used as an origin.** Rejected: the guard scans
   source text line-by-line and cannot reliably tell whether a bare repo's HEAD is
   later observed; the correct, cheap default is "pin the branch or mark it exempt",
   with the marker carrying the human reason. Trying to infer HEAD-observation adds
   complexity for no gain.

3. **Extract the guard into a `src/` module and unit-test it separately.**
   Rejected as scope creep: the guard is self-contained in the one test file and the
   fix does not need relocation; refactoring the guard's home is a separate concern.

Decision: **Approach 1.**
