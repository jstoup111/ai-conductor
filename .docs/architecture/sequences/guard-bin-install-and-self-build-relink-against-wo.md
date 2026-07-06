# Sequence: Self-build relink preflight with worktree-root guards (#363)

**Last updated:** 2026-07-06
**Scope:** The self-build dispatch preflight (`runSelfBuildDispatch` → `relinkSkillsForSelfBuild`)
after the fix, including both refusal branches — a worktree-resolved harness root and a direct
worktree-rooted `bin/install` invocation.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon self-build dispatch
    participant P as relinkSkillsForSelfBuild
    participant R as resolveHarnessRoot
    participant REG as registry.json
    participant I as bin/install at resolved root
    participant G as Operator globals

    D->>P: preflight before first build step
    P->>R: resolve harness root
    R->>REG: read registry-recorded harness path
    alt registry path valid and has bin/install
        R-->>P: main checkout root
        P->>I: run bin/install --update at main root
        I->>I: self-root guard - root not under .worktrees
        I->>G: relink skills and bins against main
        P-->>D: preflight ok - dispatch build
    else resolved root under .worktrees
        R-->>P: rejected root
        P-->>D: InstallStaleError - HALT, no dispatch
        Note over G: globals untouched
    end

    Note over I: Direct invocation path - build agent runs worktree bin/install
    I->>I: self-root guard fires - HARNESS_DIR under .worktrees
    I-->>D: refuse with non-zero exit and explanation
    Note over G: globals untouched
```

## Legend

- The `alt` block covers the engine-side guard (registry-first resolution with a
  `.worktrees/` hard-reject that HALTs instead of relinking).
- The trailing notes cover the installer-side guard, which is caller-independent: any
  `bin/install` whose own root sits under `.worktrees/` refuses global linking unless
  the explicit override flag is passed.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-06 | Initial generation | Spec for #363 worktree-install guards |
