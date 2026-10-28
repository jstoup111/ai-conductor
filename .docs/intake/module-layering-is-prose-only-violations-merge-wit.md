# Intake origin: module-layering-is-prose-only-violations-merge-wit

Source-Ref: jstoup111/ai-conductor#1988
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1988 digest=cf10cad6a46d873d5752af832163cdbb287d38168ed0db648e1a9b2bd09aca4e >>>
## Desired outcome

- An import that violates the documented layer direction fails CI before merge, at the point of the mistake.
- The two #1017 violations are gone and cannot be reintroduced.
- Conforming imports, and any explicitly-listed grandfathered exceptions, still pass — and the exception set can only shrink.
- The module-map documentation can no longer silently drift from the enforced rules (either generated or checked).
<<< END INBOUND >>>
