# PRD: Built-In Provider Installation and Readiness

**Date:** 2026-07-25
**Status:** Approved
**Source:** GitHub issue #901
**Track:** Product
**Complexity:** Small

## Problem / Background

The harness can execute work through either Claude or Codex, and an initial
installation solution exposes harness guidance to both. Installation readiness,
however, still treats Claude as the only required provider. An operator who chooses
Codex—or chooses both built-in providers—cannot get a complete, selection-aware
answer about whether the machine is ready.

This inconsistency makes successful installation output ambiguous: provider surfaces
may be present while a selected provider's CLI is unavailable, and the operator does
not receive readiness behavior aligned with the selected provider set.

## Goals & Non-Goals

**Goals**

- Let operators require Claude, Codex, or both for installation readiness.
- Keep Claude as the predictable default when no provider is selected.
- Establish both built-in provider surfaces during every installation.
- Report selected-provider readiness clearly and independently.
- Preserve best-effort installation while making explicit readiness validation
  strict and scriptable.
- Preserve existing provider selection across interactive and unattended conductor
  execution.

**Non-Goals**

- Authenticating a provider or proving that its credentials are valid.
- Defining sandbox or permission policy for unattended provider execution.
- Supporting installation or readiness contracts for third-party provider plugins.
- Removing an unselected built-in provider's already-installed surfaces.
- Changing provider fallback, model selection, session behavior, or execution
  semantics.

## Users / Personas

- **Harness operator:** installs or updates the harness and needs to know whether
  every provider they intend to use is locally available.
- **Project operator:** selects Claude, Codex, or both for project execution and
  expects installation readiness to understand the same built-in choices.
- **Automation maintainer:** needs an unambiguous success or failure result from
  readiness validation without parsing advisory installation prose.

## Functional Requirements

- **FR-1:** An operator can select Claude, Codex, or both as the built-in providers
  required for installation readiness.
- **FR-2:** When no provider is selected, Claude is the sole required provider.
- **FR-3:** Every installation establishes the harness's user-facing surfaces for
  both Claude and Codex, regardless of which providers are required for readiness.
- **FR-4:** Installation reports the local CLI readiness of every required provider
  and identifies the provider associated with each result.
- **FR-5:** A missing required provider CLI produces an actionable installation
  warning that identifies the provider and how the operator can become ready.
- **FR-6:** A missing required provider CLI does not prevent installation of common
  harness capabilities or either built-in provider's user-facing surfaces.
- **FR-7:** Installation completes after reporting a missing required provider CLI;
  provider absence is advisory during installation.
- **FR-8:** Explicit readiness validation fails when any required provider CLI is
  unavailable and identifies every missing required provider.
- **FR-9:** Explicit readiness validation succeeds only when all required provider
  CLIs and the existing common harness installation checks pass.
- **FR-10:** When both providers are required, readiness is evaluated independently
  for Claude and Codex; one provider's result does not suppress the other's result.
- **FR-11:** An unavailable provider that was not selected as required does not make
  explicit readiness validation fail.
- **FR-12:** A selection containing a provider outside the built-in Claude and Codex
  set is rejected before readiness is reported, with an actionable message listing
  the supported built-in choices.
- **FR-13:** Existing projects that make no new provider-readiness selection retain
  Claude-required behavior without migration.
- **FR-14:** A project's existing Claude, Codex, or multi-provider execution
  selection continues to be honored consistently by interactive and unattended
  conductor execution.

## Non-Functional Requirements

- **Determinism:** Given the same selected provider set and installed CLIs, readiness
  produces the same pass/fail result and provider-specific findings.
- **Backward compatibility:** Existing installations and projects require no changes
  to retain Claude-default behavior.
- **Non-destructive installation:** Provider readiness failure never removes or
  disables an existing provider surface.
- **Diagnostic clarity:** Every provider-readiness warning or failure names the
  affected provider and distinguishes it from common harness failures.
- **Scope honesty:** Local CLI availability must not be presented as proof of valid
  authentication, safe unattended permissions, or successful remote execution.

## Acceptance Criteria / Success Metrics

- Automated coverage proves that no selection requires Claude and preserves existing
  default behavior.
- Automated coverage proves that Claude-only, Codex-only, and combined selections
  evaluate the intended provider set.
- Automated coverage proves that installation establishes both provider surfaces for
  every selection.
- Automated coverage proves that a missing required CLI warns without aborting
  installation.
- Automated coverage proves that explicit readiness validation fails for every
  missing required CLI, reports all selected-provider results, and succeeds when all
  required providers and common checks are ready.
- Automated coverage proves that a missing unselected provider CLI is non-failing.
- Automated coverage proves that unsupported provider selections are rejected with
  the supported built-in choices.
- Existing provider execution-selection coverage remains green for interactive and
  unattended paths.

## Scope

### In Scope

- Multi-selection of built-in providers for installation readiness.
- Claude-default readiness when no selection is supplied.
- Installation of both built-in provider surfaces.
- Provider-specific installation warnings and strict readiness results.
- Independent combined-provider reporting.
- Actionable rejection of unsupported readiness selections.
- Preservation of existing runtime provider selection.

### Out of Scope

- Provider authentication, credential expiry, or account validation.
- Sandbox, approval, or unattended permission policy.
- Third-party provider installation and readiness.
- Provider-specific model, retry, fallback, session, or usage behavior.
- General documentation parity beyond the installation/readiness behavior changed by
  this feature.
- End-to-end remote execution qualification.

## Key Decisions & Rationale

- **Both built-in provider surfaces are always installed.** The surfaces are cheap to
  establish, provider switching stays easy, and repositories on the same machine may
  choose different providers.
- **Selection controls readiness, not installed surfaces.** This gives multiselect a
  precise purpose without making one project's choice remove another project's
  capability.
- **Claude remains the absent-selection default.** Existing installations preserve
  their behavior and require no migration.
- **Installation is advisory; explicit readiness validation is strict.** Operators
  can finish setup despite a missing external CLI, while automation receives an
  unambiguous failure when required capabilities are absent.
- **The feature covers built-in providers only.** A third-party onboarding contract
  would materially expand the product and is not needed to complete Codex support.
- **CLI presence is not authentication readiness.** Authentication, sandbox, and
  unattended permission behavior remain separate work so this feature does not make
  a stronger safety claim than it can verify.

## Dependencies

- The existing Claude and Codex command-line clients as externally installed
  dependencies.
- Existing built-in provider registration and provider execution support.
- Existing single-provider and multi-provider project selection behavior.
- Existing user-facing harness surfaces for Claude and Codex.

## Open Questions

- Which existing operator-facing selection surfaces should supply the required
  provider set to installation and readiness validation without creating conflicting
  sources of truth?
- How should provider version information be presented consistently when the two
  external clients expose different version output?
