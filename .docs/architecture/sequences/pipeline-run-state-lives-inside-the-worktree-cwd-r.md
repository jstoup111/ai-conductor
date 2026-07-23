# Sequence: Run-state resolution, durability, and cleanup (#564)

**Last updated:** 2026-07-21
**Scope:** How a run resolves its state directory by feature identity (never cwd), how
the outward symlink is established, how the store survives worktree removal and a
cwd-relative `rm`, and how end-of-feature cleanup removes exactly one feature's state.

## Sequence 1 — resolve + ensure store on run start (host or daemon)

```mermaid
sequenceDiagram
    participant Caller as conduct host / daemon
    participant RS as run-state-store.ts
    participant G as git
    participant HOME as ~/.ai-conductor/runs/«project-key»/«slug»/
    participant WT as worktree .pipeline (symlink)

    Caller->>RS: resolveRunStateDir({worktreePath, feature})
    RS->>G: rev-parse origin url (projectKey) + slugify(feature)
    G-->>RS: projectKey, slug
    RS-->>Caller: absolute store path (no process.cwd() read)
    Caller->>RS: ensureRunStateStore(worktreePath, identity)
    RS->>HOME: mkdir -p store (idempotent)
    RS->>WT: symlink .pipeline → store (outward, reuse if correct)
    Note over WT,HOME: worktree holds a pointer — real state lives in HOME
    Caller->>HOME: readState / writeState / gates / HALT (through resolved path)
```

## Sequence 2 — durability under worktree removal and cwd-relative rm

```mermaid
sequenceDiagram
    participant Op as operator / stray test / cleanup
    participant WT as worktree .pipeline (symlink)
    participant HOME as ~/.ai-conductor/runs/«project-key»/«slug»/
    participant Resume as conduct resume

    Op->>WT: rmSync(join(cwd,'.pipeline'))  ·OR·  remove worktree
    WT--xWT: symlink unlinked (target NOT followed)
    Note over HOME: store untouched — nothing destructive reached it
    Resume->>HOME: resolveRunStateDir(identity) → read conduct-state
    HOME-->>Resume: state intact → run resumes from last step
    Note over Resume: recreating the worktree re-establishes the symlink — no finished task is redone
```

## Sequence 3 — end-of-feature cleanup (scoped to one slug)

```mermaid
sequenceDiagram
    participant Finish as finish / feature teardown
    participant RS as run-state-store.ts
    participant HOME as ~/.ai-conductor/runs/«project-key»/

    Finish->>RS: removeRunStateDir(identity)
    RS->>HOME: rm -rf runs/«project-key»/«slug»  (this feature only)
    Note over HOME: sibling features under other slugs untouched<br/>(negative path: no cross-feature collision)
    RS-->>Finish: removed
```

## Legend

- `«slug»` / `«project-key»` are guillemet placeholders for variable path parts.
- Sequence 1 shows the load-bearing invariant: the store path is derived from **feature
  identity** (projectKey + slug), never from `process.cwd()`.
- Sequence 2 shows the durability contract — a delete reaches only the symlink; the real
  store is off the worktree tree, so the run always resumes. This is the observable
  acceptance signal in the desired outcome ("remove the worktree… confirm the run can
  still resume").
- Sequence 3 shows cleanup is per-slug: legitimate end-of-feature removal takes exactly
  that feature's state and nothing else.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | DECIDE for #564 — run-state resolution/durability/cleanup flows |
