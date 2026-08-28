# Intake origin: paired-enumerations-that-must-agree-drift-with-no-

Source-Ref: jstoup111/ai-conductor#1833
Owner: jstoup111

## Desired outcome

- A change that edits one side of a declared matched pair fails a check at the moment it is made,
  naming both sides, rather than surfacing at the next audit.
- The set of pairs is declared somewhere a reader can enumerate, so a new pair can be registered
  and an obsolete one removed.
- Where a pair can be collapsed into a single source, the check reports that as satisfied rather
  than requiring the duplication to be maintained forever.
- Adding a value to one side of a registered pair without the other cannot reach a green build.
