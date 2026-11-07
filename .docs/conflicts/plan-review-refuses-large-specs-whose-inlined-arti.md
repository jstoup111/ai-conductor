# Conflict Check: plan review prompt carries an index, not every cited ADR (#3278)

**Date:** 2026-10-24
**New stories:** `.docs/stories/plan-review-refuses-large-specs-whose-inlined-arti.md` (Stories 1-4)
**Result:** passed. 0 blocking, 1 degrading (operator accepted 2026-10-24).

## Inventory

Story files that mention plan review or its inputs, compared pair by pair with Stories 1-4 in both directions:

- `source-grounded-plan-defects-pass-every-decide-gat.md` (Stories 1-11, the plan-review owner)
- `contradictory-decide-artifacts-reach-build-and-hal.md` (ADR-versus-story contradiction at M/L tier)
- `no-decide-sweep-covers-task-versus-task-oscillatio.md` (task-pair sweep)
- `2026-07-12-wiring-reachability-gate.md` (plan review flags partial `Wired-into:` coverage)
- `multi-child-feature-cannot-resume-after-an-operato.md` (step order after `plan_review`)
- `shipped-features-decide-artifacts-accumulate-in-do.md` (pruning `.docs/plan-review`)
- `config-keys-that-validate-but-have-no-consumer-inc.md` (closed config keys and unknown-key errors)

The remaining story files share no behavior, entity, config key or gate with Stories 1-4 and were narrowed out.

ADRs examined: `adr-2026-10-10-source-grounded-adversarial-plan-review-step` (D3 amended by this spec, D5-D8 compared), `adr-2026-07-22-coherence-gate-placement-and-validation-split` (land stays model-free), `adr-2026-08-09-adr-contradiction-detection-in-two-halves`. Narrowed out: every ADR whose subject is not plan review, its prompt inputs, or config validation.

## Pairs judged compatible

- **Round 2 (owner Story 7 vs new Story 1).** Both state round 2 re-checks only digest-changed tasks, stories and decisions plus prior blocking and significant findings. Satisfying either keeps the other.
- **Evidence rules (owner Story 4 vs new Story 2).** Indexed items carry worktree paths, and validation still grounds against the full texts, so every evidence rule still holds.
- **No added friction (owner Story 9 vs new Stories 3-4).** A size refusal already existed (#3234). The new refusal is narrower and names an override, so clean specs gain no interaction.
- **Land rung (owner Story 8, ADR D7 vs new Story 2).** The reviewed digest still covers every in-scope ADR text, so staleness detection is unchanged.
- **Closed config keys (`config-keys-that-validate-but-have-no-consumer-inc.md` vs new Story 3).** The new `plan_review` block has consumers on both entry points, and unknown keys fail as they do elsewhere.
- **Task-pair sweep and reachability.** Every plan task stays inline, so both sweeps see what they saw before.

## Conflict: indexed decisions are judged only if the reviewer opens them

**Stories involved:** owner Story 5 "Feasibility and contradiction are judged against real source by one reviewer", and `contradictory-decide-artifacts-reach-build-and-hal.md` "ADR whose implementing story contradicts it", vs new Story 1 "The round-1 prompt inlines what the spec changes and indexes the rest"
**Files:** `.docs/stories/source-grounded-plan-defects-pass-every-decide-gat.md`, `.docs/stories/contradictory-decide-artifacts-reach-build-and-hal.md` vs `.docs/stories/plan-review-refuses-large-specs-whose-inlined-arti.md`
**Type:** overlap
**Severity:** degrading

**Description:** The existing criteria expect a contradiction finding when a task or story contradicts "an in-scope ADR decision". New Story 1 removes the text of unchanged in-scope decisions from the prompt. The capability survives: the reviewer has read tools, the index names each decision's path, and new Story 2's brief requires opening an indexed item before relying on it. But a contradiction against an unchanged decision is now found only if the reviewer chooses to open it. Neither story is falsified; detection of that one case becomes reviewer-dependent.

**Resolution Options:**
1. Accept the compromise. Changed decisions, which are what a spec amends and where contradictions concentrate, stay inline. Unchanged decisions are reachable by path, with titles to guide the reviewer.
2. Also inline unchanged decisions that a task's text cites as `<adr-stem>#D<n>`. This narrows the gap, but the #3278 measurement showed cited-only narrowing removes only 0-30% of decision text.
3. Return to approach B (budgeted tiers inline everything that fits). Rejected at explore.

**Recommendation:** Option 1. The operator chose the index approach at explore knowing the reviewer would read indexed items, and architecture review registered this risk as Medium impact with the same mitigation.

**Operator decision:** Option 1 accepted, 2026-10-24.
