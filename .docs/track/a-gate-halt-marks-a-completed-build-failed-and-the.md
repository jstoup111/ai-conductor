# Track: A gate halt marks a completed build failed, and the residue blocks every later resume

Track: technical

Scope boundary: Comprehensive — every pre-dispatch refusal (protected-artifact seal, missing worktree path, live-boundary) gets one typed `refused` outcome that never stamps the step failed; resume entry always lands on a step `checkGate` admits; a prerequisite-gate halt names the unsatisfied prerequisite and the blocking step's status. Genuine step failures keep their `failed` semantics. Excludes: changing seal/live-boundary detection rules themselves, task-status counter desync (#497-class), daemon re-kick policy.

Engine state/halt semantics with no product requirements; acceptance criteria live in stories. Source: jstoup111/ai-conductor#1753.
