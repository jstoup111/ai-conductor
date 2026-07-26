# PRD: Codex Safety and Self-Host Parity

**Date:** 2026-07-25
**Status:** Approved
**Source:** GitHub issue #907
**Track:** Product
**Complexity:** Medium

## Problem / Background

The harness can select Claude or Codex for autonomous work, but several established
safety and lifecycle guarantees are currently available only when the selected
provider exposes Claude-specific lifecycle behavior and configuration semantics.
Codex-selected work can therefore miss current-task identity, mutation protection,
documentation freezing, or self-host isolation that operators already rely on.

This gap is dangerous because provider selection should change who performs the work,
not whether safety-critical protections apply. It is also difficult to diagnose:
missing provider capabilities can be mistaken for parity, and a self-host build may
accidentally depend on or affect live operator configuration.

## Goals & Non-Goals

**Goals**

- Give Claude- and Codex-selected work equivalent safety-critical outcomes.
- Maintain an accurate current-task identity throughout autonomous build work.
- Prevent provider selection from bypassing mutation and documentation protections.
- Isolate self-host work from the live harness checkout and unrelated operator
  configuration while preserving the authentication source selected under #905.
- Make unsupported non-critical provider capabilities explicit rather than silently
  claiming parity.
- Preserve existing Claude behavior.

**Non-Goals**

- Reproducing identical lifecycle events, dispatch telemetry, or configuration
  semantics across providers.
- Expanding task attribution beyond the current-task identity needed during work.
- Replacing the existing judgment-based gates that verify implementation wiring and
  completion.
- Changing authentication selection, unattended permission policy, or recovery
  behavior owned by #905.
- Changing skill discovery and repository-guidance behavior owned by #904.
- Adding usage accounting owned by #906.
- Generalizing this feature to third-party providers.

## Users / Personas

- **Harness operator:** selects a provider and expects the same safety guarantees
  without needing to understand provider-specific lifecycle features.
- **Daemon operator:** expects unattended work to remain attributable to its current
  task, respect frozen artifacts, and stop safely when required protection is absent.
- **Self-host maintainer:** builds the harness itself and needs assurance that work is
  isolated from the live checkout and unrelated personal provider configuration.
- **Harness maintainer:** needs explicit evidence of which protections are guaranteed,
  which capabilities are merely diagnostic, and whether Claude behavior regressed.

## Functional Requirements

- **FR-1:** During every autonomous build task, the harness maintains one accurate
  current-task identity for the work in progress, regardless of whether Claude or
  Codex is selected.
- **FR-2:** When a task completes, fails, is cancelled, or is replaced by another
  task, its identity is no longer treated as current.
- **FR-3:** While a build is active, a project mutation without a valid current-task
  identity is rejected with actionable guidance.
- **FR-4:** A stale, unknown, empty, or mismatched task identity never authorizes a
  project mutation.
- **FR-5:** During BUILD and SHIP, protected product, architecture, story, and plan
  artifacts remain frozen except where the active lifecycle step explicitly permits
  their update, regardless of the selected provider.
- **FR-6:** If the target of a protected-artifact mutation cannot be determined, the
  mutation is rejected rather than treated as allowed.
- **FR-7:** A self-host run may modify its isolated feature workspace but cannot modify
  the operator's live harness checkout.
- **FR-8:** A self-host run may use the authentication source selected under #905 but
  neither inherits nor modifies unrelated live operator preferences, extensions,
  lifecycle customizations, or mutable provider state.
- **FR-9:** Completion, failure, cancellation, or interruption of a self-host run
  leaves no feature-created changes in the operator's unrelated live provider
  configuration.
- **FR-10:** If a required task-identity, mutation, documentation, or self-host
  isolation protection is missing or cannot be verified, affected work does not begin
  or continue under an assumption of safety.
- **FR-11:** A provider may lack a non-critical lifecycle or observability capability
  only when the gap is explicitly reported and does not weaken any required safety
  outcome.
- **FR-12:** Initial, retried, and resumed work receives the same required protections;
  retry or resume never silently weakens them.
- **FR-13:** A rejected or unavailable protection identifies the affected provider and
  protection, explains why work stopped, and gives actionable recovery guidance.
- **FR-14:** Safety and isolation diagnostics expose no authentication material or
  sensitive operator configuration.
- **FR-15:** Existing Claude-selected workflows retain their current task lifecycle,
  mutation rules, documentation protections, self-host isolation, and operator-visible
  behavior.

## Non-Functional Requirements

- **Safety:** Required protections fail closed when their state or applicability
  cannot be determined.
- **Provider consistency:** Equivalent work receives equivalent safety outcomes across
  Claude and Codex even when their native capabilities differ.
- **Isolation:** Self-host execution cannot mutate the live harness checkout or
  unrelated operator configuration.
- **Confidentiality:** Authentication material and sensitive operator configuration
  never appear in project artifacts, diagnostics, logs, or source-control history.
- **Reliability:** Protection state remains correct through completion, failure,
  interruption, retry, and resume.
- **Diagnostic clarity:** Messages distinguish a missing required protection from an
  allowed non-critical capability gap.
- **Backward compatibility:** Claude users require no migration and observe no safety
  or workflow regression.

## Acceptance Criteria / Success Metrics

- Provider-parity coverage demonstrates accurate current-task identity and rejection
  of unstamped or stale-identity mutations under both Claude and Codex.
- Protected artifacts remain frozen under both providers, including when a target is
  missing, malformed, or otherwise unverifiable.
- A representative Codex self-host run can complete using its selected #905
  authentication source without modifying the live harness checkout or unrelated
  operator configuration.
- Success, failure, interruption, retry, and resume coverage demonstrates that no
  stale task identity or weakened safety posture survives a lifecycle transition.
- A deliberately unavailable required protection stops affected work with an
  actionable explanation; an allowed non-critical capability gap is visible and does
  not claim false parity.
- Existing Claude safety, isolation, and lifecycle coverage remains green without
  changed operator behavior.
- Diagnostics and persisted artifacts contain no credential material or sensitive
  operator configuration.

## Scope

### In Scope

- Current-task identity for autonomous build work under Claude and Codex.
- Mutation gating tied to valid current-task identity.
- Protection of frozen requirements and delivery artifacts during BUILD and SHIP.
- Self-host isolation from the live harness checkout and unrelated live provider
  configuration.
- Explicit treatment of missing required protections and non-critical capability
  gaps.
- Equivalent protection across initial, retry, resume, failure, and interruption
  paths.
- Regression protection for existing Claude behavior.

### Out of Scope

- Dispatch telemetry beyond maintaining current-task identity.
- Generalized lifecycle capability support for third-party providers.
- Authentication-source selection, credential recovery, or unattended permission
  policy.
- Skill installation, skill invocation, or repository-guidance parity.
- Usage and cost reporting.
- Replacing judgment-based wiring, architecture, build-review, or completion gates.
- Broad redesign of source-control attribution, which is already provider-neutral.

## Key Decisions & Rationale

- **Require outcome parity, not lifecycle symmetry.** Operators need consistent safety
  guarantees; providers do not need identical internal capabilities or telemetry.
- **Limit task attribution to current-task identity.** That identity supports safe,
  attributable work, while judgment-based gates remain responsible for validating
  implementation wiring and completion.
- **Preserve selected authentication while isolating unrelated configuration.** This
  keeps #905's approved authentication behavior without exposing self-host work to
  unrelated operator preferences or mutable state.
- **Fail closed only for required protections.** Safety cannot rest on an unverified
  protection, while a clearly reported diagnostic-only gap need not stop otherwise
  safe work.
- **Keep Claude behavior stable.** Codex parity must not impose a migration or workflow
  regression on existing Claude users.

## Dependencies

- Issue #905's approved Codex authentication selection, bounded unattended execution,
  and provider-specific credential ownership.
- Issue #904's Codex skill discovery, invocation, and repository-guidance behavior.
- Existing Claude and Codex client capabilities, which may expose different lifecycle
  and configuration surfaces.
- Existing judgment-based architecture, wiring, build-review, and completion gates.

## Open Questions

- How should current-task identity and mutation authorization be maintained when a
  provider does not expose equivalent lifecycle interception?
- Which existing lifecycle capabilities are required safety controls versus optional
  diagnostics, and how should each class be represented to operators?
- How should self-host execution isolate unrelated provider configuration while
  preserving the authentication source selected under #905?
- What compatibility boundary best preserves existing Claude behavior while moving
  required outcomes out of provider-specific assumptions?

## Verify-Claims Ledger

### Claims

- **Verified:** Current Claude-selected work maintains task identity and several
  mutation protections through Claude-specific lifecycle behavior; reviewed the
  current worktree preparation, lifecycle assets, and observability documentation.
- **Verified:** Current self-host isolation is shaped around Claude configuration and
  trust behavior; reviewed the existing self-host isolation implementation.
- **Verified:** #905 preserves provider-specific authentication sources and explicitly
  leaves Claude lifecycle-sandbox parity outside its scope; reviewed its approved PRD
  and architecture decisions.
- **Verified:** Existing source-control attribution is provider-neutral and its
  trailers are telemetry rather than build-completion authority; reviewed the current
  observability contract.

### Confirmed Inputs

- **Approved by operator 2026-07-25:** Task attribution is required only for accurate
  current-task stamping; judgment-based skills continue to ensure wiring.
- **Approved by operator 2026-07-25:** Self-host Codex execution retains the
  authentication source selected under #905 while unrelated live Codex configuration
  remains isolated.

### Verdict

**CLEAR** — no unconfirmed load-bearing product assumptions remain.
