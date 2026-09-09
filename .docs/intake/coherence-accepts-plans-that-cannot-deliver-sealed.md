# Intake origin: coherence-accepts-plans-that-cannot-deliver-sealed

Source-Ref: jstoup111/ai-conductor#2419
Owner: jstoup111

## Desired outcome

- For Medium and Large features, the land-time coherence validator rejects a spec whose criterion row records that a cited task cannot deliver the sealed story criterion, even though citation coverage is satisfied.
- The coherence artifact and the land-time rejection identify the criterion, the cited task, the governing constraint, and whether correction belongs in plan authoring or architecture review.
- Existing valid plans with genuinely achievable task coverage continue to pass without requiring duplicate review artifacts.
