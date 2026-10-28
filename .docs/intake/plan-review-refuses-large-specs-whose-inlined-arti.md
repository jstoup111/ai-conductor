# Intake origin: plan-review-refuses-large-specs-whose-inlined-arti

Source-Ref: jstoup111/ai-conductor#3278
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3278 digest=ccd19e515c8d2d0d60f91aaf4a7cd30bfb3d36a89e05e9d62e4209084db2202e >>>
## Desired outcome

- `compose plan-review` runs for a Large spec whose plan, stories, coherence artifact and changed ADRs together exceed 400,000 characters, and still reviews every task.
- The reviewer can still read any full artifact it needs, but the prompt does not grow linearly with the full text of every changed or cited ADR and every duplicated table.
- When a review must still be refused for size, the refusal names what to change, and the operator has a supported way to proceed. It is never a dead end.
- Plan review findings for specs that fit today are unchanged in kind and quality.
<<< END INBOUND >>>
