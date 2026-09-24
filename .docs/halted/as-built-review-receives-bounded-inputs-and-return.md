# Halt record

Status: halted
Slug: as-built-review-receives-bounded-inputs-and-return
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-as-built-review-receives-bounded-inputs-and-return
Head SHA: b3677064917e9cfe95aa33096e676e97670e4742
Halted at: 2026-09-24T15:05:15.205Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given a projection that fits every limit, when the step is dispatched twice against the same unchanged inputs, then both dispatches carry byte-identical projection blocks.
Task ids: 6
Done when checks: `buildAsBuiltProjection` over a fully populated fixture worktree returns a projection stamped with `AS_BUILT_PROJECTION_VERSION` whose sections carry the changed-file stat, the per-file hunks at default context, every plan task id with its `Done when` bullets from `parsePlanTaskDoneWhen`, the sealed story criteria, the resolved as-built check policy, and the approved diagram paths, as asserted by the populated-projection test | The governing-ADR section equals the ADRs cited by the plan's Architecture Obligation Coverage table joined with the ADRs added in the feature diff, filtered to APPROVED, each with the decision ids and decision text `parseAdrDecisions` reports, so the fixture yields exactly three ADRs, as asserted by the governing-set test | The prior-findings section lists both pending findings from a two-entry fixture ledger with their class, governing reference, and summary, and is empty with the projection still produced when the ledger file does not exist, as asserted by the prior-findings tests | `buildAsBuiltProjection` over a fixture whose ledger file cannot be parsed returns `ok: false` with a mechanical fault whose `dimension` is `pending-findings` and whose detail names the ledger path, and returns no projection, as asserted by the unreadable-ledger projection test | Two `renderAsBuiltProjection` calls over unchanged fixture inputs return byte-identical text, as asserted by the determinism test
Missing assertion: No cited check requires two dispatched as-built steps to carry byte-identical projection blocks; it only requires two direct render calls over unchanged inputs to be byte-identical.
```
