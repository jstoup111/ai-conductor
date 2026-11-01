# Intake origin: refusing-a-newly-raised-over-scope-criterion-halts

Source-Ref: jstoup111/ai-conductor#3548
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3548 digest=0ccdc2e37f9fb22df128bb0919601bc772f907c4d4503f2d1513b54abf973cf2 >>>
## Desired outcome

- Every criterion rendered in an over-scope halt can take an `accept` or `refuse` decision, and that decision is recorded on the next lap.
- When a decision entry is rejected, the halt names the rejection reason, the criterion, and the recovery that fits that reason. It never reports `malformed-history` for a well-formed widening history.
- The halt names the affected criterion instead of "affected no specific record" whenever the rejected entry carries one.
- Genuinely malformed widening history still halts as `malformed-history` (negative path).
<<< END INBOUND >>>
