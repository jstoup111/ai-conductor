# Conflict Check: Gate satisfied without dispatch leaves no state key (#1587)

**Date:** 2026-09-14
**Result:** PASSED — zero blocking conflicts, zero degrading conflicts

## Scope

**ADR corpus:** `conflict_check.adr_corpus` is unset, so the default `change_set` scope applies.
The change set contains one decisions-directory artifact — this feature's own architecture review,
`architecture-review-2026-09-14-gate-satisfied-without-dispatch-leaves-no-state-ke.md`. No new or
amended ADR is in the change set, so no ADR-versus-story comparison party exists beyond that
review's own conditions, against which both stories were checked and found consistent.

**Stories scanned:** all files in `.docs/stories/`. Pair analysis was concentrated on the files
that share this feature's behavior, entity, field, or gate — identified by searching the story
corpus for implementation-evidence and gate-verdict subject matter rather than by assuming
isolation.

## Candidate pairs examined

### `rekick-resume-runs-finish-while-the-build-gate-ver.md` — closest neighbor, no conflict

This is the nearest story set in the corpus: it governs the resume entry index, and its Story 4
asserts that a resume with all verdicts satisfied fast-forwards to `finish`.

Bidirectional test (confidence 95%, verified against both story texts):

- If this feature's Story 1 is fully satisfied — FINISH judges implementation evidence through
  `gateSatisfied` — does that feature's Story 4 still hold? **Yes.** Story 4 constrains where the
  run *starts*; this feature changes only what FINISH *reads* once it is running. The resume index
  derivation is untouched.
- If that feature's Story 4 is fully satisfied — an all-satisfied resume starts at `finish` — does
  this feature's Story 1 still hold? **Yes**, and Story 4 is the precondition that makes Story 1
  matter: it produces exactly the state in which the loop has resolved the gates and handed
  control to FINISH.

Two "yes" answers, so no oscillation and no contradiction. The relationship is complementary:
Story 4's fast-forward is the path that today reaches a FINISH which then refuses the very gates
the resume accepted. This feature completes that intent rather than opposing it.

### `gate-step-completion-validates-against-code-state-.md` — no conflict, strengthening

Its Story 2 (a re-dispatch preserves a passed gate whose surface is unchanged) and Story 5 (a
kickback that changed code still invalidates the verdict) govern when a gate verdict is valid
against the current code state.

Bidirectional test (confidence 92%, verified against both story texts):

- If those stories are fully satisfied, does this feature's Story 1 still hold? **Yes**, and more
  strongly: FINISH inherits their code-state validation by reading the verdict rather than a raw
  state key, which carries no such validation.
- If this feature's Story 1 is fully satisfied, do those still hold? **Yes.** This feature adds a
  *reader* of the verdict layer and changes no writer, no stamp, no invalidation rule, and no
  sweep.

### `maintain-documentation.md` — not a pair

Its single "implementation evidence" occurrence refers to grading documentation prose against the
implementation. Different subject; no shared behavior, entity, field, or gate.

## Conflict types evaluated

| Type | Result |
|---|---|
| Contradiction | None. No scanned story asserts that FINISH should judge implementation evidence from step state, nor that a resolved gate should be re-refused. |
| Behavioral overlap | None incompatible. The two neighbors above touch the same gate-verdict store but in non-overlapping roles — index derivation and verdict validity — while this feature adds a consumer. |
| State conflict | None. No combination of the scanned stories produces a state that is both satisfied and unsatisfied for one gate: `gateSatisfied` is a single predicate, and this feature routes one more consumer into it rather than adding a competing rule. |
| Resource contention | None. `.pipeline/gates/` gains a reader, not a second writer; `conduct-state.json` is not written by this feature at all. |
| Sequencing | None. This feature assumes no ordering that the scanned stories do not already establish, and establishes none of its own. |
| Oscillating | None. Both close pairs were tested in both directions above and returned two "yes" answers each; no pair returned a "no" in either direction. |

## Assumptions surfaced

The clean verdict rests on one assumption, stated rather than assumed silently per the
correctness gate:

**Assumption (confidence 90%, inferred):** no story outside the pairs examined above constrains
what FINISH's implementation-evidence observation may read. Basis: the story corpus was searched
for both the behavior ("implementation evidence") and the mechanism ("gate verdict",
"gateSatisfied", "satisfied verdict"), and every match was either examined above or was a
different subject. **Impact if wrong:** an unexamined story could assert a state-only evidence
contract, which would make this feature's Story 1 a contradiction rather than a clean addition.
**How to confirm:** the land-time coherence mapping and `build_review`'s plan-versus-diff
adjudication both re-examine the story corpus against the delivered change.

## Resolutions applied

None required. No story was modified, no ADR was superseded, and no degrading compromise was
accepted.
