# Complexity: build_review testQuality evidence travels by reference (#2582)

Tier: M

## Rationale

- Touches four engine modules, not one: evidence pinning and the snapshot type
  (`build-review-inputs.ts`), the sealed projection (`build-review-projections.ts`), rubric
  dispatch and prompt assembly (`step-runners.ts`), and the failure classification consumed by the
  coordinator (`build-review-domain.ts` / `build-review-coordinator.ts`).
- Changes a versioned, digest-sealed contract that a cache, an aggregate parser, and a shipped
  skill all read. The change is shape-only — `contentHash` already carries the region's semantic
  identity — but proving that requires cache-invalidation and identity-stability coverage, not a
  single unit test.
- Adds a new failure lane behaviour: an oversized projection must stop being charged to the shared
  mechanical-fault allowance. That interacts with `adr-2026-08-18-mechanical-rubric-faults-are-their-
  own-lane` and with the reduced-coverage seam on the aggregate, so it needs a reviewed design
  decision rather than a local edit.
- Governed by an existing approved ADR (`adr-2026-09-06-engine-owned-test-quality-scope`, D6/D8/D11)
  whose "compact evidence" and projection-size obligations this change makes real; an amendment is
  the likely landing surface, which is architecture-review work.
- Not Large: no new subsystem, no new CLI surface, no config schema change, no provider contract
  change, and the judgement semantics of the rubric are untouched. Estimated 4-6 stories.

Per tier rules, architecture-diagram, architecture-review (lightweight), conflict-check, and
coherence-check all apply.
