# PRD: Per-feature step applicability

**Date:** 2026-10-03
**Status:** Approved
**Source:** jstoup111/ai-conductor#1789

## Problem / Background

Which pipeline steps run is decided once, repository-wide, before any feature is specced. The only
per-feature variations today — the complexity tier and the product/technical track — are derived
classifications, not a decision about *this* change, and neither reaches most gating steps. The
repository-wide opt-out covers a single step.

As a result every change is processed as though it adds new product behavior. A change whose shape
differs (nothing new to specify, nothing new for tests to drive out) still pays for the full gate
chain and is judged by gates whose premises do not hold for it. The operator's only alternatives are
to accept inapplicable findings one at a time, or to bypass the harness and hand-drive the work —
forfeiting every gate instead of only the inapplicable ones.

This is also the foundation for #1790 (lanes for refactors, deletions, and dependency upgrades),
which needs a per-feature way to say "this step does not apply here".

## Goals & Non-Goals

**Goals**
- DECIDE can record that a named step does not apply to one feature, with a stated reason, and the
  pipeline honors that for that feature only.
- An inapplicable step is visibly recorded as such, distinguishable from every other way a step can
  end up not running or not passing.
- Repositories that do not opt in behave exactly as they do today.
- Declaring a step inapplicable is an operator judgement, never something an autonomous run can do
  on its own, and the record shows who made it.
- A step a feature genuinely needs cannot be declared away to get past a failing gate.

**Non-Goals**
- Change-class lanes or profiles (refactor / deletion / dependency upgrade) — that is #1790.
- A separate interactive operator ratification step beyond the spec review the operator already
  performs.
- Changing how complexity-tier, track, or repository-wide step disabling behave.

## Users / Personas

- **Operator** — reviews and merges spec PRs, runs the daemon; wants inapplicable gates skipped for
  a specific change without giving up the rest of the gate chain, and wants to see afterwards which
  gates were declared away, why, and by whom.
- **DECIDE author (agent or operator)** — authors the spec set and needs a place to state, with a
  reason, that a step does not apply to this feature.
- **Repository maintainer** — decides whether the repository allows per-feature step shaping at all.

## Functional Requirements

- **FR-1:** A repository can enable or disable per-feature step applicability as a repository-level
  setting; when the setting is absent the capability is disabled.
- **FR-2:** With the capability disabled, step selection for every feature is identical to today's
  behavior.
- **FR-3:** With the capability enabled, a feature's DECIDE artifact set can declare one or more
  steps inapplicable to that feature, each declaration naming exactly one step and carrying a
  non-empty, human-readable reason.
- **FR-4:** Each step states whether it may be declared inapplicable per feature; a step that does
  not state it is not declarable. Structural steps and the steps that prove the change correct and
  deliver it (the full test suite, build review, and finish) are never declarable.
- **FR-5:** Landing a spec is refused, with a message naming the offending declaration, when a
  declaration names an unknown step, names a step that is not declarable, has an empty reason, names
  the same step twice, or is present while the repository has the capability disabled.
- **FR-6:** A valid declaration causes the declared step not to run for that feature only; every
  other feature in the same repository, including ones built concurrently, is unaffected.
- **FR-7:** A declaration takes effect only once it is part of the operator-merged spec on the base
  branch; a declaration that exists only on a feature's build branch or worktree has no effect, and
  the run reports that it was ignored.
- **FR-8:** A declaration never takes effect for a step that has already started for that feature,
  including a step that is currently failing or halted; the run reports that the late declaration
  was refused and the step's prior outcome stands.
- **FR-9:** A step skipped by a declaration is recorded with a distinct "inapplicable" outcome that is
  distinguishable — in the operator's status view and in telemetry — from a complexity-tier skip, a
  track skip, a repository-wide disable, a failure, and a step that never ran.
- **FR-10:** The inapplicable record carries the declared reason and the identity of the person
  whose merge brought the declaration onto the base branch.
- **FR-11:** Downstream gates treat an inapplicable step the same way they treat any other skipped
  prerequisite today — satisfied for ordering purposes — and do not raise findings for the absence of
  that step's output.

  > **Amended 2026-10-03 by #1789:** FR-11 now requires that downstream gates neither fail nor
  > halt because a declared step's output is missing. Suppressing a judged review's prose finding
  > about the missing output is out of scope, as approved by the operator during the stories step.

## Non-Functional Requirements

- **Observability:** the inapplicable outcome is reported through the harness's existing single
  telemetry spine so every existing consumer sees it; no parallel reporting channel.
- **Back-compatibility:** no existing spec, config, or in-flight feature changes behavior when the
  capability is disabled or when a feature declares nothing.
- **Determinism:** whether a step is inapplicable is computed mechanically from the merged
  declaration and step metadata — no model judgement at dispatch time.

## Acceptance Criteria / Success Metrics

- Every FR is covered by a passing test, including each FR-5 refusal and the FR-7/FR-8 ignore and
  refusal paths.
- In a repository with the capability enabled, a feature that declares a declarable step
  inapplicable completes without that step running, and the status view and telemetry show it as
  inapplicable with its reason and decider.
- A repository with the capability disabled shows no behavior change across the existing test suite.

## Scope

### In Scope
- Repository-level enable/disable of the capability (default disabled).
- Per-feature declaration authored during DECIDE, validated when the spec lands.
- Per-step declarability, with the never-declarable set in FR-4.
- Honoring declarations at dispatch from the merged base only, refusing late declarations.
- Distinct inapplicable outcome with reason and decider identity in status and telemetry.

### Out of Scope
- Change-class lanes/profiles (#1790).
- An interactive, terminal-confirmed operator ratification of each declaration.
- Changes to tier, track, or repository-wide disable behavior.
- Declaring steps inapplicable for features already past DECIDE through any path other than a
  merged spec amendment (and then only for steps not yet started, per FR-8).

## Key Decisions & Rationale

- **Operator authority is the spec merge.** The operator already reviews and merges every spec PR
  before the daemon builds it; requiring the declaration to be on the merged base makes the merge
  the operator judgement and keeps autonomous runs from self-declaring. A separate ratification step
  was considered and rejected as extra operator work for this scope.
- **Opt-in per repository, default off.** Guarantees repositories that set nothing see no change.
- **Opt-in per step, with a fixed never-declarable core.** Prevents the capability from becoming a
  way to silence the gates that prove a change correct.
- **Reason required per declaration.** Makes every declaration reviewable in the spec PR and
  auditable afterwards.

## Dependencies

- Existing operator-merged spec PR flow (spec lands on the base branch before the daemon builds it).
- The harness's existing telemetry spine and operator status view.
- #1790 depends on this feature.

## Open Questions

- Which non-core steps should be declarable by default (e.g. acceptance specs, manual test,
  PRD/PRD audit, architecture review, conflict/coherence checks)? — architecture-review to decide,
  weighing what each downstream gate assumes about that step's output.
- Where the per-feature declaration lives: a dedicated per-feature marker alongside the existing
  tier/track markers versus a section of an existing DECIDE artifact — architecture-review trade-off.
- How the decider identity is derived (author of the base-branch commit that introduced the
  declaration vs. the merger of the PR that carried it) and what is recorded when it cannot be
  determined (e.g. a local-commit fallback with no PR).
- Whether the distinct outcome is a new step status or a new skip cause on the existing status —
  architecture-review trade-off against existing consumers that switch on step status.
