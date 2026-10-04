# Intake origin: over-scope-accept-stranded-rebase-fence-re-halts-b

Source-Ref: jstoup111/ai-conductor#2983
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2983 digest=1f62ba6ae7a33f92a5050ce4a76f5ed8db3ccdc0fc401d490f75562db160f5ca >>>
## Desired outcome

- After an operator decision on an over-scope criterion is recorded, a subsequent prd_audit re-verification reflects that recorded decision for the same criterion/source instead of re-rejecting it as an open repair; the feature proceeds without manual halt-file deletion.
- A halt of the "outstanding repair or re-verification" class whose unsatisfied verdict is actually a pending-recorded-operator-decision names that decision (criterion id, recorded state) and an actionable next step.
- A re-rejection computed while a decision for the same criterion is pending or recorded does not silently drop or overwrite that decision, and does not lose relation data in the persisted record.
- Negative path: a criterion whose recorded decision is refused, or that has no decision, still halts exactly as today.
<<< END INBOUND >>>
