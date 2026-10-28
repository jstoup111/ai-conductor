# Intake origin: halt-records-committed-on-stacked-child-branches-m

Source-Ref: jstoup111/ai-conductor#3451
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3451 digest=ab0abd27429a9b1847b13887035786c11fc31749f1eb196c62db6bef7bf7e480 >>>
## Desired outcome

- Writing or resolving a halt record on a stacked feature never creates a commit that a later restack must reconcile across children.
- A restack whose only divergence between children is halt-record bookkeeping completes without a conflict halt or a resolver call.
- The halt record a reader sees on the feature after a restack is the newest one, never an older copy replayed over it.
- Flat (non-stacked) features keep their current halt-record behavior.
<<< END INBOUND >>>
