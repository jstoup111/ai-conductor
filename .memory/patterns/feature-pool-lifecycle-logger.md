---
created: 2026-07-26
category: patterns
related: [src/conductor/src/engine/daemon.ts, src/conductor/src/daemon-cli.ts, daemon log feature tags]
---

## Feature pool lifecycle logger

Feature lifecycle records emitted by the daemon pool (start, resume, and done)
must obtain the same cached feature-scoped logger as worktree execution. The
pool boundary occurs before the worktree scope exists and after it stops, so a
per-slug logger cache is the ownership bridge.

### Why

Using the repository-global logger at either boundary silently produces
untagged records even when all nested conductor logs are correctly tagged.

### Applies When

Adding or moving daemon lifecycle output across the pool/worktree boundary.
