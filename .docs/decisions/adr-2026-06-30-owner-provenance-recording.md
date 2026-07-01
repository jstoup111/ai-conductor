# ADR: Owner Provenance — How a Spec Records and Proves Its Owner

**Date:** 2026-06-30
**Status:** APPROVED
**Deciders:** James Stoup (operator)

## Context

The daemon reads **only committed state on the base branch** — it never sees the live GitHub PR. So
a spec's owner must be **recorded into the spec's committed artifacts** at authoring time, and the
daemon reads it back from the tree. Two existing facts constrain the choice:

- The engineer `land` flow **already commits a per-spec marker** (`.docs/intake/<slug>.md` carrying
  `Source-Ref: <ref>`) when an idea came from GitHub intake.
- The **phase-9.3b github-intake-writeback** work also reads/writes that marker and the intake
  ledger. A second, competing metadata artifact would risk schema drift between the two features.
- Per the PRD, **forgery resistance is a deferred non-goal** — committed text is trusted
  cooperatively now, but the design must not foreclose a verified provenance source later (EKS).

## Options Considered

### Option A: a dedicated new owner artifact/field, separate from the intake marker
- **Pros:** clean separation of concerns.
- **Cons:** two per-spec metadata artifacts to keep consistent; must coordinate with phase-9.3b
  anyway; more surface for the "no-remote / local-commit fallback" path to miss (see stories FR-4).

### Option B: extend the existing per-spec intake marker to carry the owner (chosen)
- **Pros:** one artifact, one write path in `land`; reuses the proven seam; a single place for
  phase-9.3b and this feature to agree on.
- **Cons:** couples owner recording to the intake marker's lifecycle — requires explicit
  coordination with phase-9.3b to avoid field drift.

### Option C: derive owner from git author of the spec commit (no stamp)
- **Pros:** no new write.
- **Cons:** **rejected** — under squash-merge the commit author becomes whoever merged the PR, so a
  collaborator's spec merged by the operator would mis-attribute to the operator. Fragile and wrong.

## Decision

**Extend the existing per-spec intake marker to also carry the operator/owner identity**, written on
**every** `land` path (including the no-remote / local-commit fallback — stories FR-4 negative
path), and read back through a **`ProvenanceReader` seam**. The reader is an interface whose current
implementation is `CommittedStampReader` (reads the marker from the base-branch tree); a future
`SignedProvenance` implementation can replace it without changing the gate.

The exact field name and marker schema MUST be **coordinated with phase-9.3b** so both features
share one metadata path rather than forking it.

A missing/blank stamp is **not** a valid owner — it is the "un-owned" case handled by the cutover
ADR and stories FR-8/FR-9/FR-12.

## Consequences

### Positive
- One committed metadata path for spec provenance; no competing artifact.
- Ownership travels with the spec on the base branch, independent of who merges (fixes the
  squash-merge misattribution of Option C).
- `ProvenanceReader` seam keeps a verified/signed source open for the EKS future.

### Negative
- Couples this feature to the intake marker — a schema change in phase-9.3b must account for the
  owner field, and vice versa. Requires a coordination checkpoint, not independent shipping.
- Committed text is forgeable (accepted per PRD non-goal); the seam is the mitigation, not
  cryptography today.

### Follow-up Actions
- [ ] Define the owner field on the per-spec intake marker; coordinate the schema with phase-9.3b.
- [ ] Write the owner on every `land` path, including no-remote fallback (guard the alternate branch).
- [ ] Implement `ProvenanceReader` / `CommittedStampReader`; leave the `SignedProvenance` seam.
- [ ] Treat blank/whitespace stamp as un-owned, not a match (stories FR-12).
