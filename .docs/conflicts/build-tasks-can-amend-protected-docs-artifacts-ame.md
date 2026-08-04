# Conflict Check: DECIDE mutates accepted `.docs/` artifacts; no task may

**Date:** 2026-08-04
**Tier:** M
**Stories:** `.docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md`
**Refs:** jstoup111/ai-conductor#1293
**Verdict:** PASS — zero blocking conflicts; zero required amendments

## Inter-story checks (TS-1 … TS-4)

- **No contradiction.** TS-1 governs where the mutation happens, TS-2 and TS-3 reject a plan that
  directs it elsewhere, TS-4 keeps a BUILD-discovered finding routed to DECIDE. Each owns a disjoint
  decision point.
- **No overlap.** No story introduces a new artifact, so there is no shared writer to contend over.
  This is a deliberate property of the revised design, not an accident of scope.
- **No state conflict.** TS-2's own-feature exemption is the one place this change deliberately does
  *not* tighten, and TS-4 explicitly preserves the seal's existing halt. Both are stated identically
  in the ADR and in the stories, so no story can be implemented in a way that contradicts the other.
- **Sequencing.** TS-1 must land before TS-2 can pass its end-to-end criterion (a DECIDE-authored
  amendment reaching the seal baseline). TS-3 depends on TS-2's scan existing. Reflected in the
  plan's dependency graph.

## Checks against the accepted corpus

Each item below was read directly, not inferred from a summary.

### Cleared — `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`

Its decision is scoped to own-feature self-amendment: report rather than halt, and let `build_review`
judge scope. This change neither reverts that nor extends it. TS-2's own-feature exemption is
explicitly *consistent* with it — the seal keeps tolerating own-feature amendment, and the new
authoring check does not re-forbid what that ADR deliberately permitted. TS-4 preserves its
`build_review` Scope rubric unchanged.

### Cleared — `.docs/plans/2026-07-27-protected-artifact-seal-self-amendment-1047.md:37`

> "**No new amendment ledger file, no new `.pipeline/` schema.** The evidence already travels in
> `build_review`'s diff; do not build transport for data that is already there."

An earlier draft of this spec introduced an amendment ledger and had to argue this non-goal did not
bind it. The revised design introduces no ledger and no new artifact of any kind, so the question is
moot and the non-goal is satisfied literally as well as in spirit. Recorded because the tension is
visible in this branch's history.

### Cleared — `skills/` and `.docs/` corpus

No accepted assertion anywhere states that a plan task may name a sealed path. `skills/plan/SKILL.md`
is silent on which paths may appear on a `**Files:**` line; silence is not an accepted assertion, so
there is nothing to falsify. Checked across `skills/plan`, `skills/stories`, `skills/conflict-check`,
`skills/architecture-review`, `skills/remediate`, and the seal's documentation in
`docs/reference/artifacts.md`.

## Resource contention

- **No new artifact directory.** The revised design adds none, so it contends with nothing under
  `.docs/`, and it requires no `.docs` write-allowlist entry.
- **`land-spec.ts` gate sequence** — TS-3 adds one gate to an existing ordered sequence. It does not
  reorder or alter the existing coherence, DRAFT-ADR, tier, or mermaid gates.
- **`parsePlanTaskPaths`** — TS-2 adds a seventh consumer to an existing exported parser. Read-only;
  no signature change.
- **Remediation dispositions** — TS-4 narrows one case in an existing routing table and adds no new
  disposition value and no new gate.

## Adjacent issues — overlap the operator should see

- **#1254** ("Protected DECIDE artifact task traps feature in BUILD cycle") is the same collision class
  with malformed metadata rather than an intended amendment. This spec delivers two of its four stated
  desired outcomes: a finalized plan cannot assign mutation of a protected artifact to a BUILD task
  (TS-2, TS-3), and a remediation finding requiring such a change returns to its owning DECIDE phase
  rather than BUILD (TS-4). Its remaining outcome — every provider prevented from *committing* the
  mutation at runtime — is the write-guard half and is **not** in this scope. Whether #1254 is
  re-scoped or closed against this spec is an operator decision, not one this spec makes.
- **#1281** ("no operator command to reseal") is deliberately **not** a dependency. This design routes
  around the reseal path by landing mutations before the seal baseline is taken. #1281 remains
  independently worth shipping as an escape hatch.

## Known adjacent hole, explicitly out of scope

The `retro` step carries `.docs/stories/` on its write allowlist. A retro that edits *another*
feature's story would clear the write-guard and then trip the seal — the same collision, at SHIP
instead of BUILD. This spec does not change the retro allowlist. Flagged so the next reader does not
assume it was covered.

## Verify-Claims Verdict

Every claim above cites text read directly during this check. No unconfirmed load-bearing assumption
remains.

Verdict: CLEAR
