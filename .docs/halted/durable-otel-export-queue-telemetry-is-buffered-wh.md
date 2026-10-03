# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-03T10:46:48.189Z
Slug: durable-otel-export-queue-telemetry-is-buffered-wh
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-durable-otel-export-queue-telemetry-is-buffered-wh
Head SHA: fdd2b765a352213ead76701254badda173943135
Halted at: 2026-10-03T08:20:46.384Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-D18-PROVENANCE-EVENTS-ABSENT (architectural-clarity: Verified (95%): ADR-014 D18-D20 were added by #2910 for a different feature, 'a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t' (#2000). Its plan (.docs/plans/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md, Tasks 1-3+) owns the provenance event fields and VisualizerStartContext.sourceRef, and it is being built right now on feat/daemon-a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t. Neither main nor that feature has shipped it yet. This plan's coverage row (plan line 546) says D18 is owned by the #2000 feature. It does not say D18 is already shipped, so the as-built summary misreads it. No task in this plan admits provenance work, and building it here would duplicate and conflict with the in-flight feature. A human has to make the sequencing call. Recommended: let #2000 ship, rebase this branch, and rerun the as-built review. The alternative is to rule that the as-built review does not hold this feature to D18-D20, which another feature owns.); AB-D19-PROVENANCE-PLACEMENT-ABSENT (architectural-clarity: Verified (95%): D19 puts conductor.source.ref on the trace Resource and stamps HEAD, base, PR URL and disposition on the root span. That work is owned by the in-flight #2000 feature (plan a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t, branch feat/daemon-a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t). This plan's coverage row (plan line 547) records that ownership. No task in this plan admits it, and building it here would duplicate concurrent work. It needs the same human sequencing decision as AB-D18: ship #2000 then rebase, or scope D19 out of this feature's as-built check.); AB-D20-PROVENANCE-CONFIG-ABSENT (architectural-clarity: Verified (95%): the otel.provenance config block and its toggles (D20) are owned by the in-flight #2000 feature (plan a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t). This plan adds only otel.spool, per its coverage row at plan line 548. No task in this plan admits the provenance config, and adding it here would conflict with that branch. It needs the same human sequencing decision as AB-D18: ship #2000 then rebase, or scope D20 out of this feature's as-built check.)
```
