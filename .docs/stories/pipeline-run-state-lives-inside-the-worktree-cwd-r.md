**Status:** Accepted

# Stories: Relocate pipeline run-state to a home-dir store (#564)

Technical track (no PRD). Acceptance criteria derive from the technical intent and the APPROVED
`adr-2026-07-21-run-state-home-dir-placement` (+ its 4 conditions). "Run-state" = the `.pipeline/`
artifacts: `conduct-state.json`, `task-status.json`, `task-evidence.json`, `gates/<step>.json`,
session markers (`session-created`, `conduct-session-id`), `HALT`, and the other per-run files.
Technical requirement tags: **TR-1 … TR-10**.

---

## Story: Run-state directory is resolved by feature identity, never by cwd

**Requirement:** TR-1

As the conductor engine, I want the run-state directory resolved from a feature identity
`{projectKey, slug}` so that the same feature's state is found from any working directory.

### Acceptance Criteria

#### Happy Path
- Given a feature with slug `s` in a project whose `projectKey` is `k`, when `resolveRunStateDir({projectKey:k, slug:s})` is called with any `process.cwd()`, then it returns `<home>/.ai-conductor/runs/k/s` and the return value does not vary with cwd.
- Given the process is invoked from a nested subdirectory of the worktree, when run-state is read, then it reads the same directory as when invoked from the worktree root.

#### Negative Paths
- Given `process.cwd()` is changed between two resolve calls for the same identity, when both resolve, then they return the identical absolute path (cwd has no effect).
- Given a caller passes an identity whose `slug` contains path separators or `..`, when `resolveRunStateDir` runs, then it rejects the identity (slug must match the `slugify` charset `[a-z0-9-]`) rather than escaping the `runs/` root.
- Given `HOME` is unset, when resolution runs, then it falls back through `USERPROFILE`/`homedir()` deterministically (same rule as `memory-store.resolveHome`) and never resolves to a relative path.

### Done When
- [ ] `resolveRunStateDir(identity)` exists in `run-state-store.ts`, returns `join(aiConductorHome(),'runs',projectKey,slug)`, and contains no reference to `process.cwd()`.
- [ ] A test asserts identical output for two calls made with different `process.cwd()` values.
- [ ] A test asserts a slug outside `[a-z0-9-]` is rejected (no path traversal).

---

## Story: A canonical `aiConductorHome()` base helper backs the store path

**Requirement:** TR-2

As a maintainer, I want a single `aiConductorHome()` helper so run-state does not add another
inline `homedir()`/`.ai-conductor` join.

### Acceptance Criteria

#### Happy Path
- Given `HOME=/tmp/h`, when `aiConductorHome()` is called, then it returns `/tmp/h/.ai-conductor`.
- Given the resolver builds the store path, when it needs the base, then it calls `aiConductorHome()` (not an inline join).

#### Negative Paths
- Given `HOME` is unset but `USERPROFILE` is set, when `aiConductorHome()` runs, then it uses `USERPROFILE` (parity with `memory-store.resolveHome`).
- Given neither `HOME` nor `USERPROFILE` is set, when it runs, then it uses `os.homedir()` and never returns an empty or relative string.

### Done When
- [ ] `aiConductorHome()` is exported and env-injectable (reads `process.env.HOME`/`USERPROFILE`).
- [ ] `resolveRunStateDir` uses it; a test with an injected `HOME` confirms the composed path.

---

## Story: Ensure-store creates the store and an idempotent outward `.pipeline` symlink

**Requirement:** TR-3

As the run-start path, I want `ensureRunStateStore(worktreePath, identity)` to create the store
and leave an outward `.pipeline` symlink in the worktree, following the `ensureMemoryStore` rules.

### Acceptance Criteria

#### Happy Path
- Given no store yet, when `ensureRunStateStore` runs, then `<home>/.ai-conductor/runs/k/s` is created and `<worktree>/.pipeline` is a symlink pointing to it.
- Given the `.pipeline` symlink already points at the correct store, when `ensureRunStateStore` runs again, then it is a no-op (idempotent, symlink unchanged).

#### Negative Paths
- Given `.pipeline` is a symlink pointing at a STALE store (different prior target), when `ensureRunStateStore` runs, then the stale symlink is replaced with one pointing at the correct store.
- Given `.pipeline` is a REAL directory (pre-migration in-flight worktree), when `ensureRunStateStore` runs, then it does NOT clobber the directory — it triggers migration (TR-8) instead.
- Given the store directory already exists with prior content, when `ensureRunStateStore` runs, then existing content is preserved (mkdir is `recursive`, non-destructive).

### Done When
- [ ] `ensureRunStateStore` creates the store dir and a correct outward symlink.
- [ ] Tests cover: fresh create, idempotent re-run, stale-symlink replacement, real-dir-not-clobbered.

---

## Story: Writes reach the real store even when the worktree symlink is gone (write-through)

**Requirement:** TR-4

As the engine, I want state writes to resolve the real store directly so a run's state is durable
even if the `.pipeline` symlink has been removed mid-run.

### Acceptance Criteria

#### Happy Path
- Given a resolved store path, when the engine writes `conduct-state.json` / a gate verdict / `HALT`, then the bytes land in `<home>/.ai-conductor/runs/k/s/...` (resolved directly, not via the symlink).

#### Negative Paths
- Given the `.pipeline` symlink in the worktree has been deleted, when the engine writes state, then the write still succeeds against the real store (write-through), matching `recordMemoryEntry`'s contract.
- Given the store directory was removed underneath a long-running process, when the next write occurs, then the store is recreated (guarded write) and a warning is logged rather than the loop crashing (the #549 crash mode does not recur).

### Done When
- [ ] Engine write paths resolve the store via identity, not by reading `.pipeline` through the worktree.
- [ ] A test deletes the `.pipeline` symlink, performs a write, and asserts it lands in the real store.

---

## Story: A run survives worktree removal and resumes from its state

**Requirement:** TR-5

As an operator, I want to remove a feature's worktree and still resume the build, so worktree
cleanup never destroys run-state.

### Acceptance Criteria

#### Happy Path
- Given a feature mid-build with committed run-state, when its worktree is removed and later recreated from the branch, when I resume, then the conductor reads the existing `conduct-state.json` and resumes at the last recorded step (no finished task is redone).

#### Negative Paths
- Given the worktree is removed, when I inspect the home store, then `runs/k/s` and its `conduct-state.json` are intact (removal took only the symlink).
- Given the worktree is recreated, when `ensureRunStateStore` runs, then the outward `.pipeline` symlink is re-established pointing at the surviving store.
- Given a feature was never built (no store), when its (empty) worktree is removed, then no error is raised and no phantom store is created.

### Done When
- [ ] An acceptance test removes a worktree, recreates it, resumes, and asserts the run continues from the persisted step.
- [ ] The test asserts the store survived worktree removal.

---

## Story: A run survives a cwd-relative `.pipeline` delete and resumes

**Requirement:** TR-6

As a maintainer, I want a stray cwd-relative `rm` of `.pipeline` (the #549 shape) to be
non-destructive to run-state.

### Acceptance Criteria

#### Happy Path
- Given a live run, when `rmSync(join(process.cwd(), '.pipeline'), {recursive:true, force:true})` executes in the worktree, then only the symlink is removed and the real store is untouched, and the run resumes from its state.

#### Negative Paths
- Given the delete followed the symlink is NOT possible (fs removes the link, not the target), when the store is inspected after the delete, then all run-state files are present.
- Given the engine writes after the delete, when the write occurs, then it recreates/repairs the symlink or write-through succeeds, and the conductor does not crash on a missing `session-created` (the specific #549 failure).

### Done When
- [ ] A regression test reproduces the #549 cwd-relative delete and asserts run-state survives and the run resumes.

---

## Story: Missing feature identity fails closed — never a cwd fallback

**Requirement:** TR-7

As a maintainer, I want any run-state write path with no resolvable feature identity to raise an
explicit error rather than silently writing to a cwd-relative path.

### Acceptance Criteria

#### Happy Path
- Given every enumerated run-state write entry point (host seed, resume, daemon per-worktree, finish-record, dashboard read), when it resolves run-state, then a `FeatureIdentity` is available and used.

#### Negative Paths
- Given a code path attempts to resolve run-state with neither a `featureDesc` nor a worktree-derivable slug, when resolution runs, then it raises an explicit error naming the missing identity and does NOT fall back to `join(process.cwd(), '.pipeline')`.
- Given a bare `conduct` status/dashboard invocation with no feature, when it runs, then it performs reads only and creates no run-state store (no eager `mkdir` of a cwd `.pipeline`).

### Done When
- [ ] The plan enumerates every run-state write entry point; each has a proven identity source (documented in the plan's Wired-into notes).
- [ ] A test asserts an identity-less resolve raises rather than returning a cwd path.
- [ ] The eager `mkdir(join(process.cwd(),'.pipeline'))` at the host seed is removed/gated behind identity resolution.

---

## Story: In-flight worktrees migrate their real `.pipeline` into the store without loss

**Requirement:** TR-8

As an operator upgrading mid-build, I want an existing real `.pipeline` directory relocated into
the home store without losing any run-state.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose `.pipeline` is a real directory with `conduct-state.json`, gates, and evidence, when `ensureRunStateStore` first runs post-upgrade, then all contents are moved into `<home>/.ai-conductor/runs/k/s` and `.pipeline` becomes an outward symlink, with every file present and byte-identical.

#### Negative Paths
- Given migration is interrupted (process killed mid-move), when it re-runs, then it completes idempotently without duplicating or dropping files (resumable/safe re-entry).
- Given the store already exists AND the worktree still has a real `.pipeline` (conflicting state), when migration runs, then it resolves deterministically (defined precedence) and never silently discards state — surfacing a warning if a conflict is detected.
- Given `.pipeline` is already a correct symlink, when migration is checked, then it is a no-op (nothing to migrate).

### Done When
- [ ] `migrateInTreePipelineIfPresent` moves a real `.pipeline` into the store loss-free and replaces it with a symlink.
- [ ] A migration regression test asserts every file survives with identical content; an interrupted-then-rerun test asserts idempotency.

---

## Story: Generated session-hook scripts resolve the store by injected path, not cwd

**Requirement:** TR-9

As the hook generator, I want the emitted session-hook scripts to reference the resolved absolute
store path so hooks stop resolving `.pipeline` by `process.cwd()`.

### Acceptance Criteria

#### Happy Path
- Given a worktree with a resolved store, when session-hook scripts are generated, then the emitted script source contains the resolved absolute store path (or reads it from an injected env/anchor), and the hooks write run-state there when executed by the Claude subprocess.

#### Negative Paths
- Given the emitted hook source is inspected, when scanned, then it contains no `join(process.cwd(), ".pipeline")` (or equivalent cwd-derived `.pipeline` resolution).
- Given a hook runs with the subprocess cwd set to a nested subdirectory, when it writes a marker, then the marker lands in the correct store (not a cwd-relative `.pipeline`).

### Done When
- [ ] `session-hook-assets` generation injects the resolved store path; a test asserts no `process.cwd()`-based `.pipeline` resolution remains in emitted hook source.
- [ ] A hook executed from a nested cwd writes to the correct store.

---

## Story: Concurrent features keep disjoint state; per-slug cleanup removes exactly one feature

**Requirement:** TR-10

As the daemon running multiple features, I want each feature's state isolated by slug and cleanup
scoped to a single feature, so features never collide and teardown never over-deletes.

### Acceptance Criteria

#### Happy Path
- Given two concurrent features with slugs `s1` and `s2` in the same project, when both write run-state, then they write to `runs/k/s1` and `runs/k/s2` respectively — disjoint, no shared files.
- Given feature `s1` finishes, when `removeRunStateDir({projectKey:k, slug:s1})` runs, then `runs/k/s1` is removed and `runs/k/s2` is untouched.

#### Negative Paths
- Given the same slug in two DIFFERENT projects (distinct `projectKey`), when both write, then `runs/k1/s` and `runs/k2/s` stay isolated (cross-project isolation).
- Given `removeRunStateDir` is called for a slug that has no store, when it runs, then it is a safe no-op (idempotent), not an error.
- Given `removeRunStateDir` is somehow passed an empty/invalid slug, when it runs, then it refuses (never removes the whole `runs/k` or `runs/` tree).

### Done When
- [ ] A test runs two concurrent slugs and asserts disjoint store dirs.
- [ ] A test asserts per-slug cleanup removes exactly one feature's store and leaves siblings intact.
- [ ] A test asserts an empty/invalid slug is refused by `removeRunStateDir` (no wide delete).
