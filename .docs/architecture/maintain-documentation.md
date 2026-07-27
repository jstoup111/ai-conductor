# Components: repository-local documentation maintenance

**Last updated:** 2026-07-25
**Scope:** The repository-local skill, opt-in custom-step completion contract, and conditional finish integration used only by this repository.

## Diagram

```mermaid
graph TD
  subgraph local["Repository-local surfaces"]
    codex[".agents/skills/maintain-documentation<br/>canonical skill"]
    claude[".claude/skills/maintain-documentation<br/>repo-local symlink"]
    config[".ai-conductor/config.yml<br/>custom step after rebase"]
  end

  subgraph engine["Generic conductor machinery"]
    parser["config.ts<br/>validate opt-in completion artifact"]
    registry["steps.ts<br/>insert custom step"]
    runner["conductor.ts<br/>dispatch gate-loop step"]
    completion["artifacts.ts<br/>require fresh configured marker"]
    finish["finish flow<br/>conditionally finalize PR link"]
    release["release workflow<br/>release only with notable content"]
  end

  subgraph evidence["Transient evidence"]
    review[(".pipeline/maintain-documentation-review.md")]
    pass[(".pipeline/maintain-documentation-pass")]
  end

  subgraph maintained["Human-facing documentation"]
    readme["README.md"]
    docs["docs/<br/>guides · reference · explanation<br/>runbooks · contributing"]
    changelog["CHANGELOG.md<br/>notable implementation changes"]
  end

  config --> parser --> registry --> runner
  codex --> runner
  claude -.-> codex
  runner --> readme
  runner --> docs
  runner --> changelog
  runner --> review
  runner -->|"PASS only"| pass
  pass --> completion
  completion -->|"fresh marker"| finish
  finish -->|"placeholder present"| changelog
  changelog -->|"non-empty Unreleased"| release

  classDef localNode fill:#d5f5e3,stroke:#1e8449,stroke-width:2px;
  classDef generic fill:#d6eaf8,stroke:#2874a6;
  classDef transient fill:#fdebd0,stroke:#b9770e;
  class codex,claude,config localNode;
  class parser,registry,runner,completion,finish,release generic;
  class review,pass transient;
```

## Legend

- Green nodes are committed only in this repository.
- Blue nodes are generic conductor behavior that remains inert without explicit project configuration or a changelog placeholder.
- The release workflow exits successfully without mutation when `[Unreleased]` has no notable content.
- Orange nodes are transient, per-run evidence.
- The skill may read `.docs/` for context but has no write edge to `.docs/`.
- The direct-invocation symlink points to one canonical skill; no instructions are duplicated.

## Change log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial design | Define the Medium-tier technical architecture before implementation |
| 2026-07-25 | Add conditional release path | Resolve the notable-only changelog conflict without fake entries |
