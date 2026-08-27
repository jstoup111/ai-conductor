# Halt record

Status: halted
Slug: connector-seam-for-event-submissions-is-registered
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-connector-seam-for-event-submissions-is-registered
Head SHA: f0f41fb30c474f4436ea65a694ac14815e7fe871
Halted at: 2026-08-27T10:05:59.539Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Need DECIDE/plan amendment: ADR-014 requires daemon beginFeatureRun wiring and complete production start-context identity, but no accepted plan task admits either gap.


stall:start-context-identity (build: Answered from committed artifacts — no plan amendment is needed: Task 9 already admits this fix. Story 3's happy-path criterion requires the started connector to receive runId, project, feature, branch, engineVersion, and pipelineDir, and Task 9 ('Absent-field context delivery and emitter independence', Story 3) owns index.ts context construction — its Steps say 'Implement: any gap the tests expose in context construction (absent fields passed through, not defaulted)' and its Files-likely-touched names 'src/conductor/src/index.ts — context pass-through fixes if exposed'. The interactive context at src/conductor/src/index.ts:1346-1356 currently passes only runId/project/feature/pipelineDir, so derive and pass branch and engineVersion there too (absent when underivable, never fabricated — Story 3 negative path) and assert the six-field production context in test/integration/visualizer-selection.test.ts; the acceptance spec at test/acceptance/connector-seam-for-event-submissions-is-registered.acceptance.test.ts:99-105 supplies the context itself and therefore does not cover this derivation. Do this inside Task 9 only; do not touch src/conductor/src/daemon-cli.ts (see stall:daemon-beginfeaturerun-wiring).); stall:daemon-beginfeaturerun-wiring (build: Answered from committed artifacts — the daemon wiring is out of scope for this feature, so build proceeds without it and no plan amendment is owed. This feature is issue #1516; ADR-014's daemon paragraph is a distinct later amendment explicitly attributed to #1934 ('Amended 2026-08-26 by #1934 ... because the daemon path had none and exported nothing (#1934)'), which is a separate OPEN v1.0 issue, 'Daemon-dispatched builds emit no OTel telemetry: the visualizer is never wired'. The accepted stories for this feature (Stories 1-5) name no daemon behavior, and the accepted plan's Summary, Technical Approach, and all nine tasks scope the selection loop to index.ts main(); the #1516 amendment paragraph the stories cite as their source specifies only the registry seam. Wiring src/conductor/src/daemon-cli.ts:926-942 beginFeatureRun now would widen the diff past plan admission — the sweep boundary the remediation contract forbids crossing. Recorded as found-and-excluded: daemon-cli.ts:926-942 has no visualizer start/stop and the daemon's read-only/injected conduct.run.id rule is unimplemented; both belong to #1934.) — remediation produced no dispatchable build work; the implicated task(s) are already evidence-complete — human needed
```
