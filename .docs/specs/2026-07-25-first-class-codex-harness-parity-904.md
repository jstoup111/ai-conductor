# PRD: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**Status:** Approved

## Problem / Background

The harness can select Codex as an execution provider, but its reusable workflows
and durable project guidance still contain assumptions associated with Claude.
An operator can therefore configure Codex successfully while receiving skills,
invocations, or repository instructions that Codex does not discover or cannot
follow as intended.

This gap matters most in unattended execution. A daemon-selected Codex run must
be able to enter each supported lifecycle step, load the applicable workflow,
and preserve its gates without requiring an operator to translate provider-specific
instructions mid-run.

Codex is already a built-in execution provider. Skill and guidance parity should
therefore be part of the normal harness experience, not an additional product
that operators must discover, install, and keep synchronized.

## Goals & Non-Goals

**Goals**

- Make the supported harness skill catalog automatically available to Codex
  operators and Codex-selected daemon runs.
- Give Codex-selected projects durable repository guidance that Codex loads
  automatically.
- Preserve the same workflow outcomes, artifacts, and lifecycle gates across
  Claude and Codex while allowing provider-specific instructions where required.
- Let unattended Codex runs advance without human intervention solely to
  translate a Claude-oriented skill invocation or instruction.
- Preserve current Claude behavior and mixed-provider operation.

**Non-Goals**

- Add or change Codex authentication, credential handling, sandbox policy,
  approval behavior, or permission readiness; those belong to #905.
- Add or change provider usage and cost reporting; those belong to #906.
- Create a native interactive Codex launcher or generalized persistent-session
  recovery. That remains separate follow-up work under #759.
- Modernize or extend the legacy execution path.
- Redesign existing provider routing, model policy, retry, or session-isolation
  foundations.
- Add third-party execution providers or require a separate distribution package
  for Codex support.

## Users / Personas

- **Daemon operator:** selects Codex for unattended SDLC work and expects every
  supported lifecycle step to advance without provider-syntax intervention.
- **Project operator:** installs or updates the harness and expects Codex to see
  the current supported workflow catalog immediately.
- **Project maintainer:** initializes harness guidance in a repository and expects
  future Codex sessions to inherit the project's operating rules.
- **Mixed-provider operator:** uses Claude and Codex in the same project and expects
  each provider to receive valid instructions without weakening shared gates.

## Functional Requirements

- **FR-1:** Installing the harness for Codex makes the complete supported harness
  skill catalog discoverable by Codex through its documented local discovery
  behavior.
- **FR-2:** Codex skill availability does not require the operator to install or
  maintain an additional distribution package, manually copy individual skills,
  or inject workflow instructions into each prompt.
- **FR-3:** Updating the harness makes the current supported skill definitions
  available to Codex rather than leaving an earlier installed revision active.
- **FR-4:** Repeating installation or update does not create duplicate Codex-visible
  copies of the same harness skill.
- **FR-5:** Initializing a Codex-selected project produces durable repository
  guidance that Codex loads automatically in later sessions.
- **FR-6:** Initializing a project that supports both built-in providers produces
  durable guidance that is valid for each provider and contains no contradictory
  instructions for the same workflow state.
- **FR-7:** A shared workflow instruction either expresses provider-neutral
  behavior or clearly scopes provider-specific behavior to the provider that
  supports it.
- **FR-8:** A Codex-selected workflow is not instructed to use a Claude-only
  invocation form, model identity, tool contract, or delegation contract as if
  Codex supported it.
- **FR-9:** Every existing daemon-managed lifecycle step that is eligible to run
  with Codex can activate its corresponding workflow in a form Codex recognizes.
- **FR-10:** A Codex-selected daemon run does not pause solely because an operator
  must translate a Claude-oriented workflow invocation into a Codex-recognized
  invocation.
- **FR-11:** When an operator directly invokes a supported harness skill in Codex,
  the resulting workflow preserves the same required outcomes, artifacts, and
  gates as the corresponding daemon-managed workflow.
- **FR-12:** When a workflow truly depends on a capability unavailable in the
  selected provider, it stops before relying on that capability and reports the
  unsupported dependency and an actionable recovery path; it does not silently
  apply another provider's assumptions.
- **FR-13:** Adding Codex-compatible skills and guidance does not remove or alter
  the accepted availability and behavior of the corresponding Claude workflows.

## Non-Functional Requirements

- **Reliability:** Installation, update, and project initialization produce
  deterministic results when repeated against the same harness version and
  provider selection.
- **Backward compatibility:** Existing accepted Claude-only and mixed-provider
  workflow behavior remains green.
- **Clarity:** Provider-specific diagnostics name the selected provider, the
  unavailable capability, and the operator action needed to continue.
- **Lifecycle integrity:** Provider adaptation must not bypass, reorder, or weaken
  an existing required SDLC gate.

## Acceptance Criteria / Success Metrics

- A current installation exposes the complete supported skill catalog to an
  actual Codex session without an additional package or per-session prompt setup.
- A newly initialized Codex project reports that its durable repository guidance
  was loaded in a later Codex session.
- Automated acceptance coverage proves that every Codex-eligible daemon lifecycle
  step activates the intended workflow without Claude-only invocation syntax.
- A representative Codex-selected daemon run crosses lifecycle boundaries without
  a human translation handoff and preserves the expected artifacts and gates.
- Automated coverage proves repeat installation/update does not create duplicate
  skill entries or leave stale skill content active.
- Provider-contract coverage proves unscoped Claude-only invocation, model, tool,
  and delegation assumptions are not presented to Codex-selected workflows.
- Negative-path coverage proves a genuinely unsupported capability halts with an
  actionable Codex-specific diagnostic before incompatible work begins.
- Existing accepted Claude-only, Codex-provider, and mixed-provider suites remain
  green.

## Scope

### In Scope

- First-class local discovery of the supported harness skills by Codex.
- Installation and update behavior for Codex skill availability.
- Durable Codex-recognized project guidance produced during project initialization.
- Provider-neutral shared workflow contracts and explicitly scoped provider
  differences.
- Codex-recognized invocation for all existing daemon-managed lifecycle steps.
- Direct Codex invocation of supported harness skills within the existing workflow
  lifecycle.
- Actionable failure behavior for unsupported provider capabilities.
- Regression and acceptance coverage for the above outcomes.

### Out of Scope

- The legacy execution path.
- A native interactive Codex launcher or persistent interactive recovery contract.
- Authentication, credentials, sandboxing, approvals, or permission setup (#905).
- Usage, token, or cost reporting (#906).
- New provider routing, fallback, model-policy, or session-isolation architecture.
- Third-party provider parity.
- Packaging the harness as a separately installed plugin or marketplace product.

## Key Decisions & Rationale

- **Codex support is first-class within the normal harness installation.** Codex
  is already a built-in provider, and requiring another product would add operator
  setup and version-skew risk without resolving daemon invocation or shared
  workflow-contract gaps.
- **Daemon execution is the priority.** Unattended lifecycle progression creates
  immediate operational value; a new interactive launcher and persistent-session
  recovery introduce a separate architectural problem and remain deferred.
- **Parity means equivalent outcomes and gates, not identical wording.** Provider
  differences may be explicit, but they may not change required SDLC results or
  expose one provider to another provider's unsupported assumptions.
- **The legacy execution path receives no compatibility work.** Product acceptance
  is measured through the active harness lifecycle only.
- **#904 owns skills, durable guidance, and invocation compatibility.** Provider
  environment readiness and provider usage reporting remain isolated in #905 and
  #906 respectively.

## Dependencies

- Codex's documented external behavior for automatically loading `AGENTS.md` as
  durable repository guidance.
- Codex's documented external behavior for discovering standalone local skills,
  activating a skill explicitly with `$skill-name`, and following linked skill
  resources.
- The existing built-in Claude and Codex provider integrations, provider-native
  model policy, per-step routing, retry behavior, and session isolation.
- The existing built-in provider installation-readiness contract from #901.
- Credentialed live execution may also require the environment-readiness outcomes
  owned by #905; #904 does not absorb that scope.

## Open Questions

- Architecture review must choose the smallest adaptation boundary that keeps one
  coherent workflow contract while allowing provider-native invocation and
  provider-specific instructions.
- Architecture review must decide whether provider-specific views are maintained
  directly or derived from shared source material, and how drift is detected.
- Architecture review must define how an update reconciles an earlier unsupported
  Codex skill installation without producing duplicate discovery results.
- There are no unresolved product-scope questions.

## Verify-Claims Ledger — PRD #904 — 2026-07-25

### Claims

- **[verified]** Codex automatically loads durable repository guidance from
  `AGENTS.md` and applies nested guidance by scope — current official Codex manual,
  checked 2026-07-25.
- **[verified]** Codex discovers standalone skills from documented repository and
  user scopes and supports explicit `$skill-name` invocation — current official
  Codex manual, checked 2026-07-25.
- **[verified]** Plugins primarily add installation and distribution capabilities;
  they do not replace the need for provider-valid workflow instructions — current
  official Codex manual plus the locally verified daemon invocation path.
- **[verified]** #904 asks for Codex-appropriate durable guidance, reusable skill
  invocation, provider-scoped instructions, and provider-aware initialization —
  issue body read 2026-07-25.
- **[verified]** The existing Codex provider and per-step routing foundations pass
  their focused suite (39 tests), and provider installation-readiness passes all
  11 focused scenarios — executed during exploration on 2026-07-25.

### Assumptions

- **[load-bearing, 100% confirmed]** Codex parity is delivered as first-class
  harness behavior rather than a separately installed distribution package.
  - Impact if wrong: FR-1 through FR-4 and the installation scope would change.
  - Confirmed by: operator selection of Approach A on 2026-07-25.
  - **Status: APPROVED by operator 2026-07-25.**
- **[load-bearing, 100% confirmed]** Daemonized execution takes priority over a
  new native interactive launcher and persistent-session recovery.
  - Impact if wrong: the acceptance path and #759 boundary would expand materially.
  - Confirmed by: operator direction and the approved #759 follow-up comment on
    2026-07-25.
  - **Status: APPROVED by operator 2026-07-25.**
- **[load-bearing, 100% confirmed]** The legacy execution path receives no work.
  - Impact if wrong: scope and regression coverage would expand to a second runtime.
  - Confirmed by: explicit operator direction on 2026-07-25.
  - **Status: APPROVED by operator 2026-07-25.**
- **[load-bearing, 100% confirmed]** Authentication and environment readiness stay
  in #905, while usage reporting stays in #906.
  - Impact if wrong: #904 would absorb two independently active workstreams and
    become a substantially larger feature.
  - Confirmed by: operator-approved exploration boundary on 2026-07-25.
  - **Status: APPROVED by operator 2026-07-25.**

**Verdict: CLEAR** — no unconfirmed load-bearing assumptions remain.
