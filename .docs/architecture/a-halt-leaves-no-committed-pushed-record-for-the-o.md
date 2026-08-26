# Architecture: committed halt record

Feature: A halt leaves no committed, pushed record for the operator to pick up from
Source: jstoup111/ai-conductor#1809

## C4 — Component view (engine halt path, after the change)

```mermaid
C4Component
  title Halt path — where the committed record is produced

  Container_Boundary(engine, "conduct-ts engine (feature worktree)") {
    Component(callers, "Halt call sites", "conductor.ts, rebase.ts, daemon-runner.ts, task-progress.ts, rewind.ts, provider-lifecycle.ts, task-cli.ts, self-host gates", "~30 sites; unchanged by this feature")
    Component(seam, "writeHaltMarker", "halt-marker.ts", "The single halt writer. Writes .pipeline/HALT and .pipeline/HALT.class, then delegates the durable record")
    Component(record, "halt-record", "halt-record.ts (new)", "Renders, stages, commits and pushes .docs/halted/<slug>.md. Best-effort in every arm")
    Component(clear, "Halt clear path", "conductor.ts, daemon-deps.ts", "Emits halt_cleared; now also supersedes the record")
    Component(emitter, "ConductorEventEmitter", "ui/events.ts", "The one telemetry spine")
  }

  ContainerDb(pipeline, ".pipeline/", "untracked worktree state", "HALT, HALT.class — lost with the worktree")
  ContainerDb(docs, ".docs/halted/<slug>.md", "git-tracked artifact", "Survives worktree loss; readable from the branch alone")
  System_Ext(remote, "origin", "git remote", "Receives the pushed branch when one exists")
  System_Ext(operator, "Operator", "human", "Reads the record from any checkout of the branch")

  Rel(callers, seam, "writeHaltMarker(root, body, class)")
  Rel(seam, pipeline, "writes markers (best-effort)")
  Rel(seam, record, "non-mechanical class only")
  Rel(record, docs, "render → git add <path> → commit --no-verify")
  Rel(record, remote, "git push (best-effort)")
  Rel(record, emitter, "halt_record_written / halt_record_write_failed / halt_record_push_failed")
  Rel(clear, record, "supersede: Status resolved")
  Rel(clear, emitter, "halt_cleared (existing)")
  Rel(operator, docs, "git fetch && read — no daemon host needed")
  Rel(operator, remote, "clones/fetches the branch")
```

## Sequence — halt, pick up, resume

```mermaid
sequenceDiagram
  participant C as Halt call site
  participant W as writeHaltMarker
  participant R as halt-record
  participant G as git worktree
  participant E as event spine
  participant O as Operator

  C->>W: writeHaltMarker(root, body, needs-human)
  W->>G: write .pipeline/HALT and .pipeline/HALT.class
  W->>R: recordHalt(slug, class, step, phase, body)
  R->>G: write .docs/halted/slug.md
  R->>G: git add path-scoped
  alt the add staged a change
    R->>G: git commit --no-verify
    R->>E: halt_record_written
    R->>G: git push
  else identical bytes already committed
    R->>E: halt_record_written (noop)
  end
  alt push rejected, or no remote
    R->>E: halt_record_push_failed, commit retained
  end
  R-->>W: result — every arm returns, nothing throws
  O->>G: git fetch, then read the record from the branch
  O->>C: resume or unpark
  C->>R: supersedeHaltRecord(slug, cause)
  R->>G: rewrite Status resolved, then commit
  R->>E: halt_record_written
```

## Design notes

- The record is produced at the seam, not at the call sites, so no halt path can forget it and no
  future halt path has to remember it.
- `mechanical` halts are excluded. The daemon re-kicks them without an operator, so a commit per
  mechanical halt is churn on the feature branch with no reader.
- The commit is path-scoped (`git add -- <record path>`), so a halt raised over a dirty worktree
  never sweeps in-progress work into the record commit.
- The push is of the current feature branch. At halt time the branch already carries the
  committed build work, so pushing it is what makes the halt readable from another machine —
  which is the outcome the issue asks for.
