# Intake origin: anchor-marker-scoped-changed-tests-outside-convent

Source-Ref: jstoup111/ai-conductor#2165
Owner: jstoup111

## Desired outcome
- Any changed test file the scope machinery counts as in-scope has anchor regions, so findings on it are representable.
- No mechanical-fault burn or forced empty-findings PASS caused purely by a test file's location.
