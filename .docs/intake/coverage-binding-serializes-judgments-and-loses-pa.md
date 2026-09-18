# Intake origin: coverage-binding-serializes-judgments-and-loses-pa

Source-Ref: jstoup111/ai-conductor#2493
Owner: jstoup111

## Desired outcome

- Coverage binding for a multi-criterion feature completes materially faster than the current sum of individual provider-call latencies.
- Each criterion still receives an independently attributable, schema-valid verdict keyed to its claim identity.
- An interruption preserves completed criterion judgments so a resumed run evaluates only unfinished or invalidated claims.
- Missing, duplicate, malformed, or foreign verdicts cannot satisfy the gate.
- A failed judgment does not discard valid judgments for unrelated criteria.
