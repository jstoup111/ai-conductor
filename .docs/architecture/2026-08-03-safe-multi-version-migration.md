# Architecture: Safe multi-version harness migration

**Date:** 2026-08-03
**Feature:** `verify-bin-migrate-handles-a-multi-version-jump-wi` (`jstoup111/ai-conductor#219`)
**Tier:** M

## Scope

Only the consumer update path changes. The release PR workflow, the changelog renderer, and the
conductor engine are untouched. `bin/migrate` gains a durable applied-block ledger, a fail-fast
per-block executor, and per-block approval; the harness gains an integrity check over newly
authored migration blocks.

## Container view

```mermaid
C4Container
  title Consumer harness update — containers

  Person(op, "Operator", "Runs an update from a consumer project")

  System_Boundary(consumer, "Consumer project") {
    Container(proj, "Project working tree", "files", "config, .gitignore, worktrees, daemon state")
    ContainerDb(ledger, "Applied-block ledger", "JSON", "NEW — which migration blocks have been applied")
  }

  System_Boundary(harness, "Harness checkout") {
    Container(update, "bin/update", "bash", "Detects a newer tag or commit, prompts, checks it out")
    Container(migrate, "bin/migrate", "bash + python3", "Refreshes the install, then runs migration blocks")
    Container(install, "bin/install", "bash", "Relinks skills, merges settings")
    ContainerDb(changelog, "CHANGELOG.md", "markdown", "Migration blocks, keyed by release entry")
    Container(integrity, "test/test_harness_integrity.sh", "bash", "NEW check — migration block authoring contract")
  }

  ContainerDb(cfg, "~/.claude/ai-conductor.config.json", "JSON", "currentVersion, updateChannel")

  Rel(op, update, "runs")
  Rel(update, cfg, "reads / advances currentVersion")
  Rel(update, migrate, "invokes after checkout")
  Rel(migrate, install, "refreshes install")
  Rel(migrate, changelog, "parses migration blocks")
  Rel(migrate, ledger, "reads applied set, records outcomes")
  Rel(migrate, op, "asks per-block approval")
  Rel(migrate, proj, "executes approved blocks against")
  Rel(integrity, changelog, "validates newly authored blocks")
```

## Component view — the reworked runner

```mermaid
C4Component
  title bin/migrate — components

  Container_Boundary(migrate, "bin/migrate") {
    Component(parse, "Block parser", "python3", "Splits release entries, collects every Migration section, emits identified blocks")
    Component(select, "Candidate selector", "python3", "Subtracts the applied ledger from the parsed set; version range is advisory only")
    Component(approve, "Approval loop", "bash", "Per-block preview and y / n / all / quit")
    Component(exec, "Block executor", "bash", "Runs one block per invocation under fail-fast semantics with HARNESS_DIR exported")
    Component(record, "Ledger writer", "bash + python3", "Records applied and pending outcomes after each block")
    Component(report, "Summary reporter", "bash", "applied / skipped / failed / already-applied")
  }

  ContainerDb(changelog, "CHANGELOG.md", "markdown")
  ContainerDb(ledger, "Applied-block ledger", "JSON")
  Container(proj, "Consumer working tree", "files")

  Rel(parse, changelog, "reads")
  Rel(select, parse, "consumes parsed blocks")
  Rel(select, ledger, "reads applied identities")
  Rel(approve, select, "iterates candidates")
  Rel(exec, approve, "runs approved block")
  Rel(exec, proj, "mutates")
  Rel(record, ledger, "writes after each outcome")
  Rel(report, record, "summarizes")
```

## Execution sequence

```mermaid
sequenceDiagram
  actor Op as Operator
  participant U as bin/update
  participant M as bin/migrate
  participant L as Ledger
  participant B as Block (bash -euo pipefail)

  Op->>U: update
  U->>U: checkout new tag
  U->>M: invoke
  M->>M: bin/install --update
  M->>L: read applied identities
  M->>M: parse blocks, subtract applied, order
  loop each candidate block, in order
    M->>Op: preview block, ask y / n / all / quit
    alt approved
      M->>B: execute with HARNESS_DIR exported
      alt block succeeded
        B-->>M: exit 0
        M->>L: record applied
      else block failed
        B-->>M: non-zero
        M->>L: leave pending
        M-->>U: stop sequence, non-zero
      end
    else skipped or quit
      M->>L: leave pending
    end
  end
  M-->>U: summary, exit 0
  U->>U: advance currentVersion
```

## Key boundary decisions

- **The ledger, not the version string, decides what runs.** The version range stays as an
  advisory display bound. This is what makes the `main@<sha>` channel behave like the tagged
  channel and makes declining a block non-lossy.
- **The ledger lives with the consumer, not the harness.** One harness checkout serves many
  consumer projects, and migration blocks mutate the consumer.
- **One block per shell invocation, fail-fast.** Failure isolation stays at the block boundary, so
  a partial sequence is always representable as applied-prefix plus pending-suffix.
- **`bin/conduct`'s duplicated update logic is out of scope** and continues to call the same
  `bin/migrate`, so it inherits the fix without modification.
