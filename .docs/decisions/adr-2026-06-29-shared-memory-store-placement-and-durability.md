# ADR: Shared Memory Store Placement & Cross-Worktree Durability

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

FR-5 requires harness memory to be **durable and shared across a project's worktrees** and to
**survive worktree removal**, with sharing **branch-independent** (one set per project, visible
everywhere immediately, not gated on a merge). Today `.memory/` lives **inside the working tree**
(created at bootstrap, `bin/conduct:1078-1085`; gitignored, `.gitignore:5`), so it is per-worktree and
lost when a worktree is removed — the exact gap FR-5 closes. Open Question 3 asks *where shared memory
lives and how cross-worktree durability is achieved*.

Forces:
- A superseded spec (`SUPERSEDED-2026-06-29-worktree-shared-memory.md:114`) already sketched the
  mechanism: a **canonical per-project store under `~/.ai-conductor/memory/<key>/harness/`**, with
  `.memory/` becoming a symlink to it. The harness already centralizes Serena memory the same way
  (memory note: "Serena symlinked to ~/.ai-conductor/memory store").
- `.memory/` is **gitignored**, so relocating its real contents out of the tree changes nothing that
  git tracks; the in-tree path can remain as a symlink for full backward compatibility (FR-9/FR-10:
  every existing reader that opens `.memory/index.md` still works).
- Branch-independence (FR-5) means the store must **not** be keyed by branch or worktree — it is keyed
  by **project identity**, shared across all that project's worktrees.
- This default-provider placement is independent of non-default providers (an MCP platform stores its
  own data); this ADR governs the **default/local provider** and the **fallback store** (adr-2026-06-29-memory-resilience-write-fallback-and-reconcile).

## Options Considered

### Option A: Canonical per-project store at `~/.ai-conductor/memory/<project-key>/harness/`, `.memory/` → symlink
- **How:** The default provider's real storage lives at a stable user-dir path keyed by project
  identity. Each worktree's in-tree `.memory/` is a **symlink** to that canonical directory. All
  worktrees of the project therefore read/write the same store; removing a worktree removes only the
  symlink, never the store.
- **Pros:** Satisfies FR-5 directly (shared, branch-independent, survives removal); preserves the
  `.memory/` path so all existing readers/writers are untouched (FR-9/FR-10); reuses the established
  `~/.ai-conductor/memory/` convention; zero external dependency (FR-8).
- **Cons:** Requires a stable, collision-free **project key**; symlink semantics must be handled on the
  platform (WSL/Linux here — fine); concurrent writes from two worktrees target one directory (handled
  by file-per-entry layout, below).

### Option B: Commit `.memory/` to git (share via the repo)
- **Cons:** Branch-**dependent** (memory only shared after merge) — violates FR-5's "not gated on a
  merge"; pollutes history/PRs with memory churn; lost for a removed *unmerged* worktree. Rejected.

### Option C: A local memory daemon/DB owning the store
- **Cons:** Reintroduces a service/process for the *default* path, violating FR-8 (zero dependency out
  of the box). Belongs to a Phase 2 non-default provider, not the default. Rejected for default.

## Decision

Adopt **Option A**: the default provider's store is a **canonical per-project directory at
`~/.ai-conductor/memory/<project-key>/harness/`**, and each worktree's `.memory/` is a **symlink** to
it.

- **Project key:** derived from a stable project identity (e.g. the main repository's
  origin/identity, not the branch or worktree path) so all worktrees of one project resolve to the
  same key and a *different* project resolves elsewhere (per-project isolation, FR-5 negative path).
  The exact derivation is an implementation detail fixed in planning, but it MUST be branch- and
  worktree-path-independent.
- **Layout = file-per-entry** (today's category subdirs + `index.md`), which makes near-simultaneous
  writes from two worktrees land as **separate files** that both persist (FR-5: "concurrent writes
  both persist, no clobber"). The shared `index.md` is the one contended file; appends/updates must be
  done as read-modify-write of distinct lines (or per-entry index fragments) to avoid losing one
  worktree's line.
- **Worktree removal** deletes only the symlink; the canonical store is never touched (FR-5 negative
  path: "no shared project memory deleted as a side effect").
- Bootstrap/`bin/conduct` memory creation is updated to **ensure the canonical dir + symlink** instead
  of a plain in-tree directory; if `.memory/` already exists as real content, that is the **migration**
  case (adr-2026-06-29-safe-reversible-memory-migration), not fresh creation.

Why: it is the minimal change that makes memory project-scoped and durable while keeping the `.memory/`
path every existing reader/writer already uses, and it reuses the `~/.ai-conductor/memory/` convention
already in the codebase.

## Consequences

### Positive
- FR-5 satisfied: shared across worktrees, branch-independent, survives worktree removal.
- Backward-compatible: `.memory/` still resolves; no reader/writer changes (FR-9/FR-10).
- Zero dependency for the default (FR-8); reuses an existing convention.

### Negative
- Needs a robust, branch-independent **project key**; getting it wrong risks cross-project bleed or
  per-project fragmentation — must be covered by negative-path tests (cross-project isolation).
- The shared `index.md` is a concurrency hotspot; the write protocol must avoid clobbering concurrent
  worktree updates (file-per-entry mitigates the entry files; index needs care).
- Symlinks assume a POSIX-ish filesystem (true for this WSL/Linux environment).

### Follow-up Actions
- [ ] Fix the project-key derivation (branch/worktree-independent) and document it.
- [ ] Update bootstrap/`bin/conduct` memory setup to create canonical dir + `.memory/` symlink.
- [ ] Define the concurrent-write protocol for the shared `index.md` (per-entry fragments or
      read-modify-write) so two worktrees never clobber each other (FR-5).
- [ ] Negative-path coverage: cross-project isolation, worktree-removal-preserves-store, concurrent
      dual-worktree writes.
- [ ] Coordinate with adr-2026-06-29-safe-reversible-memory-migration (existing `.memory/` content is migration, not fresh create) and adr-2026-06-29-memory-resilience-write-fallback-and-reconcile
      (this canonical store is also the write-fallback sink).
