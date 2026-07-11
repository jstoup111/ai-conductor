# Components: Worktree-rooted global-install guards (#363)

**Last updated:** 2026-07-06
**Scope:** The two guard points that stop a build-worktree checkout from repointing
operator globals — the `bin/install` self-root refusal and the registry-first,
worktree-rejecting harness-root resolution used by the self-build relink preflight.

## Diagram

```mermaid
graph TD
    subgraph OperatorGlobals["Operator globals - the protected surface"]
        BINS["~/.local/bin/conduct + conduct-ts"]
        SKILLS["~/.claude/skills/* symlinks"]
        SETTINGS["~/.claude/settings.json hook commands"]
    end

    subgraph MainCheckout["Main checkout - registry-recorded path"]
        INSTALL["bin/install"]
        GUARD["worktree-root guard - refuses when HARNESS_DIR is under .worktrees unless override flag"]
    end

    subgraph Worktree["Build worktree - .worktrees/«slug»"]
        WINSTALL["bin/install - same script, worktree copy"]
        WDIST["src/conductor dist - running engine module"]
    end

    subgraph Engine["Conductor engine"]
        RESOLVE["resolveHarnessRoot - registry-first, hard-rejects .worktrees roots"]
        RELINK["relinkSkillsForSelfBuild - preflight"]
        REGISTRY["~/.ai-conductor/registry.json"]
        HALT["InstallStaleError to .pipeline/HALT"]
    end

    RELINK --> RESOLVE
    RESOLVE --> REGISTRY
    RESOLVE -- "resolved root under .worktrees" --> HALT
    RELINK -- "approved main root" --> INSTALL
    INSTALL --> GUARD
    GUARD -- "root is main checkout" --> BINS
    GUARD -- "root is main checkout" --> SKILLS
    GUARD -- "root is main checkout" --> SETTINGS
    WINSTALL -. "self-root under .worktrees" .-> GUARD
    GUARD -- "refuse with exit code + message" --> WINSTALL
    WDIST -. "old path: __dirname probing resolved the worktree" .-> RESOLVE
```

## Legend

- **Solid arrows** — the healthy post-fix flow: preflight resolves the registry-recorded
  main checkout and only that root's installer may touch operator globals.
- **Dotted arrows** — the incident paths from #363, now terminated at a guard: a worktree
  copy of `bin/install` refuses to link globals from its own root, and a worktree-resolved
  harness root fails the preflight loudly instead of relinking.
- Guillemets `«slug»` mark variable path segments.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-06 | Initial generation | Spec for #363 worktree-install guards |
