# Complexity: Markerless no-verdict daemon exit is always classified needs-human

Tier: S

Operator confirmed Tier S on 2026-09-18 (skips architecture-diagram, architecture-review,
conflict-check, and coherence-check; the technical track also skips `/prd`).

## Rationale

One localized engine edit plus unit tests. The gate-block return path in
`src/conductor/src/engine/conductor.ts` already computes the deciding predicate
(`noRunnablePrerequisite`) and already writes a classified HALT on its `true` branch; the change
gives the `false` branch an explicit classified write — `mechanical` when a `pending` prerequisite
resolves to an earlier registry index, `needs-human` otherwise — plus the matching `emitLoopHalt`,
instead of returning markerless into the catch-all classifier.

The resolvability test is not newly invented: it is the selection rule already inlined inside
`clampToRunnablePrerequisite`, extracted to one exported helper so the clamp and the
classification cannot drift apart. That extraction is a pure refactor of existing logic with the
clamp's own tests as its regression proof.

- No new module, service, record schema, storage path, configuration key, or telemetry channel.
- No new HALT read disposition — `adr-2026-07-28` D2's four dispositions are unchanged, and
  `mechanical` is an existing writable class under D1.
- No new retry, timer, or backoff state. Re-kick bounding already exists in the daemon
  (`progressReKickDispatchCeiling`), so the source issue's "must not become a retry loop" outcome
  is satisfied by machinery already in place.
- No change to `classifyRetryDecision` or any other seam owned by a separate ADR.
- The catch-all at `conductor.ts:13459` keeps its conservative `needs-human` default untouched;
  a test pins that it still fires for other markerless shapes.

Validation is the existing conductor unit suite plus `test/test_harness_integrity.sh`. Story count
is small (2–3): the recoverable shape classifies `mechanical` and names its blocker, and every
other markerless exit still classifies `needs-human`.

## Tier risk accepted

S skips `/architecture-review`, which is where the `adr-2026-07-28` D1 compliance argument would
normally be validated independently. That argument was instead grounded during explore against the
governing ADRs (D1's provable-at-the-writer clause, D2's fixed disposition set,
`adr-2026-07-27`'s auto-clear guard rule, and `adr-2026-07-13` D2/D6's retry seam) and is recorded
in `.memory/decisions/markerless-gate-block-exit-classification.md`. The ADR pass was
topic-targeted, not the full 592-file corpus sweep an M-tier review would run.
