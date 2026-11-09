# Intake origin: restack-refuses-child-resolution-that-adapts-tests

Source-Ref: jstoup111/ai-conductor#3598
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3598 digest=4310bd6473969bddac5fc19df9b6071376475a201d89ae2694f1e1407ab9517c >>>
## Desired outcome

- A restack resolution that changes a file introduced or changed by the child's new parent, in order to keep that parent's tests passing with the child's change, is accepted, and the stack continues without a `needs-human` halt.
- A resolution that changes paths that neither the child's old range nor its new parent's delta touched is still refused (`replay-mismatch`), so the guard against scope creep stays in place.
- When a resolution is refused, the resolver's tip is kept somewhere the operator can find and reuse (named in the HALT), not left only as unreachable commits.
- The same rule holds whether the resolution comes from the resolver or from an operator `--tip`.
<<< END INBOUND >>>
