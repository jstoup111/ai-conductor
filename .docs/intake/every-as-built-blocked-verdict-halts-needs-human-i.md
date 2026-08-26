# Intake origin: every-as-built-blocked-verdict-halts-needs-human-i

Source-Ref: jstoup111/ai-conductor#1874
Owner: jstoup111

## Desired outcome

- A feature whose as-built findings are all "shipped code does not do what an already-approved
  artifact requires" converges without an operator, and the operator can see afterward what was
  remediated and against which approved clause.
- A feature whose as-built findings require a design decision — superseding an approved ADR,
  choosing between incompatible approved constraints — still halts for a human, as
  `streaming-provider-dispatches-record-no-token-usag` did.
- The distinction between those two cases is recorded per finding, so a reader can tell why a
  given finding halted rather than remediated.
- Autonomous remediation of as-built findings terminates: a finding that survives its allowance
  reaches a human instead of looping.
- An as-built report that does not clearly place a finding in either class fails toward the human,
  never toward silent self-healing.
