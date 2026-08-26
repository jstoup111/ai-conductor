# Intake origin: prd-audit-has-no-criterion-key-for-an-over-scope-f

Source-Ref: jstoup111/ai-conductor#1848
Owner: jstoup111

## Desired outcome

- An audit that reports an unplanned change owning no story criterion produces a
  parseable report on the first attempt, with no operator intervention.
- Every finding in a parseable report is distinguishable from every other
  finding, so recording a decision about one never matches another.
- A scope finding is never presented as a verdict on an unrelated story
  criterion that the same report also grades PASS.
- A report whose only defect is a key the parser does not recognize does not
  discard the findings it parsed correctly — the operator sees which rows were
  rejected and why.
- The report shape the audit skill teaches and the shape the parser accepts are
  the same shape, demonstrated by a fixture that covers a scope finding with no
  owning criterion.
