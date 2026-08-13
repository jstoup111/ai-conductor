# Intake origin: harden-intake-ledger-durability

Source-Ref: jstoup111/ai-conductor#1476
Owner: jstoup111

## Desired outcome

- A ledger file that exists but does not parse is never treated as an empty ledger, and never overwritten by the next mutation.
- After an unparseable ledger is encountered, the original bytes are still recoverable.
- The operator learns that a corrupt ledger was encountered, at the time it is encountered, rather than inferring it later from duplicate work.
- Concurrent mutations from separate processes do not lose each other's writes: with N processes each adding a distinct entry, all N entries are present afterward.
- A legitimately absent ledger (first run) still starts empty with no warning and no error.
