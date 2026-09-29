# Intake origin: consume-kickback-raise-matching-the-live-halt-gene

Source-Ref: jstoup111/ai-conductor#2595
Owner: jstoup111

## Desired outcome
- A raise authorized against the live halt's generation is consumed on the next sweep and the halt clears, regardless of unconsumed authorizations on other gates.
- An authorization whose halt generation no longer matches any live halt never blocks a later authorization, and its staleness is visible (log line or inspect output).
- An authorization for a gate whose cap halt is not the live halt still clears nothing (the existing "no unrelated halt is cleared" behaviour holds).
- When a raise cannot be consumed, `kickback-budget inspect` or the raise command itself says so, rather than only the daemon log.
