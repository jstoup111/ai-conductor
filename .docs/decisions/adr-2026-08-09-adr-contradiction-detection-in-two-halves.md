# ADR: ADR-versus-story contradiction detection is split across two DECIDE gates

**Date:** 2026-08-09
**Status:** Approved
**Deciders:** James Stoup (operator), DECIDE architecture review for intake #1391

## Context

An approved ADR required a warning once per discovery pass while an approved story required it not
repeat on the next poll. Neither DECIDE gate compared them, so the contradiction surfaced at Task
10 of BUILD as a needs-human halt, after all prior tasks' work was spent.

Two verified facts constrain where a fix can live:

- **`skills/conflict-check/SKILL.md` §1** loads `.docs/stories/`, `.docs/specs/`, and
  `.docs/conflicts/`. `.docs/decisions/` is absent — ADRs appear in that file only as an *output*
  (create a superseding ADR) and as a kickback target, never as a comparison party.
- **`skills/coherence-check/SKILL.md`** contains zero ADR mentions; its row classes are exactly
  `outcome`, `fr`, `story`, `task`.

The step order, taken from `steps.ts` prerequisites rather than the doc comments (which are
stale — see Risks), is:

    explore → complexity → prd → architecture_diagram → architecture_review
            → stories → conflict_check → plan → coherence_check

So ADRs exist on disk before `conflict_check` runs, and `coherence_check` runs after `plan`.

Intake #1391's first desired outcome asks that the contradiction be *"reported as a blocking
conflict before the plan is approved."*

The relevant precedent: **#1394** (merged 2026-08-08, one day before this decision) added the
oscillating-conflict type to `conflict-check` and the `fail` verdict plus a §4d cross-layer
consistency pass to `coherence-check`. It supplied the **vocabulary** for expressing a
contradiction but left ADRs outside both gates' **corpora** — which is why the failure this ADR
addresses would still not be caught today.

## Options Considered

### Option A: `conflict-check` corpus expansion only
- **Pros:** Correct timing — pre-plan, exactly what outcome 1 asks for. Cheapest change; skill
  prose only, no engine risk.
- **Cons:** Unenforceable. A skipped ADR pass is indistinguishable from a clean one, because
  nothing records that the pass happened. Structurally identical to #1394, which had already
  applied prose to this same failure class without closing it.

### Option B: `coherence-check` `adr` row class only
- **Pros:** Mechanically enforced at land — the validator can prove every approved ADR carries an
  adjudicated verdict. Fail-closed, and the artifact is reviewable in the spec PR diff.
- **Cons:** `coherence_check` runs after `plan`, so the report arrives post-plan. Satisfies "not
  after BUILD starts" but not outcome 1's literal "before the plan is approved."

### Option C: Both halves
- **Pros:** The only option that satisfies outcome 1's timing *and* produces evidence the
  adjudication occurred. The two halves fail independently: prose drift is caught by the
  machinery, and the machinery's late timing is covered by the early pass.
- **Cons:** Two surfaces in one change (shipped skills catalog plus engine), and the largest diff
  of the three.

## Decision

**Option C.** `conflict-check` gains `.docs/decisions/` in its corpus (early detection, pre-plan);
`coherence-check` plus the validator gain the `adr` row class (late enforcement, land-gated).

> **Amended 2026-08-09 by #1391:** the *scope* of the corpus this decision gives `conflict-check` is
> staged, and is no longer "all approved ADRs" by default. The default is the spec's own change-set
> ADRs; the repo-wide sweep over all approved ADRs is gated behind a default-off config key and
> enabled in this repository only, pending evidence. See
> `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` for the rule, the rationale,
> and the exit condition. The two-halves decision itself is unchanged — only the breadth of HALF 1's
> corpus at default settings.

The reasoning that decides it is this repository's Design Principle — *deterministic where
possible; LLM only where necessary*, with its corollary that when prompt discipline misses, the
fix is machinery at the point of violation rather than stronger prose.

Applied here, the principle **splits the problem rather than choosing a side**:

- *"Does this ADR contradict this story?"* is irreducibly a judgment call. No validator can
  compute it. It stays with the LLM, in `conflict-check`'s pass and `coherence-check`'s §4d.
- *"Was every approved ADR explicitly adjudicated, with a recorded verdict?"* is pure accounting
  and entirely mechanical. It becomes the `adr` layer.

The second question is precisely the step that silently did not happen in
`adr-approval-gate-before-build`. Making only the first question better — which is what a
prose-only fix does — leaves no way to tell a careful pass from a skipped one.

## Consequences

### Positive
- A contradiction is reported pre-plan, where amending an artifact is cheapest.
- The adjudication leaves a committed, diff-reviewable record; a skipped pass now fails the land
  gate instead of passing silently.
- Builds on #1394's vocabulary rather than duplicating it — the `fail` verdict and the
  oscillation heuristic already exist and are reused as-is.

### Negative
- The skill prose and the engine change **must ship in the same PR**.
  `coherence-validator.ts:130` rejects unknown row classes at parse time, so a skill emitting
  `adr` rows against an un-updated validator breaks the gate outright. This is a hard sequencing
  constraint on the implementation, not a preference.
- Two gates now read `.docs/decisions/`, so an ADR corpus change affects both. Accepted: they ask
  different questions of it (contradiction versus adjudication accounting) and neither subsumes
  the other.
- `conflict-check`'s pass grows with the ADR count, adding pairwise comparison work at a step that
  is already the most expensive judgment in DECIDE.

### Follow-up Actions
- [ ] Land both halves in one PR; do not split the skill and engine changes.
- [ ] Reuse #1394's oscillation heuristic and `fail` verdict verbatim for ADR pairs — add corpus,
      not new vocabulary.
- [ ] Update `docs/reference/skills.md` and `docs/explanation/gates.md` in the same change.
