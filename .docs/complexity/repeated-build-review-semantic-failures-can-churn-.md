# Complexity: bound build_review churn and stop grading removal maintenance as tautology

Tier: M

## Signals

| Signal | Count | Mechanical tier |
|---|---|---|
| models | 0 | S |
| integrations | 0 | S |
| auth | 0 | S |
| stateMachines | 1 (kickback ledger + conduct step routing) | M |
| stories | ~6 | M |

`assessTier` on those signals returns **S** — three structurally-zero product signals
outbid the two real ones.

## Override to M — rationale

The mechanical signal set is product-shaped, so it under-reads any pure-engine change.
This one warrants M for three reasons:

- **It changes a terminal state.** A new cumulative bound can halt a feature that
  today would keep running. A cap set wrongly turns real progress into a spurious
  `needs-human` halt, which is the expensive failure direction. That is an
  architectural decision with an accepted trade-off, and it needs an ADR.
- **It amends an approved, already-ADR'd contract.** `adr-2026-07-26` fixed the
  per-tree bound deliberately at `MAX_KICKBACKS_PER_GATE`, and its D3 section
  explicitly rejected reason-keying. A second, cumulative bound layered on the same
  ledger must be reconciled against that ADR rather than silently added — exactly what
  `architecture_review` and `conflict_check` exist to catch.
- **It weakens a gate's rubric.** The Tautology exemption narrows what `build_review`
  rejects. Under-scoping it lets genuinely tautological tests through on any diff that
  happens to delete something. The exemption predicate must be engine-computed and
  reviewed, not asserted.

M (not L): no new subsystem, no data model, no integration. Both changes extend seams
that already exist — `kickback-ledger.ts`'s entry schema, the `kickback` event member on
the existing spine, and the grader prompt's established evidence-block pattern
(`repairContext`, `acceptedWidenings`).

## Consequence

Full DECIDE artifact set applies: architecture diagram, architecture review with ADRs,
conflict check, and the coherence mapping are all required before land.
