# Track: Build halts when a branch inherits an older revision of another feature's protected plan (#1315)

Track: technical

Engine-internal correctness fix to the protected-artifact seal's base-inheritance tolerance
(`src/conductor/src/engine/protected-artifact-seal.ts`). The seal is a tamper-detection boundary,
not a product surface: there is no user-facing capability, no new CLI verb, and no configuration
key. Acceptance criteria therefore live directly in the stories and no PRD is authored.

The one reader-visible surface is the refusal text an operator reads out of `.pipeline/HALT` and
`.daemon/daemon.log`, plus the runbook entry that names its recovery — documentation, not product
requirements.
