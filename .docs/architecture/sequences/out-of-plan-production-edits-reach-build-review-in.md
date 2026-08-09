# Sequence: A BUILD commit touching a path outside its task's declared scope

**Last updated:** 2026-08-09
**Scope:** the `git commit` → `commit-msg` hook → `scope-check` → ledger → `build_review` flow,
covering the three outcomes (inside floor / outside floor / check unresolvable).

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Agent as BUILD agent
    participant Git as git commit
    participant Hook as commit-msg hook
    participant CLI as conduct-ts scope-check
    participant Eval as evaluateScopeContainment
    participant Led as .pipeline/hook-events.jsonl
    participant Floor as runPerTaskCommitFloor
    participant Rev as build_review grader

    Agent->>Git: commit staged paths, Task N trailer
    Git->>Hook: commit-msg «msgfile»
    Hook->>CLI: scope-check «msgfile»
    CLI->>CLI: read task-status.json, resolve task N

    alt task N not in_progress or declares no files
        CLI-->>Hook: exit 0, no output
        Note over CLI,Hook: not applicable — silent, was exit 1
    else check cannot resolve (crash, unparseable state)
        CLI->>Led: append scope_check_unresolved
        CLI-->>Hook: exit 3
        Note over Hook: commit still lands — ambiguity is recorded, not swallowed
    else task N resolved
        CLI->>Eval: staged paths, declared files, Scope trailers
        Note over Eval: floor = declared files<br/>+ test siblings<br/>+ same-dir neighbors<br/>+ docs/generated<br/>+ Scope trailers

        alt every staged path inside floor
            Eval-->>CLI: allowed
            CLI-->>Hook: exit 0, no output
        else some path outside floor
            Eval-->>CLI: offending paths + task id
            CLI->>Led: append scope_widening_recorded (per path)
            Note over CLI,Led: rationale = Scope trailer verbatim,<br/>else derived from commit subject+body
            CLI-->>Hook: exit 0 + advisory stderr
            Note over Agent,Hook: stderr names task N, each offending path,<br/>and the exact Scope line to paste next time
        end
    end

    Hook-->>Git: allow
    Git-->>Agent: commit lands

    Note over Agent,Rev: ... remaining tasks ...

    Floor->>Led: read recorded widenings for this build
    Floor->>Floor: harvest Scope trailers from commits
    Floor->>Rev: acceptedWidenings (path, rationale, derived?, task, sha)
    Rev->>Rev: judge scope with every widening explained
    Note over Rev: an explained widening no longer reads<br/>as an unjustified bundled fix
```

## Legend

- **«msgfile»** — the commit-message file path git passes to the hook.
- **exit 3** is new. Today every non-0/non-2 exit hits the hook's
  `abstained (exit N); allowing commit` branch and leaves no durable trace; splitting
  not-applicable (0) from unresolvable (3) is what makes desired outcome 4 satisfiable.
- **No refusal edge exists.** By operator direction the commit lands on every path; the gate
  remains `build_review`, now supplied with a rationale for every out-of-floor path.
- `derived?` distinguishes a verbatim `Scope:` trailer from a rationale inferred from the commit
  message, so the grader can weigh them differently.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial authoring | DECIDE for intake #1390 |
