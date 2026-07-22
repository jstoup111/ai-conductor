# ADR: Pipeline Run-State Placement & Cwd-Independent, Per-Feature Durability

**Date:** 2026-07-21
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

<!-- Filename convention: adr-2026-07-21-run-state-home-dir-placement.md (no sequential numbers).
     The ADR's identifier is its filename stem. -->

## Context

Pipeline **run-state** — `.pipeline/conduct-state.json`, `task-status.json`,
`task-evidence.json`, `gates/<step>.json`, session markers (`session-created`,
`conduct-session-id`), `HALT`, and the other per-run artifacts — currently lives **inside
the feature worktree** and is resolved relative to a `projectRoot` that is seeded from
`process.cwd()` on the host path (`index.ts:605-609` eagerly `mkdir`s `join(process.cwd(),
'.pipeline')`) and from the per-worktree `wt.path` on the daemon path (`daemon-cli.ts:760`).
The generated session-hook scripts embed literal `join(process.cwd(), ".pipeline")`
(`session-hook-assets.ts:92,256`) and resolve state by cwd at exec time.

This single structural placement is the shared root cause of a class of state-loss and
"wrong-root" bugs (all 2026-07-11): **#549** (a cwd-relative `rmSync(join(process.cwd(),
'.pipeline'))` in a test wiped a live worktree's run-state, then the conductor crashed on
the missing `session-created` — twice), **#486** (auto-park markers written to the
worktree's `.daemon` instead of the main checkout's → capped features re-dispatch every
sweep), **#534** (park/unpark resolving `.docs/plans` and `.worktrees` relative to cwd →
fail from a subdirectory), plus the general failure that worktree removal takes `.pipeline`
with it. #549 is the interim point-fix (guard writes, scope the deleter); this ADR is the
durable architectural fix that makes the whole class structurally impossible.

**Forces / constraints:**

- The state PERSISTENCE PRIMITIVES are already cwd-clean: `readState(path)` /
  `writeState(path)` (`engine/state.ts:10,69`), `gate-verdicts(dir)` (`engine/gate-verdicts.ts:51`),
  `writeHaltMarker(projectRoot)` (`engine/halt-marker.ts:23`), `task-evidence(projectRoot)`
  (`engine/task-evidence.ts:77`) all take a resolved root and never read `process.cwd()`.
  The coupling is entirely in the CALLERS that construct the root. (VERIFIED, ~95%.)
- A directly analogous relocation already shipped and is APPROVED: the **memory store**
  (`adr-2026-06-29-shared-memory-store-placement-and-durability`) moved `.memory/` out to
  `~/.ai-conductor/memory/<project-key>/harness/` with the in-tree `.memory/` becoming an
  outward **symlink**; `projectKey()` = `sha256(stableIdentity).slice(0,24)` where identity
  is `git remote get-url origin` → `git rev-parse --git-common-dir` → repoPath
  (`memory-store.ts:73-118`, VERIFIED). Writes go **through the resolved store, not the
  symlink**, "so they work even when a worktree's symlink has been removed"
  (`recordMemoryEntry`, `memory-store.ts:279-302`, VERIFIED).
- **Crucial difference from the memory store:** memory is keyed by PROJECT and *shared*
  across all a project's worktrees (branch-independent). Run-state is the opposite — it is
  **per-feature and must NOT be shared**: two concurrent features must have disjoint state.
  The distinguishing key is the feature **slug** (`slugify()`, `engine/worktree.ts:19`),
  already the key for `.worktrees/<slug>`, `feature/<slug>` branches, and `.daemon/parked/<slug>`.
- Feature identity is resolvable wherever run-state is written: from `opts.featureDesc` on
  the host (same `slugify()` that names the worktree) or the worktree directory basename on
  the daemon/resume path. `.gitignore` already ignores `.pipeline/`, so relocating its real
  contents out of tree changes nothing git tracks.

## Options Considered

### Option A: Home-dir store at `~/.ai-conductor/runs/<project-key>/<slug>/`, `.pipeline/` → outward symlink  (CHOSEN)
- **How:** A new `run-state-store.ts` owns one canonical resolver
  `resolveRunStateDir(featureIdentity)` = `join(aiConductorHome(), 'runs', projectKey, slug)`,
  never reading `process.cwd()`. `ensureRunStateStore(worktreePath, identity)` creates the
  store and leaves an outward `.pipeline` symlink in the worktree (idempotent, replace-if-stale,
  never-touch-a-real-dir — the exact `ensureMemoryStore` contract). Engine writes resolve the
  real store directly (write-through). Generated session-hook scripts get the resolved absolute
  store path injected at generation time instead of `process.cwd()`.
- **Pros:** Maximally isolated — state survives worktree removal, a cwd-relative `.pipeline`
  delete (removes only the symlink), and invocation from any directory. Reuses the APPROVED,
  tested memory-store precedent (`projectKey`, outward symlink, write-through). `projectKey`
  namespacing gives cross-project isolation for free; slug gives per-feature isolation.
- **Cons:** Requires a stable feature slug at every write site (confirmed derivable, but must be
  enforced fail-closed — see Consequences); adds a symlink + a migration path for in-flight
  worktrees; depends on `homedir()` resolution (mitigated by a single new `aiConductorHome()`
  helper replacing ~10 inline joins).

### Option B: Main-checkout-root store at `<main-root>/.daemon/runs/<slug>/` (park-marker precedent)
- **How:** Resolve the main checkout via `git rev-parse --git-common-dir` (the shipped #486
  `resolveMainRepoRoot`), key by slug, co-locate with the daemon's other per-feature state.
- **Pros:** Reuses proven in-repo machinery; no symlink; auto-namespaces per project; survives
  worktree removal and cwd-relative rm inside a worktree.
- **Cons:** State still lives inside the main checkout tree — a deliberate `rm -rf` at main root
  reaches it, and it would be a *second* relocation idiom alongside the memory store's home-dir
  one. Rejected in favor of a single, maximally-isolated, precedent-consistent convention.

### Option C: Resolver-only refactor (canonical door, storage stays in the worktree)
- **Cons:** Does not satisfy the durability requirement ("survives worktree removal") on its
  own — state still dies with the worktree. Only a stepping stone. Its single-resolver mechanism
  is **folded into Option A** (introduce the door AND point it at the home store), so it is not
  a standalone option.

## Decision

Adopt **Option A**. Introduce `run-state-store.ts` as the single owner of run-state location:

1. **Canonical base helper** `aiConductorHome()` returning `join(resolveHome(), '.ai-conductor')`
   (env-injectable `HOME`, mirroring `memory-store.resolveHome`), replacing the ~10 inline
   `homedir()`/`.ai-conductor` joins over time (this ADR requires it for run-state; broader
   adoption is follow-up, non-blocking).
2. **Resolver** `resolveRunStateDir(identity: FeatureIdentity)` = `join(aiConductorHome(),
   'runs', identity.projectKey, identity.slug)`. `FeatureIdentity` is a parsed value object
   `{ projectKey, slug }` constructed once at the boundary (parse-don't-validate), not raw
   strings threaded around. The resolver **never** reads `process.cwd()`.
3. **Ensure + symlink** `ensureRunStateStore(worktreePath, identity)` — `mkdir -p` the store,
   then create/repair an outward `.pipeline` symlink in the worktree using the exact
   `ensureMemoryStore` rules (leave a correct symlink; replace a stale one; never touch a real
   directory). Engine/CLI writes resolve the store path directly (write-through), so they work
   even if the symlink is gone.
4. **Hook scripts** — inject the resolved absolute store path into the generated
   `session-hook-assets` scripts at generation time; remove the literal `process.cwd()`.
5. **Migration** `migrateInTreePipelineIfPresent(worktreePath, identity)` — on first resolve for
   an in-flight worktree whose `.pipeline` is still a real directory, move its contents into the
   store and replace it with the symlink (mirrors the memory-store real-dir → migrate handling).
6. **Cleanup** `removeRunStateDir(identity)` removes exactly `runs/<project-key>/<slug>` — one
   feature's state, nothing else.

Chosen because it reuses an already-APPROVED, already-tested placement/durability pattern; makes
the whole cwd/worktree state-loss class structurally impossible (state is addressed by feature
identity from anywhere); and keeps a single home-dir convention for out-of-worktree harness state.

## Consequences

### Positive
- Run-state survives worktree removal, a cwd-relative `.pipeline` delete, and invocation from any
  directory — the exact observable acceptance signal in the intake's desired outcome.
- No engine/CLI code resolves "which run-state" by `process.cwd()`; one canonical resolver.
- The #486/#534 root/worktree-ambiguity shape cannot recur for run-state.
- Cross-project isolation (projectKey) and per-feature isolation (slug) are structural; concurrent
  features cannot collide.

### Negative
- A slug must be resolvable at every run-state write site. **Enforced fail-closed:** if no feature
  identity is resolvable, the resolver raises an explicit error — it MUST NOT fall back to a
  cwd-relative path (that would silently reintroduce the bug). The plan must enumerate every write
  entry point and prove an identity is available at each.
- One-time migration cost for in-flight worktrees; a bug there could strand state (mitigated by
  reusing the tested memory-store migration shape and a migration regression test).
- Symlink semantics are platform-dependent (WSL/Linux here — the memory store already relies on
  them, so no new platform risk).

### Follow-up Actions
- [ ] Add `aiConductorHome()` and adopt it for run-state (broader inline-join replacement is
      follow-up).
- [ ] Implement `resolveRunStateDir` / `ensureRunStateStore` / `removeRunStateDir` /
      `migrateInTreePipelineIfPresent` in `run-state-store.ts`.
- [ ] Rewire `index.ts` host seed + resume reassignments, `daemon-cli.ts:760`, `resume.ts`,
      `auto-resume.ts`, `finish-record-cli.ts`, `daemon-dashboard.ts` to the resolver.
- [ ] Inject the resolved store path into generated `session-hook-assets` scripts.
- [ ] Fail-closed identity guard + a regression test for each of: worktree removal, cwd-relative
      `.pipeline` delete, two concurrent features, and per-slug cleanup.
