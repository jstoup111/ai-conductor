# Intake origin: acceptance-specs-hide-missing-red-evidence-and-com

Source-Ref: jstoup111/ai-conductor#1246
Owner: jstoup111

## Desired outcome

- While `acceptance_specs` runs, operator-visible status shows whether relevant RED evidence is required, pending, satisfied, or rejected.
- Recorded RED evidence identifies the failing test, failure reason, timestamp, and why the failure corresponds to the intended missing behavior.
- If acceptance tests are already green before qualifying RED evidence exists, the step reports that condition explicitly and cannot present the acceptance-spec lifecycle as successfully proven.
- Operator-visible progress distinguishes active child work from a completion wait, including active child count, last meaningful action, last test outcome, heartbeat age, elapsed step time, and uncached input/output token consumption.
- After all child work and required verification finish, the step either closes promptly or reports the exact unresolved completion condition.
- Remediation workflows make any exception to the normal RED requirement explicit and observable rather than silently combining test and production changes.
