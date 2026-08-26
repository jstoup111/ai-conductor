# ADR: The coherence `criterion` layer is structural, and all its strictness stays at land

**Date:** 2026-08-23
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1799

## Context

Intake #1799 requires that a coherence row claiming a story criterion is covered by a named task
be accepted only when the plan text supports it, and that an accepted criterion owned by no task be
reported at DECIDE rather than surfacing two steps later as an `acceptance_specs` needs-human halt.

That means a new `criterion` row class, which forces the question adr-2026-08-09 already answered
once for `adr`: when does the layer engage? That ADR (APPROVED) decided new row classes join the
**signal-gated** group in `resolveRequiredLayers`, never the structural group, because an
unconditional layer retroactively fails artifacts authored against an earlier contract.

The signal-gated rule cannot be applied here without defeating the purpose. The only signal
derivable from the change set for a `criterion` layer is "the artifact contains criterion rows" —
so omitting the rows would switch off the very gate whose job is to detect missing rows. That is
the defect #1799 exists to remove, re-created as the engagement rule.

Two facts, verified by reading the source, bound the retroactivity risk that motivated
adr-2026-08-09:

- `runCoherenceGate`'s only non-test caller is `src/conductor/src/engine/engineer/land-spec.ts:347`.
  The semantic validator runs **once per spec, at land**. An already-landed spec is never re-graded,
  so the merged and parked corpus cannot be failed by a stricter layer.
- Discovery's own coherence check is separate and deliberately shallow —
  `hasCoherenceTableDataRow` at `src/conductor/src/engine/daemon-backlog.ts:1018`, whose comment
  records the split: "discovery has only the base-branch tree, while the semantic validator needs a
  change set and runs at land."

So the blast radius of a structural `criterion` layer is only specs sitting mid-DECIDE on the day it
ships — not the in-flight BUILD corpus adr-2026-08-09 was protecting.

The distinction that ADR's reasoning actually turns on is visible in its own Option C rationale:
signal-gating `adr` is "semantically correct rather than merely convenient" because **a spec may
legitimately have no ADRs**. Story criteria are not like that. Every M/L spec has stories, and every
accepted story has criteria; there is no spec for which "no criterion rows" is the correct answer.

## Options Considered

### Option A: Signal-gate `criterion` on criterion-row presence
- **Pros:** Literal compliance with adr-2026-08-09; zero retroactivity even at land.
- **Cons:** Circular and self-defeating — the gate that detects missing rows is disabled by missing
  rows. It would ship a check that passes exactly the artifacts it exists to reject.

### Option B: Signal-gate on a contract-version marker in the coherence artifact
- **Pros:** Honors adr-2026-08-09's letter; non-retroactive even at land; a reader can see which
  contract an artifact was written against.
- **Cons:** This is precisely the Option B that adr-2026-08-09 considered and rejected — a second
  compatibility mechanism beside the one `resolveRequiredLayers` already owns, requiring a stamped
  and parsed field that carries no other value, and which every future row class would then need.
  Rejecting it there and adopting it here would leave two contradictory answers on the record.

### Option C: A separate pure shape rung in `landSpec`, outside `resolveRequiredLayers`
- **Pros:** No conflict with adr-2026-08-09 at all; follows the adr-2026-08-21 D1 precedent for a
  land-only plan-shape rung.
- **Cons:** Splits criterion coverage away from the coherence artifact whose entire purpose is to
  carry the outcomes → FRs → stories → tasks mapping, leaving two places that answer "is this story
  covered?" and no single artifact a reader can audit.

### Option D: `criterion` joins the structural group; all strictness confined to land
- **Pros:** The engagement rule matches the semantics — a class that is always applicable is always
  required. Inherits the tier-S exemption and the legacy-change-set escape for free, since both are
  evaluated before layer derivation. Keeps the mapping in one artifact. No new compatibility concept.
- **Cons:** Departs from adr-2026-08-09's stated rule, so that ADR must be amended rather than
  silently contradicted. Specs mid-DECIDE when this ships must add criterion rows before landing.

## Decision

**Option D.** `criterion` joins the structural layer set in `resolveRequiredLayers`, alongside
`story`, `orphan-task`, and `coverage-table`:

```ts
const layers = new Set(['story', 'orphan-task', 'coverage-table', 'criterion']);
```

adr-2026-08-09 is amended, not superseded: its signal-gating rule stands for row classes tracking a
genuine variable — a spec may have no ADRs, no PRD FRs, no intake outcomes — and does not extend to
a row class tracking something every engaged spec necessarily has. The test for a future row class
is therefore "can a correct spec legitimately have none of these?", not "is it new?".

Backwards compatibility at BUILD is a fixed requirement of this decision, not a consequence of it:

- `hasCoherenceTableDataRow` and the discovery-side coherence check are **not** modified. A merged
  spec carrying zero `criterion` rows remains a valid coherence artifact at discovery and continues
  to build.
- No BUILD or SHIP consumer may require a `criterion` row. `prd_audit` already reads the mapping
  conditionally ("where a committed coherence mapping exists"), and that tolerance is preserved.
- All added strictness lives inside `runCoherenceGate`, which runs only at `landSpec`.

## Consequences

### Positive
- The engagement rule stops being a hole in the gate: a spec cannot disable the coverage check by
  omitting the rows it is being checked for.
- One artifact continues to carry the whole traceability mapping.
- The merged and parked corpus is provably unaffected, because the strict path is never re-run
  against it.
- Future row classes get a principled test rather than a blanket "signal-gate everything new".

### Negative
- adr-2026-08-09's rule is no longer uniform; a reader must apply the variable/invariant test rather
  than a single blanket rule.
- Specs mid-DECIDE when this ships must add criterion rows before they can land. There is no
  automatic migration; the land rejection names the missing criteria, and the existing coherence
  waiver mechanism can absorb a deliberate deferral.
- Two coherence-validity notions now exist at different depths (shallow at discovery, strict at
  land). This already was true and is unchanged, but the gap between them widens.

### Follow-up Actions
- [ ] Add `criterion` to the structural set in `resolveRequiredLayers`
- [ ] Amend `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md` with the variable/invariant test
- [ ] Assert in test that `hasCoherenceTableDataRow` accepts an artifact with no criterion rows
- [ ] Assert in test that discovery does not block a merged spec lacking criterion rows
