# Plan: engineer (brain) CLI — subcommand `--help` executes the command instead of printing help

Source: jstoup111/ai-conductor#524
Tier: S (technical track)

All paths are relative to the repo root. Source under `src/conductor/src/`, tests
under `src/conductor/test/` (NOT `src/conductor/src/`). Run the suite from
`src/conductor` (`cd src/conductor && npx vitest run <path>`).

Root cause (verified, file:line): `detectEngineerCommand` in
`src/conductor/src/engine/engineer-cli.ts:128-252` dispatches purely by matching
`argv[3]` against a subcommand literal and returning that subcommand's mutating/query
kind unconditionally — e.g. the `claim` branch at `engineer-cli.ts:186-189`:
```
if (subCmd === 'claim') {
  return { kind: 'claim' };
}
```
never inspects the rest of `argv` for `--help`/`-h`, so `engineer claim --help` parses
identically to `engineer claim` and `dispatchEngineer`'s `case 'claim':`
(`engineer-cli.ts:892-963`) executes for real. The sibling `daemon` subcommand already
has the correct guard, proven in production, at `src/conductor/src/index.ts:378-388` —
this plan applies the same "check `--help`/`-h` before any subcommand logic runs"
shape inside `detectEngineerCommand` itself (the actual dispatch/mutation site for
`engineer`, unlike `daemon` which routes through a separate `detectDaemonCommand`).

## Tasks

### Task 1 — `--help`/`-h` short-circuit guard + `help` dispatch kind (root-cause fix)

**Story:** Story 1 (happy + negative — the literal #524 repro).

**Type:** bugfix

**Steps:**
- RED: create `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`. Import
  `detectEngineerCommand` from `../../../src/engine/engineer-cli.js`. Add an
  `argv(...rest)` helper identical to the one in
  `engineer-cli-resolve.test.ts:16` (`['node', 'conduct-ts', 'engineer', ...rest]`).
  Assert: (a) for each of `projects`, `worktree`, `land`, `handoff`, `poll`, `claim`,
  `forget`, `resolve`, `migrate-issue-deps`, `detectEngineerCommand(argv(sub,
  '--help'))` returns `{kind:'help', topic: sub}` — NOT that subcommand's normal kind
  (e.g. NOT `{kind:'claim'}`); (b) the same with `-h` in place of `--help`; (c)
  `--help` anywhere in the argv (not just immediately after the subcommand) is still
  caught, e.g. `detectEngineerCommand(argv('land', '--project', 'x', '--help'))` →
  `{kind:'help', topic:'land'}`; (d) the exact issue repro —
  `detectEngineerCommand(argv('claim', '--help'))` → `{kind:'help', topic:'claim'}`,
  explicitly NOT `{kind:'claim'}`; (e) a regression guard: bare
  `detectEngineerCommand(argv('--help'))` (no subcommand token) still returns
  `{kind:'guide'}` exactly as today — the new guard must not touch this existing,
  already-correct fallback path. Run — fails (`help` kind does not exist; `claim
  --help` returns `{kind:'claim'}`).
- GREEN: in `src/conductor/src/engine/engineer-cli.ts`:
  - Add `| { kind: 'help'; topic: string }` to the `EngineerDispatch` union
    (lines 102-113).
  - In `detectEngineerCommand`, immediately after the bare-`launch` check closes
    (after line 138's `}`, before line 140's `if (subCmd === 'projects')`), insert:
    ```ts
    // #524: --help/-h MUST be checked BEFORE any subcommand's own dispatch logic —
    // mirrors the `daemon --help` guard in index.ts:378-388 (same failure class:
    // otherwise the flag is silently ignored and the subcommand actually executes).
    const KNOWN_SUBCOMMANDS = new Set([
      'projects', 'worktree', 'land', 'handoff', 'poll', 'claim', 'forget', 'resolve',
      'migrate-issue-deps',
    ]);
    if (KNOWN_SUBCOMMANDS.has(subCmd) && argv.slice(4).some((a) => a === '--help' || a === '-h')) {
      return { kind: 'help', topic: subCmd };
    }
    ```
  Run — passes.
- COMMIT: `fix(engineer-cli): --help/-h short-circuits every subcommand before dispatch (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-help.test.ts` (new)

**Dependencies:** none

---

### Task 2 — `dispatchEngineer` renders per-subcommand help with zero side effects

**Story:** Story 1 (zero-side-effects assertion), Story 2 (happy — content).

**Type:** feature

**Steps:**
- RED: extend `engineer-cli-help.test.ts` with a `dispatchEngineer` integration
  block (mirror the `captureOut()` helper from `engineer-cli-resolve.test.ts:102-111`).
  For each of the 9 subcommands, dispatch `{kind:'help', topic: sub}` with `print`/
  `printErr` spies AND a `gh` spy that `throw`s if called AND an `engineerDir` pointing
  at a nonexistent temp path (`/tmp/engineer-cli-help-<rand>/nope`) — if the help path
  touches the ledger/fs/gh it will throw. Assert: exit code `0`; exactly one line
  printed; the printed text contains the subcommand name; `gh` spy never called; no
  throw. Also assert the printed text for `claim` explicitly mentions what it mutates
  (contains the word "ledger" or "inbox") and for `projects` explicitly states it is
  read-only (contains "read-only"). Run — fails (no `case 'help'` in the switch).
- GREEN: in `src/conductor/src/engine/engineer-cli.ts`, add a `SUBCOMMAND_HELP:
  Record<string, string>` constant near `printGuide` (before `dispatchEngineer`), one
  entry per subcommand in `KNOWN_SUBCOMMANDS`, each stating: what it does (one
  sentence), its flags (required vs optional, pulled 1:1 from the existing
  `parseFlag`/positional calls in that subcommand's `detectEngineerCommand` branch),
  what durable state it mutates (or "Mutates: nothing (read-only)" for `projects`),
  and where it sits in the idea→spec loop (claim → worktree → land → handoff →
  resolve/forget; `poll`/`migrate-issue-deps` are out-of-band maintenance ops — say
  so explicitly). Add `case 'help': { print(SUBCOMMAND_HELP[dispatch.topic] ?? ''); return 0; }`
  to the `switch` in `dispatchEngineer` (alongside the existing `case 'guide':` at
  line 587). Run — passes.
- COMMIT: `feat(engineer-cli): per-subcommand --help text (what/flags/mutates/loop-fit) (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`

**Dependencies:** Task 1

---

### Task 3 — Help-content completeness guard (every known subcommand has help text)

**Story:** Story 2 (negative — a future subcommand added without help coverage fails a test).

**Type:** test-only (regression guard)

**Steps:**
- RED: in `engineer-cli-help.test.ts`, add a test that imports both
  `KNOWN_SUBCOMMANDS`-equivalent list (export it from `engineer-cli.ts` if not already,
  or hardcode the same 9-element list matching Task 1's set — prefer exporting a
  single source of truth, e.g. `export const ENGINEER_SUBCOMMANDS = [...]` used by both
  the guard clause and this test) and `SUBCOMMAND_HELP`, and asserts every entry in
  the list has a non-empty corresponding value in the map, and that the map has no
  EXTRA keys outside the list (catches a typo'd topic key). Run — fails if
  `SUBCOMMAND_HELP` and the subcommand list have drifted (they won't yet, since Task
  2 just wrote both — this test's value is purely as a future regression guard, so it
  should pass immediately once `ENGINEER_SUBCOMMANDS` is exported and used by both
  sites).
- GREEN: in `engineer-cli.ts`, promote the inline `KNOWN_SUBCOMMANDS` Set from Task 1
  to a single exported source of truth, e.g. `export const ENGINEER_SUBCOMMANDS =
  ['projects', 'worktree', 'land', 'handoff', 'poll', 'claim', 'forget', 'resolve',
  'migrate-issue-deps'] as const;`, and derive both the Task 1 guard's `Set` and the
  `SUBCOMMAND_HELP` map's expected keys from it (a `satisfies Record<typeof
  ENGINEER_SUBCOMMANDS[number], string>` type constraint on `SUBCOMMAND_HELP` gives a
  compile-time guarantee too — add it). Run — passes.
- COMMIT: `test(engineer-cli): guard every known subcommand has --help coverage (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`

**Dependencies:** Task 2

---

### Task 4 — Unknown-flag rejection: zero/boolean-flag subcommands (`projects`, `poll`, `claim`, `migrate-issue-deps`)

**Story:** Story 3 (happy + negative — no regression on existing valid invocations).

**Type:** feature

**Steps:**
- RED: create `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`
  with the same `argv(...)` helper. Assert: (a)
  `detectEngineerCommand(argv('claim', '--verbose'))` →
  `{kind:'reject', sub:'claim', flag:'--verbose'}`; (b) same shape for
  `detectEngineerCommand(argv('poll', '--bogus'))` and
  `detectEngineerCommand(argv('projects', '--typo'))`; (c)
  `detectEngineerCommand(argv('migrate-issue-deps', '--bogus'))` rejects, while
  `detectEngineerCommand(argv('migrate-issue-deps', '--confirm'))` still returns
  `{kind:'migrate-issue-deps', confirm:true}` (no regression on the one real flag);
  (d) regression: `detectEngineerCommand(argv('claim'))` and
  `detectEngineerCommand(argv('poll'))` and `detectEngineerCommand(argv('projects'))`
  (no extra flags) are UNCHANGED (`{kind:'claim'}` / `{kind:'poll'}` /
  `{kind:'projects'}`). Run — fails (extra flags currently silently ignored).
- GREEN: in `engineer-cli.ts`, add `| { kind: 'reject'; sub: string; flag: string }` to
  `EngineerDispatch`. Add a small helper above `detectEngineerCommand`:
  ```ts
  /** First argv token (from index 4) starting with `--` that isn't in `allowed`
   * and isn't `--help`/`-h` (already handled earlier) — or null if none. */
  function findUnknownFlag(argv: string[], allowed: string[]): string | null {
    for (let i = 4; i < argv.length; i++) {
      const tok = argv[i];
      if (tok.startsWith('--') && tok !== '--help' && !allowed.includes(tok)) return tok;
    }
    return null;
  }
  ```
  In the `subCmd === 'projects'` branch, before `return { kind: 'projects' };`, add
  `const unk = findUnknownFlag(argv, []); if (unk) return { kind: 'reject', sub: 'projects', flag: unk };`.
  Same pattern for `poll` (allowed `[]`) and `claim` (allowed `[]`) immediately before
  their existing returns. For `migrate-issue-deps`, allowed is `['--confirm']` — insert
  the check before `return { kind: 'migrate-issue-deps', confirm };`. Run — passes.
- COMMIT: `feat(engineer-cli): reject unknown flags on projects/poll/claim/migrate-issue-deps (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts` (new)

**Dependencies:** Task 1 (shares the `--help` precedence ordering — the `--help` guard
must still run first; a token can never be simultaneously `--help` and "unknown" since
`findUnknownFlag` explicitly excludes `--help`)

---

### Task 5 — Unknown-flag rejection: positional + optional-flag subcommands (`forget`, `resolve`)

**Story:** Story 3 (happy + negative).

**Type:** feature

**Steps:**
- RED: extend `engineer-cli-unknown-flag.test.ts`. Assert: (a)
  `detectEngineerCommand(argv('forget', 'o/a#1', '--force'))` →
  `{kind:'reject', sub:'forget', flag:'--force'}`; (b)
  `detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'https://x/1', '--dry-run'))`
  → `{kind:'reject', sub:'resolve', flag:'--dry-run'}`; (c) regression: every existing
  passing case in `engineer-cli-resolve.test.ts` (valid `--pr-url`/`--branch`
  combinations, and the missing-required-flag → `{kind:'guide'}` cases) is unchanged —
  re-run that file too, not just the new one. Run — fails.
- GREEN: in `engineer-cli.ts`, in the `subCmd === 'forget'` branch, after resolving
  `sourceRef` (and before its final `return { kind: 'forget', sourceRef };`), add
  `const unk = findUnknownFlag(argv, []); if (unk) return { kind: 'reject', sub: 'forget', flag: unk };`.
  In the `subCmd === 'resolve'` branch, after computing `prUrl`/`branch` (and before
  the final `return { kind: 'resolve', sourceRef, prUrl, branch };`), add
  `const unk = findUnknownFlag(argv, ['--pr-url', '--branch']); if (unk) return { kind: 'reject', sub: 'resolve', flag: unk };`.
  Run — passes.
- COMMIT: `feat(engineer-cli): reject unknown flags on forget/resolve (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`
- `src/conductor/test/engine/engineer/engineer-cli-resolve.test.ts` (re-run only, no edits expected)

**Dependencies:** Task 4

---

### Task 6 — Unknown-flag rejection: required-named-flag subcommands (`worktree`, `land`, `handoff`)

**Story:** Story 3 (happy + negative).

**Type:** feature

**Steps:**
- RED: extend `engineer-cli-unknown-flag.test.ts`. Assert: (a)
  `detectEngineerCommand(argv('worktree', '--project', 'p', '--idea', 'i', '--extra', 'x'))`
  → `{kind:'reject', sub:'worktree', flag:'--extra'}`; (b)
  `detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w', '--bogus'))`
  → `{kind:'reject', sub:'land', flag:'--bogus'}` (and a variant WITH `--source-ref`
  present too, still rejecting the unrelated `--bogus`); (c)
  `detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'b', '--worktree', 'w', '--nope'))`
  → `{kind:'reject', sub:'handoff', flag:'--nope'}`; (d) regression: valid
  `worktree`/`land`/`handoff` invocations with ONLY recognized flags (with and without
  the optional `--source-ref`) are unchanged, and missing-required-flag cases still
  return `{kind:'guide'}` exactly as before. Run — fails.
- GREEN: in `engineer-cli.ts`:
  - `worktree` branch: after confirming `project`/`idea` are present, add
    `const unk = findUnknownFlag(argv, ['--project', '--idea']); if (unk) return { kind: 'reject', sub: 'worktree', flag: unk };`
    before `return { kind: 'worktree', project, idea };`.
  - `land` branch: after computing `sourceRef`, add
    `const unk = findUnknownFlag(argv, ['--project', '--idea', '--worktree', '--source-ref']); if (unk) return { kind: 'reject', sub: 'land', flag: unk };`
    before the final `return { kind: 'land', ... };`.
  - `handoff` branch: same pattern with allowed
    `['--project', '--branch', '--worktree', '--source-ref']`.
  Run — passes.
- COMMIT: `feat(engineer-cli): reject unknown flags on worktree/land/handoff (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`

**Dependencies:** Task 5

---

### Task 7 — `dispatchEngineer` handles the `reject` kind (exit 1, no mutation)

**Story:** Story 3 (happy + negative — zero mutation on rejection).

**Type:** feature

**Steps:**
- RED: extend `engineer-cli-unknown-flag.test.ts` with a `dispatchEngineer`
  integration block (same `captureOut()` + throwing-`gh`-spy + nonexistent
  `engineerDir` pattern as Task 2). Dispatch `{kind:'reject', sub:'claim',
  flag:'--verbose'}` and assert: exit code `1`; stderr contains both `'claim'` and
  `'--verbose'`; stdout is empty; the `gh` spy is never called. Repeat for one
  representative case per Task 4/5/6 group (`projects`, `resolve`, `land`) to cover
  each allowlist shape. Run — fails (no `case 'reject'` in the switch).
- GREEN: in `engineer-cli.ts`, add to the `dispatchEngineer` switch:
  ```ts
  case 'reject': {
    printErr(`engineer ${dispatch.sub}: unknown flag '${dispatch.flag}' — run \`engineer ${dispatch.sub} --help\` for usage.`);
    return 1;
  }
  ```
  Run — passes.
- COMMIT: `feat(engineer-cli): reject unknown-flag dispatch exits 1 with zero mutation (#524)`

**Files:**
- `src/conductor/src/engine/engineer-cli.ts`
- `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`

**Dependencies:** Task 6

---

### Task 8 — Root `conduct-ts --help` names both loops; generated reference is complete

**Story:** Story 4 (happy + negative — rename-neutral wording).

**Type:** docs/feature (commander declarations only — never executed for dispatch)

**Steps:**
- RED: extend `src/conductor/test/cli/index.test.ts`'s existing `describe('renderFullHelp
  (root-level full reference)', ...)` block (around line 133). Add assertions that
  `help` (from `renderFullHelp()`) contains `'conduct engineer worktree'`,
  `'conduct engineer poll'`, `'conduct engineer claim'`, `'conduct engineer forget'`,
  `'conduct engineer resolve'`, `'conduct engineer migrate-issue-deps'` (currently
  absent from the generated tree — only `projects`/`land`/`handoff` are declared), and
  that it contains `'--worktree'` and `'--source-ref'` (currently absent — `land`/
  `handoff` are declared without these two real, required/optional flags). Also add a
  test on `createProgram().helpInformation()` (the top-level program description)
  asserting it mentions BOTH `'daemon'` and `'engineer'` and contains the string
  `'engineer --help'`. Run — fails.
- GREEN: in `src/conductor/src/cli.ts`:
  - In `createProgram()` (lines 127-142), add the six missing subcommand
    declarations under the existing `engineer` const: `.command('worktree')` (options
    `--project`, `--idea`), `.command('poll')`, `.command('claim')`,
    `.command('forget <sourceRef>')`, `.command('resolve <sourceRef>')` (options
    `--pr-url`, `--branch`), `.command('migrate-issue-deps')` (option `--confirm`) —
    each with a one-line `.description(...)` matching its `SUBCOMMAND_HELP` entry from
    Task 2. Add `--worktree` and `--source-ref` options to the existing `land` and
    `handoff` declarations (both currently missing them).
  - In `createBaseProgram()` (lines 74-78), extend `.description(...)` to name both
    loops, e.g. `'Orchestrate SDLC pipeline — two loops: the build/ship daemon
    (`daemon`) and the engineer/brain idea→spec loop (`engineer`, or `engineer
    --help` for its full command reference)'`. Use this dual-naming style (not a
    single new name) so the wording is correct regardless of how #227 resolves.
  Run — passes.
- COMMIT: `docs(cli): complete engineer subtree + name both loops in root --help (#524)`

**Files:**
- `src/conductor/src/cli.ts`
- `src/conductor/test/cli/index.test.ts`

**Dependencies:** Task 2 (reuses the `SUBCOMMAND_HELP` wording as the source for each
new commander `.description(...)` so the two help surfaces — runtime `--help`/`-h` and
the generated `conduct-ts --help` reference — never drift apart)

---

### Task 9 — Docs, CHANGELOG, full regression pass

**Story:** all (verification + "Docs track features").

**Type:** docs + verification

**Steps:**
- Update `README.md` and `src/conductor/README.md`'s engineer/CLI command-surface
  section: note that every `engineer <subcommand> --help`/`-h` now prints usage with
  zero side effects, and that an unrecognized flag on a subcommand is now rejected
  (exit 1) instead of silently ignored.
- Confirm the `## [Unreleased]` CHANGELOG entry (added at spec time — see below) is
  still accurate once the implementation lands; amend wording only if the actual
  GREEN implementation diverged from the plan (it should not).
- Run `cd src/conductor && npx vitest run test/engine/engineer/engineer-cli-help.test.ts
  test/engine/engineer/engineer-cli-unknown-flag.test.ts test/cli/index.test.ts` —
  green.
- Run the FULL existing `engineer-cli-*.test.ts` suite (all 8 pre-existing files under
  `src/conductor/test/engine/engineer/`) — green, confirming zero regression on every
  previously-valid invocation shape.
- Run `cd src/conductor && npx tsc --noEmit` — the two new `EngineerDispatch` union
  members and every new call site typecheck.
- Run `test/test_harness_integrity.sh` from the repo root — green (this repo's own
  validation gate).

**Files:**
- `README.md`
- `src/conductor/README.md`
- `CHANGELOG.md` (verify only — already added at spec time)

**Dependencies:** Task 8

---

## Task Dependency Graph

```
Task 1 (--help guard + `help` kind)
   ├─▶ Task 2 (dispatchEngineer renders help; per-subcommand content)
   │       └─▶ Task 3 (help-content completeness guard)
   └─▶ Task 4 (unknown-flag: zero/boolean-flag subs)
           └─▶ Task 5 (unknown-flag: positional + optional-flag subs)
                   └─▶ Task 6 (unknown-flag: required-named-flag subs)
                           └─▶ Task 7 (dispatchEngineer renders reject)
Task 2 ─────────────────────────────────────────────────▶ Task 8 (root --help completeness)
Task 7, Task 8 ──────────────────────────────────────────▶ Task 9 (docs + changelog + full regression)
```

**Dependencies:** T2→T1; T3→T2; T4→T1; T5→T4; T6→T5; T7→T6; T8→T2; T9→T7,T8.

## Verification

- Every subcommand in `ENGINEER_SUBCOMMANDS` responds to `--help`/`-h` (anywhere in its
  argv) with `{kind:'help'}` and zero calls into `gh`/ledger/fs (Tasks 1-3).
- Every subcommand rejects an unrecognized flag with `{kind:'reject'}` → exit 1, zero
  mutation, while every PRE-EXISTING valid invocation shape (asserted by the 8
  pre-existing `engineer-cli-*.test.ts` files) is unchanged (Tasks 4-7).
- `conduct-ts --help` documents every real subcommand and flag `detectEngineerCommand`
  accepts, and the root description names both loops with a pointer to
  `engineer --help` (Task 8).
- `test/test_harness_integrity.sh` green; full `src/conductor` vitest suite green;
  `tsc --noEmit` green (Task 9).

## Coverage Mapping (story → tasks)

- Story 1 (`--help`/`-h` short-circuits every subcommand, zero side effects) → Tasks 1, 2
- Story 2 (per-subcommand help documents what/flags/mutates/loop-fit) → Tasks 2, 3, 8
- Story 3 (unknown flags rejected, no state change, no regression) → Tasks 4, 5, 6, 7
- Story 4 (root `--help` names both loops, complete reference, rename-neutral) → Task 8
