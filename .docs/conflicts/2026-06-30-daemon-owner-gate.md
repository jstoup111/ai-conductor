# Conflict Report: Daemon Owner-Gating

**Date:** 2026-06-30
**Stories checked:** `.docs/stories/daemon-owner-gate.md` against existing `.docs/stories/*` and
current daemon-engine behavior.
**Result:** 0 blocking, 2 degrading (both carried into architecture-review with recommendations).

The owner-gate stories were authored to **compose additively** with existing daemon selection:
every FR explicitly preserves the existing content-eligibility filters, the processed-set
idempotency, and warn-once skip logging (FR-5/FR-6/FR-7/FR-8/FR-9/FR-11 negative paths). No
contradiction, state-conflict, or sequencing conflict was found. Two degrading overlaps remain.

---

## Conflict: The term "owner" is already taken in the daemon engine

**Stories involved:** daemon-owner-gate (FR-1, FR-4, FR-5) vs. existing daemon-lock behavior.
**Files:** `.docs/stories/daemon-owner-gate.md` vs. `src/conductor/src/engine/daemon-lock.ts`
**Type:** resource-contention (naming / semantic)
**Severity:** degrading

**Description:**
`daemon-lock.ts` uses **"owner"** to mean *the process that holds the 1-per-repo pidfile lock*
(`PidRecord owner`, `result.owner`, "existing owner is still alive"). This feature introduces
**"owner"** to mean *the operator identity a daemon builds for*. Same word, unrelated concepts, in
the same engine. Left un-disambiguated this will confuse readers and risks accidental coupling
(e.g. a future refactor conflating lock-owner with operator-owner). It is degrading, not blocking —
they live in different structs/files and never interact at runtime.

**Resolution Options:**
1. Give the new concept a distinct name everywhere — e.g. **operator identity / `specOwner` /
   `ownerIdentity` / `buildOwner`** — and reserve bare `owner` for the lock context. (Least
   disruptive; pure vocabulary discipline.)
2. Rename the lock's `owner` → `lockHolder`/`holder`. (Touches stable lock code for no functional
   gain — riskier.)
3. Do nothing and rely on file context to disambiguate. (Rejected — invites exactly the confusion
   above.)

**Recommendation:** Option 1 — name the new concept distinctly (never bare `owner` near the lock)
and **codify the vocabulary in an ADR** during architecture-review, so the naming boundary is a
ratified decision, not an ad-hoc choice.

---

## Conflict: Owner stamp overlaps the existing intake marker the engineer writes

**Stories involved:** daemon-owner-gate (FR-4 — stamp owner at authoring) vs. existing engineer
intake write-back (`intake-issue-pr-link-autoclose`, `phase-9.3b-github-intake-writeback`).
**Files:** `.docs/stories/daemon-owner-gate.md` vs. `.docs/stories/intake-issue-pr-link-autoclose.md`,
`.docs/stories/phase-9.3b-github-intake-writeback.md`
**Type:** behavioral overlap
**Severity:** degrading

**Description:**
The engineer `land` flow already commits a per-spec marker (`.docs/intake/<slug>.md` carrying
`Source-Ref: <ref>`). FR-4 needs to commit an owner identity at that same authoring moment, into
the same neighborhood. This is overlap, not contradiction: both write per-spec committed metadata
during `land`. The risk is two competing artifacts/paths for spec metadata if FR-4 introduces a
*separate* mechanism instead of extending the established one.

**Resolution Options:**
1. Extend the existing per-spec intake marker to also carry the owner identity (one artifact, one
   write path in `land`). (Least disruptive; reuses the proven seam.)
2. Introduce a dedicated owner artifact/field alongside the intake marker. (More surface, two
   things to keep consistent.)
3. Derive owner from something already committed (e.g. git author) instead of stamping. (Rejected
   in the PRD — fragile under squash-merge, where the merger becomes the author.)

**Recommendation:** Option 1 — reuse/extend the existing intake marker as the owner carrier, and
coordinate the exact field with the phase-9.3b intake work. This is already flagged as a PRD Open
Question ("where the owner is recorded"); resolve it in architecture-review so the two features
share one metadata path.

---

## Non-conflicts confirmed (checked, cleared)

- **`discoverBacklog` content filters** (plan/stories/dep-tree/processed): owner gate is an
  *additional* filter that never bypasses them (FR-6/FR-7/FR-8/FR-9). No contradiction.
- **Processed-set idempotency**: FR-5 and FR-13 negative paths explicitly preserve it. No conflict.
- **warn-once skip logging**: FR-11 reuses the existing pattern rather than replacing it. No conflict.
- **GitHub-issue intake queue** (`--assignee @me`): explicitly out of scope; this feature gates the
  *autonomous spec build* surface, a different code path. No behavioral collision.
- **daemon-pr-labels / halt-reconciliation / supervised-hosting**: PR-labeling and lifecycle, not
  spec selection. No overlap with the gate.

---

## Gate

**Zero blocking conflicts — clear to proceed to architecture-review + plan.** The two degrading
overlaps are accepted as known compromises and handed to architecture-review, which must:
(1) ratify the owner-vs-lock vocabulary in an ADR, and (2) resolve where the owner stamp is
recorded (reuse the intake marker), coordinating with the phase-9.3b intake work.
