# Intake origin: treat-completed-commit-status-entries-as-terminal-

Source-Ref: jstoup111/ai-conductor#2164
Owner: jstoup111

## Desired outcome
- Completed commit-status entries (state SUCCESS/FAILURE/ERROR) count as terminal for eligibility; genuinely pending ones still defer.
- The "(unnamed check)" label never appears for a completed entry.
