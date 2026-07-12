**Status:** Accepted

# Stories: Reject an `undefined` base path in the authored-keys write

Technical track (no PRD) · Tier S · intake jstoup111/ai-conductor#574
Source of intent: intake #574 ("Engineer authored-keys.json written to a literal
`undefined/` directory in the primary checkout — path resolves to undefined").

Root cause (verified): the authored-keys write site
(`recordAuthoredKey`/`ledgerPath`, `src/conductor/src/engine/engineer/authored-ledger.ts:55-58,89-91`)
does not validate its base dir, and `resolveEngineerDir`
(`src/conductor/src/engine/engineer-store.ts:186`) returns the literal string
`"undefined"` verbatim when `$AI_CONDUCTOR_ENGINEER_DIR` holds it. A test
(`src/conductor/test/acceptance/engineer.test.ts:88`) poisons that env var by
assigning an unset `savedEnv` value (`undefined` → the string `"undefined"`),
so `join("undefined","authored-keys.json")` is written relative to `process.cwd()`
= the primary checkout.

---

## Story: An unset/`undefined` base path throws a clear error instead of writing `undefined/`

**Requirement:** intake #574 desired outcome 1 (a base that is an
unresolved/`undefined` value is rejected with a clear message, not silently
written to `undefined/`)

As the engineer ledger writer, I want the authored-keys write to reject a base
directory that resolves to a sentinel string (`"undefined"`, `"null"`), a blank
value, or any non-absolute path so that a misresolved base fails loudly at the
write site instead of silently creating `undefined/authored-keys.json` under
whatever the current working directory happens to be.

### Acceptance Criteria

#### Happy Path
- Given `recordAuthoredKey('p','f', { engineerDir: 'undefined' })`, when it runs,
  then it REJECTS with an Error whose message names the offending base value
  (`undefined`) and the file (`authored-keys.json`), and NO file is created —
  in particular no `undefined/authored-keys.json` under `process.cwd()`.
- Given `$AI_CONDUCTOR_ENGINEER_DIR` is the literal string `"undefined"` and
  `recordAuthoredKey('p','f')` is called (opts resolve the dir from env), when it
  runs, then it throws the same clear error and writes nothing to cwd.
- Given the read side `readAuthoredKeys({ engineerDir: 'undefined' })`, when it
  runs, then it likewise throws the clear base-rejected error (the guard covers
  both read and write paths, so a poisoned base can never be silently consulted).
- Given a base of `"null"`, an empty string, `"   "`, or a relative path like
  `engineer` (non-absolute), when the write runs, then each is rejected with the
  same clear error — the guard is not `"undefined"`-only.

### Done When
- [ ] A unit test asserts `recordAuthoredKey` with `engineerDir: 'undefined'`
      rejects with a message naming the base and the ledger file, and that
      `process.cwd()` gains NO `undefined/` directory or file afterward.
- [ ] A unit test asserts `readAuthoredKeys` with a sentinel/non-absolute base
      rejects identically.
- [ ] Parametrized coverage for `"null"`, `""`, whitespace-only, and a relative
      base all rejecting.

---

## Story: Tests scope their authored-keys writes to a temp dir and never poison the env

**Requirement:** intake #574 desired outcome 2 (tests never write authored-keys —
or any artifact — into the primary checkout / cwd)

As the test suite, I want the acceptance test that exercises the authored-keys
ledger to save and restore `$AI_CONDUCTOR_ENGINEER_DIR` with the conditional-delete
pattern (delete when the ambient value was unset, restore otherwise) so that a run
with the env var unset never leaves `process.env.AI_CONDUCTOR_ENGINEER_DIR ===
"undefined"` behind to poison later code paths, and every authored-keys write in
the suite lands in an explicit temp dir.

### Acceptance Criteria

#### Happy Path
- Given the acceptance test suite runs with `$AI_CONDUCTOR_ENGINEER_DIR` UNSET in
  the ambient environment, when every test and its `afterEach` have completed, then
  `process.env.AI_CONDUCTOR_ENGINEER_DIR` is UNSET (via `delete`), never the string
  `"undefined"`.
- Given the acceptance test suite runs with `$AI_CONDUCTOR_ENGINEER_DIR` set to a
  real value ambiently, when the suite completes, then that original value is
  restored verbatim.
- Given the whole `src/conductor` test run, when it finishes, then the primary
  checkout has NO untracked `undefined/` directory and no stray `authored-keys.json`
  outside a temp dir (regression assertion for the observed litter).

#### Negative Path
- Given the env var is deliberately poisoned to the string `"undefined"` and a
  ledger `record` is then invoked without an explicit `engineerDir`, when it runs,
  then it THROWS (per Story 1's guard) rather than writing under cwd — proving the
  guard is the fail-closed backstop even if some other test re-introduces the
  poisoning.

### Done When
- [ ] `test/acceptance/engineer.test.ts` uses `if (saved === undefined) delete …;
      else … = saved;` for `AI_CONDUCTOR_ENGINEER_DIR` (and `AI_CONDUCTOR_REGISTRY`
      if it shares the defect), matching `test/engine/engineer-store.test.ts:85-87`.
- [ ] A regression test asserts that after poisoning the env to `"undefined"`, a
      no-opts ledger write throws and creates no cwd-rooted file.

---

## Story: A correctly-configured authored-keys write still lands at the canonical store

**Requirement:** intake #574 desired outcome 3 (negative path — a correctly
configured write is unchanged and lands at `~/.ai-conductor/engineer/authored-keys.json`)

As the engineer ledger writer, I want a properly resolved absolute base directory
to behave exactly as today so that the guard rejects ONLY misresolved bases and
never regresses the real ledger write or its default location.

### Acceptance Criteria

#### Negative Path (guard must not over-reject)
- Given `recordAuthoredKey('proj','feat', { engineerDir: <absolute temp dir> })`,
  when it runs, then it writes `<temp>/authored-keys.json` containing the pair —
  identical to pre-guard behavior (idempotency and merge semantics unchanged).
- Given no `engineerDir` and no `$AI_CONDUCTOR_ENGINEER_DIR`, when the write runs,
  then `resolveEngineerDir` derives the default absolute path
  `~/.ai-conductor/engineer` (via `homedir()`), the guard accepts it, and the
  ledger lands at `~/.ai-conductor/engineer/authored-keys.json` (the canonical
  store) — asserted against an injected `home` temp dir so the test does not touch
  the real `$HOME`.
- Given a valid absolute `$AI_CONDUCTOR_ENGINEER_DIR`, when the write runs, then
  the guard accepts it and the write lands there — the override path is unchanged.

### Done When
- [ ] A test asserts the injected-`home` default resolves to
      `<home>/.ai-conductor/engineer/authored-keys.json` and the write succeeds
      through the guard.
- [ ] A test asserts an explicit absolute `engineerDir` and a valid absolute env
      override both still write successfully (guard accepts all absolute bases).
- [ ] The existing `authored-ledger.test.ts` idempotency/merge/empty-arg tests
      remain green (no behavioral regression).

---

## Non-goals

- Refactoring every other test file that shares the unconditional env-restore
  anti-pattern (~10 files). The Story 1 guard makes them all fail-closed; only the
  file that produced the observed leak is corrected here.
- Changing `resolveEngineerDir`'s contract, its `$AI_CONDUCTOR_ENGINEER_DIR`
  override semantics, or the default `~/.ai-conductor/engineer` location.
- Introducing a shared state-store root seam (#564). If review concludes the guard
  belongs in a shared root resolver rather than the ledger, that is a larger
  decision to be escalated, not absorbed into this S-tier fix.
