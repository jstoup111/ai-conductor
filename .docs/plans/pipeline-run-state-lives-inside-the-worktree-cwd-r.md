# Implementation Plan: Relocate pipeline run-state to a home-dir store (#564)

**Date:** 2026-07-21
**Design:** `.docs/decisions/adr-2026-07-21-run-state-home-dir-placement.md` +
`.docs/decisions/architecture-review-2026-07-21-run-state-home-dir-relocation.md`
**Stories:** `.docs/stories/pipeline-run-state-lives-inside-the-worktree-cwd-r.md` (TR-1…TR-10)
**Complexity:** L · **Track:** technical
**Conflict check:** Clean as of 2026-07-21 (one accepted degrading overlap with #549 — see
`.docs/conflicts/2026-07-21-run-state-home-dir-relocation.md`)

## Summary
Introduce `run-state-store.ts` as the single owner of run-state location — a canonical resolver
keyed by feature identity (`{projectKey, slug}`) pointing at `~/.ai-conductor/runs/<project-key>/<slug>/`,
with an outward `.pipeline` symlink in the worktree, write-through durability, loss-free migration,
and per-slug cleanup — then rewire the three cwd seams and the resolver's consumers to it. 18 tasks.

## Technical Approach
The persistence primitives (`state.ts`, `gate-verdicts.ts`, `halt-marker.ts`, `task-evidence.ts`)
already take a resolved path and are left untouched; only the callers that construct the root change.
New module `src/conductor/src/engine/run-state-store.ts` exports `aiConductorHome()`,
`resolveRunStateDir(identity)`, `ensureRunStateStore(worktreePath, identity)`,
`migrateInTreePipelineIfPresent(worktreePath, identity)`, `removeRunStateDir(identity)`, and a
`resolveFeatureIdentity(...)` that derives `{projectKey, slug}` from `opts.featureDesc` (host) or the
worktree basename (daemon/resume), reusing `memory-store.projectKey()`. The design deliberately
mirrors `ensureMemoryStore`/`recordMemoryEntry` (outward symlink, write-through, never-touch-real-dir)
but keys by **project + slug** (per-feature isolation) rather than project-only (shared). Sequencing:
build and unit-test the store module in isolation (Tasks 1-7), then rewire callers (Tasks 8-12), then
land the durability/isolation acceptance tests (Tasks 13-17), then docs (Task 18). Fail-closed
throughout: no resolvable identity raises rather than falling back to a cwd path. #549's D1/D2/D3
guards are preserved against the relocated path (accepted overlap constraint).

## Prerequisites
- None beyond the current stack (Node fs + git). Migration of in-flight worktrees is handled in-code
  (Task 5), not by an operator step.

## Tasks

### Task 1: `aiConductorHome()` canonical base helper
**Story:** TR-2 (happy + both negative env paths)
**Type:** infrastructure
**Steps:**
1. Write failing test: `aiConductorHome()` with injected `HOME=/tmp/h` returns `/tmp/h/.ai-conductor`; with `HOME` unset + `USERPROFILE` set uses `USERPROFILE`; with neither uses `os.homedir()`, never empty/relative.
2. Verify RED.
3. Implement `aiConductorHome()` in a new `run-state-store.ts`, reading `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` (parity with `memory-store.resolveHome`).
4. Verify GREEN.
5. Commit: "feat(run-state): add aiConductorHome() base helper".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — new module + helper
- `src/conductor/test/engine/run-state-store.test.ts` — new test
**Wired-into:** `same as Task 2` (consumed by `resolveRunStateDir`)
**Dependencies:** none

### Task 2: `FeatureIdentity` type + `resolveRunStateDir(identity)` (cwd-independent)
**Story:** TR-1 (happy: identity→path, cwd-invariant)
**Type:** infrastructure
**Steps:**
1. Write failing test: `resolveRunStateDir({projectKey:'k', slug:'s'})` returns `<home>/.ai-conductor/runs/k/s`; two calls with different `process.cwd()` return identical paths.
2. Verify RED.
3. Implement `FeatureIdentity = {projectKey: string, slug: string}` and `resolveRunStateDir(id)` = `join(aiConductorHome(),'runs',id.projectKey,id.slug)`; no `process.cwd()` reference.
4. Verify GREEN.
5. Commit: "feat(run-state): resolveRunStateDir keyed by feature identity".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — type + resolver
- `src/conductor/test/engine/run-state-store.test.ts` — cwd-invariance test
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runDaemon, src/conductor/src/engine/resume.ts#resume, src/conductor/src/engine/finish-record-cli.ts#dispatch, src/conductor/src/engine/daemon-dashboard.ts#render`
**Dependencies:** 1

### Task 3: Slug validation / path-traversal guard in the resolver
**Story:** TR-1 (negative: slug with `/` or `..` rejected)
**Type:** negative-path
**Steps:**
1. Write failing test: `resolveRunStateDir({projectKey:'k', slug:'../evil'})` (and slug with `/`) throws; a valid `[a-z0-9-]` slug passes.
2. Verify RED.
3. Implement: validate slug against the `slugify` charset `[a-z0-9-]+` before joining; reject otherwise (never escape `runs/`).
4. Verify GREEN.
5. Commit: "feat(run-state): reject path-traversal slugs in resolver".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — validation
- `src/conductor/test/engine/run-state-store.test.ts` — traversal test
**Wired-into:** `same as Task 2`
**Dependencies:** 2

### Task 4: `ensureRunStateStore` — create store + idempotent outward `.pipeline` symlink
**Story:** TR-3 (happy: create + symlink; idempotent; negative: stale-replace, real-dir-not-clobbered)
**Type:** infrastructure
**Steps:**
1. Write failing tests: fresh run creates `runs/k/s` and a `.pipeline` symlink to it; re-run is a no-op; a stale symlink (wrong target) is replaced; a real `.pipeline` directory is NOT clobbered (defers to migration).
2. Verify RED.
3. Implement `ensureRunStateStore(worktreePath, identity)` following the `ensureMemoryStore` rules (`memory-store.ts:167-192`): mkdir store recursive; lstat `.pipeline` → correct symlink=noop, stale symlink=unlink+recreate, real dir=leave for migration.
4. Verify GREEN.
5. Commit: "feat(run-state): ensureRunStateStore with outward symlink".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — ensure + symlink
- `src/conductor/test/engine/run-state-store.test.ts` — 4 cases
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runDaemon`
**Dependencies:** 2

### Task 5: `migrateInTreePipelineIfPresent` — loss-free, idempotent migration
**Story:** TR-8 (happy: real dir → store byte-identical; negative: interrupted-then-rerun idempotent, conflict precedence, already-symlink no-op)
**Type:** infrastructure
**Steps:**
1. Write failing tests: a real `.pipeline` with conduct-state/gates/evidence migrates into `runs/k/s` with every file byte-identical then `.pipeline` becomes a symlink; interrupted move re-runs without dup/drop; store-exists-AND-real-dir conflict resolves deterministically with a warning; already-a-correct-symlink is a no-op.
2. Verify RED.
3. Implement move-then-symlink with safe re-entry; defined precedence on conflict; loud warning; never discard state.
4. Verify GREEN.
5. Commit: "feat(run-state): loss-free in-tree .pipeline migration".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — migration
- `src/conductor/test/engine/run-state-store-migration.test.ts` — new test
**Wired-into:** `src/conductor/src/engine/run-state-store.ts#ensureRunStateStore` (called from inside ensure)
**Dependencies:** 4

### Task 6: `removeRunStateDir(identity)` — per-slug cleanup with wide-delete guard
**Story:** TR-10 (happy: remove exactly one slug; negative: no-store no-op, empty/invalid slug refused)
**Type:** infrastructure
**Steps:**
1. Write failing tests: `removeRunStateDir({k,s1})` removes `runs/k/s1`, leaves `runs/k/s2`; removing a non-existent slug is a safe no-op; an empty/invalid slug is refused (never removes `runs/k` or `runs/`).
2. Verify RED.
3. Implement guarded per-slug `rm` (validate slug first; refuse empty/invalid).
4. Verify GREEN.
5. Commit: "feat(run-state): per-slug removeRunStateDir with wide-delete guard".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — cleanup
- `src/conductor/test/engine/run-state-store.test.ts` — 3 cases
**Wired-into:** `src/conductor/src/engine/finish-record-cli.ts#dispatch` (feature teardown)
**Dependencies:** 2

### Task 7: `resolveFeatureIdentity` — derive `{projectKey, slug}`, fail-closed
**Story:** TR-7 (happy: identity available at each write site; negative: no identity raises, never cwd fallback)
**Type:** infrastructure
**Steps:**
1. Write failing tests: from `featureDesc` derives `slug = slugify(desc)` + `projectKey = projectKey(repoPath)`; from a worktree path derives `slug = basename`; with neither, throws an explicit error (asserts the message names the missing identity, and that no cwd-relative path is returned).
2. Verify RED.
3. Implement `resolveFeatureIdentity` reusing `memory-store.projectKey` and `worktree.slugify`; explicit branches (featureDesc / worktree basename / neither→throw). No cwd fallback.
4. Verify GREEN.
5. Commit: "feat(run-state): fail-closed feature-identity resolution".
**Files likely touched:**
- `src/conductor/src/engine/run-state-store.ts` — identity resolver
- `src/conductor/test/engine/run-state-store.test.ts` — 3 cases
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runDaemon`
**Dependencies:** 2

### Task 8: Rewire daemon per-worktree dispatch to the resolver
**Story:** TR-1/TR-3 (daemon path)
**Type:** refactor
**Steps:**
1. Write failing test: daemon run for a worktree resolves `pipelineDir` from `resolveFeatureIdentity(wt)` + `ensureRunStateStore`, not `join(wt.path,'.pipeline')`; state lands in the store.
2. Verify RED.
3. Implement: replace `daemon-cli.ts:760` `const pipelineDir = join(wt.path,'.pipeline')` and the derived `stateFilePath` with resolver + ensure-store; keep passing the resolved dir into the Conductor.
4. Verify GREEN.
5. Commit: "refactor(daemon): resolve run-state by feature identity".
**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — replace worktree-relative pipelineDir
- `src/conductor/test/daemon-*.test.ts` — daemon resolution test
**Wired-into:** `none (no new production surface)`
**Dependencies:** 4, 7

### Task 9: Rewire host seed + resume reassignments in `index.ts` (remove eager cwd mkdir)
**Story:** TR-1/TR-7 (host path); accepted #549 overlap constraint
**Type:** refactor
**Steps:**
1. Write failing test: a host run with `featureDesc` resolves the store via identity and creates no cwd-relative `.pipeline`; a bare status invocation (no featureDesc) creates no store; resume reassignment targets the store.
2. Verify RED.
3. Implement: remove the eager `mkdir(join(process.cwd(),'.pipeline'))` at `index.ts:605-609`; gate store creation behind `resolveFeatureIdentity`; update the resume/auto-resume reassignment sites (`:735,:771,:795,:846`) to the resolver. Preserve #549's crash-handler `mkdir` (now targets the resolved store).
4. Verify GREEN.
5. Commit: "refactor(conduct): host run-state resolved by identity, no cwd seed".
**Files likely touched:**
- `src/conductor/src/index.ts` — seed + reassignment rewire
- `src/conductor/test/acceptance/*.acceptance.test.ts` — host resolution test
**Wired-into:** `none (no new production surface)`
**Dependencies:** 4, 7

### Task 10: Rewire resolver consumers (resume, auto-resume, finish-record, dashboard)
**Story:** TR-1 (read paths)
**Type:** refactor
**Steps:**
1. Write failing test: `resume.ts`/`auto-resume.ts` read `conduct-state.json` from the store; `daemon-dashboard.ts:244` reads state from the store; `finish-record-cli.ts` reads/writes the store.
2. Verify RED.
3. Implement: replace inline `join(<root>,'.pipeline'...)` reads in `resume.ts`, `auto-resume.ts`, `finish-record-cli.ts`, `daemon-dashboard.ts` with the resolver.
4. Verify GREEN.
5. Commit: "refactor(run-state): route resume/dashboard/finish reads through resolver".
**Files likely touched:**
- `src/conductor/src/engine/resume.ts`, `src/conductor/src/engine/auto-resume.ts`, `src/conductor/src/engine/finish-record-cli.ts`, `src/conductor/src/engine/daemon-dashboard.ts`
- `src/conductor/test/engine/*.test.ts`
**Wired-into:** `none (no new production surface)`
**Dependencies:** 8, 9

### Task 11: Inject resolved store path into generated session-hook scripts
**Story:** TR-9 (happy: injected path; negative: no `process.cwd()` in emitted source, nested-cwd hook writes to store)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests: generated hook source contains the resolved absolute store path (or reads an injected anchor) and no `join(process.cwd(), ".pipeline")`; a hook run from a nested cwd writes its marker to the store.
2. Verify RED.
3. Implement: `session-hook-assets.ts:92,256` generation injects the resolved store path instead of literal `process.cwd()`.
4. Verify GREEN.
5. Commit: "feat(run-state): hooks resolve store by injected path, not cwd".
**Files likely touched:**
- `src/conductor/src/engine/session-hook-assets.ts` — inject path
- `src/conductor/test/engine/session-hook-assets.test.ts` — no-cwd assertion
**Wired-into:** `same as Task 4` (hooks generated during `ensureRunStateStore`/worktree prepare)
**Dependencies:** 4

### Task 12: Wire `removeRunStateDir` into feature teardown
**Story:** TR-10 (cleanup wiring)
**Type:** refactor
**Steps:**
1. Write failing test: completing/tearing down feature `s1` calls `removeRunStateDir({k,s1})` and leaves sibling `s2` intact.
2. Verify RED.
3. Implement: call `removeRunStateDir` from the finish/feature-teardown path.
4. Verify GREEN.
5. Commit: "feat(run-state): scope end-of-feature cleanup to one slug".
**Files likely touched:**
- `src/conductor/src/engine/finish-record-cli.ts` — teardown call
- `src/conductor/test/engine/finish-record-cli.test.ts`
**Wired-into:** `same as Task 6`
**Dependencies:** 6

### Task 13: Acceptance — write-through when the symlink is removed (TR-4)
**Story:** TR-4 (negative: symlink deleted, write still lands in store)
**Type:** negative-path
**Steps:**
1. Write failing acceptance test: delete the `.pipeline` symlink mid-run, perform an engine state write, assert it lands in `runs/k/s`.
2. Verify RED.
3. Implement any write-through gap so the resolved store path is used, not the symlink.
4. Verify GREEN.
5. Commit: "test(run-state): write-through survives missing symlink".
**Files likely touched:**
- `src/conductor/test/acceptance/run-state-write-through.acceptance.test.ts` — new
- `src/conductor/src/engine/run-state-store.ts` — if a gap surfaces
**Wired-into:** `none (no new production surface)`
**Dependencies:** 8, 9

### Task 14: Acceptance — #549 D1/D2/D3 guards preserved against the relocated path
**Story:** TR-4 (negative: guarded recreate, no crash on missing `session-created`); #549 overlap constraint
**Type:** negative-path
**Steps:**
1. Write failing test: with the resolved store removed mid-run, the marker write ensures the dir and returns `success:true` (D1), and the crash handler writes state+HALT (D2) — against the store path.
2. Verify RED.
3. Implement: confirm #549's guards operate on the resolved store dir; adjust ensure-dir target if needed.
4. Verify GREEN.
5. Commit: "test(run-state): preserve #549 durability guards post-relocation".
**Files likely touched:**
- `src/conductor/test/acceptance/run-state-549-guards.acceptance.test.ts` — new
- `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts` — only if ensure-dir target must follow the store
**Wired-into:** `none (no new production surface)`
**Dependencies:** 9

### Task 15: Acceptance — survives worktree removal, resumes from state (TR-5)
**Story:** TR-5 (happy + negatives)
**Type:** negative-path
**Steps:**
1. Write failing acceptance test: build to a known step, remove the worktree, recreate from branch, resume — assert the run continues from the persisted step and the store survived; empty/never-built worktree removal raises no error.
2. Verify RED.
3. Implement any resume gap (re-establish symlink via `ensureRunStateStore` on recreate).
4. Verify GREEN.
5. Commit: "test(run-state): resume after worktree removal".
**Files likely touched:**
- `src/conductor/test/acceptance/run-state-worktree-removal.acceptance.test.ts` — new
**Wired-into:** `none (no new production surface)`
**Dependencies:** 10

### Task 16: Acceptance — survives cwd-relative `.pipeline` delete, resumes (#549 regression) (TR-6)
**Story:** TR-6 (happy + negatives)
**Type:** negative-path
**Steps:**
1. Write failing acceptance test: reproduce the #549 `rmSync(join(process.cwd(),'.pipeline'),{recursive:true,force:true})` in the worktree; assert only the symlink is removed, the store's files are intact, and the run resumes without crashing on missing `session-created`.
2. Verify RED.
3. Implement any gap.
4. Verify GREEN.
5. Commit: "test(run-state): #549 cwd-relative delete is non-destructive".
**Files likely touched:**
- `src/conductor/test/acceptance/run-state-cwd-delete.acceptance.test.ts` — new
**Wired-into:** `none (no new production surface)`
**Dependencies:** 9, 10

### Task 17: Acceptance — concurrent features disjoint + cross-project isolation (TR-10)
**Story:** TR-10 (happy: disjoint slugs; negative: same slug across projects isolated)
**Type:** negative-path
**Steps:**
1. Write failing acceptance test: two slugs `s1`/`s2` in one project write to disjoint `runs/k/s1` and `runs/k/s2`; the same slug in two projects (`k1`,`k2`) stays isolated.
2. Verify RED.
3. Implement any gap.
4. Verify GREEN.
5. Commit: "test(run-state): concurrent-feature and cross-project isolation".
**Files likely touched:**
- `src/conductor/test/acceptance/run-state-isolation.acceptance.test.ts` — new
**Wired-into:** `none (no new production surface)`
**Dependencies:** 8

### Task 18: Docs + changelog (and release-gate handling)
**Story:** CLAUDE.md Documentation Upkeep + Release & Update Gates
**Type:** infrastructure
**Steps:**
1. Update `README.md` and `src/conductor/README.md`: document that run-state lives at `~/.ai-conductor/runs/<project-key>/<slug>/` with a `.pipeline` symlink, and that it survives worktree removal / cwd-relative deletes.
2. Add a `## [Unreleased]` CHANGELOG entry (Changed: run-state relocated out of the worktree; Fixed: #564 state-loss class). If the self-host release gate flags `hook wiring` (session-hook generation changed) and the change is internal-only (no consumer CLI/schema behavior change), add a `.docs/release-waivers/<plan-stem>.md` waiver naming `hook wiring`; if it changes consumer-visible behavior, add a runnable `## Migration` block instead. In-flight worktree migration is in-code (Task 5), so no operator migration command is needed for that.
3. No test (docs); complete via the normal commit.
4. Commit: "docs(run-state): document home-dir run-state store + changelog (#564)".
**Files likely touched:**
- `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
- `.docs/release-waivers/pipeline-run-state-lives-inside-the-worktree-cwd-r.md` — only if the gate flags hook-wiring as internal-only
**Wired-into:** `none (no new production surface)`
**Dependencies:** 11

## Task Dependency Graph
```
1 → 2 → 3
        ├→ 4 → 5
        │    └→ (into 8,9,11)
        ├→ 6 → 12
        └→ 7
4,7 → 8 → 17
4,7 → 9 → 14
8,9 → 10 → 15
8,9 → 13
9,10 → 16
4 → 11 → 18
6 → 12
```

## Integration Points
- After Task 7: the `run-state-store.ts` module is complete and unit-tested in isolation.
- After Task 11: all three cwd seams (host, daemon, hooks) resolve run-state by identity; the store
  is the live location end-to-end.
- After Task 17: the full durability + isolation contract from the desired outcome is proven by
  acceptance tests (worktree removal, cwd-relative delete, concurrency, per-slug cleanup).

## Verification
- [x] Every acceptance criterion (TR-1…TR-10, happy + negative) maps to at least one task
- [x] Negative paths are explicit tasks (Tasks 3, 5-neg, 6-neg, 13, 14, 15, 16, 17)
- [x] Tasks are 2-5 minute TDD granularity
- [x] Dependencies declared and acyclic (see graph)
- [x] Every task carries a `**Wired-into:**` line
- [x] Plan saved to `.docs/plans/pipeline-run-state-lives-inside-the-worktree-cwd-r.md`
- [x] #549 accepted overlap carried in as a coordination constraint (Tasks 9, 14)
- [x] Docs + changelog + release-gate handling scoped (Task 18)
