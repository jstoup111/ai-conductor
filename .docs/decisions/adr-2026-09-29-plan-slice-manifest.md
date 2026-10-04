# ADR: Plans declare ordered slices in one engine-validated manifest

**Date:** 2026-09-29
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session for jstoup111/ai-conductor#2723

## Context

The stacked-PR chain (#2723 → #2724 build-loop slice checkpoints → #2725 FINISH stack publication →
#2726/#2727, then #2715/#2716) needs one feature's plan to declare a small number of ordered slices,
where each slice is a group of plan tasks. The operator's scale note is that a 40-task plan must
never become 40 PRs. Nothing downstream can act until a declared, validated slice structure exists.

Today the plan grammar the engine parses is entirely per-task. `plan-task-parse.ts` reads task
headings, `**Story:**`, `**Done when:**`, and `**Files:**`. `**Dependencies:**` is only
presence-checked (`planHasDependencyTree` in `artifacts.ts`), and the pipeline skill orders tasks.
There is no plan-wide grouping and no config surface for opting into stacked publication.

Corpus facts (verified 2026-09-29 at `4d850beb9`):
- 512 plans carry 5,383 `**Dependencies:**` lines. About 96% are a bare id list or `none`. The
  other 229 are free-form: ranges (`Tasks 1–9`), `all prior.`, or trailing prose.
- `parsePlanTaskBodies` runs a task's body until the next task heading. A plan section placed
  after the first task is therefore absorbed into the preceding task's body.

A repo-wide sweep of all 325 ADRs found no ADR that governs plan-section grammar, slices, or a
strict Dependencies grammar, and none that contradicts this design. The decisions below comply with:
- `adr-2026-08-30-shared-plan-task-reference-resolver` (D1: no consumer re-derives task-id
  validity);
- `adr-2026-07-05-engine-owned-task-status` (H9 id grammar);
- `adr-2026-08-31-coverage-binding-judge-step` (D6, D16, D17, D19, D20);
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (D4);
- `adr-2026-07-26-daemon-decide-preseed-ownership` (discovery keeps its presence-only check);
- `adr-2026-09-23-one-owner-for-accepted-story-readability` (one predicate, called by land and
  one later rung).

## Options Considered

### Option A: per-task `**Slice:** <n>` line plus a separate slice-title list
- **Pros:** matches the existing per-task bold-line style.
- **Cons:** membership is spread across every task body. Moving a task rewrites that task's body.
  Titles still need a second list. Bold plan lines are known to register only their first value
  when a comma list or trailing note is present.

### Option B: `## Slice <n>: <title>` headings that group `### Task` headings
- **Pros:** reads naturally.
- **Cons:** every slice heading is absorbed into the previous task's body (see Context), so
  regrouping rewrites task bodies. Fixing that needs a boundary change in the shared task-body
  parser that every plan consumer depends on.

### Option C: one `## Slices` manifest table before the first task (chosen)
- **Pros:** each slice names its title and its tasks, literally as the outcome asks. The table sits
  outside every task body, so a move between slices is a single row edit. Task ids resolve through
  the existing shared resolver.
- **Cons:** an author can forget to add a new task to the table. The membership rule refuses that
  at land.

## Decision

1. **Grammar: an optional `## Slices` manifest table.** A plan may contain at most one
   `## Slices` section, outside fenced code and before the first task heading
   (`TASK_HEADER_PATTERN`). The section holds one pipe table whose header is exactly
   `Slice | Title | Tasks`. Each row has three cells:
   - `Slice`: a positive-integer order position.
   - `Title`: a non-empty, reader-facing title.
   - `Tasks`: a comma list of plan task ids, resolved through `resolvePlanTaskReference`. The
     resolver's rules apply: an annotation is stripped, a repeat inside one cell collapses, and an
     empty segment is malformed.

   A plan without the section is **unsliced**, and it is valid whether `stacked_prs.enabled` is on
   or off.

2. **One owner: `validatePlanSlices(planText)` in `plan-slices.ts`.** It is a pure, model-free
   function. It returns a typed result:
   - `unsliced`;
   - `sliced`, with the ordered slices (position, title, task ids); or
   - `invalid`, with one typed violation per defect, each carrying a violation code, the slice
     position, the task id where one applies, and a message.

   It reads task ids from `TASK_HEADER_PATTERN` headings and never re-derives task-id validity. The
   engineer land gate (Decision 5) and the `coverage_binding` slice layer (Decision 6) are its only
   production callers. Daemon discovery and `planHasDependencyTree` stay presence-only and
   unchanged.

3. **Membership rules.** Engine-appended remediation tasks (`isEngineAppendedRemediationTaskId`)
   are exempt, because they are appended after land by the one-appender authority. Their slice
   placement is #2724's decision. Every other task id declared by a task heading must appear in
   exactly one slice. The following are violations:
   - a task in no slice;
   - a task in two or more slices;
   - a slice with no tasks;
   - two slices with the same order position;
   - a `Tasks` cell citing an id that no task heading declares;
   - a malformed table, row, or cell;
   - more than `MAX_PLAN_SLICES` slices. This is a code constant equal to 5, not a config key,
     following `adr-2026-09-05-gh-cli-version-floor` D2.

   Slices are ordered by position value. Gaps between positions are allowed.

> **Amended 2026-10-03 by #2940:** (adr-2026-10-03-stacked-child-plans-identity-and-state decision 5) The slice-count bound becomes the operator
> config key `stacked_prs.max_slices`:
> - the default is 1;
> - values 1–9 are accepted, values above 5 log a warning, and 10 or more is a `validation_error`;
> - it applies to stacked delivery, and #2941 implements it where land consumes it.
>
> This replaces "a code constant equal to 5, not a config key" for the stacking bound once #2941
> lands. Until then the constant stands. Child identities are capped by the fixed engine ceiling
> `MAX_CHILD_ID` = 9, which never depends on configuration.

4. **Strict Dependencies grammar, for sliced plans only.** In a sliced plan, every non-exempt task
   carries exactly one `**Dependencies:**` line. The accepted forms are:
   - `none`; or
   - a comma list of task references, each an id optionally prefixed by `Task` or `Tasks` and
     optionally followed by a parenthetical annotation.

   Ids resolve through `resolvePlanTaskReference`. Ranges and free prose are refused, because an H9
   id may itself contain a hyphen. A dependency on a task in a **later** slice is a violation. A
   dependency on the same slice or an earlier one is allowed. An unparseable line, a missing line,
   or an unknown id is also a violation. Unsliced plans keep today's presence-only check, so the
   229 existing free-form lines are unaffected.

5. **Land rung `plan-slices`: every tier, flag-independent, non-waivable.** `landSpec` calls
   `validatePlanSlices` beside the Done-when and task-count checks. Any `invalid` result throws
   `landGateError('plan-slices', …)`, a new `LandGateIdentifier` member. The message names every
   violation. A grammar violation also lists the accepted forms, and an over-bound plan names the
   bound (5).
   - The rung ignores `stacked_prs.enabled`, so turning the flag on later can never expose a plan
     that already landed.
   - It applies at every complexity tier.
   - Every slice violation is non-waivable: the violations are evidentiary or structural, and no
     waiver parser accepts them. This follows decision D4 of
     `adr-2026-09-02-adr-decision-citability-contract`: refuse only, append nothing.
   - The rung stays model-free and offline, and it reads the worktree plan, so a re-run of land
     gives the same verdict.

6. **`coverage_binding` slice layer: re-validation after amendment, with visible membership
   change.** Following the precedent of D17 in `adr-2026-08-31-coverage-binding-judge-step`, the
   `coverage_binding` runner calls `validatePlanSlices` on the plan it resolved.
   - **When it runs:** before the judge, whatever the judge's enabled key says, at every tier. That
     includes the re-run that D16's operator reseal triggers when the plan changed.
   - **An `invalid` result:** records `refused` and ends needs-human through the existing refusal
     path and halt writer. It names each violation, never appends a task, and never routes to
     `plan` (D6).
   - **Membership recording:** the runner records the engine-computed membership in the envelope
     as an optional field: task id → slice position, plus the ordered slice titles, excluding
     exempt ids. That field is kept when the envelope is invalidated. It is not completion evidence,
     leaves `COVERAGE_BINDING_COMPLETION_STATUSES` unchanged, and never enters the judge prompt.
   - **`plan_slices_changed`:** emitted only when the prior envelope recorded membership and the
     current membership differs. The event names the moved, added, and removed tasks, and whether
     the manifest was dropped. A manifest newly added to an unsliced plan has no prior membership,
     so it is a baseline (below) and emits nothing.
   - **Baseline:** a prior envelope with no recorded membership (legacy, first run, or a recreated
     worktree) is a baseline, per D19. It records membership and emits nothing.
   - **Unsliced plans:** the layer is inert for a plan that is unsliced both before and after.

> **Amended 2026-10-03 by #2940:** (adr-2026-10-03-stacked-child-plans-identity-and-state decisions 5–7) The recorded membership is also the source
> of a stacked feature's child identities: a child id is a declared slice position. The recovery
> CLIs read it to validate `--child`, and later tickets read it to resolve the active child. It
> remains non-completion evidence and still never enters the judge prompt. Once any child state or
> child branch exists, declared positions must not change. #2942 implements the guard that halts a
> reseal that would move them.

7. **Event `plan_slices_changed` joins the persisted spine.** It is a new `ConductorEvent` member
   with an `EVENT_SINKS` row `{ render: false, persist: true, audit: false, otel: false }`. It is
   classified not-audited-by-design, like its `coverage_binding_*` siblings, because a slice move
   is a record of what changed, not an operator-friction record. It is not added to the OTel
   visualizer list or the metrics listener. A slice move is a new fact that no existing event
   carries, which is why it is a new type rather than an extra field. No sidecar log, marker, or
   timestamp is added.

8. **Config: `stacked_prs.enabled`, default off and reserved.** A new top-level `stacked_prs`
   block accepts only `enabled` (boolean, default `false`). `loadProjectConfig` rejects the
   following as a `validation_error` naming the key:
   - a non-object block;
   - an unknown sub-key;
   - a non-boolean `enabled`.

   The `mergeable_autoresolve.enabled` shape is the model. The consumer registry declares
   `stacked_prs` and `stacked_prs.enabled` as `none`, with the reason "reserved for #2724
   build-loop slice checkpoints; replaced by a real consumer when #2724 lands". That ticket is the
   flag's exit condition. The key appears, commented and inert, in
   `templates/project-config.yml.template` and in the configuration reference. Nothing in this
   feature reads it: with the flag off, and equally with it on, a sliced plan builds and publishes
   exactly as today, as one branch and one PR.

9. **The authoring surface states the grammar, and a drift test keeps it honest.**
   `skills/plan/SKILL.md` documents the `## Slices` table, the membership and dependency rules, and
   the bound. A test parses the skill's example manifest with `validatePlanSlices` and requires a
   `sliced` result, so the documented grammar cannot drift from the validator.

## Consequences

### Positive
- #2724 and #2725 get a validated, ordered slice structure with one owner and a typed result.
- A malformed or oversized slice declaration fails at land, before any spec PR is opened. A
  post-build amendment that breaks slicing fails at `coverage_binding`, before the next build lap.
- Moving a task between slices is a single table-row edit. It is re-validated on reseal and appears
  on the event spine, so it is never silently dropped.
- No existing plan changes behavior. Strict Dependencies parsing engages only when a plan opts in
  by declaring slices.

### Negative
- Sliced plans must use the strict Dependencies grammar (no ranges, no prose). That is a small
  authoring tax, stated in the skill.
- `land-spec.ts` and the `coverage_binding` runner are high-contention files, so expect rebase work.
- A hand-authored plan that bypasses `land` is caught only at `coverage_binding`, not before
  BUILD's first step (the known gap in `adr-2026-08-08-single-adr-approval-parser-three-rungs`).
- `stacked_prs.enabled` is a deliberately inert key until #2724.

### Follow-up Actions
- [ ] #2724 replaces the `none` consumer declaration with the build-loop reader and decides where
      engine-appended remediation tasks sit.
- [ ] #2724/#2725 amend the one-branch/one-PR ADRs
      (`adr-2026-08-09-one-pr-per-branch-halt-is-a-state` and the FINISH publication ADRs) when
      publication changes.
