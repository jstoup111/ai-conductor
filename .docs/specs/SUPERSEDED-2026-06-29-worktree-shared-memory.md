# PRD: Worktree-Shared Memory — Phase 1 (share + install + migrate)

**Date:** 2026-06-29
**Status:** Draft

> **Delivery:** Phase 1 ships the worktree-shared-memory *mechanism* harness-wide (generic
> post-checkout hook, `bin/install` wiring, untrack + migration of `.memory`/`.serena`, shared
> store layout). The formal **`memory` plugin kind** (registry, config selection, alternate
> backends like SQLite/service) is **Phase 2** — a separate conduct pass that plugs backends into
> the store layout this phase establishes. The two phases ship as separate PRs.

## Problem / Background

Git worktrees do not share **gitignored** state, and **tracked** state is branch-isolated. Memory
written while working in a worktree is therefore either lost or invisible to sibling worktrees:

1. **Serena (`.serena/memories`) is gitignored** → each worktree gets its own copy, **lost** when
   the worktree is removed. (Confirmed: `.serena` is gitignored repo-wide.)
2. **The harness `.memory/` is git-tracked** in consumer projects (e.g. `honeydew-or-handymando`
   commits `.memory/decisions/*`, `.memory/gotchas/*`) → not lost, but **branch-isolated**: memory
   written in a feature-branch worktree is visible elsewhere only after that worktree's PR merges.

This affects **any project that uses the harness (ai-conductor)**, not just this repo. The harness's
heavy multi-worktree workflow makes it acute: an operator running several concurrent worktrees wants
one shared, immediately-visible memory set, and wants memory to survive routine worktree cleanup.

A project-agnostic reference hook (symlinking `.serena/memories` to a canonical per-project store)
was prototyped locally in this repo and verified (a memory written in a throwaway worktree survived
removal). This feature formalizes that into a durable, harness-installed, project-agnostic capability
and extends it to `.memory/`.

## Goals & Non-Goals

**Goals**
- Memory written in **any** worktree of a harness project is **immediately visible** in every other
  worktree of that project and **survives worktree removal** — for both `.serena/memories` and
  `.memory/`.
- Applies to **every project the harness is installed into**, automatically, including worktrees
  created by plain `git worktree add` (not only the orchestration code).
- Existing consumer projects that **track** `.memory/` are migrated safely (no data loss, reversible).
- New (greenfield) projects are configured correctly from bootstrap — no migration needed.

**Non-Goals (Phase 2 or out)**
- The `memory` **plugin kind** + registry + config-driven backend selection + alternate backends
  (SQLite, remote service). Phase 1 establishes the store layout; Phase 2 makes it pluggable.
- Sharing `.serena/cache` (LSP index — regenerated, correctly per-worktree).
- Cross-machine sync of the shared store (the store is local; git hooks are inherently per-clone —
  see Key Decision 1).
- Changing the **global** auto-memory at `~/.claude/projects/.../memory/` (already path-keyed and
  persistent; out of scope).

## Users / Personas

- **Harness operator (James)** — runs many concurrent worktrees per project; wants one shared memory
  set that persists across worktree churn and is visible without waiting for a merge.
- **Harness installer (`bin/install`)** — must deliver the hook to every project, idempotently,
  without clobbering existing git hooks.
- **Consumer project** — any repo using the harness, whether it currently tracks `.memory/` or not.

## Functional Requirements

### Hook (the sharing mechanism)
- **FR-1:** A project-agnostic `post-checkout` git hook, when executed inside a **linked worktree**,
  symlinks both `.serena/memories` and `.memory` in that worktree to the canonical per-project store
  (`~/.ai-conductor/memory/<key>/serena` and `~/.ai-conductor/memory/<key>/harness`). In the **main**
  worktree the hook is a no-op (it does not symlink the main checkout's dirs).
- **FR-2:** The hook detects a linked worktree by comparing `git rev-parse --absolute-git-dir` to
  `--git-common-dir` (differ ⇒ linked). `<key>` is the **main worktree absolute path** with `/`→`-`
  (path-keyed ⇒ collision-free across projects with the same basename).
- **FR-3 (no data loss):** If a symlink target already exists as a **real directory** (not a
  symlink), its contents are merged into the store with no-overwrite (`cp -n`) **before** the dir is
  replaced by the symlink. An already-correct symlink is left untouched (idempotent).
- **FR-4 (fires on every worktree creation):** The hook runs on `git worktree add` (post-checkout
  fires), so manually-created worktrees are covered, not just orchestration-created ones.

### Install / delivery
- **FR-5:** `bin/install` installs the hook at `<repo>/.git/hooks/post-checkout` for the project it
  installs into, idempotently. The hook script body lives in the harness (e.g. `hooks/git/`) and is
  copied/symlinked, mirroring how Claude hooks are wired today.
- **FR-6 (chain, don't clobber):** If a non-harness `post-checkout` hook already exists, `bin/install`
  MUST NOT silently overwrite it — it chains (invokes the pre-existing hook) or warns and skips, never
  destroys operator hooks.
- **FR-7 (backfill):** On install, existing worktrees of the repo are backfilled — their
  `.serena/memories` and `.memory` are migrated-and-symlinked to the store (same safe logic as FR-3).

### Migration of existing tracked `.memory/`
- **FR-8:** A `## Migration` bash block (run by `bin/migrate` on update past this version) converts a
  consumer project's **tracked** `.memory/` to untracked+shared, in this safe order: (1) seed the
  store (`cp -n .memory/. <store>/harness/`); (2) create a one-time archive tag
  `pre-memory-untrack-<date>`; (3) `git rm -r --cached .memory`; (4) add `.memory/` and `.serena/` to
  `.gitignore`; (5) symlink `.memory` → store. Reversible via the tag; git history retains the files.
- **FR-9 (abort-before-destroy):** If the seed copy (step 1) fails (store unwritable, disk full), the
  migration ABORTS before `git rm` — never untrack without a completed safe copy.
- **FR-10 (idempotent / no-op safety):** The migration is a **no-op with a clear message** when
  `.memory/` is already untracked/gitignored, already a symlink, or absent. It never errors on a
  project that doesn't use `.memory/`.

### Greenfield + harness integrity
- **FR-11:** Bootstrap/templates gitignore `.serena/` and `.memory/` for **new** projects so they are
  untracked from creation (no migration needed); the hook + install wire the symlinks.
- **FR-12:** `test/test_harness_integrity.sh` stays green; the new hook script passes `bash -n`
  (extend the script-syntax check to cover `hooks/git/`).

## Non-Functional Requirements
- **Idempotent & safe:** every operation (hook, install, migration) is re-runnable; destructive steps
  are gated behind a completed safe copy (FR-3, FR-9).
- **Project-agnostic:** no hardcoded project name; keyed by path (FR-2).
- **Non-destructive to operator config:** never clobber a pre-existing git hook (FR-6).
- **Delivered like existing hooks:** installer-delivered (not committed to consumer repos), consistent
  with how Claude hooks are wired — accepts that hooks are re-established per clone by `bin/install`.

## Acceptance Criteria / Success Metrics
- After `bin/install` in a project, creating a worktree with `git worktree add` yields a worktree whose
  `.serena/memories` and `.memory` are symlinks to `~/.ai-conductor/memory/<key>/{serena,harness}`; a
  memory written there is visible in a sibling worktree and **survives `git worktree remove`**.
- Running the migration on a project that tracks `.memory/` leaves: an archive tag present, `.memory`
  gitignored + symlinked, the store seeded with the prior contents, and `git status` clean of tracked
  `.memory` files — with **zero** memory entries lost.
- Re-running install/migration is a clean no-op. A project without `.memory/` migrates to a no-op.
- An existing operator `post-checkout` hook is preserved (chained), not destroyed.
- `test/test_harness_integrity.sh` green.

## Scope

### In Scope (Phase 1, this PR)
- Generic `post-checkout` hook script (`hooks/git/post-checkout`), `bin/install` wiring + backfill,
  `## Migration` block, bootstrap/template gitignore updates, store layout
  `~/.ai-conductor/memory/<key>/{serena,harness}`, integrity-check extension, README + CHANGELOG.

### Out of Scope (Phase 2 / later)
- `memory` PluginKind, registry, `~/.ai-conductor/config.yml` backend selection, alternate backends.
- `.serena/cache` sharing; cross-machine store sync.

## Key Decisions & Rationale
1. **Git `post-checkout` hook is the mechanism (not the orchestration code).** It fires on *all*
   worktree creation including manual `git worktree add`, where conductor/daemon code does not. Hooks
   are per-clone (not version-controlled), so `bin/install` delivers them per-project — exactly how the
   harness already delivers Claude Code hooks. "Harness-wide" = "installed wherever the harness is."
2. **Path-keyed store under `~/.ai-conductor/`.** Reuses the product's established user dir (alongside
   `~/.ai-conductor/config.yml`); path key is collision-free and stable across a repo's worktrees.
3. **Share both `.serena/memories` and `.memory`; `.memory` must be untracked first.** Symlinking a
   tracked dir would break git tracking — hence the migration. Greenfield projects gitignore from the
   start (FR-11).
4. **Migration is seed → tag → untrack (operator-chosen safest path).** Reversible via the archive
   tag; abort-before-destroy (FR-9) guarantees no untrack without a safe copy.
5. **Phase 1 keeps the backend implicit.** Only the symlink-share mechanism + the
   `<key>/{serena,harness}` store layout ship now, so Phase 2 can introduce the `memory` plugin kind
   and alternate backends without relocating any data.
6. **Chain, never clobber, existing git hooks (FR-6).** Operators may have their own `post-checkout`.

## Dependencies
- `bin/install` (current: installs Claude hooks + skill symlinks; no git hooks yet) — the delivery seam.
- `bin/migrate` + the `## Migration` block convention (CLAUDE.md release gates).
- `test/test_harness_integrity.sh` (extend script-syntax coverage to `hooks/git/`).
- Bootstrap/templates (gitignore for greenfield).
- Coexists with the OTel feature's use of `~/.ai-conductor/` (config) — no conflict (distinct subdir).

## Open Questions
- **Phase 2:** the `memory` backend interface (read/write/list), the PluginKind + registry
  registration, and config selection (`memory_backend:` in `~/.ai-conductor/config.yml`). Deferred;
  does not block Phase 1.
- **Hook chaining mechanics (FR-6):** simplest robust form — wrap an existing `post-checkout` by
  renaming it and calling it, vs. appending. Resolve in architecture-review/plan.
