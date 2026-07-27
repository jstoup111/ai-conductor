**Status:** Accepted

# Built-in Provider Installation and Readiness

**Source:** Issue #901  
**Track:** Product  
**Complexity:** Small  
**PRD:** `.docs/specs/2026-07-25-builtin-provider-installation-readiness-901.md`

## ST-901-1 — Select the required built-in provider set

**As an** operator installing or validating AI Conductor,  
**I want** to select Claude, Codex, or both as required providers,  
**so that** readiness reflects the provider set I intend to use.

**Traceability:** FR-1, FR-2, FR-12, FR-13

### Acceptance criteria

#### Happy path — explicit provider selection

**Given** the supported built-in providers are Claude and Codex  
**When** the operator selects Claude only, Codex only, or both providers  
**Then** the selected provider set is used as the required set for readiness evaluation.

#### Happy path — backward-compatible default

**Given** the operator does not provide a provider selection  
**When** installation or readiness evaluation begins  
**Then** Claude alone is treated as required  
**And** no migration or new selection is required.

#### Negative path — unsupported provider

**Given** the operator supplies a provider outside the built-in Claude and Codex choices  
**When** the selection is evaluated  
**Then** the request is rejected before provider readiness is evaluated  
**And** the error identifies Claude and Codex as the supported choices.

### Done when

- [ ] Automated coverage proves Claude-only, Codex-only, combined, and omitted-selection behavior.
- [ ] Omitted selection is demonstrably equivalent to requiring Claude only.
- [ ] Unsupported selections are rejected before readiness checks and the error lists both supported choices.

## ST-901-2 — Install both built-in provider surfaces

**As an** operator,  
**I want** every installation to establish both built-in provider surfaces,  
**so that** changing provider selection later does not require reinstalling AI Conductor.

**Traceability:** FR-3, FR-6, FR-7

### Acceptance criteria

#### Happy path — both surfaces are installed

**Given** the operator selects Claude, Codex, both, or no provider  
**When** installation completes  
**Then** the common installation surface is established  
**And** the Claude provider surface is established  
**And** the Codex provider surface is established.

#### Negative path — required CLI is unavailable

**Given** at least one required provider CLI is unavailable  
**When** installation runs  
**Then** installation still establishes the common, Claude, and Codex surfaces  
**And** installation completes instead of treating the missing external CLI as a fatal installation error.

### Done when

- [ ] Automated installation coverage proves both provider surfaces are present for Claude-only, Codex-only, combined, and omitted selection.
- [ ] Automated coverage proves a missing required CLI does not prevent common or provider-specific surfaces from being installed.
- [ ] Installation returns a successful completion result when its only readiness problem is a missing required provider CLI.

## ST-901-3 — Report required-provider readiness during installation

**As an** operator,  
**I want** installation to report readiness for every required provider,  
**so that** I know which external CLI, if any, still needs attention.

**Traceability:** FR-4, FR-5

### Acceptance criteria

#### Happy path — required CLIs are available

**Given** every required provider CLI is available  
**When** installation reports readiness  
**Then** it reports a provider-specific ready result for each required provider.

#### Negative path — one or more required CLIs are unavailable

**Given** one or more required provider CLIs are unavailable  
**When** installation reports readiness  
**Then** it emits an actionable warning for every missing required provider CLI  
**And** each warning names the affected provider and tells the operator how to address the missing CLI  
**And** readiness for another selected provider is still reported.

### Done when

- [ ] Automated output coverage proves provider-named readiness results for Claude-only, Codex-only, and combined selections.
- [ ] Missing-CLI warnings name each affected provider and provide an actionable installation remedy.
- [ ] Combined selection reports both providers independently when either provider is unavailable.

## ST-901-4 — Enforce explicit readiness validation

**As an** operator or automation caller,  
**I want** an explicit readiness check to strictly validate all required providers and common prerequisites,  
**so that** its result can reliably gate subsequent work.

**Traceability:** FR-8, FR-9, FR-10, FR-11

### Acceptance criteria

#### Happy path — all required readiness conditions pass

**Given** every required provider CLI is available  
**And** all common readiness checks pass  
**When** the explicit readiness check runs  
**Then** it evaluates every required provider independently  
**And** it succeeds.

#### Negative path — required provider CLI is unavailable

**Given** one or more required provider CLIs are unavailable  
**When** the explicit readiness check runs  
**Then** it evaluates all required providers without stopping after the first failure  
**And** it fails  
**And** it identifies every missing required provider CLI.

#### Negative path — an unselected provider CLI is unavailable

**Given** every required provider CLI is available  
**And** an unselected provider CLI is unavailable  
**And** all common readiness checks pass  
**When** the explicit readiness check runs  
**Then** it succeeds.

#### Negative path — a common readiness condition fails

**Given** every required provider CLI is available  
**And** a common readiness check fails  
**When** the explicit readiness check runs  
**Then** it fails and identifies the failed common readiness condition.

### Done when

- [ ] Automated matrix coverage spans Claude-only, Codex-only, and combined selection against available and unavailable provider CLIs.
- [ ] Combined validation proves all required providers are evaluated and all missing required CLIs are reported in one result.
- [ ] Automated coverage proves an unavailable unselected provider does not fail readiness.
- [ ] Automated coverage proves common readiness failures remain fatal even when every required provider CLI is available.

## ST-901-5 — Preserve execution-provider selection

**As an** operator with an existing execution-provider configuration,  
**I want** installation and readiness selection to leave execution routing intact,  
**so that** Claude, Codex, and multi-provider projects continue to run as configured.

**Traceability:** FR-14

### Acceptance criteria

#### Happy path — existing execution selections remain honored

**Given** a project is configured for Claude, Codex, or multiple execution providers  
**When** work is run through either the interactive or unattended path after installation and readiness evaluation  
**Then** the configured execution-provider selection is honored.

#### Negative path — readiness selection differs from execution selection

**Given** the required provider set used for installation or readiness differs from the project's execution-provider selection  
**When** installation or readiness evaluation completes  
**Then** the project's execution-provider selection is not replaced, reordered, or narrowed  
**And** subsequent interactive and unattended execution still uses the project configuration.

### Done when

- [ ] Existing accepted provider-routing scenarios for Claude, Codex, and multiple providers remain green.
- [ ] Focused regression coverage proves readiness selection does not mutate execution-provider configuration.
- [ ] Both interactive and unattended execution paths are covered by the regression evidence.

## Functional-requirement traceability

| Functional requirement | Covered by |
|---|---|
| FR-1 | ST-901-1 |
| FR-2 | ST-901-1 |
| FR-3 | ST-901-2 |
| FR-4 | ST-901-3 |
| FR-5 | ST-901-3 |
| FR-6 | ST-901-2 |
| FR-7 | ST-901-2 |
| FR-8 | ST-901-4 |
| FR-9 | ST-901-4 |
| FR-10 | ST-901-4 |
| FR-11 | ST-901-4 |
| FR-12 | ST-901-1 |
| FR-13 | ST-901-1 |
| FR-14 | ST-901-5 |
