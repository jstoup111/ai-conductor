# Complexity: Heal pre-rebase untracked-file collisions and park them accurately

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one failure branch of `performRebase`, one new event variant with its sink
declaration, and the halt-note selection at the two existing rebase halt call sites. It reuses the
existing git runner injection, the existing `rebaseStateActive` probe, the existing
`emitRebaseEvent` bridge, and the existing `writeSealHalt` precedent for a pre-rebase refusal note.
It introduces no configuration key, no service, no schema for durable state, and no second
telemetry channel. The gated resolution sub-loop, the resolver skill, gate invalidation, and every
other refusal class keep their current behaviour.

Five production files are touched, three of them by a single line or row: the union member in
`src/conductor/src/types/events.ts`, the sink row in `src/conductor/src/engine/event-sinks.ts`, and
one halt-writer call each in `src/conductor/src/engine/conductor.ts` and
`src/conductor/src/engine/daemon-rekick.ts`. The substantive work is confined to
`src/conductor/src/engine/rebase.ts`.

Small-tier architecture, conflict, and coherence artifacts are not required. No ADR is required: the
approved gated-rebase-resolution sub-loop record scopes itself to the path between `performRebase`'s
`conflict_halt` outcome and `writeHalt`, and names `performRebase` as existing unchanged machinery
outside its own boundary. This change stays inside `performRebase` and inside halt-note selection,
and it leaves the sub-loop's cap, dispatch, and acceptance guards exactly as recorded.
