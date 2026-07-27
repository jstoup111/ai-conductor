# Components + Sequences: Codex Authentication and Autonomous Execution Readiness

**Last updated:** 2026-07-26
**Scope:** Current provider-aware Codex authentication readiness, bounded unattended
policy, failure disposition, and self-host isolation responsibilities from issue #905,
plus the planned mixed-health classification and recovery-loop implementation for issue #970.
Issue #970 elements are marked **[CHANGE #970]** and map to the approved 12-task implementation
plan.

## Component Diagram

```mermaid
graph LR
    Operator["Harness operator"]

    subgraph roots ["Composition and feature-run scope"]
        Daemon["Daemon composition root"]
        Feature["Per-feature provider execution context<br/>runtimes, sessions, events"]
        SelfHost["Self-host guardrail selection<br/>[CHANGE: provider-aware]"]
    end

    subgraph orchestration ["Existing provider-aware orchestration"]
        Runner["Step runner<br/>normal and auxiliary dispatches"]
        Execution["Provider candidate execution<br/>selection, model ladder, classification"]
        Recovery["Shared authentication recovery<br/>one bounded park lifecycle<br/>[CHANGE #970: backed-off probes and progress events]"]
        Events["Operator diagnostics and audit events"]
    end

    subgraph codexboundary ["Planned Codex invocation boundary"]
        AuthSelect["Authentication source selection [NEW]<br/>per-run API key, otherwise cached login"]
        Readiness["Authentication readiness gate<br/>ready, missing, unusable, unverifiable<br/>[CHANGE #970: auth evidence independent of unrelated checks]"]
        Policy["Unattended invocation policy [NEW]<br/>workspace-write, on-request, auto-review"]
        CodexProvider["Codex provider adapter [CHANGE]<br/>scoped auth, explicit policy, classification"]
        AuthPark["Auth park coordinator<br/>provider/source retained; source-specific readiness<br/>zero fallback, retry, and escalation budget<br/>[CHANGE #970: bounded backoff and visible wait state]"]
    end

    subgraph selfhost ["Self-host provider isolation"]
        ClaudeGuardrails["Existing Claude self-host guardrails<br/>throwaway Claude configuration"]
        CodexGuardrails["Codex self-host adaptation [NEW]<br/>skip Claude-only setup; use native worktree boundary<br/>plus provider-local readiness and policy"]
        Isolation["Isolation invariant<br/>Codex path never reads or mutates<br/>Claude account state"]
    end

    ApiKey["Operator-supplied per-run API key"]
    Cached["Cached Codex account login"]
    ClaudeState["Claude account and configuration state"]
    CodexCli["Codex CLI<br/>external"]
    CodexService["Codex service<br/>external"]
    ExternalOps["Source-control host and package services<br/>external boundary operations"]

    Operator --> Daemon
    Daemon --> Feature
    Feature --> AuthSelect
    ApiKey --> AuthSelect
    Cached --> AuthSelect
    AuthSelect --> Readiness
    Readiness --> CodexCli
    CodexCli --> CodexService
    Readiness -->|"ready"| Runner
    Readiness -->|"not ready"| AuthPark

    Runner --> Execution
    Execution --> Policy
    Policy --> CodexProvider
    CodexProvider --> CodexCli
    CodexProvider --> Events
    CodexProvider -->|"auth failure"| AuthPark
    AuthPark --> Recovery
    Recovery -->|"Codex readiness recheck"| Readiness
    Recovery --> Events
    CodexCli -->|"automatically reviewed escalation"| ExternalOps

    Daemon --> SelfHost
    SelfHost -->|"Claude selected"| ClaudeGuardrails
    SelfHost -->|"Codex selected"| CodexGuardrails
    ClaudeState --> ClaudeGuardrails
    CodexGuardrails --> Isolation
    CodexGuardrails --> Policy

    style AuthSelect fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Readiness fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Policy fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style CodexProvider fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style AuthPark fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style CodexGuardrails fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Isolation fill:#fce4ec,stroke:#ad1457,stroke-width:2px
```

## Sequence 1: Preflight, Dispatch, and Automatic Boundary Review

```mermaid
sequenceDiagram
    actor O as Operator
    participant D as Daemon feature run
    participant A as Auth source selection
    participant R as Readiness gate
    participant CLI as Codex CLI
    participant S as Codex service
    participant Run as Step runner
    participant E as Provider execution
    participant P as Codex provider adapter
    participant Rev as Automatic approval reviewer
    participant X as External boundary
    participant Park as Shared auth park

    O->>D: start or resume unattended feature
    D->>A: resolve Codex authentication for this run
    alt per-run API key supplied
        A->>A: select API key
    else no per-run API key
        A->>A: select cached login
    end
    A->>R: verify selected source only
    R->>CLI: codex doctor --json --summary<br/>captured with bounded timeout
    CLI->>S: authenticate
    S-->>CLI: accepted, rejected, or unavailable
    CLI-->>R: versioned per-check evidence plus overall health
    Note over R: auth.credentials is classified independently<br/>from unrelated doctor checks [CHANGE #970]

    alt selected source ready
        R-->>D: proceed with selected auth context
        D->>Run: dispatch step
        Run->>E: execute selected Codex candidate
        E->>P: invoke with selected auth and explicit policy
        P->>CLI: workspace-write plus on-request plus auto-review
        Note over CLI: routine work stays inside the feature workspace
        opt source-control, network, or other boundary crossing
            CLI->>Rev: request exceptional action
            alt reviewer approves
                Rev->>X: execute approved action
                X-->>CLI: result
            else reviewer denies
                Rev-->>CLI: denial and rationale
                Note over CLI: find a safer path or fail<br/>never disable safeguards
            end
        end
        CLI-->>P: classified completion
        alt authentication failure after dispatch
            P->>Park: enter park with provider and selected source
            Note over E,Park: no auth-source fallback<br/>no provider fallback<br/>no retry or escalation budget consumed
        else success or non-auth failure
            P-->>E: ordinary classified result
        end
    else selected source missing, unusable, or unverifiable
        R->>Park: block before substantive work and enter park
        Park-->>O: provider/source state and safe remediation<br/>no credential material
        Note over A,Park: another available auth source is not attempted
    end
```

## Sequence 2: Shared Authentication Park and Recovery

```mermaid
sequenceDiagram
    actor O as Operator
    participant C as Conductor auth recovery
    participant R as Provider readiness capability
    participant D as Daemon supervisor

    C->>C: retain failed provider, source, and sanitized state
    C->>C: freeze retry, escalation, and fallback budgets
    alt source can become ready in this process
        loop bounded park interval with capped backoff [CHANGE #970]
            C->>R: recheck the same selected source
            R-->>C: ready, missing, unusable, or unverifiable
            C-->>O: rate-limited progress with auth state<br/>and unrelated-health distinction [CHANGE #970]
        end
        alt source becomes ready
            C->>C: resume only the failed attempt or group member
        else timeout or park disabled
            C-->>O: provider and source specific HALT
        end
    else source is a startup-only API key
        C-->>O: parked, replacement requires daemon restart
        alt daemon restarts with replacement key
            D->>C: resume unfinished feature in a new process
            C->>R: fresh preflight with the replacement key
            R-->>C: ready or a new non-ready state
        else timeout before restart
            C-->>O: restart-required HALT and requeue guidance
        end
    end
```

## Sequence 3: Provider-Isolated Self-Host Dispatch

```mermaid
sequenceDiagram
    participant D as Self-host conductor
    participant S as Provider-aware guardrail selection
    participant C as Existing Claude guardrails
    participant X as Codex self-host adaptation
    participant W as Edited harness worktree
    participant P as Codex invocation policy
    participant A as Claude account state

    D->>S: prepare self-host build for selected provider
    alt Claude selected
        S->>C: preserve existing Claude self-host path
        C->>A: use existing Claude-specific state
        C->>W: run against edited harness surface
    else Codex selected
        S->>X: skip Claude-only relink, credential, config, and hook preparation
        X->>W: make feature worktree the only writable root
        X->>P: dispatch through Codex readiness and bounded policy
        Note over X,A: no read, copy, mutation, or dependency<br/>on Claude account state
        P-->>D: launch Codex self-host build
    end
```

## Approved Invariants

- Authentication selection belongs to one feature-run Codex context: a supplied
  per-run API key wins; otherwise cached login is used. Rejection never selects a
  different authentication source.
- The Codex adapter evaluates readiness immediately before every unattended initial,
  model-ladder, auxiliary, or resumed dispatch. It captures raw doctor output and
  emits only a source kind plus a sanitized four-state verdict.
- `workspace-write`, `on-request`, and `auto_review` are set explicitly on every
  unattended Codex invocation, including resumed and auxiliary paths. The dangerous
  combined bypass is not used for routine Codex automation.
- Provider candidate execution keeps its existing recovery precedence: authentication
  failure is returned to recovery and never advances to another configured provider.
- Authentication failure does not consume task retry, effort-escalation, or
  model-escalation budget.
- Every built-in-provider authentication failure enters the same bounded park
  lifecycle. Provider-specific readiness determines whether the source recovers.
- A startup-only API key is explicitly restart-required; the harness does not claim
  hot reload or create another credential source.
- The automatic reviewer may approve exceptional source-control and network actions,
  but a denial never widens policy on retry or resume.
- Claude authentication sources, credential ownership, and permission policy remain
  unchanged; auth failures share the common park disposition.
- A Codex self-host build skips only Claude-specific relink/auth/sandbox preparation
  and uses the same provider-local readiness and native worktree boundary as other
  Codex dispatches. Provider-neutral self-host release gates remain active.

## Approved Architecture Decisions

- The Codex adapter owns source selection, child-environment scoping, strict
  `doctor` parsing, explicit policy arguments, and secret-safe completion
  classification for every invocation path.
- `doctor` evidence maps to `ready`, `missing`, `unusable`, or `unverifiable`.
  Unknown schemas, external failures, and conflicting evidence fail closed as
  `unverifiable`; raw diagnostic output is never surfaced.
- Codex auth failure retains provider/source context through serial and grouped
  recovery and enters the shared bounded auth park with zero retry or escalation
  budget. Cached login is rechecked through the Codex readiness capability; a
  startup-only API key requires daemon restart and never gains a new reload path.
- Self-host setup resolves the build provider before provider-specific preparation.
  The Codex branch uses the native worktree sandbox and never enters Claude setup.
- Codex skill discovery, `$skill` invocation, `AGENTS.md`, and edited-skill self-host
  parity remain owned by issue #904 rather than being duplicated in #905.
- An automatic-review denial is an actionable permission failure. It never selects a
  different auth source, advances provider/model fallback, or weakens policy on retry.

## Planned Implementation for Issue #970

- A documented `auth.credentials` status of `ok` is sufficient authentication evidence
  even when another doctor check makes overall health fail. Missing, rejected, malformed,
  or absent auth evidence continues to fail closed.
- The cached-login park retains its existing timeout and zero-budget semantics while
  replacing fixed one-second subprocess polling with bounded, capped backoff.
- A recovery wait emits rate-limited progress that identifies the selected credential
  source and distinguishes authentication state from unrelated doctor health. Raw doctor
  output and credential material remain excluded.
- No provider fallback, authentication-source fallback, new deployable component, or new
  external integration is introduced.

## Diagram Impact Boundary

Issue #905 changes internal conductor components and invocation sequences around an
already-supported external provider. It adds no new deployable container, datastore,
database relationship, user type, or external service integration. System-context,
container, and ERD diagrams therefore require no update.

## Legend

- **Blue** marks planned Codex-specific readiness or self-host responsibilities.
- **Green** marks the planned explicit unattended policy.
- **Orange** marks existing components whose contracts change.
- **Pink** marks the cross-provider isolation invariant.
- Solid arrows show control, credential selection, or invocation flow. Labels identify
  external or conditional boundaries.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial planned architecture | DECIDE input for issue #905, Medium tier |
| 2026-07-25 | Resolved auth probe, recovery, policy, and self-host boundaries | Operator-approved architecture ADR |
| 2026-07-25 | Replaced Codex-only HALT with shared auth park and source-specific readiness | Operator-approved PRD and superseding ADR amendment |
| 2026-07-25 | Mapped approved components and sequences to the #905 implementation plan | Plan update; no new container, service, datastore, or external integration |
| 2026-07-26 | Added mixed-health auth classification and backed-off visible recovery | DECIDE architecture input for issue #970, Medium tier |
| 2026-07-26 | Mapped #970 to the provider classifier, shared park coordinator, and exhaustive event consumers | Plan update; 12 consolidated TDD tasks and no new architectural boundary |
