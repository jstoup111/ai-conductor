# Intake origin: recover-stale-conduct-state-lease-recovery-claims

Source-Ref: jstoup111/ai-conductor#2170
Owner: jstoup111

## Desired outcome

- A recovery claim left by a dead process is detected and cleared automatically; the next acquirer proceeds.
- The timeout message names the actual blocking state (dead claim vs live owner).
- Two concurrently live recoverers still exclude each other.
