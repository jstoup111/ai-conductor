# Intake origin: reclaim-orphaned-full-suite-lock-recovery-claims

Source-Ref: jstoup111/ai-conductor#2171
Owner: jstoup111

## Desired outcome
- An orphaned claim whose pid is dead is reclaimed automatically; `ensure()` succeeds without operator intervention.
- Concurrent live recoverers still exclude each other.
