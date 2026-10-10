# Intake origin: validation-group-member-with-a-stale-verdict-artif

Source-Ref: jstoup111/ai-conductor#2553
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2553 digest=c2509f7cfbb83b967d6ced8fcbe4d76201c3ff87d8b9d2efa51196bec455528e >>>
## Desired outcome

- A validation-group member whose dispatch completes but whose verdict artifact is absent or stale is re-dispatched within the bounded no-verdict retry budget without operator intervention.
- Such a member never enters gap remediation and never spends a kickback lap.
- A member that genuinely fails its gate (verdict present, unsatisfied) still routes to remediation as today.
- When the retry budget is exhausted the halt names the handshake failure, not a content gap.
<<< END INBOUND >>>
