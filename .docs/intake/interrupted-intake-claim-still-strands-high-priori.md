# Intake origin: interrupted-intake-claim-still-strands-high-priori

Source-Ref: jstoup111/ai-conductor#2733
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2733 digest=7993f7d664fc35ec36742fdb84cc923364b83ff2da8be16536e1c02bfee79ed4 >>>
## Desired outcome

- An interrupted, killed or crashed `compose claim` never leaves an intake entry unclaimable: at the next claim, every entry whose ledger status is `pending` is claimable again, whatever happened to the previous claim process.
- An entry that is genuinely claimed by a live session is never handed out twice (compare #862).
- The operator's existing recovery verbs (`compose unclaim`, `compose requeue --stale`) recover a pending-ledger / claimed-envelope mismatch instead of refusing it as "not claimed".
- The mismatch count is visible to the operator in the same place other intake queue health is reported, so a starving queue is noticed rather than discovered.
- Any strands created before the fix ships are recovered by the fix itself, without manual file renames.
<<< END INBOUND >>>
