# Intake origin: report-the-prd-input-gate-surface-accurately-in-re

Source-Ref: jstoup111/ai-conductor#2211
Owner: jstoup111

## Desired outcome
- When a foreign runtime change leaves PRD-audit preserved, its event accurately describes the gate's declared input surface and the delta relevant to that decision.
- When a feature-owned runtime change or declared stories/PRD input invalidates PRD-audit, its event names the paths that actually justify that decision.
- Preservation and invalidation payloads remain consistent with their classification for each supported gate-surface kind, without changing the gate decisions themselves.
- Existing explicit drift-budget preservation remains distinguishable from ordinary delta-based preservation.
