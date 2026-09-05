# Track: A halted feature only re-runs when a human clears it, even for retryable failures

Track: technical

Scope boundary: (1) Retry half, reshaped to comply with the APPROVED ADR corpus — no deferred state, no timer: validation-group members get the serial attempt budget (folds in #1425); a test_suite infrastructure failure gets a bounded, non-charging in-step retry lane that ends in a needs-human halt naming attempts spent; the three budget halts written `mechanical` today (manual-test cap, test_suite cap, per-gate remediation budget) are reclassified `needs-human`. Self-host live-boundary trips and protected-artifact seal errors are excluded as fail-closed by decided design (adr-2026-08-17 §4, adr-2026-06-30, adr-2026-07-26 §2). (2) Grant half, absorbed: `ai-conductor kickback-budget raise|reset` implemented exactly per adr-2026-08-29 D1–D8 (as amended by its 08-29 successor and adr-2026-08-31); the daemon clears the halt on seeing the authorization; #1760 closes as a duplicate via a companion cleanup PR. Excludes #2147 (dispatch reads daemon-root config) and does not touch the as-built halt-reason text owned by spec #2197 (#2195).

Daemon recovery machinery and an operator CLI; no end-user product requirements, acceptance criteria live in stories.
