# Complexity: build_review sees wiring_check gate instructions

Tier: S

## Rationale

Signals assessed against the standard set (models, integrations, auth, state machines,
story count):

- **Data models:** none new. Reads the existing `ConductorEvent` union member `kickback`;
  adds one optional field to the existing `BuildReviewInputs` interface.
- **Integrations:** none. No third-party boundary, no network, no new process.
- **Auth / permissions:** none.
- **State machines:** unchanged. No new step, gate, phase, or transition; the wiring_check
  kickback path in `conductor.ts` is not modified.
- **Event spine:** no new channel, no new variant, no new writer — this is a read of a
  record the spine already persists to `.pipeline/events.jsonl`.
- **Surface area:** two engine modules (`build-review-inputs.ts`, `build-review-prompt.ts`)
  plus their unit tests, and one docs page (`docs/explanation/gates.md`).
- **Story count:** small — one behavior (assemble the context) plus its rendering and the
  degraded/absent-ledger path.

The change mirrors an existing precedent end to end: `repairContext` is read from a
`.pipeline/` ledger in the same function and rendered as its own prompt section. No new
architecture is introduced, so architecture-diagram, architecture-review, conflict-check
and coherence-check are skipped per the S tier.
