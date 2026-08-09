# ADR: The coherence `adr` layer is gated by a committed ADR signal, not always required

**Date:** 2026-08-09
**Status:** Approved
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1391

## Context

Adding `adr` as a fifth coherence row class means the land-time gate must decide **when** to
require it. Every coherence artifact authored before this ships has no `adr` rows. If the layer
were unconditionally required, the gate would begin rejecting specs that were never asked to
author the rows — a retroactive failure of exactly the kind the existing no-retroactivity escape
was built to prevent.

`docs/explanation/gates.md:182` documents that escape, but it only covers a change set carrying
**no** `.docs/coherence/` file at all. It does not cover an *existing* artifact that merely lacks
one row class.

The relevant existing machinery, verified by reading
`src/conductor/src/engine/engineer/coherence-validator.ts:1256-1292`:

```ts
export function resolveRequiredLayers(
  worktree, tier, track, outcomes, changeSet,
): RequiredLayersResult {
  if (tier === 'S') return { engaged: false, reason: 'tier-exempt' };
  const changed = changeSet instanceof Set ? changeSet : new Set(changeSet);
  const hasCoherenceSignal = [...changed].some((p) => p.startsWith('.docs/coherence/'));
  if (!hasCoherenceSignal) return { engaged: false, reason: 'legacy-change-set' };

  const layers = new Set(['story', 'orphan-task', 'coverage-table']);   // structural
  const effectiveTrack = track ?? 'product';
  if (effectiveTrack === 'product') layers.add('fr');                   // marker-gated
  if (outcomes.length > 0) layers.add('outcome');                       // signal-gated
  return { engaged: true, layers };
}
```

The function already distinguishes **structural** layers (always required once engaged) from
**signal-gated** layers (`fr` from the track marker, `outcome` from persisted intake bullets),
and it **already receives the `changeSet`** and already tests path prefixes against it.

## Options Considered

### Option A: Make `adr` a structural layer (always required once the gate engages)
- **Pros:** Strongest guarantee — no spec with ADRs can ever skip adjudication. Simplest rule to
  state.
- **Cons:** Retroactively fails every coherence artifact authored before this ships, including
  specs already in flight whose artifacts are complete and correct by the contract they were
  written against. Requires inventing a *second* escape hatch to undo the damage, which
  duplicates the concept `resolveRequiredLayers` already owns.

### Option B: Add a new dedicated escape hatch (e.g. a version stamp on the artifact)
- **Pros:** Explicit; a reader can see which contract an artifact was written against.
- **Cons:** Introduces a new compatibility mechanism alongside the one that already exists, so two
  places now answer "does this layer apply?". Requires stamping and parsing a field that carries
  no other value, and every future row class would need the same treatment.

### Option C: Make `adr` a signal-gated layer, keyed on committed ADR presence in the change set
- **Pros:** Reuses the exact mechanism already in place for `fr` and `outcome` — no new concept,
  no new parameter, no new escape hatch. Inherits the tier-S exemption and the legacy-change-set
  no-retroactivity escape for free, because both are evaluated *before* layer derivation. A spec
  with no ADRs never has the layer required, which is also the semantically correct answer rather
  than merely a convenient one.
- **Cons:** A spec that *should* have authored an ADR but did not is not caught by this layer —
  the gate can only adjudicate ADRs that exist. That gap belongs to `architecture_review`, which
  decides whether an ADR is warranted, not to the coherence gate.

## Decision

**Option C.** The `adr` layer joins the signal-gated group:

```ts
const hasAdrSignal = [...changed].some((p) => p.startsWith('.docs/decisions/adr-'));
if (hasAdrSignal) layers.add('adr');
```

The layer is required **iff the change set carries one or more `.docs/decisions/adr-*` files**.

> **Amended 2026-08-09 by #1391:** the rule above is a deliberate *over-approximation* with respect
> to deletions, and the deletion case is resolved at pool derivation rather than here. `resolveIdeaFiles`
> (`land-spec.ts:498-503`) builds the change set from `git diff --name-only`, which includes the paths
> of **deleted** files, and `resolveRequiredLayers` receives `ideaFiles` as paths only, with no status
> codes (`coherence-validator.ts:1366`) — so this signal structurally cannot distinguish a deleted ADR
> from an added one, and a deletion-only change set therefore still engages the layer. That is
> harmless and intentional: the ADR **pool** is derived inside `runCoherenceGate` from the
> status-carrying list `resolveChangedFilesForWaiver` already computes, and it **excludes deleted
> ADRs**. A deletion-only change set thus engages the layer over an empty pool, finds nothing to
> adjudicate, and passes. Resolving it this way keeps `resolveRequiredLayers`' signature unchanged,
> which three other layers depend on.

Two details are load-bearing:

1. **The prefix is `.docs/decisions/adr-`, not `.docs/decisions/`.** That directory also holds
   architecture-review reports (`architecture-review-*.md`, `review-*.md`) and other
   non-ADR records — verified by listing a real feature's `.docs/decisions/`. Keying on the bare
   directory would require an `adr` row for every review report, which is not an ADR and has no
   counterpart to adjudicate.

2. **"Approved" needs no new parser.** `coherence-validator.ts:1297-1298` states that
   `runCoherenceGate` is the entry point `land-spec.ts` calls **after the existing DRAFT-ADR
   gate**, and `land-spec.ts:28` confirms land already rejects any artifact carrying an
   unapproved-status marker (case-insensitive). By the time the coherence gate runs, every ADR in
   the change set is therefore already known to be approved. The ADR pool is the file list; no
   status parsing is required.

Detail 2 also keeps this change independent of the in-flight `adrApprovalStatus` parser from the
`adr-approval-gate-before-build` feature, which is **not on main** (verified: `git grep
adrApprovalStatus main -- src/` returns nothing). Depending on unmerged work would couple this
spec to a feature that is currently halted.

## Consequences

### Positive
- No new compatibility mechanism. The change is additive to a function that already does exactly
  this for two other layers.
- Pre-existing coherence artifacts are unaffected unless their spec also carries ADRs.
- Tier-S and legacy-change-set specs are untouched, because both short-circuit before layer
  derivation.
- No dependency on unmerged work, and no second ADR-status parser to keep in sync.

### Negative
- A spec that *omits* an ADR it should have written is not caught here. This is a genuine limit,
  accepted because detecting a missing ADR is `architecture_review`'s judgment, not a coverage
  question the validator can compute.
- The `.docs/decisions/adr-` prefix is a naming-convention dependency. An ADR filed under a
  different name is invisible to the layer. This is consistent with the existing convention
  documented in `templates/adr.md.template` and enforced by the architecture-review skill.

### Follow-up Actions
- [ ] Add `adr` to `CoherenceRequiredLayer` and derive it in `resolveRequiredLayers`.
- [ ] Ensure the ADR pool filters on the `adr-` filename prefix, with a test proving a
      review report in the same directory does not demand an `adr` row.
- [ ] Cover the compatibility case in tests: an existing coherence artifact with no `adr` rows,
      in a change set with no ADRs, still passes.
