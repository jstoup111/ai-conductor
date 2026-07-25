# Sequence: Codex Skill Setup and Daemon Dispatch (#904)

**Last updated:** 2026-07-25
**Scope:** Planned first-class Codex setup followed by one daemon-managed lifecycle step. The
sequence begins after provider selection and ends at the existing artifact gate; authentication,
sandboxing, usage reporting, and native interactive session recovery are outside this flow.

## Diagram

```mermaid
sequenceDiagram
    actor Operator as Project operator
    participant Installer as Active installer
    participant SkillScope as Codex user skill scope
    participant Bootstrap as Bootstrap workflow
    participant Guidance as Repository AGENTS.md
    participant Daemon as Daemon conductor
    participant Resolver as Invocation resolver
    participant Provider as Codex provider
    participant Codex as Codex host
    participant Skill as Selected harness skill
    participant Gate as Artifact and lifecycle gate

    Operator->>Installer: install or update built-in Codex support
    Installer->>SkillScope: reconcile harness-owned skill links
    Installer->>SkillScope: expose current shared catalog and harness guidance
    Installer->>Installer: verify current targets and no duplicate harness entries

    Operator->>Bootstrap: initialize or refresh project guidance
    Bootstrap->>Guidance: create or append missing harness reference
    Note over Bootstrap,Guidance: Preserve existing operator-authored content

    Daemon->>Provider: execute semantic lifecycle step with configured candidates
    Provider->>Resolver: resolve skill mention for selected Codex candidate
    Resolver-->>Provider: explicit $skill-name invocation
    Note over Provider,Resolver: Resolve again for every fallback candidate
    Provider->>Codex: start one-shot Codex execution in feature worktree
    Codex->>Guidance: load durable repository instructions
    Codex->>SkillScope: discover explicitly named harness skill
    SkillScope-->>Codex: shared workflow with Codex-scoped instructions
    Codex->>Skill: execute required workflow

    alt Required capability is unsupported by Codex
        Skill-->>Codex: unsupported capability and recovery action
        Codex-->>Provider: classified incomplete result
        Provider-->>Daemon: stop without applying Claude assumptions
        Daemon->>Gate: record actionable failure and keep step incomplete
    else Workflow completes
        Skill->>Gate: write required artifacts and evidence
        Codex-->>Provider: successful completion
        Provider-->>Daemon: provider-attributed success
        Daemon->>Gate: validate existing completion contract
        Gate-->>Daemon: advance only when satisfied
    end
```

## Invariants

- Installation and update use Codex's documented user skill discovery scope and reconcile only
  harness-owned prior links.
- Repository guidance is durable and automatically loaded by Codex; bootstrap never overwrites
  unrelated operator content.
- The candidate loop resolves a provider-native explicit skill mention immediately before each
  candidate invocation. A Codex-to-Claude fallback is resolved again rather than reusing Codex
  syntax. The skill's workflow semantics and completion contract remain provider-neutral.
- Codex executes in the feature worktree through the existing provider runtime and session scope.
- Provider incompatibility is explicit and fail-closed; the lifecycle gate remains unsatisfied.
- A successful provider process is insufficient by itself: existing artifact gates still decide
  whether the step advances.

## Legend

- `$skill-name` denotes Codex's documented explicit local-skill invocation form.
- “Reconcile” means update or remove only paths proven to be owned by this harness; user-owned
  content is preserved.
- The sequence intentionally omits #905 auth/sandbox behavior and #906 usage accounting.
- Direct interactive skill use can share the installed skill and guidance contracts, but a native
  interactive Codex launcher and generalized persistent recovery remain deferred under #759.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Resolved the skill prompt per provider candidate | Prevent Codex syntax from leaking into a Claude fallback attempt |
| 2026-07-25 | Initial planned sequence | DECIDE architecture input for daemon-first Codex parity (#904) |
