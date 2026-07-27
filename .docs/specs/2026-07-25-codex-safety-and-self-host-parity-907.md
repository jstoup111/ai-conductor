# PRD: Codex Safety and Self-Host Parity

**Date:** 2026-07-25
**Status:** Approved
**Source:** GitHub issue #907
**Track:** Product
**Complexity:** Medium

> **Amended 2026-07-26 during conflict-check:** the operator selected concurrent
> task-local telemetry instead of a singular mutation lease, and strict minimal
> self-host isolation for both Claude and Codex.

## Problem / Background

The harness can select Claude or Codex for autonomous work, but several established
safety and lifecycle guarantees are currently available only when the selected
provider exposes Claude-specific lifecycle behavior and configuration semantics.
Codex-selected work can therefore miss task-attribution telemetry, mutation protection,
documentation freezing, or self-host isolation that operators already rely on. The
existing singular `.pipeline/current-task` mechanism also cannot accurately attribute
concurrent tasks and can erase or overwrite their stamping telemetry.

This gap is dangerous because provider selection should change who performs the work,
not whether safety-critical protections apply. It is also difficult to diagnose:
missing provider capabilities can be mistaken for parity, and a self-host build may
accidentally depend on or affect live operator configuration.

## Goals & Non-Goals

**Goals**

- Give Claude- and Codex-selected work equivalent safety-critical outcomes.
- Preserve accurate per-task attribution telemetry without serializing autonomous build work.
- Prevent provider selection from bypassing mutation and documentation protections.
- Isolate self-host work from the live harness checkout and unrelated operator
  configuration while preserving the authentication source selected under #905.
- Make unsupported non-critical provider capabilities explicit rather than silently
  claiming parity.
- Preserve Claude's provider-specific execution behavior except where strict self-host
  isolation replaces inherited live operator configuration.

**Non-Goals**

- Reproducing identical lifecycle events, dispatch telemetry, or configuration
  semantics across providers.
- Making task attribution or task telemetry an authorization or completion gate.
- Replacing the existing judgment-based gates that verify implementation wiring and
  completion.
- Changing authentication selection, unattended permission policy, or recovery
  behavior owned by #905.
- Changing #904's normal installation, user-scoped skill catalog, or repository-guidance
  behavior; #907 only supplies the isolated self-host child with a worktree-owned discovery view.
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

- **FR-1:** Every autonomous build task carries its own known plan-task identity in
  dispatch and attribution telemetry, regardless of whether Claude or Codex is selected;
  multiple mutation-bearing tasks may remain active concurrently.
- **FR-2:** When a task completes, fails, is cancelled, or is replaced, its active-task
  telemetry is retired independently without clearing, replacing, or corrupting another
  concurrently active task's identity.
- **FR-3:** Task identity and `Task:` commit trailers are advisory attribution telemetry:
  missing attribution is reported but never authorizes or rejects an otherwise permitted
  project mutation and never determines completion.
- **FR-4:** A supplied task identity or `Task:` trailer is validated against the active
  plan before it is recorded; stale, unknown, empty, malformed, or mismatched values are
  never guessed, globally substituted, or used as mutation authority.
- **FR-5:** During BUILD and SHIP, protected product, architecture, story, and plan
  artifacts remain frozen except where the active lifecycle step explicitly permits
  their update, regardless of the selected provider.
- **FR-6:** If the target of a protected-artifact mutation cannot be determined, the
  mutation is rejected rather than treated as allowed.
- **FR-7:** A self-host run may modify its isolated feature workspace but cannot modify
  the operator's live harness checkout.
- **FR-8:** A self-host run may use the authentication source selected under #905 but
  neither inherits nor modifies unrelated live operator preferences, extensions,
  lifecycle customizations, user-scoped skill catalogs, or mutable provider state; the
  self-host child discovers only engine/worktree-owned harness assets.
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
- **FR-15:** Claude- and Codex-selected workflows use equivalent concurrent task-attribution,
  mutation, documentation, and strict self-host isolation outcomes. Claude requires no
  authentication migration, but a Claude self-host run no longer inherits personal settings,
  hooks, extensions, or other unrelated live provider state.

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
- **Backward compatibility:** Claude users require no authentication migration; the intentional
  self-host compatibility change is removal of inherited unrelated operator configuration.

## Acceptance Criteria / Success Metrics

- Provider-parity coverage demonstrates concurrent task dispatch, independent task-attribution
  telemetry, preservation of valid explicit `Task:` trailers, and no mutation authorization
  dependency on a singular current-task stamp under Claude and Codex.
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
- Existing Claude authentication, recovery, and non-self-host coverage remains green;
  self-host coverage changes intentionally to assert minimal unrelated-state isolation.
- Diagnostics and persisted artifacts contain no credential material or sensitive
  operator configuration.

## Scope

### In Scope

- Concurrent task-local attribution telemetry under Claude and Codex.
- Mutation safety independent of task attribution.
- Protection of frozen requirements and delivery artifacts during BUILD and SHIP.
- Self-host isolation from the live harness checkout and unrelated live provider
  configuration.
- Self-host-only skill discovery from the feature worktree without reading or relinking
  #904's live user-scoped catalog.
- Explicit treatment of missing required protections and non-critical capability
  gaps.
- Equivalent protection across initial, retry, resume, failure, and interruption
  paths.
- Compatibility protection for Claude outside the intentional self-host isolation change.

### Out of Scope

- Making task telemetry authoritative for mutation, wiring, or completion.
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
- **Keep task attribution advisory and concurrency-safe.** Each task carries its own identity;
  no singular workspace-global stamp may override explicit attribution or authorize mutation.
  Judgment-based gates remain responsible for implementation wiring and completion.
- **Preserve selected authentication while isolating unrelated configuration.** This
  keeps #905's approved authentication behavior without exposing self-host work to
  unrelated operator preferences or mutable state.
- **Fail closed only for required protections.** Safety cannot rest on an unverified
  protection, while a clearly reported diagnostic-only gap need not stop otherwise
  safe work.
- **Give Claude and Codex the same isolation outcome.** Both providers use minimal throwaway
  self-host configuration containing only selected authentication, engine-owned controls, and
  worktree-owned harness assets; unrelated live provider configuration is not inherited.

## Dependencies

- Issue #905's approved Codex authentication selection, bounded unattended execution,
  and provider-specific credential ownership.
- Issue #904's Codex skill discovery, invocation, and repository-guidance behavior.
  Normal install/update and ordinary-session discovery remain owned by #904; #907 owns
  only the isolated self-host child view of that catalog.
- Existing Claude and Codex client capabilities, which may expose different lifecycle
  and configuration surfaces.
- Existing judgment-based architecture, wiring, build-review, and completion gates.

## Open Questions

- How should task-local attribution telemetry be normalized when a provider does not
  expose equivalent lifecycle interception?
- Which existing lifecycle capabilities are required safety controls versus optional
  diagnostics, and how should each class be represented to operators?
- How should self-host execution isolate unrelated provider configuration while
  preserving the authentication source selected under #905?
- Which minimal engine-owned Claude settings are required to replace inherited operator
  settings without weakening headless self-host execution?

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

- **Approved by operator 2026-07-26:** Task attribution is task-local telemetry;
  concurrent mutation-bearing tasks remain supported and judgment skills ensure wiring.
- **Approved by operator 2026-07-26:** Claude and Codex self-host execution both retain
  only the selected authentication source while unrelated live provider configuration
  remains isolated.

### Verdict

**CLEAR** — no unconfirmed load-bearing product assumptions remain.
