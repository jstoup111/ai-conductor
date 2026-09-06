# Intake origin: accept-trailing-tables-in-a-coherence-artifact

Source-Ref: jstoup111/ai-conductor#1979
Owner: jstoup111

## Desired outcome
- A coherence artifact whose mapping table is complete and well-formed passes the land gate
  regardless of what follows the table.
- Whatever the resolved rule turns out to be, an artifact that violates it fails with a message
  naming the rule, not a line offset.
- The land gate and daemon discovery continue to agree on every artifact: nothing is
  dispatch-acceptable but land-rejectable, or the reverse.
- Artifacts that parse today keep parsing, with the same extracted rows.
