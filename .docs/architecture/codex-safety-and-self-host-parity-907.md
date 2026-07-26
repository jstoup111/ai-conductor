# Components: Codex Safety and Self-Host Parity (#907)

**Last updated:** 2026-07-26
**Scope:** The current Claude-shaped safety surfaces, the provider-neutral engine seams
that already own lifecycle and judgment, and the required ownership boundary for
task-local telemetry, mutation protection, protected artifacts, and symmetric self-host isolation.

## Component Diagram

```mermaid
flowchart LR
    Operator["Harness operator"]

    subgraph Engine["Conductor engine"]
        Conductor["Conductor lifecycle<br/>step, retry, resume, cleanup"]
        Routing["Per-candidate provider routing<br/>actual Claude or Codex runtime"]
        TaskState["Task attribution service<br/>validated ids and concurrent active rows"]
        PhaseState["Phase protection state<br/>active phase and allowed artifacts"]
        Seal["Protected artifact seal<br/>approved DECIDE baseline"]
        Safety["Safety boundary<br/>required verdict and capability classification"]
        Diagnostics["Safety diagnostics<br/>structured recovery and redaction"]
        SelfHost["Self-host coordinator<br/>provider-home and terminal cleanup lifecycle"]
        LiveAudit["Live-boundary verifier<br/>checkout and provider-state fingerprints"]
        Judgement["Judgment gates<br/>architecture, wiring, build completion"]
    end

    subgraph Providers["Provider execution boundary"]
        Claude["Claude provider"]
        ClaudeHooks["Claude lifecycle integrations<br/>current interception surface"]
        Codex["Codex provider"]
        CodexClient["Codex client<br/>native sandbox and lifecycle hooks"]
        ProviderAuth["Optional self-host auth capability<br/>provider-owned selected representation"]
    end

    subgraph Isolated["Per-run minimal provider home"]
        ClaudeHome["Throwaway CLAUDE_CONFIG_DIR<br/>selected auth, engine controls,<br/>worktree harness assets"]
        CodexHome["Throwaway CODEX_HOME + discovery HOME<br/>opaque selected auth, engine controls,<br/>worktree .agents/skills view"]
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
    TaskState -. "non-authoritative telemetry" .-> Safety
    PhaseState --> Seal
    Seal --> Safety
    Safety --> Diagnostics
    Routing --> Claude
    Routing --> Codex
    Claude --> ClaudeHooks
    Codex --> CodexClient
    ClaudeHome --> Claude
    CodexHome --> Codex
    ClaudeHooks -. "provider-local early guard" .-> Safety
    CodexClient -. "provider-local early guard" .-> Safety
    Claude --> Safety
    Codex --> Safety
    Safety --> Work
    Safety --> Docs
    Safety --> State
    Conductor --> SelfHost
    Routing -- "actual candidate" --> SelfHost
    SelfHost --> LiveAudit
    LiveAudit --> Safety
    SelfHost --> ProviderAuth
    ProviderAuth --> Auth
    SelfHost --> ClaudeHome
    SelfHost --> CodexHome
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
    class Seal,Safety,Diagnostics,SelfHost,LiveAudit required
    class ClaudeHooks current
    class Live,ClaudeConfig,CodexConfig protected
```

## Boundary Notes

- The conductor already owns step, retry, resume, phase, and cleanup lifecycles.
- Task rows represent a concurrent active set. Task ids and commit trailers are telemetry;
  no workspace-global current-task value authorizes mutation or completion.
- The required safety authority owns outcomes, not provider API symmetry. Claude
  lifecycle integration may remain as a compatibility signal, but it is not the
  correctness boundary.
- The plan implements the green boundary as separate task-attribution, artifact-seal,
  safety-verdict, diagnostic-redaction, provider-home, and live-fingerprint modules; the
  conductor composes them around every BUILD/SHIP attempt.
- Judgment gates remain the authority for architecture, wiring, and build completeness.
- Both provider homes preserve only selected authentication, engine-owned controls, and
  worktree-owned harness assets. Personal settings/hooks and live global relink are excluded.
- The conductor creates the policy wrapper, but provider execution enters it per candidate
  after resolving the actual runtime. The provider-owned auth capability prepares only its
  selected representation; teardown completes before fallback advances.
- #904's ordinary Codex catalog remains under the operator's `$HOME/.agents/skills`; a
  self-host child receives a separate discovery home linked only to feature-worktree skills.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` places policy and terminal
  acceptance in the conductor safety boundary. Provider hooks and sandboxes remain
  early/preventive integrations rather than the correctness authority.

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
| 2026-07-26 | Place isolation inside per-candidate routing and add provider-owned auth capability | Post-plan architecture review for issue #907 |
| 2026-07-26 | Name planned safety, seal, diagnostic, provider-home, and live-verifier components | `/plan` update for issue #907 |
| 2026-07-26 | Replace singular task lease with concurrent telemetry; add minimal homes for both providers | Conflict-check resolution for issue #907 |
| 2026-07-25 | Resolve the safety seam and record Codex native guards | Architecture review for issue #907 |
| 2026-07-25 | Initial component boundary | DECIDE architecture for issue #907 |
