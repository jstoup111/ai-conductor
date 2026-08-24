# ADR: Diff-locality is an authored disposition, not a detected property

**Date:** 2026-08-23
**Status:** APPROVED
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1799

## Context

Intake #1799's third defect is a completion criterion that invalidated itself between authoring and
BUILD. From the plan of `plan-tasks-lack-falsifiable-done-criteria-so-revie` (Task 2, recovered from
commit `e93914b2f^`):

    - A corpus test over every landed plan on main finds exactly one plan with a non-empty map and
      an empty map for every other.

Six plans on main carried the block by the time BUILD ran — several landed by the same initiative's
sibling features — so the build reported 100% implementation and a failing assertion
(`expected 1, got 5`) that no implementation work could fix.

This is a distinct defect class from #1763's falsifiability bar. "Exactly one plan on main" is a
definite yes/no and passes that bar; it rots because its truth depends on state outside the
feature's own diff. The missing predicate is diff-locality, not decidability.

Detecting it mechanically is unattractive. The signal is semantic — a criterion is non-diff-local
when its truth can be changed by a commit this feature does not contain — and the surface forms are
open-ended ("every landed plan on main", "all specs in the corpus", "no other feature"). A keyword
matcher over that space would be exactly the anti-pattern CLAUDE.md names: a "deterministic" check
that delegates its hard core to string matching on prose, needing an ever-growing exception list.
It would also produce false rejections on legitimate criteria that merely mention `main`.

## Options Considered

### Option A: Keyword/heuristic detection of census-shaped criteria
- **Pros:** No authored field; catches the known phrasings immediately.
- **Cons:** String matching on prose as the hard core of a gate. Open-ended surface, false positives
  on criteria that legitimately mention the corpus, and an exception list that grows forever.

### Option B: Model judgement at land
- **Pros:** Suits the semantic question.
- **Cons:** Forbidden — adr-2026-07-22-coherence-gate-placement-and-validation-split requires the
  land rung to be model-free.

### Option C: Leave it to plan-authoring prose guidance
- **Pros:** Zero machinery; `/plan` already carries falsifiability guidance from #1764.
- **Cons:** #1764 shipped as skill prose only and this defect occurred anyway, in a feature of that
  very initiative. Prose alone is demonstrably insufficient here.

### Option D: An authored per-criterion disposition, mechanically required at land
- **Pros:** Puts the judgement where it belongs — the author, at authoring, deciding whether this
  criterion's truth can be changed by a commit outside this diff — while the engine mechanically
  requires the disposition to be present and non-negative on every criterion row. Machinery for the
  bookkeeping, judgement at the point that genuinely needs one, per CLAUDE.md's softened principle.
  Forcing an explicit answer per criterion is itself the intervention: the census criterion above is
  hard to mark diff-local once the question is asked directly.
- **Cons:** An author can mark a non-local criterion local and pass. Adds a field to every row.

## Decision

**Option D.** Every `criterion` row carries a diff-locality disposition. At land, `runCoherenceGate`
requires the disposition to be present and non-negative on every row; an absent or negative
disposition is rejected, naming the criterion.

The engine deliberately does **not** attempt to determine diff-locality itself. It enforces that the
question was asked and answered for each criterion, and that no criterion was landed with a
disposition saying its truth depends on state this feature does not control.

A criterion legitimately requiring corpus-wide state is not made unlandable: it is recorded through
the existing coherence waiver mechanism
(`adr-2026-07-22-coherence-waiver-and-duplicate-claim`), which requires a named gap id and written
rationale. That preserves #1799's fourth desired outcome — a deliberate deferral stays recordable
rather than silently dropped — and keeps the escape auditable instead of implicit.

Gap ids for these rejections join the existing waiver vocabulary rather than forming a new one, so
every new refusal is waivable. A refusal with no waivable id is a design defect under that ADR.

## Consequences

### Positive
- The census defect class is addressed at plan-authoring time, where it is cheap, rather than as an
  unfixable BUILD assertion failure.
- No prose-matching heuristic enters the gate, so there is no exception list to maintain and no
  false-rejection class on criteria that mention the corpus.
- The deliberate-deferral path is explicit and auditable.

### Negative
- The check is only as good as the author's answer; a mislabelled criterion still passes. This is a
  forcing function, not a proof.
- Another authored field per criterion row, compounding the ceremony added by
  `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`.
- A criterion can become non-diff-local after authoring through no edit of its own, and nothing
  re-checks the disposition later.

### Follow-up Actions
- [ ] Define the disposition vocabulary and its non-negative set in `skills/coherence-check/SKILL.md`
- [ ] Enforce presence and non-negativity in `runCoherenceGate` with a criterion-naming rejection
- [ ] Register the new gap ids in the coherence waiver vocabulary
- [ ] Add the diff-locality question to `skills/plan/SKILL.md` alongside #1764's falsifiability guidance
