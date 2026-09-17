# PRD: Guided setup walks the operator through project and operator configuration

**Date:** 2026-09-14
**Status:** Approved

**Source:** jstoup111/ai-conductor#2218

## Problem / Background

Onboarding a project leaves the operator to configure the harness by hand. The guided setup that
runs when a project is onboarded asks exactly two questions, then records a configuration built
almost entirely from fixed defaults — including a test command assumed to be the one used by a
single ecosystem, regardless of what the project is actually written in.

Everything else an operator must decide is reached only by opening a configuration file and editing
it. The written file carries little guidance: the operator sees setting names and terse comments,
but not what each setting controls, what values are permitted, or what changing it costs them. The
separate reference documentation explains how configuration is loaded and merged, not what an
operator should choose.

The most damaging instance is operator identity. The harness attributes authored work to an
operator, and refuses to proceed when that identity cannot be established. No guided flow ever
establishes it, and no supported action sets it — the only route is hand-editing a file the
documentation points at. A new operator therefore reaches a hard, fail-closed stop with no
self-service fix, at the end of a setup that appeared to succeed.

## Goals & Non-Goals

**Goals**
- An operator onboarding a project reaches a complete, valid, understood configuration without
  opening a configuration file.
- Every setting the operator is asked about is explained well enough to choose a value confidently.
- Choosing something other than the default is a supported outcome of the walkthrough, not a
  follow-up chore.
- Operator identity is established during onboarding, before the fail-closed stop can be reached.
- Settings the walkthrough does not ask about are explained where the operator will find them.

**Non-Goals**
- Reconfiguring projects that are already onboarded, in bulk or across the operator's machine.
- Turning project registration into an interactive action.
- Replacing the reference documentation that explains how configuration loads and merges.
- Validating operator-supplied values beyond the permitted set for each question.

## Users / Personas

- **New operator, first project.** Has installed the harness and is onboarding a repository for the
  first time. Does not know which settings exist, let alone what to set them to. Today they either
  accept defaults that may be wrong for their stack, or stop at a fail-closed error.
- **Experienced operator, new project.** Knows the settings and wants to depart from the defaults
  for this project without a detour into a file editor.
- **Returning operator, configured project.** Re-runs onboarding on a project that is already set
  up, and must not lose or silently change any value they previously chose.
- **Automation.** A daemon or continuous-integration run that onboards or reconfigures without a
  person present, and must never be blocked waiting for an answer.

## Functional Requirements

- **FR-1:** When onboarding runs with an operator present, the operator is walked through each
  project-scoped setting they are expected to decide, one question at a time.
- **FR-2:** Each question states, in plain language, what the setting controls, which values are
  permitted, which value applies if the operator does nothing, and what choosing a non-default
  value changes.
- **FR-3:** A value the operator chooses is recorded in the project's configuration, including when
  it differs from the default.
- **FR-4:** Accepting the offered value at every question produces the same project configuration
  that onboarding produces today.
- **FR-5:** The command that runs the project's test suite is established from what the project
  actually uses, and is never recorded as a fixed assumption about the project's ecosystem.
- **FR-6:** When operator identity is not already established, onboarding establishes it, without
  the operator editing any file.
- **FR-7:** Operator identity is recorded so that it applies to every project this operator works
  on, and is never written into state that is shared with collaborators through the repository.
- **FR-8:** When operator identity cannot be established during onboarding, onboarding says so
  plainly and names what will not work until it is established.
- **FR-9:** Re-running onboarding against an already-configured project preserves every
  operator-set value byte-for-byte; no previously chosen value is overwritten or silently changed.
- **FR-10:** On a re-run, the operator is told which settings are already established rather than
  being asked to decide them again.
- **FR-11:** Settings the walkthrough does not ask about are explained alongside the recorded
  configuration itself, so the operator can change them later without consulting separate
  documentation.
- **FR-12:** When no operator is present — automation, or no interactive terminal — onboarding
  completes using defaults and is never blocked waiting for an answer.
- **FR-13:** An answer outside the permitted set for a question is rejected and re-asked; an
  invalid value is never recorded.
- **FR-14:** A configuration produced by onboarding is accepted by the harness on the next run; the
  walkthrough cannot produce a configuration the harness later rejects as invalid.

## Non-Functional Requirements

- Operator identity never leaves the operator's own machine as a result of this feature, and never
  becomes part of any artifact shared with collaborators.
- The walkthrough adds no step to automated or daemon-driven execution paths.
- A failure part-way through the walkthrough leaves the project no worse configured than before it
  started: no partially written configuration that the harness would reject.

## Acceptance Criteria / Success Metrics

- A new operator can onboard a project in a non-default configuration and run the harness
  successfully, without opening a configuration file at any point.
- A new operator never reaches the unresolved-identity stop as a consequence of onboarding having
  completed.
- Onboarding a project whose test suite is not run by the assumed ecosystem command produces a
  working test command.
- Re-running onboarding on a configured project changes nothing.
- Every functional requirement is covered by a passing test, including the negative behaviors in
  FR-9, FR-12, and FR-13.

## Scope

### In Scope
- The guided walkthrough during project onboarding, its question set, and the quality of the
  explanation attached to each question.
- Recording operator-chosen values, default and non-default alike.
- Establishing operator identity during onboarding.
- Explanations attached to the recorded configuration for settings not asked about.

### Out of Scope
- Applying configuration changes across already-registered projects during an update; captured as
  separate intake.
- Prompting during project registration or project creation.
- Any change to how configuration is loaded, merged, or validated at run time.
- Re-deciding settings that a previous run already established.

## Key Decisions & Rationale

- **The walkthrough asks; it does not assume.** The present behavior records a plausible default
  for a decision it never surfaced, which is worse than asking: the operator does not learn the
  setting exists and discovers the wrong value only when something fails.
- **Identity is established at onboarding, not at first failure.** The fail-closed stop is correct
  behavior and stays; the defect is that nothing offers the operator a way through it beforehand.
- **Explanation belongs at the point of decision.** Guidance that lives only in reference
  documentation is not read while choosing a value. It is attached to the question, and for
  settings never asked about, to the recorded configuration itself.
- **Defaults remain the safe path.** An operator who answers nothing gets exactly today's outcome,
  so the walkthrough can be added without changing any existing project's result.

## Dependencies

- The existing project onboarding flow, which already asks a small number of questions and already
  delegates the writing of configuration to a deterministic component rather than composing files
  itself.
- The existing terminal question-and-answer capability used elsewhere during installation.
- GitHub authentication, which already acts as a fallback source of operator identity when one is
  not configured.
- The existing fail-closed identity rules, which forbid operator identity from being carried in
  state shared through the repository.

## Open Questions

- Where a value chosen in the walkthrough is persisted, and by which component, given that the
  onboarding flow is not permitted to author configuration files itself — a trade-off between
  widening the inputs accepted by the existing deterministic writer and introducing a general
  ability to record a single chosen setting. For architecture-review.
- Whether a re-run should be able to change an already-established value on explicit request, or
  stay strictly additive. Product leans additive (FR-9, FR-10); architecture-review should confirm
  no downstream consumer requires a change path.
- How the explanation shown at the question and the explanation recorded alongside the
  configuration stay consistent over time — one authored source versus two that can drift.
- Whether establishing the project's real test command requires detection, an operator-supplied
  answer, or both, and what happens when detection is ambiguous. For architecture-review.
