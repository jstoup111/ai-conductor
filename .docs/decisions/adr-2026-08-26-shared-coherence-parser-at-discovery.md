# ADR: Discovery consumes the shared coherence parser; the bespoke triple-scan is deleted

**Date:** 2026-08-26
**Status:** APPROVED
**Deciders:** operator (jstoup111), engineer session for #1881

## Context

Two independent readers of `.docs/coherence/<plan-stem>.md` diverged. `engineer land` parses via
`parseCoherenceArtifact` (`coherence-validator.ts`), which ignores header width and accepts the
documented ragged shape (five-cell legacy rows beside six-cell `criterion` rows). Daemon dispatch
discovery uses a bespoke `hasCoherenceTableDataRow` triple-scan (`daemon-backlog.ts`) requiring
header/separator/data widths to be equal. A six-wide header over five-cell rows landed (PR #1879),
merged, and was then permanently unbuildable — skipped at dispatch as "missing or unparseable"
(issue #1881), recoverable only by a hand-authored PR against the default branch.

`adr-2026-07-26-daemon-decide-preseed-ownership` D4 already names the hazard this ADR resolves:
"Duplicating the validator would create two divergent notions of validity for one artifact." Its
rule — deep semantic validation stays at land; discovery is shallow and change-set-free — stands.

`adr-2026-08-23-criterion-layer-is-structural-at-land` stated as a fixed requirement that
`hasCoherenceTableDataRow` is not modified. That requirement's *intent* is behavioral — a merged
spec valid at discovery before the criterion layer stays valid — and this ADR preserves that
behavior while replacing the mechanism; the 08-23 ADR carries an amendment note pointing here.

## Options Considered

### Option A: Discovery calls the shared `parseCoherenceArtifact` (chosen)
- **Pros:** land-accepted ⇒ dispatch-parseable by construction; kills the divergence class, not
  the instance; parse failures can name the offending line for both surfaces; matches the
  `adr-2026-08-08-single-adr-approval-parser-three-rungs` precedent (single parser, multiple
  rungs, bespoke predicate deleted).
- **Cons:** the parser must be reachable from `daemon-backlog.ts` without dragging in land-only
  imports; requires amending 08-23's fixed requirement.

### Option B: Teach the triple-scan the ragged shape
- **Pros:** tiny diff; no ADR amendment.
- **Cons:** two grammars remain; every divergence class not yet hit stays open; no diagnostics.

### Option C: Option A plus a land-time dispatch-simulation gate
- **Pros:** belt-and-braces.
- **Cons:** redundant — with one shared parser the two acceptance sets are identical by
  construction. Declined by the operator (Balanced scope).

## Decision

1. **The pure parsing core of `parseCoherenceArtifact` is extracted to a lean, dependency-light
   shared module** (no land-only imports: no overlap-scan, rebase, owner-gate, blocker-resolver),
   re-exported by `coherence-validator.ts` for existing land callers. Discovery imports the shared
   module directly. The parser stays change-set-free (text in, result out), honoring D4.
2. **`hasCoherenceTableDataRow` is deleted** and its single call site in `discoverBacklog` calls
   the shared parser. `ok: false` at a non-S tier keeps the existing fail-closed behavior:
   `BlockedSpecItem` with reason `missing-coherence` (union unchanged) and a `warnOnce` skip.
3. **Parse failures carry structural detail.** The parser's failure branch gains an optional
   `detail` field naming the offending line number and what disagrees with what (e.g. expected
   cell count vs actual, unknown row class). Existing `CoherenceParseFailureReason` ids are NOT
   renamed (`adr-2026-07-22-coherence-waiver-and-duplicate-claim` makes gap-id stability an API).
   Land rejections and the dispatch `remedy`/log line include the detail verbatim. Per
   `adr-2026-08-24-evidentiary-defects-are-not-waivable`, enriched parse failures remain
   non-waivable refusals.
4. **No-regression obligation** (adapting `adr-2026-08-05-blocked-classification-after-dedup`,
   whose strict set-equality cannot hold here because the fix intentionally accepts more): the
   change ships a test running discovery over fixtures under both predicates asserting every
   old-accepted fixture stays eligible and that all divergences are new-predicate acceptances
   (the #1881 shape asserted eligible explicitly), plus the 08-23 pin — an artifact with zero
   `criterion` rows still passes discovery.

> **Amended 2026-08-28 by #1945:** decision 4's obligation is restated. "Every old-accepted fixture
> stays eligible" is not a property the shared parser provides, and the corpus measurement below
> already records why: the parser rejects an artifact carrying a second markdown table beneath the
> mapping table, a shape the retired triple-scan accepted. The obligation is therefore restated as
> **no silent loss**: every artifact the retired predicate accepted is either eligible at discovery,
> or blocked with reason `missing-coherence` carrying a remedy that names the offending line and the
> parser's message (`daemon-backlog.ts:983-995`). Nothing the old predicate accepted may disappear
> from discovery without an operator-visible, actionable diagnostic.
>
> This is a narrowing of the guarantee, not a downgrade of its purpose: the #1881 stranding class
> that motivated this ADR was precisely a spec that vanished from discovery with no usable
> diagnostic, and the restated obligation still forbids exactly that. The corpus test enumerates
> each divergence and asserts its direction — new-predicate acceptances explicitly, and each
> old-accepted / parser-rejected shape with the blocked remedy it produces. Dedup skipping a
> counterexample before it reaches the parser does not discharge the obligation; the shape must be
> exercised in an un-deduped run.
>
> Widening the parser to tolerate trailing tables — which would restore the original superset
> property — is tracked separately as jstoup111/ai-conductor#1979 and deliberately not decided here.

### Corpus blast radius (measured 2026-08-26, 107 landed artifacts on main)

- 100 accepted by both predicates.
- 6 accepted by the old triple-scan, rejected by the shared parser — **all six are shipped**
  (`.docs/shipped/` records on main), and discovery's shipped/processed dedup runs before the
  coherence check, so none is reachable at dispatch. Zero regressions.
- 1 rejected by the old triple-scan, accepted by the shared parser:
  `remove-retrospectives-full-and-micro-from-feature-.md` — the exact #1881 failure shape,
  un-shipped; this change makes it buildable.

### Scoping note: line numbers in diagnostics

`adr-2026-08-18-content-anchored-finding-reference-schema` forbids coordinate encodings in
*persisted finding identities* (build-review dispositions, rebase-stable references). The line
number added here is a transient diagnostic in a refusal message and a per-pass `blocked.json`
remedy, regenerated on every parse — it is not a persisted identity and is outside that ADR's
scope.

## Consequences

- A coherence artifact accepted by `engineer land` is parseable at dispatch by construction; the
  #1881 stranding class is closed.
- Operators reading a skip or land rejection see the offending line and the disagreement, not a
  generic "missing or unparseable".
- Absent / empty / table-less artifacts at non-S tiers remain blocked at dispatch (fail-closed
  unchanged); tier-S exemption unchanged.
- `adr-2026-08-23-criterion-layer-is-structural-at-land` is amended (mechanism, not intent);
  review condition C1 of `architecture-review-2026-08-23-coherence-rows-assert-story-task-coverage-that-not.md`
  is satisfied in intent (merged corpus keeps building, evidenced by the corpus run) while its
  stated mechanism is retired by this ADR.
