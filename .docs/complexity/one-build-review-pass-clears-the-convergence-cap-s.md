# Complexity: One build_review PASS clears the convergence cap

Tier: M

## Signals

| Signal | Count | Mechanical tier |
|---|---|---|
| models | 0 | S |
| integrations | 0 | S |
| auth | 0 | S |
| stateMachines | 1 (kickback ledger reset/refund semantics + build_review FAIL routing) | M |
| stories | ~5 | M |

The mechanical signal set is product-shaped, so it under-reads a pure-engine change: three
structurally-zero product signals would outbid the two real ones and return **S**. Overridden to
**M** on the same grounds as both sibling features in this lane
(`repeated-build-review-semantic-failures-can-churn-`, `the-engine-cannot-detect-its-own-spinning-operator`),
which are engine changes of the same shape and were both assessed M.

## Rationale

- **Data models:** no new field and no new store. This change alters the *semantics* of two
  existing `KickbackGateEntry` fields (`cumulative`, and `rubricFailures` once
  `adr-2026-08-17` lands) by removing their clear-on-PASS and adding a credit at a different site.
  Backward tolerance is inherited rather than re-established: a legacy entry still reads clean.
  Lower model complexity than either sibling, which each added a field.
- **Integrations:** none added. No provider dispatch, no new boundary, no LLM in the decision path —
  the property `adr-2026-08-12`'s consequences record and `adr-2026-08-17` preserves.
- **State machine:** one, and it is the reason this is not S. The refund sits inside the rebase
  invalidation path, which already coordinates `classifyGateInvalidation`'s
  preserved/invalidated split, kickback-shaped verdicts, `navigateBack` re-opening, and event
  emission across five candidate target steps. Placing a one-shot, conditional credit correctly
  inside that path — crediting only an actually-invalidated gate, exactly once per invalidation —
  is the substance of the work, and getting it wrong silently over- or under-credits a bound whose
  failure mode is a spurious `needs-human` halt.
- **Sequencing risk:** `adr-2026-08-17`'s `rubricFailures` field is APPROVED and merged but **not
  yet implemented** (absent from `kickback-ledger.ts` on this base), and it carries the same PASS
  reset. This feature must land its reset change in a form that covers that field when it arrives
  without depending on it existing first. That coupling is a genuine M-tier concern and is
  conflict-check's to adjudicate.
- **Story count:** ~5 — delete the PASS reset, conditional refund, one-shot refund, spine emission,
  and the legacy/in-flight ledger negative path.

Non-Small, so `conflict-check`, `architecture-diagram`, `architecture-review`, and
`coherence-check` all apply.
