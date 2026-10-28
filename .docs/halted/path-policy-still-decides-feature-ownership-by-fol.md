# Halt record

Status: halted
Slug: path-policy-still-decides-feature-ownership-by-fol
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/c1/path-policy-still-decides-feature-ownership-by-fol
Child: 1
Head SHA: 00b42bfdb79787b757e6357e9ba4bbd5b94bea04
Halted at: 2026-10-28T16:37:05.754Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Need user decision: Task 12's required manifest-based remediation routing needs a conductor.ts call-site change to supply projectRoot and baseRef, but the approved task scope permits only remediation-hints.ts and its test.


DECIDE entry refused — autonomous run may not enter DECIDE without operator direction.

Source gate:       remediate
Requested target:  plan
Evidence:          stall:path-policy-still-decides-feature-ownership-by-fol→plan
Why refused:       remediation requires a DECIDE revision of DECIDE step 'plan' despite the current artifact — explicit operator grant required
Operator choices:  direct a return to a named step | correct the routing target | reject the kickback
```
