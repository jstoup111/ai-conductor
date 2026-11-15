# Intake origin: reduce-resolver-cost-for-mechanical-restack-confli

Source-Ref: jstoup111/ai-conductor#3632
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3632 digest=8526a57158af6f8aa648760528fc9a64d7eb533d3b7c4cf00cc1ae9686d62a12 >>>
## Desired outcome

- A conflict that a deterministic or cheap path can settle is settled without a frontier-model resolver run.
- Only conflicts that change behavior reach the strong-model resolver.
- Only conflicts that need a real design choice halt for the operator.
- Per-round reporting shows how many conflicts were settled at each tier.
- Negative path: a conflict that changes behavior is never settled by a cheap path. A wrongly mechanical-looking resolution is caught before the restack is applied.
<<< END INBOUND >>>
