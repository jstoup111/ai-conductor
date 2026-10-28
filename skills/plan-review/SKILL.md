---
name: plan-review
description: "Use only within active engineer/conduct DECIDE after coherence-check for Medium or Large work to adversarially review the final plan against the real source. Reports source-grounded findings; does not author or amend plan artifacts."
enforcement: gating
phase: decide
disable-model-invocation: true
---

## Purpose

Judge the final plan against the target worktree's real source after `/coherence-check` and before
land. This is an adversarial, source-grounded review: deterministic candidate rows are prompts for
judgment, never findings by themselves. Return only findings the supplied evidence supports; the
engine owns dispatch, schema validation, artifact rendering, operator dispositions, and land
enforcement.

Run only for Medium and Large work. For Small work, do not create a review artifact or substitute
this review for the plan's §7b contradiction review.

## Read-only review

This reviewer is read-only. It MUST NOT write or edit any worktree file, generated artifact,
operator-decision store, configuration, or source; it MUST NOT stage or commit. Do not run tests,
builds, formatters, or commands that modify project state. Inspect the supplied artifacts and source
through the read-only session, then return the terminal structured result requested by the engine.

## Inputs and evidence

Use the supplied stories, every plan task, relevant ADR Decision sections, coherence artifact,
candidate rows, and the target worktree source. `ADR DECISIONS` contains the decisions changed by
the spec. `INDEX` lists the remaining in-scope decisions and coherence artifact by path; read each
indexed item from its listed worktree path before relying on it. Assess the final plan rather than
reconstructing candidate generation or routing.

Every finding needs concrete evidence. Record a feasibility finding citing the source `file:line`
when a planned input differs from what production passes. Quote both passages for every
contradiction. An ungrounded suspicion is advisory at most: do not promote it to significant or
blocking merely because it sounds plausible.

## Candidate lenses

Judge every supplied candidate under these lenses:

- **test-impact:** an existing test references a path or identifier a task changes, but no task
  updates that test.
- **reachability:** a planned export or primitive has no production caller in source and no task
  that supplies one.
- **dependency-order:** a task needs a path, export, or identifier that only a task outside its
  dependency closure introduces.
- **feasibility:** a planned step cannot work against the actual source, including when its planned
  input differs from the value production really passes.

Candidates with insufficient evidence are not findings. Search beyond candidates for the
contradiction lenses below.

## Contradiction sweep

Check static contradiction, oscillation, task-versus-task conflict, preserved-behavior conflict,
and criterion-conflict. Treat ADR-versus-story as a cross-layer pair.

For every task-versus-task pair sharing a behavior, resource, state, input, output, or gate, ask:
“if I fully satisfy A, does B still hold?” Then ask the other direction. Pairs with nothing shared
need no finding. Two negative answers identify an oscillation; one may identify a static
contradiction or another applicable conflict. A merely uncovered criterion is not a contradiction.

**Layer ownership.** Story↔story pairs belong to `/conflict-check`. Cross-layer and task versus task
pairs belong to plan review at Medium and Large tier, and to the plan's §7b at Small tier.

## Verification

Before returning, verify the task-versus-task sweep considered both directions for every pair with a
shared subject. Verify every reported finding has the required source-grounded evidence, and that
each claimed contradiction quotes both opposing passages. Return no finding for a candidate or pair
that the evidence does not support.
