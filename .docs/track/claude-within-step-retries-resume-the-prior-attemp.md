# Track: Claude within-step retries resume the prior attempt's session (#1071)

Track: technical

Internal engine change to provider session/retry semantics. No user-facing product
capability is added or removed; the operator-visible surface is limited to retry
behavior, recovery diagnostics, and documentation of the contract. Acceptance criteria
live directly in the stories.
