# PRD: Pluggable Memory Backend (harness `/memory`)

**Date:** 2026-06-29
**Status:** Draft

> **Supersedes** `SUPERSEDED-2026-06-29-worktree-shared-memory.md`. That draft framed the problem as
> "symlink memory dirs across worktrees." The operator reframed it: the real feature is a **pluggable
> memory backend** (local file, vector SQLite, mem0). Worktree-sharing is no longer the feature — it
> is a *property of where the chosen backend stores*, and is solved for free by the default backend's
> placement. **Serena's** worktree-sharing is a separate, decoupled shim (out of scope here — see
> Non-Goals); the local prototype hook already in place covers it for now.

> **Delivery (phased, separate PRs):** Phase 1 = the `MemoryBackend` seam + the default **local-file**
> backend + the `conduct memory` CLI + routing the harness through it + migration. Phase 2 = **vector
> SQLite** backend. Phase 3 = **mem0** backend. Each later backend plugs into the Phase 1 seam without
> touching call sites.

## Problem / Background

The harness's memory is a fixed local-file store, accessed three different ways with no abstraction:
- the Markdown **`/memory` skill** (Claude reads/writes categorized files under `.memory/`),
- **`bin/conduct`** (bash; reads `.memory/index.md`, `git add .memory/`),
- **bootstrap** (seeds `.memory/`, writes `.memory/index.md`).

Two limitations follow:
1. **No semantic recall.** Recall is "read the index + grep." As memory grows, relevant-entry
   retrieval degrades. Modern memory stores (vector DBs, mem0) do relevance search — the harness
   can't use them because memory access is hardcoded to flat files.
2. **Storage is tied to the repo working tree.** `.memory/` is git-tracked and lives in the working
   copy, so it is branch-isolated across worktrees and entangled with the repo. There is no way to
   point memory at a shared store, a local database, or an external service.

The operator wants memory to be **pluggable**: the store engine is swappable by config — **local
file** (default), **vector SQLite** (semantic, local), or **mem0** (semantic, external/hosted) —
behind one interface, the same way `llm_provider` and `ui_renderer` are already pluggable.

## Goals & Non-Goals

**Goals**
- A single **`MemoryBackend` interface** with `add` / `search` / `list` / `delete`, selected by config
  (`memory_backend:` in `~/.ai-conductor/config.yml`), registered as a `memory` plugin kind.
- A uniform **`conduct memory` CLI** (`add|search|list|delete`) that the Markdown `/memory` skill,
  `bin/conduct`, and bootstrap all call — so no consumer touches the store directly and every backend
  works for all three.
- **Semantic recall as a first-class operation** (`search(query)` → ranked entries), so vector/mem0
  backends deliver relevance, while the file backend implements `search` as keyword/index scan.
- A default **local-file backend** that stores at a **resolved shared per-project path**, which makes
  harness memory **survive worktree removal and be visible across sibling worktrees** — the original
  pain, now a property of placement, not a symlink hack.
- Safe **migration** of existing tracked `.memory/` to the backend store (seed → archive tag →
  untrack), reversible, no data loss.

**Non-Goals**
- **Serena memory worktree-sharing** — separate decoupled effort (Serena is an external MCP tool with
  its own store; it cannot write to a harness backend). The existing local prototype hook covers it;
  productizing it is its own small PR.
- The **vector-SQLite** and **mem0** backends themselves — Phase 2 / Phase 3 (this PRD defines the
  seam they plug into and the file backend only).
- Changing the **global** Claude auto-memory (`~/.claude/projects/.../memory/`) — separate system.
- Embedding-model selection / RAG tuning — belongs to the Phase 2 vector backend.

## Users / Personas
- **Harness operator (James)** — wants to choose where harness memory lives (file now, sqlite/mem0
  later) and get relevant recall, with memory shared across a project's worktrees.
- **`/memory` skill + `conduct` + bootstrap** — consumers that must keep working unchanged in behavior
  while their storage access is routed through the new CLI/backend.
- **Backend authors (incl. future)** — implement `MemoryBackend` once; the harness picks it up via the
  registry, no call-site changes.

## Functional Requirements

### The seam
- **FR-1:** A `MemoryBackend` interface in `src/conductor` defines `add(entry)`, `search(query, scope)
  → ranked entries`, `list(scope)`, `delete(id)`, where an entry carries content, a `scope`
  (project + category: decisions/gotchas/feedback/…), and metadata (timestamp, source). Registered as
  a new `memory` **PluginKind** in the registry/loader (alongside llm_provider/ui_renderer/visualizer).
- **FR-2:** Backend is selected by config `memory_backend:` (default `file`) from
  `~/.ai-conductor/config.yml` merged with project `.ai-conductor/config.yml`, exactly like the
  existing `llm_provider`/`ui_renderer` resolution. An unknown value fails closed with a named error
  and falls back to `file` (never crashes a run).

### The uniform access point
- **FR-3:** A `conduct memory` CLI subcommand exposes `add`, `search`, `list`, `delete`, routing to the
  configured backend. It is the ONLY sanctioned way the harness reads/writes memory.
- **FR-4:** The Markdown `/memory` skill is rewritten to call `conduct memory add|search|list` instead
  of writing `.memory/` files directly; recall-before-act uses `search`. `bin/conduct` and bootstrap
  read/seed memory via the CLI, not by touching `.memory/` files.
- **FR-5 (no direct store access remains):** After this change, grep shows **zero** non-test
  production reads/writes of `.memory/` paths outside the file backend itself (closes the
  "two code paths" / orphaned-access risk).

### The default file backend
- **FR-6:** `FileMemoryBackend` stores Markdown entries at a **resolved shared per-project path**
  (`~/.ai-conductor/memory/<project-key>/harness/`, key = main-worktree absolute path `/`→`-`). It
  implements `add` (write categorized file + update an index), `list` (scope scan), `search` (keyword
  / index match, ranked by simple relevance), `delete`.
- **FR-7 (worktree-sharing falls out):** Because the file backend's path is the shared per-project
  store (not the working tree), memory written in any worktree is immediately visible in sibling
  worktrees and **survives worktree removal**. Verified end-to-end.
- **FR-8 (parity):** The file backend preserves today's category structure and `index.md` semantics so
  existing `/memory` and `conduct` behavior is unchanged from the user's perspective (same recall,
  same categories) — only the location and access path change.

### Migration + greenfield
- **FR-9:** A `## Migration` bash block (run by `bin/migrate`) converts a project's tracked `.memory/`:
  seed the file-backend store (`cp -n`), create archive tag `pre-memory-untrack-<date>`,
  `git rm -r --cached .memory`, gitignore `.memory/`, **then** the CLI/backend reads from the shared
  store. Abort-before-destroy if the seed fails (FR-9a). No-op + clear message if `.memory/` is absent
  or already migrated (FR-9b).
- **FR-10:** Bootstrap/templates configure new projects for the `file` backend and gitignore `.memory/`
  from creation — greenfield needs no migration.

### Harness integrity
- **FR-11:** `test/test_harness_integrity.sh` stays green; new TS modules build (`npm run build`); the
  new CLI subcommand and backend have unit + integration tests; a config-absent run defaults to `file`
  and behaves identically to today (regression).

## Non-Functional Requirements
- **Backend-agnostic call sites:** `/memory`, `conduct`, bootstrap depend only on the CLI/interface —
  swapping backends touches no call site (FR-2/FR-4).
- **Fail-safe:** unknown/misconfigured backend → named error + `file` fallback; backend errors never
  crash a conduct run (memory is best-effort, like the OTel exporter).
- **No data loss:** migration is seed→tag→untrack with abort-before-destroy (FR-9a).
- **Search contract is uniform:** callers get ranked entries regardless of backend; the file backend's
  keyword ranking and a vector backend's semantic ranking satisfy the same `search` signature.

## Acceptance Criteria / Success Metrics
- `conduct memory add/search/list/delete` works against the `file` backend; `/memory`, `conduct`, and
  bootstrap use it exclusively (FR-5 grep is clean).
- With `memory_backend` unset, behavior matches today (same categories, same recall) and memory now
  lives in the shared store — visible across worktrees and surviving removal (FR-7 test).
- Migration on a tracked-`.memory/` project: archive tag present, `.memory` gitignored, store seeded,
  zero entries lost, `git status` clean; re-run is a no-op; a project without `.memory/` no-ops.
- Misconfigured `memory_backend` → named error + file fallback, run continues.
- `test/test_harness_integrity.sh` green; `npm run build` clean.

## Scope
### In Scope (Phase 1)
- `MemoryBackend` interface + `memory` PluginKind + registry/config selection.
- `conduct memory` CLI; rewrite `/memory` skill, `bin/conduct`, bootstrap to use it.
- `FileMemoryBackend` at the shared per-project path (delivers worktree-sharing).
- Migration block + greenfield gitignore; tests; README + CHANGELOG; VERSION approval.

### Out of Scope (later)
- **Phase 2:** `SqliteVecMemoryBackend` (embeddings, semantic search, model choice).
- **Phase 3:** `Mem0MemoryBackend` (external service, auth, scoping).
- Serena worktree-share shim (separate small effort; prototype already local).

## Key Decisions & Rationale
1. **Pluggable = swap the store engine, behind one `MemoryBackend` interface**, selected by config like
   `llm_provider`/`ui_renderer`. The three target engines (file / sqlite-vec / mem0) share `add /
   search / list / delete`; `search` is first-class so semantic backends are real plugs, not bolt-ons.
2. **A `conduct memory` CLI is the uniform access point.** Memory is touched by a Markdown skill, bash,
   and TS — only a CLI gives all three one backend-agnostic surface. Without it, sqlite/mem0 are
   impossible (a Markdown skill can't speak SQL or the mem0 API; it can call a CLI).
3. **Worktree-sharing is demoted to a placement property.** The file backend stores at the shared
   per-project path, so sharing/persistence fall out — no symlink, no git hook for harness memory. The
   symlink+hook approach is dropped for `.memory` (it was the wrong layer: the harness owns the path).
4. **Serena stays separate.** It is external (MCP) with its own store; it can't be a `MemoryBackend`.
   Forcing it through the abstraction would be a brittle sync layer. Decoupled by design.
5. **Phased backends.** Phase 1 ships the seam + file backend (correct foundation + the immediate
   worktree-sharing win); sqlite-vec and mem0 plug in later with zero call-site change.
6. **Fail-safe, like the OTel exporter.** Memory is best-effort: misconfig → file fallback; backend
   errors never crash a run.

## Dependencies
- Plugin loader/registry + config resolution (`src/conductor`, existing).
- `conduct`/`conduct-ts` CLI surface (new `memory` subcommand).
- `bin/migrate` + `## Migration` convention; bootstrap/templates; `test_harness_integrity.sh`.
- Phase 2/3 only: an embeddings/sqlite-vec dependency; the mem0 SDK/API + credentials.

## Open Questions
- **Search semantics for the file backend (FR-6):** how rich should keyword ranking be (substring/
  index vs. simple TF) so it's a useful `search` without reimplementing a search engine? Resolve in
  architecture-review/plan.
- **CLI vs. in-process for the TS callers:** `bin/conduct` (bash) and the Markdown skill clearly need
  the CLI; TS conductor code could call the backend in-process. Pick one path (likely: everything via
  the CLI for uniformity) in architecture-review.
- **Scope/category taxonomy** carried in `add`/`search` — reuse today's `decisions|gotchas|feedback|…`
  exactly, or generalize? Lean: reuse as-is for parity (FR-8).
- **Phase 2/3 backend contracts** (embedding model, mem0 scoping/auth) — deferred.
