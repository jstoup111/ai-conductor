# Intake origin: adrs-lock-without-a-machine-checkable-assumption-l

Source-Ref: jstoup111/ai-conductor#542
Owner: jstoup111

## Desired outcome

- An ADR cannot reach APPROVED (and land rejects it) without a structured assumptions section where each entry carries confidence, basis (verified/inferred/unverified), and impact-if-wrong — presence and shape checked mechanically.
- Unverified load-bearing entries require an explicit operator approval marker per entry, recorded in the ADR — observable in the artifact, not in session logs.
- Negative path: ADRs with a genuinely empty ledger may state "No load-bearing assumptions" explicitly — absence of the section, not smallness, is what blocks.
