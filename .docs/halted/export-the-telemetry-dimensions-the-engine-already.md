# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-10T10:14:40.903Z
Slug: export-the-telemetry-dimensions-the-engine-already
Class: plan-gap
Halting step: acceptance_specs
Phase: BUILD
Branch: feat/daemon-export-the-telemetry-dimensions-the-engine-already
Head SHA: 53badef09658f71a5f77a2081369dd90d0773eed
Halted at: 2026-09-10T03:53:45.909Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Acceptance-spec authoring is blocked by an impossible event-order contract in the accepted stories and plan.

Story 2 requires every retry point to carry model, effort, provider, and tier, but at `step_retry` time the existing event spine has no tier: `provider_attempt` carries provider/model, and `step_retry` carries only optional escalated model/effort. Task 5 nevertheless requires recording the retry immediately from cached prior observations.

Story 3 requires dispatch points to carry fallback, but Task 6 requires recording the point when `provider_attempt` arrives; the preferred provider needed to derive fallback is supplied only by the later `step_completed` event.

Writing a non-vacuous acceptance RED spec would therefore freeze an unapproved choice: buffer observations until close, or add the missing dimensions to earlier events. Return to DECIDE and amend the story/architecture/plan so the event timing and source for each label are explicit, then clear `.pipeline/HALT` and `.pipeline/HALT.class` to resume.
```
