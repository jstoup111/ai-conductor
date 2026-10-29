# Intake origin: done-step-with-an-unsatisfied-gate-verdict-loops-s

Source-Ref: jstoup111/ai-conductor#3487
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3487 digest=b7e919c0335bf845e3a8c3a4e658c94cb6677dd8086ad26871edd4511bf5dbcd >>>
## Desired outcome

- When a step reports success but its gate verdict is still unsatisfied and unchanged afterward, the run does not keep re-dispatching it up to the selection cap. Either the verdict is refreshed, or the run stops early.
- When the run stops for this reason, the halt names the step, says the step completed but its gate verdict was not refreshed, and quotes the stale verdict's reason. The operator can then tell a stale verdict apart from a gate that genuinely keeps failing.
- A gate that genuinely re-fails, where the step runs and writes a new unsatisfied verdict, still follows today's selection-cap behavior and halt wording.
- Legitimate kickback flows, where a later step re-opens an earlier done gate with a fresh unsatisfied verdict, are unaffected.
<<< END INBOUND >>>
