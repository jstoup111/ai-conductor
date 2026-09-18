# Intake origin: malformed-as-built-clause-forces-an-operator-decis

Source-Ref: jstoup111/ai-conductor#2424
Owner: jstoup111

## Desired outcome

- Invalid reviewer-authored governing-clause syntax does not become a human DECIDE state unless substantive design ambiguity exists.
- The invalid clause is identified mechanically, names the exact malformed value, and receives bounded retry or recovery handling.
- Valid whole-decision ADR citations continue to route remediation.
- Genuine findings that require a new design decision continue to halt for the operator.
