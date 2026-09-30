# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-30T00:59:24.518Z
Slug: show-autoresolve-guard-and-suite-gate-progress
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-show-autoresolve-guard-and-suite-gate-progress
Head SHA: bac9a1e5448148ef1d2e16d5e758059ea2d1c92e
Halted at: 2026-09-30T00:52:00.773Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 2 happy: Given the suite runner reports a nonzero exit code, when the suite gate settles, then the existing suite gate failed log line and the suite-gate escalation outcome line are written as today, no suite-gate passed log line or event is recorded, no push is attempted, and the outcome is escalated.
Task ids: 3
Done when checks: With a rejecting emitter and with no emitter, the integration tests end refreshed, the remote branch tip advances, and all three stage log lines are present. | The red-suite test observes the existing suite gate failed line and the stage=suite-gate result=escalated outcome line, no suite gate passed line, no suite-gate passed event, an unchanged remote branch tip, and outcome escalated. | The guard-rejection test observes the existing acceptance guard failed line and the stage=acceptance-guards result=escalated outcome line, zero suite runner calls, no acceptance-guards passed or suite-gate started line or event, and outcome escalated.
Missing assertion: No cited check explicitly requires that no push is attempted; it only requires the remote branch tip remain unchanged.
```
