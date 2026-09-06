# Intake origin: preserve-precise-utc-halt-timestamps-through-issue

Source-Ref: jstoup111/ai-conductor#2176
Owner: jstoup111

## Desired outcome

- Halt timestamps are compared in UTC at full precision regardless of host timezone.
- Evidence at or before the halt instant never resolves the issue; evidence after it still does.
