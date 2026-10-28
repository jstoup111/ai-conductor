# Intake origin: code-valid-as-built-verdict-re-run-after-a-prd-aud

Source-Ref: jstoup111/ai-conductor#3363
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3363 digest=a63628f26cdd5af01ee00c32af652f8ac1684642320818bb0b134ef7596d47b1 >>>
## Desired outcome

- After a group halt where one member refuses and another passes, resuming with HEAD unchanged does not re-dispatch the passing member. The run shows it as preserved, for example through a freshness or skip event naming the step.
- A group member whose state is stale but whose stored verdict is still valid for the current code surface is preserved on group fan-out, the same way the serial walk preserves it.
- Negative path: if code in the member's surface changed after its verdict was stamped, the member re-dispatches as it does today.
<<< END INBOUND >>>
