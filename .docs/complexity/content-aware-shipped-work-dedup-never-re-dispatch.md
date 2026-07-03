# Complexity: content-aware shipped-work dedup

Tier: M

## Rationale

- **Seams touched (3):** finish flow (author + commit the `.docs/shipped/<slug>.md`
  marker onto the implementation PR branch), backlog discovery (`discoverBacklog`
  gains a base-branch shipped-record check keyed by spec content-hash), and
  `rekickSweep` (consult `isProcessed` before re-kicking a halted worktree).
- **Migration required:** one-time backfill commit of shipped records for
  already-shipped specs (16 ledger entries + known unmarked shipped specs),
  otherwise the new check protects nothing retroactively.
- **Cross-checkout semantics:** the marker must be authoritative from the base
  branch tree (fresh clones, second machines), with the local `.daemon/processed`
  ledger demoted to cache — ordering and precedence need explicit stories.
- **No external integrations, no auth, no new services** — hashing and file
  conventions only, all injectable/testable seams. Not L.
- **Not S:** three interacting engine paths plus a migration and negative-path
  hashing edge cases (renamed stem, edited-after-ship spec, missing stories).
