# Intake origin: persist-the-once-per-sha-re-kick-guard-across-daem

Source-Ref: jstoup111/ai-conductor#286
Owner: jstoup111

## Desired outcome
- A feature re-kicked at SHA X is not re-kicked again at X across daemon restarts
- A genuine advance to SHA Y still re-kicks normally
- Existing rekick suite behavior otherwise unchanged
- Docs + CHANGELOG updated
