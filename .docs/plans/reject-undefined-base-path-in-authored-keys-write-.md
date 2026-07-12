# Implementation plan — Reject an `undefined` base path in the authored-keys write

Add a fail-closed guard to the authored-keys ledger so a base directory that
resolves to the sentinel string `"undefined"`/`"null"`, a blank value, or any
non-absolute path is REJECTED with a clear error instead of silently writing
`undefined/authored-keys.json` under `process.cwd()`. Fix the acceptance test's
env save/restore so an unset `$AI_CONDUCTOR_ENGINEER_DIR` is never coerced to the
string `"undefined"` and left to poison the worker's `process.env`. Results for a
correctly-configured (absolute) base — including the default
`~/.ai-conductor/engineer` — are unchanged.

Root cause (verified): `authored-ledger.ts:89-91` and `:55-58` join the ledger
file onto an unvalidated base; `engineer-store.ts:186` returns a non-empty
override string verbatim; `test/acceptance/engineer.test.ts:88` assigns an unset
`savedEnv` value, coercing `undefined` → the string `"undefined"`; the flywheel
tests' no-opts `createAuthoredLedger().record('alpha', …)`
(`engineer.test.ts:596-597,611` → `flywheel-trend.ts:138`) then write the
`alpha/*` fixtures to `undefined/authored-keys.json` in the primary checkout.

## Summary

One small guard helper (`assertLedgerBase`) added in `authored-ledger.ts`, reused
by both `recordAuthoredKey` (write) and `ledgerPath` (read). It follows the
existing sentinel guard (`owner-gate/identity.ts:81`) and absolute-path guard
(`engineer/authoring-guard.ts:82`). The acceptance test's restore is switched to
the conditional-delete pattern already canonical at `engineer-store.test.ts:85-87`.
Tests are added under `src/conductor/test/...` (#538). No CLI/hook/schema/ADR
surface; `resolveEngineerDir` and the default store location are untouched.

## Tasks

### Task 1: Add a fail-closed base guard and apply it to the write path
**Story:** Story 1 (reject sentinel/blank/non-absolute base); Story 3 (accept absolute bases)
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/engineer/authored-ledger.test.ts`:
   `recordAuthoredKey('p','f', { engineerDir: 'undefined' })` rejects with an Error
   whose message contains the base value and `authored-keys.json`; and that after
   the call `process.cwd()` has NO `undefined/` entry. Add parametrized cases for
   `'null'`, `''`, `'   '`, and a relative base `'engineer'` — all reject.
2. Verify RED (today they silently write `undefined/authored-keys.json`).
3. Implement in `src/conductor/src/engine/engineer/authored-ledger.ts`: add
   `function assertLedgerBase(dir: string): string` that throws a clear Error when
   `!dir || dir.trim() === '' || dir === 'undefined' || dir === 'null' ||
   !isAbsolute(dir)` (import `isAbsolute` from `node:path`; mirror the wording of
   `owner-gate/identity.ts:81` + `authoring-guard.ts:82`). Call it on the resolved
   `dir` in `recordAuthoredKey` (before `mkdir`, `authored-ledger.ts:89-91`).
4. Verify GREEN.
5. Commit: "fix(engineer): reject non-absolute/undefined authored-keys base at write site (#574)"

**Files:**
- src/conductor/src/engine/engineer/authored-ledger.ts
- src/conductor/test/engine/engineer/authored-ledger.test.ts

**Dependencies:** none

### Task 2: Apply the guard to the read path (`ledgerPath`/`readAuthoredKeys`)
**Story:** Story 1 (read side also rejects a poisoned base, never silently consults it)
**Type:** negative-path

**Steps:**
1. Write failing test: `readAuthoredKeys({ engineerDir: 'undefined' })` rejects with
   the same clear base-rejected error (today it would resolve `undefined/authored-keys.json`
   and return `[]` on ENOENT, silently masking the misresolution).
2. Verify RED.
3. Implement: call `assertLedgerBase(dir)` inside `ledgerPath`
   (`authored-ledger.ts:55-58`) so `readAuthoredKeys` throws before any `readFile`.
   Confirm the ENOENT-as-empty behavior is preserved for a VALID absolute base.
4. Verify GREEN.
5. Commit: "fix(engineer): reject poisoned authored-keys base on read path too (#574)"

**Files:**
- src/conductor/src/engine/engineer/authored-ledger.ts
- src/conductor/test/engine/engineer/authored-ledger.test.ts

**Dependencies:** 1

### Task 3: Assert the correctly-configured write is unchanged (guard does not over-reject)
**Story:** Story 3 (absolute base + default location behave exactly as today)
**Type:** negative-path

**Steps:**
1. Write tests: (a) `recordAuthoredKey('proj','feat', { engineerDir: <abs temp> })`
   writes `<temp>/authored-keys.json` with the pair (idempotency/merge intact);
   (b) with no `engineerDir` and no env override but an INJECTED `home` temp dir,
   the write lands at `<home>/.ai-conductor/engineer/authored-keys.json` (canonical
   store) — passing `{ home: <temp> }` through opts so the real `$HOME` is untouched;
   (c) a valid absolute `$AI_CONDUCTOR_ENGINEER_DIR` override still writes there.
2. Verify RED/GREEN (these should pass once the guard accepts absolute bases; they
   are the regression guard proving no over-rejection).
3. Implement: none beyond Task 1/2 if the guard is correct; adjust only if a test
   reveals over-rejection.
4. Verify GREEN.
5. Commit: "test(engineer): guard accepts absolute + default authored-keys bases (#574)"

**Files:**
- src/conductor/test/engine/engineer/authored-ledger.test.ts

**Dependencies:** 1, 2

### Task 4: Fix the leaking acceptance test's env save/restore + poison regression
**Story:** Story 2 (tests scope writes to temp; env never left as the string "undefined")
**Type:** infrastructure

**Steps:**
1. Write failing regression test: poison `process.env.AI_CONDUCTOR_ENGINEER_DIR =
   'undefined'`, then call a no-opts `createAuthoredLedger().record('p','f')` and
   assert it THROWS (per Task 1) and creates no `undefined/` under cwd; restore env
   in a `finally`. (This is the executable proof the leak can no longer occur.)
2. Verify RED against pre-Task-1 code / GREEN after.
3. Implement the restore fix in `test/acceptance/engineer.test.ts` `afterEach`
   (`:86-90`): replace the unconditional
   `process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;`
   (and the sibling `AI_CONDUCTOR_REGISTRY` line at `:87`, which shares the defect)
   with the conditional-delete pattern from `engineer-store.test.ts:85-87`:
   `if (savedEnv.X === undefined) delete process.env.X; else process.env.X = savedEnv.X;`.
4. Verify GREEN; run the acceptance file to confirm no cwd litter is produced.
5. Commit: "test(engineer): conditional-delete env restore stops 'undefined' env poisoning (#574)"

**Files:**
- src/conductor/test/acceptance/engineer.test.ts

**Dependencies:** 1

### Task 5: Focused suite run + CHANGELOG
**Story:** Story 1 & 2 (end-to-end: no `undefined/` litter after a full run)
**Type:** infrastructure

**Steps:**
1. Run the focused suites:
   `cd src/conductor && npx vitest run test/engine/engineer/authored-ledger.test.ts test/acceptance/engineer.test.ts`
   and confirm green.
2. Assert, after the run, `git status` in the primary checkout shows NO untracked
   `undefined/` directory or stray `authored-keys.json` (the observed-litter
   regression check).
3. Add a `## [Unreleased]` → `### Fixed` CHANGELOG entry: authored-keys write now
   rejects a non-absolute/`undefined` base with a clear error instead of writing
   `undefined/authored-keys.json` under cwd; acceptance test no longer poisons
   `$AI_CONDUCTOR_ENGINEER_DIR` (#574).
4. Run `test/test_harness_integrity.sh` and confirm green.
5. Commit: "docs(changelog): authored-keys base guard + env-restore fix (#574)"

**Files:**
- CHANGELOG.md

**Dependencies:** 1, 2, 3, 4

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T3
 │      │      │
 ├──────┼──────┼──▶ T5
 └──▶ T4 ──────────┘
```

**Dependencies:** T2→T1; T3→T1,T2; T4→T1; T5→T1,T2,T3,T4. Acyclic.

## Verification

- `cd src/conductor && npx vitest run test/engine/engineer/authored-ledger.test.ts
  test/acceptance/engineer.test.ts` green, including sentinel/blank/non-absolute
  rejection, read-path rejection, absolute/default acceptance, and the env-poison
  regression.
- Behavioral diff: a correctly-configured write (absolute `engineerDir`, valid env
  override, or injected-`home` default) lands at the same path with the same
  contents as before the guard (Story 3).
- Litter proof: after a full `src/conductor` run, `git status` at the primary
  checkout shows no untracked `undefined/` and no stray `authored-keys.json`
  (intake #574 observed artifact cannot recur).
- Guard proof: with the env poisoned to `"undefined"`, a no-opts ledger write
  throws a clear error naming the base and the file — no cwd-rooted write.
- `test/test_harness_integrity.sh` green (CHANGELOG `[Unreleased]` present, repo
  integrity).

## Coverage Mapping

| Story | Acceptance focus | Tasks |
|-------|------------------|-------|
| Story 1 — unset/`undefined`/non-absolute base throws a clear error, writes nothing | write-path guard, read-path guard, sentinel/blank/relative cases | T1, T2 |
| Story 2 — tests scope writes to temp; env never left as `"undefined"` | conditional-delete restore, poison-then-reject regression, no cwd litter | T4, T5 |
| Story 3 — correctly-configured write still lands at the canonical store | absolute `engineerDir`, injected-`home` default, valid env override, idempotency intact | T3 |
