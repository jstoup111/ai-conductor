# PRD: Codex Authentication and Autonomous Execution Readiness

**Date:** 2026-07-25
**Status:** Approved
**Source:** GitHub issue #905
**Track:** Product
**Complexity:** Medium

**Amended by:** `codex-readiness-distinguishes-unavailable-doctor-p` (approved 2026-07-30). That amendment replaces FR-7, FR-8, and FR-9 only for inability-to-obtain-evidence outcomes. Affirmative `ready`, `missing`, and `unusable` behavior and all other requirements remain authoritative.

## Problem / Background

The harness can select Codex for interactive and unattended work, and installation
readiness can confirm that the external client is locally available. It does not yet
establish whether Codex authentication is usable or define the safety posture under
which unattended Codex work runs.

As a result, a daemon can discover missing or rejected authentication only after work
has been dispatched, confuse Codex readiness with Claude account state, wait for a
permission decision that no operator is present to answer, or run with safeguards
disabled more broadly than the work requires. These outcomes make Codex an unreliable
choice for autonomous execution and prevent operators from knowing whether a selected
Codex run is both ready and appropriately bounded.

## Goals & Non-Goals

**Goals**

- Determine whether the authentication source selected for an unattended Codex run is
  usable before work begins.
- Support both cached Codex account sign-in and an operator-supplied API key with
  deterministic, visible selection behavior.
- Let unattended Codex work complete the normal development lifecycle without waiting
  for a human permission response while retaining meaningful safety boundaries.
- Keep authentication, diagnostics, and safety behavior provider-specific so Codex
  execution never depends on or mutates Claude account state.
- Give authentication failures the same parked recovery behavior regardless of which
  built-in provider was selected, while retaining source-specific recovery guidance.
- Make every readiness or safety failure actionable without exposing credentials.

**Non-Goals**

- Installing the Codex client or checking only for its local presence; existing
  provider-installation readiness owns that behavior.
- Changing Claude authentication-source selection, credential ownership, or unattended
  permission behavior, including adopting Claude's automatic permission mode.
- Changing safety behavior outside Codex or adding protection beyond the external
  client's existing isolation capabilities.
- Minting, storing, refreshing, rotating, or repairing credentials for the operator.
- Silently switching authentication sources after a selected source fails.
- Changing provider routing, fallback order, model selection, usage accounting, or
  interactive execution behavior.

## Users / Personas

- **Harness operator:** selects Codex for a project and needs to know which
  authentication source will be used, whether it works, and how to recover when it
  does not.
- **Daemon operator:** expects unattended work to progress through ordinary development
  operations without permission prompts or unrestricted access to the host.
- **Autonomous daemon:** must establish readiness before dispatch, preserve retry
  budget on authentication failures, and stop safely when an exceptional action is
  denied.
- **Self-host maintainer:** builds the harness with the selected provider and needs
  assurance that one provider's run cannot alter or depend on the other provider's
  account state.

## Functional Requirements

- **FR-1:** The harness supports cached Codex account sign-in as an authentication
  source for unattended Codex work.
- **FR-2:** The harness supports an operator-supplied Codex API key as an authentication
  source for unattended Codex work.
- **FR-3:** When an API key is supplied for a run, that key is the selected
  authentication source; otherwise, cached Codex sign-in is selected.
- **FR-4:** The selected authentication source is reported to the operator without
  revealing credential material.
- **FR-5:** Once an authentication source is selected for a run, rejection or failure
  of that source never causes an automatic attempt with the other source.
- **FR-6:** Before every unattended Codex dispatch, the harness evaluates whether the
  selected authentication source is usable.
- **FR-7:** Authentication readiness reports exactly one operator-visible state:
  **ready**, **missing**, **unusable**, or **unverifiable**. Expired or rejected
  authentication is **unusable**; an external failure that prevents a conclusive check
  is **unverifiable**, not ready or unusable.
- **FR-8:** An unattended Codex dispatch proceeds only when the selected authentication
  source is ready.
- **FR-9:** A missing, unusable, or unverifiable authentication result identifies the
  selected source, explains why work did not begin, and gives source-appropriate
  recovery guidance.
- **FR-10:** If the selected authentication source is rejected after work has begun,
  the failure is classified as an authentication failure, stops the current work,
  enters the same parked authentication-recovery state used for other built-in
  providers, and gives source-appropriate guidance without trying another source.
- **FR-11:** Authentication failures consume no task retry or model-escalation budget.
- **FR-12:** No readiness result, diagnostic, audit event, or failure message exposes
  an API key, cached credential, or recoverable portion of either.
- **FR-13:** Every unattended Codex invocation, including a resumed invocation, starts
  with an explicit bounded-execution policy rather than an implicit client default.
- **FR-14:** Unattended Codex work is restricted to its feature workspace by default
  and does not receive unrestricted host access as its routine posture.
- **FR-15:** An action that needs access beyond the default boundary receives an
  automatic safety decision; an allowed action proceeds and a denied action fails
  closed with an actionable explanation.
- **FR-16:** The unattended policy permits approved exceptional operations needed for
  the normal development lifecycle, including required network access and source-control
  publication, without waiting for a human permission response.
- **FR-17:** No unattended Codex invocation requests or waits for a human permission
  decision.
- **FR-18:** A denied exceptional operation does not silently disable, weaken, or bypass
  the bounded-execution policy on a retry or resume.
- **FR-19:** Codex readiness and execution neither read, modify, nor require Claude
  credentials or Claude account state; Codex credentials and account state likewise do
  not affect a Claude run.
- **FR-20:** Provider-specific readiness and execution failures identify Codex as the
  affected provider and are never reported as Claude authentication or permission
  failures.
- **FR-21:** When the harness builds itself with Codex selected, the same authentication
  selection, credential confidentiality, bounded-execution, and provider-isolation
  requirements apply.
- **FR-22:** Authentication failures from every built-in provider use the same parked
  recovery lifecycle, while each provider retains its own authentication sources,
  readiness rules, credential ownership, and unattended permission behavior.

## Non-Functional Requirements

- **Security:** Unattended Codex execution follows least-privilege defaults, grants
  exceptional access only after a safety decision, and never uses routine unrestricted
  host access.
- **Confidentiality:** Credential material must not be persisted in project artifacts,
  source-control history, logs, diagnostics, or audit output.
- **Reliability:** Readiness and permission decisions fail closed; an unknown state is
  never presented as safe or ready.
- **Determinism:** The same available authentication sources produce the same selected
  source and readiness outcome across initial and resumed invocations.
- **Diagnostic clarity:** Failures distinguish authentication, external verification,
  permission denial, and unrelated execution failures, and identify the affected
  provider.
- **Efficiency:** Authentication readiness completes quickly, performs no project
  mutation, and does not initiate substantive model work merely to prove readiness.
- **Backward compatibility:** Projects that continue to use Claude require no migration
  and observe no change in Claude behavior.

## Acceptance Criteria / Success Metrics

- Automated coverage proves the authentication matrix: cached sign-in only, API key
  only, both present, neither present, selected source rejected, and readiness
  unverifiable.
- When both sources are present, the API key is reported and used; when that key is
  rejected, a valid cached sign-in is not attempted.
- No unattended work begins for a missing, unusable, or unverifiable selected source,
  and each result provides actionable, source-specific remediation.
- An authentication rejection after dispatch consumes zero task retries and zero
  model-escalation attempts, never switches authentication sources, and enters the
  same parked recovery lifecycle regardless of the selected built-in provider.
- When a parked source becomes ready, the blocked work resumes without consuming retry
  or escalation budget. A process-scoped API key does not claim in-process hot reload;
  replacing it takes effect when the daemon restarts with the replacement value.
- A representative unattended Codex feature can use required network access, create
  and publish source-control changes, and complete without an operator permission
  response while retaining the bounded-execution policy.
- A deliberately denied boundary crossing stops with an actionable denial and remains
  denied after retry or resume; safeguards are never silently disabled.
- Initial and resumed unattended invocations exhibit the same authentication and
  bounded-execution behavior.
- Logs and diagnostics from every authentication and permission outcome contain no
  credential material.
- Self-host coverage proves that a Codex run does not read or mutate Claude account
  state, and existing Claude behavior remains green.

## Scope

### In Scope

- Cached Codex sign-in and operator-supplied API-key authentication for unattended
  Codex execution.
- Deterministic authentication-source selection and no-fallback behavior.
- Authentication usability checks before unattended dispatch and classification of
  authentication rejection after dispatch.
- Operator-visible readiness states and source-specific remediation.
- Explicit bounded autonomy for initial and resumed Codex invocations.
- Automatic handling of exceptional access needed for ordinary development work.
- Provider-specific credential, account-state, diagnostic, and self-host isolation.
- A provider-neutral parked authentication-recovery lifecycle with provider- and
  source-specific readiness checks and remediation.
- Regression protection for existing Claude behavior.

### Out of Scope

- Provider client installation or local-presence readiness.
- Credential creation, storage management, refresh, rotation, or repair.
- A new reloadable API-key source or alternate credential-storage mechanism.
- Authentication fallback after failure.
- Claude automatic permission mode or changes to Claude authentication-source
  selection, credential ownership, or permission policy.
- Safety-policy customization beyond the selected bounded Codex posture, including
  provider-neutral policies or operator-maintained action-by-action rules.
- Changing ownership of the existing source-control workflow.
- Provider routing, model policy, usage metrics, session semantics, or third-party
  provider support.

## Key Decisions & Rationale

- **Support both Codex authentication sources.** Operators may use account-based access
  or a dedicated API key; supporting both avoids forcing one billing and organizational
  policy on every installation.
- **A supplied API key wins, with no failure fallback.** Selection is deterministic and
  visible. Switching after a rejection could silently change billing, organizational
  controls, or credential policy.
- **Require bounded, prompt-free autonomy.** The daemon must complete normal work
  without an attended permission loop, but routine unrestricted host access is too
  broad for that convenience.
- **Fail closed on unknown readiness or denied access.** Autonomous progress is not a
  valid reason to claim unverified authentication or to weaken safeguards silently.
- **Share recovery disposition, not provider credentials or permissions.** A common
  parked authentication lifecycle gives operators consistent daemon behavior while
  each provider keeps its own readiness evidence, recovery instructions, account
  state, and permission policy.
- **Do not re-own installation readiness.** Existing provider readiness already covers
  local client availability and intentionally leaves authentication and permission
  safety to this feature.

## Dependencies

- The externally maintained Codex client and its existing support for cached account
  sign-in, per-run API-key authentication, workspace-restricted execution, and
  automatic review of exceptional actions.
- Existing built-in provider installation readiness, which establishes whether the
  selected external client is locally available before authentication readiness is
  evaluated.
- Existing provider selection and routing behavior for interactive and unattended
  conductor runs.
- External source-control hosting, package registries, and model services required by
  the normal development lifecycle; their availability can make readiness or an
  exceptional action unverifiable.

## Open Questions

- What is the least expensive, non-mutating way to verify the selected authentication
  source while reliably distinguishing rejected credentials from an external service
  or network outage?
- How should the bounded-autonomy requirements map onto the external client's policy
  controls so initial and resumed invocations cannot drift apart?
- How should exceptional source-control and network operations cross the default
  workspace boundary without widening unrelated host access?
- How should self-host execution preserve provider-specific account isolation while
  retaining the safeguards already required for harness builds?

## Amendment Approval

On 2026-07-25, the operator clarified and approved that built-in-provider
authentication recovery must use the same parked lifecycle. The amendment preserves
provider-specific authentication sources and permission policies and does not add API
key hot reload or a new credential store. No unconfirmed product assumption remains.
