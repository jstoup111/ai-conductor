# Intake origin: retry-a-lease-whose-owner-vanished-before-its-meta

Source-Ref: jstoup111/ai-conductor#2172
Owner: jstoup111

## Desired outcome
- An owner vanishing between the `EEXIST` and the metadata read results in a retry/normal acquisition, not a refusal.
- Genuine metadata corruption still refuses with a clear message.
