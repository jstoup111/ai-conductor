# PRD: Live provider identification per step and per parallel member

**Date:** 2026-10-14
**Status:** Approved
**Source:** jstoup111/ai-conductor#1268

## Problem / Background

When a run has more than one provider registered (for example Claude and Codex with a fallback
ladder), an operator watching it cannot tell which provider is doing the work right now. The
provider is resolved for every dispatch, but the live output names it only after an attempt
finishes, or when a fallback fires. Parallel group members (the validation and build-verification
groups, and configured parallel branches) produce no live line at all, so members of one group
that are running on different providers at the same time cannot be told apart.

"Which provider is running this?" is a routine operator question, because providers differ in cost,
speed, and quality. Today it can only be answered after the fact, by reconstructing the persisted
event history.

## Goals & Non-Goals

**Goals**
- While a provider-backed step or member is executing, the live output names the provider
  executing it.
- Members of a parallel group running at the same time are distinguishable, each with its own
  provider.
- The provider shown is the one actually executing. A mid-step fallback updates what is shown.

**Non-Goals**
- Changing how providers are selected, routed, or fallen back to.
- Changing cost, usage, or token reporting.
- Changing the daemon status dashboard (deferred; outside the confirmed Balanced scope).

## Users / Personas

- **Operator watching a daemon log**, who wants to know which provider a slow, failing, or
  expensive step is running on while it runs.
- **Operator running an interactive conduct session**, with the same need in the live terminal
  view.

## Functional Requirements

- **FR-1:** When a provider begins executing an attempt of a serial step, the daemon log shows a
  line naming the step and that provider, before the attempt completes.
- **FR-2:** When a provider begins executing an attempt of a serial step, the interactive terminal
  view shows the step and that provider, before the attempt completes.
- **FR-3:** When a provider begins executing an attempt for a member of a parallel group, both live
  surfaces show the member's name, its parent group, and that provider.
- **FR-4:** When two members of one parallel group execute at the same time on different
  providers, each member's line names its own provider, and neither member's line names the other
  member's provider.
- **FR-5:** When a fallback moves a step or member to another provider mid-step, both live surfaces
  show a new line naming the provider that took over. The earlier line is not presented as the
  current provider.
- **FR-6:** The provider shown is the one that actually began executing the attempt, never one
  that was only preferred or configured. A candidate that is skipped without executing is not
  shown as running.
- **FR-7:** When the model used for an attempt is known at the time it begins, the line shows the
  model next to the provider. When the model is not known, the line shows the provider alone,
  without a placeholder model.
- **FR-8 (negative):** When a provider-backed attempt begins but its provider cannot be determined,
  the line explicitly says the provider is unknown. It is never blank and never reuses a previous
  attempt's provider.
- **FR-9 (negative):** A step or member that does not dispatch any provider (a purely mechanical
  check) shows no provider line, and is not labelled "unknown".
- **FR-10 (negative):** In a serial, single-provider run with no fallback, each provider-backed
  step gains at most one additional line on each live surface, and no line is repeated during the
  attempt.
- **FR-11:** The provider-start identification is recorded in the run's persisted event history,
  so post-run analysis can see when each attempt began and on which provider.

## Non-Functional Requirements

- Displaying the provider must not delay or block the dispatch of the attempt.
- A failure to render the provider line must not fail, retry, or halt the step.
- Historical event records written before this change must still be read without error.

## Acceptance Criteria / Success Metrics

- Every FR is covered by a passing test.
- In a run with a validation group whose members are routed to different providers, an operator
  can read, from either live surface alone and while the members are in flight, which provider each
  member is running on.
- After a forced fallback, the live surfaces show the fallback provider as current without waiting
  for the step to finish.

## Scope

### In Scope
- Live provider identification on the daemon log and the interactive terminal view, for serial
  steps and parallel-group members (built-in groups and configured parallel branches).
- Fallback, unknown-provider, and no-provider behavior on both surfaces.
- Persisting the start-of-attempt identification in the run's event history.

### Out of Scope
- The daemon status dashboard.
- Provider routing, fallback policy, or provider selection changes.
- Cost and token reporting changes.
- Backfilling provider identification into historical runs.

## Key Decisions & Rationale

- **Identify at the start of each attempt, not at the start of each step.** A step can change
  provider through fallback, so only an attempt-level identification can satisfy FR-5 and FR-6.
  Identification at step start can only know the preferred provider, which goes stale on fallback.
- **Balanced scope (two live surfaces, no dashboard)**, chosen by the operator during exploration.
- **Mechanical steps show nothing rather than "unknown"** (FR-9). "Unknown" is reserved for a
  provider dispatch whose identity cannot be determined, so the word always signals a real gap.

## Dependencies

- The existing provider routing and fallback behavior, which this feature observes but does not
  change.
- The existing run event history, which every operator-facing surface reads.

## Open Questions

- How the start-of-attempt identification travels on the existing event history: a new event, or
  an extension of an existing provider-attempt event. Architecture-review to decide; it must keep
  historical records readable.
- How member attribution is carried, so that concurrent members of the same step stay
  distinguishable (FR-4). Architecture-review to confirm the attribution is available at the point
  where the provider begins executing.
