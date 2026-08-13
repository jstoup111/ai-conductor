# Track: Harden intake ledger against corrupt-read wipe and concurrent write loss

Track: technical

Internal durability and multi-process write-safety hardening of the engineer intake ledger
(`src/conductor/src/engine/engineer/intake/ledger.ts`); no user-facing product surface, so
acceptance criteria live directly in the stories rather than in a PRD.
