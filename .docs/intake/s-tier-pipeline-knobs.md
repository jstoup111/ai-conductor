# Intake origin: s-tier-pipeline-knobs

Source-Ref: jstoup111/ai-conductor#668
Owner: jstoup111

Routed to `ai-conductor`. Spec authored from operator directive 2026-07-21 in response to #668
("S-tier bug fixes bypass DECIDE, so gate-satisfying artifacts are hand-stamped after the fact").

**Operator directive (binding):** PR #670's separate lightweight DECIDE flow is the wrong approach —
**no separate SDLC flows.** Smallness must be expressed through the *existing* pipeline's own knobs
(tier-based step skips, per-step config overrides, retry budgets, validator selection, base
model/effort with the #188 escalation ladder as the recovery net), not a parallel authoring path.

PR #670 was closed (`--delete-branch`) as superseded. This spec is its replacement. See
`.docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md`.
