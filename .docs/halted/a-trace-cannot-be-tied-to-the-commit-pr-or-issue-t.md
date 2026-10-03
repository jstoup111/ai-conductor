# Halt record

Status: halted
Slug: a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t
Head SHA: 31ba6bc9601f353c2e3237fdd3ec8e197a054e1f
Halted at: 2026-10-03T03:20:00.096Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 3 happy: Given a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`, when a run of that feature starts with OTel enabled, then the trace Resource carries `conductor.source.ref` equal to `jstoup111/ai-conductor#2000`
Task ids: 7, 8
Done when checks: `createVisualizerStartContext` carries `sourceRef` resolved by `resolveRunSourceRef`, which reads the intake marker of the plan `resolveFeaturePlanPath` returns and applies `parseIntakeSourceRef`, as asserted in `visualizer-selection.test.ts` for a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`. | `resolveRunSourceRef` returns `undefined` without throwing when the feature has no intake marker, when its plan path cannot be resolved, and when the `Source-Ref:` line is empty, and in each case the run start context is still constructed with no `sourceRef`. | `buildResource` for the traces signal sets `conductor.source.ref` only when `sourceRef` is a non-empty string and `provenance.issue` is true, and the metrics signal never sets it, as asserted in `resource.test.ts`. | With `provenance.feature` false, the trace Resource has no `conductor.feature` attribute and its `service.instance.id` is the project name, a slash, and the run id. | With `provenance.feature` false, the metric Resource attributes and every step-metric data-point `feature` label equal those recorded with the toggle on, as asserted in `resource.test.ts` and `metrics-listener.test.ts`. | An `OtelVisualizer` test with an in-memory exporter starts a run with `sourceRef` set, ends one step, and after `forceFlush` and before `stop()` asserts the exported closed step span's Resource carries `conductor.source.ref` while no `conductor.run` span has been exported.
Missing assertion: The Resource check requires `provenance.issue` to be true; the criterion only specifies OTel enabled.
```
