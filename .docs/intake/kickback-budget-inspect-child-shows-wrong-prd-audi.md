# Intake origin: kickback-budget-inspect-child-shows-wrong-prd-audi

Source-Ref: jstoup111/ai-conductor#3364
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3364 digest=73084c8992365fd1ed6e99fce025ae0e041a49b55b29e1c9a3ae11afe40a25fb >>>
## Desired outcome

- For prd_audit, as-built and manual_test, `kickback-budget inspect --child N` reports the same consumed count, limit, adjustment history and resume authorization that the live HALT reports and that `raise` updates.
- After a `raise --child N` on one of those gates, `inspect --child N` shows the new limit and the adjustment immediately.
- A `kickback-cap` halt's recovery text for a feature-wide gate doesn't send the operator to a child-scoped view whose numbers differ from the halt's.
- Negative path: child-scoped gates such as build_review and restack still read and write the child ledger with `--child`, unchanged.
<<< END INBOUND >>>
