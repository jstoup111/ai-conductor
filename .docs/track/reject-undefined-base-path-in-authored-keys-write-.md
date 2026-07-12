# Track: Reject an `undefined` base path in the authored-keys write; tests must not write into the primary checkout

Track: technical

Engine-internal correctness fix with no user-facing product surface. Two engine
seams are touched:

1. The authored-keys ledger write site (`recordAuthoredKey` / `ledgerPath` in
   `src/conductor/src/engine/engineer/authored-ledger.ts`) gains a fail-closed
   guard so a base directory that resolves to the string `"undefined"` (or
   `"null"`, blank, or any non-absolute value) is REJECTED with a clear error
   instead of silently building `undefined/authored-keys.json` and writing it
   relative to `process.cwd()` (the primary checkout).

2. The leaking acceptance test's env save/restore
   (`src/conductor/test/acceptance/engineer.test.ts`) is corrected to the
   conditional-delete pattern already canonical in the suite
   (`test/engine/engineer-store.test.ts:85-87`), so it never coerces an unset
   `$AI_CONDUCTOR_ENGINEER_DIR` into the literal string `"undefined"` and
   poisons `process.env` for subsequent code paths.

No CLI/hook/schema surface, no data model change, no ADR-worthy decision. This is
a guard + test-scoping fix in the #486/#534/#564 root-ambiguity family combined
with the #380 cwd-relative-write lineage. Acceptance criteria live in stories.
Operator-confirmed via intake jstoup111/ai-conductor#574.
