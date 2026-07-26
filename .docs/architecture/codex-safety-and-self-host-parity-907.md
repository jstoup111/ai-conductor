# Components: Codex Safety and Self-Host Parity (#907)

**Last updated:** 2026-07-25
**Scope:** The current Claude-shaped safety surfaces, the provider-neutral engine seams
that already own lifecycle and judgment, and the required ownership boundary for task
identity, mutation protection, protected artifacts, and self-host isolation.

## Component Diagram

```mermaid
flowchart LR
    Operator["Harness operator"]

    subgraph Engine["Conductor engine"]
        Conductor["Conductor lifecycle<br/>step, retry, resume, cleanup"]
        Routing["Provider execution routing<br/>Claude or Codex"]
        TaskState["Task lifecycle state<br/>current identity and task rows"]
        PhaseState["Phase protection state<br/>active phase and allowed artifacts"]
        Safety["Required safety authority<br/>engine-owned outcomes<br/>placement resolved by ADR"]
        SelfHost["Self-host coordinator<br/>provider-aware isolation lifecycle"]
        Judgement["Judgment gates<br/>architecture, wiring, build completion"]
    end

    subgraph Providers["Provider execution boundary"]
        Claude["Claude provider"]
        ClaudeHooks["Claude lifecycle integrations<br/>current interception surface"]
        Codex["Codex provider"]
        CodexClient["Codex client<br/>no equivalent lifecycle assumed"]
    end

    subgraph Workspace["Feature worktree boundary"]
        Work["Task implementation changes"]
        Docs["Protected DECIDE artifacts"]
        State["Transient lifecycle state"]
    end

    subgraph Protected["Operator-owned protected surfaces"]
        Live["Live harness checkout"]
        ClaudeConfig["Unrelated live Claude configuration"]
        CodexConfig["Unrelated live Codex configuration"]
        Auth["Selected authentication source<br/>contract owned by issue 905"]
    end

    Operator --> Conductor
    Conductor --> Routing
    Conductor --> TaskState
    Conductor --> PhaseState
    TaskState --> Safety
    PhaseState --> Safety
    Routing --> Claude
    Routing --> Codex
    Claude --> ClaudeHooks
    Codex --> CodexClient
    ClaudeHooks -. "legacy compatibility signal" .-> Safety
    Claude --> Safety
    Codex --> Safety
    Safety --> Work
    Safety --> Docs
    Safety --> State
    Conductor --> SelfHost
    Routing --> SelfHost
    SelfHost --> Auth
    SelfHost --> Work
    SelfHost -. "deny mutation" .-> Live
    SelfHost -. "exclude unrelated state" .-> ClaudeConfig
    SelfHost -. "exclude unrelated state" .-> CodexConfig
    Work --> Judgement
    Docs --> Judgement
    Judgement --> Conductor

    classDef required fill:#e8f5e9,stroke:#2e7d32
    classDef current fill:#fff3e0,stroke:#ef6c00
    classDef protected fill:#ffebee,stroke:#c62828
    class Safety,SelfHost required
    class ClaudeHooks current
    class Live,ClaudeConfig,CodexConfig protected
```

## Boundary Notes

- The conductor already owns step, retry, resume, phase, and cleanup lifecycles.
- Current-task and phase state already exist as engine-visible worktree state, while
  Claude lifecycle integrations currently perform key interception and stamping.
- The required safety authority owns outcomes, not provider API symmetry. Claude
  lifecycle integration may remain as a compatibility signal, but it is not the
  correctness boundary.
- Judgment gates remain the authority for architecture, wiring, and build completeness;
  current-task identity does not replace those judgments.
- Self-host isolation preserves only the authentication source selected by issue #905.
  The live checkout and unrelated provider configuration remain protected.
- Exact module placement and compatibility migration are decisions for architecture
  review; this diagram fixes ownership and trust boundaries without choosing that seam.

## Legend

- **Green** — required engine-owned safety and isolation outcomes for #907.
- **Orange** — current Claude-specific lifecycle integration retained as context, not
  as the target correctness boundary.
- **Red** — operator-owned surfaces a self-host run must not mutate.
- Solid arrows show control or permitted data flow; dotted arrows show compatibility,
  exclusion, or denied-mutation relationships.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial component boundary | DECIDE architecture for issue #907 |
