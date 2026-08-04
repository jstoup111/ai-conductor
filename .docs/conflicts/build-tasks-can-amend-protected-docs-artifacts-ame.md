# Conflict Check: Amendment of accepted `.docs/` artifacts belongs to DECIDE

**Date:** 2026-08-04
**Tier:** M
**Stories:** `.docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md`
**Refs:** jstoup111/ai-conductor#1293
**Verdict:** PASS — zero blocking conflicts; zero required amendments

## Inter-story checks (TS-1 … TS-6)

- **No contradiction.** TS-1 governs DECIDE-time authoring, TS-2/TS-3 govern rejection of a plan that
  directs an amendment elsewhere, TS-4/TS-5 govern the mid-BUILD route and its SHIP backstop, TS-6
  narrows one remediation case. Each owns a disjoint decision point.
- **No overlap.** The amendment ledger is written by TS-1 and read by TS-5; the request artifact is
  written by TS-4 and read by TS-5. Both are single-writer, and TS-5 is the only reader.
- **No state conflict.** TS-2's own-feature exemption and TS-4's unsealed request directory are the two
  places this change deliberately does *not* tighten. Both are stated identically in the ADR and in the
  stories, so no story can be implemented in a way that contradicts the other.
- **Sequencing.** TS-1 must land before TS-2 can pass its end-to-end criterion (a DECIDE-authored
  amendment reaching the seal baseline). TS-5 depends on TS-4's artifact existing. Reflected in the
  plan's dependency graph.

## Checks against the accepted corpus

Each item below was read directly, not inferred from a summary.

### Cleared — `.docs/plans/2026-07-27-protected-artifact-seal-self-amendment-1047.md:37`

> "**No new amendment ledger file, no new `.pipeline/` schema.** The evidence already travels in
> `build_review`'s diff; do not build transport for data that is already there."

Read literally this forbids the `.docs/amendments/` ledger TS-1 introduces. Read in place it does not,
for two independent reasons:

1. **A plan's Non-goals section scopes that plan, not the future.** It states what *that* change will
   not do. It is not a standing prohibition on the repository, and treating per-feature scope
   statements as permanent bans would freeze the corpus.
2. **The stated rationale does not transfer.** The non-goal's own justification is that the data is
   already in `build_review`'s diff. That is true of #1047's subject — reporting tolerated *own-feature*
   self-amendments — and false of this one. Cross-feature amendment intent at DECIDE time exists before
   any diff, in no artifact, which is precisely the gap #1293 was filed against.

**No amendment required.** Recorded here rather than passed over silently because a reader
encountering both artifacts will notice the tension.

### Cleared — `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`

Its decision is scoped to own-feature self-amendment: report rather than halt, and let `build_review`
judge scope. This change neither reverts that nor extends it. TS-2's own-feature exemption is
explicitly *consistent* with it — the seal keeps tolerating own-feature amendment, and the new
authoring check does not re-forbid what that ADR deliberately permitted.

### Cleared — `.docs/architecture/…` and `.docs/stories/…` corpus

No accepted assertion anywhere states that a plan task may name a sealed path. `skills/plan/SKILL.md`
is silent on which paths may appear on a `**Files:**` line; silence is not an accepted assertion, so
there is nothing to falsify. Checked across `skills/plan`, `skills/stories`, `skills/conflict-check`,
`skills/remediate`, and the seal's documentation in `docs/reference/artifacts.md`.

## Resource contention

- **`.docs/amendments/` directory** — new; contends with nothing. Deliberately outside the four sealed
  directories and requiring an entry on the `.docs` write allowlist. Both properties are load-bearing
  and pinned by TS-4.
- **`land-spec.ts` gate sequence** — TS-3 adds one gate to an existing ordered sequence. It does not
  reorder or alter the existing coherence, DRAFT-ADR, tier, or mermaid gates.
- **`parsePlanTaskPaths`** — TS-2 adds a seventh consumer to an existing exported parser. Read-only;
  no signature change.

## Adjacent issues — overlap the operator should see

- **#1254** ("Protected DECIDE artifact task traps feature in BUILD cycle") is the same collision class
  with malformed metadata rather than an intended amendment. This spec delivers two of its four stated
  desired outcomes: a finalized plan cannot assign mutation of a protected artifact to a BUILD task
  (TS-2, TS-3), and a remediation finding requiring such a change is not routed back to BUILD (TS-6).
  Its remaining outcome — every provider prevented from *committing* the mutation — is the runtime
  write-guard half and is **not** in this scope. #1254 should be re-scoped or closed against this
  spec's delivery, an operator decision, not one this spec makes.
- **#1281** ("no operator command to reseal") is deliberately **not** a dependency. This design routes
  around the reseal path by landing amendments before the seal baseline is taken. #1281 remains
  independently worth shipping as an escape hatch.

## Known adjacent hole, explicitly out of scope

The `retro` step carries `.docs/stories/` on its write allowlist. A retro that edits *another*
feature's story would therefore clear the write-guard and then trip the seal — the same collision, at
SHIP instead of BUILD. This spec does not change the retro allowlist. Flagged so the next reader does
not assume it was covered.

## Verify-Claims Verdict

Every claim above cites text read directly during this check. The one contested item — whether the
#1047 plan's Non-goal binds this change — was settled by reading the non-goal's own stated rationale
rather than by preference. No unconfirmed load-bearing assumption remains.

Verdict: CLEAR
