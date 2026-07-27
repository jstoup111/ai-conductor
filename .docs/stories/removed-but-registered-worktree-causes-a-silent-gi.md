# Stories: removed-but-registered worktree causes a silent 128 loop with no halt written

Status: Accepted

Source issue: jstoup111/ai-conductor#1022

These stories specify the behavior of the shared worktree create/reconcile mechanism
(`ensureWorktree` / `isRegisteredWorktree` in
`src/conductor/src/engine/worktree-shared.ts`) and the daemon's worktree-creation-failure
recording path (`src/conductor/src/engine/daemon-runner.ts` → `park-marker.ts`).
Acceptance criteria are Given/When/Then and are the authority for this technical-track fix
(no PRD). Design: `.docs/decisions/adr-2026-07-27-worktree-prune-reconciliation-and-creation-failure-park.md` (APPROVED).

The canonical failure fixture referenced throughout is real `git worktree list --porcelain`
output for a removed-but-registered worktree:

```
worktree /repo/.worktrees/slug
HEAD 1791e0d1e58fe59ff22a116892aa7ad58575bfb5
branch refs/heads/feat
prunable gitdir file points to non-existent location
```

Note that `prunable` is a **sibling line inside the same blank-line-separated record**, not a
modifier on the `worktree` line.

---

## Story S1: A prunable registration is not a usable worktree (happy path)

**As** the daemon's worktree mechanism
**I want** a registration whose directory is gone to be treated as absent
**So that** `ensureWorktree` never reports `'reused'` for a path that does not exist and
downstream code never proceeds believing it has a worktree.

### Scenario 1a: prunable record reports not-registered

- **Given** `git worktree list --porcelain` returns a record for the requested path that
  carries a `prunable` line,
- **When** `isRegisteredWorktree(root, path)` is called for that path,
- **Then** it returns `false`.

### Scenario 1b: a healthy registration still reports registered

- **Given** the porcelain output contains a record for the requested path with **no**
  `prunable` line,
- **When** `isRegisteredWorktree(root, path)` is called,
- **Then** it returns `true` and `ensureWorktree` returns `reconcile: 'reused'` — the existing
  resume behavior is unchanged.

### Scenario 1c: prunable on a different record does not affect this path

- **Given** the porcelain output contains a healthy record for the requested path **and** a
  separate prunable record for a different path,
- **When** `isRegisteredWorktree(root, path)` is called for the requested path,
- **Then** it returns `true` — prunable-ness is matched per record, never bled across records.

### Scenario 1d: the realpath-suffix match is preserved

- **Given** git reports the record under a realpath-resolved form that differs from the
  requested absolute path but shares the `.worktrees/<name>` suffix, with no `prunable` line,
- **When** `isRegisteredWorktree(root, path)` is called,
- **Then** it returns `true` — the existing suffix-matching behavior survives the rewrite from
  line-wise to record-wise parsing.

### Scenario 1e: a git failure still reports not-registered

- **Given** `git worktree list --porcelain` exits non-zero,
- **When** `isRegisteredWorktree(root, path)` is called,
- **Then** it returns `false` rather than throwing — the existing fail-soft contract is
  unchanged.

---

## Story S2: A stale registration is reconciled so the worktree can be recreated (happy path)

**As** the daemon
**I want** an observed stale registration pruned before I attach or create
**So that** the subsequent `git worktree add` succeeds instead of exiting 128, closing the
loop rather than relocating it.

### Scenario 2a: prune runs, then the attach succeeds

- **Given** the requested path has a prunable registration and its branch still exists,
- **When** `ensureWorktree` runs,
- **Then** `git worktree prune` is executed in `root` **before** the add, the add is
  `git worktree add <path> <branch>`, and the call resolves with `reconcile: 'attached'`.

### Scenario 2b: prune runs, then a fresh create succeeds

- **Given** the requested path has a prunable registration and its branch does **not** exist,
- **When** `ensureWorktree` runs,
- **Then** `git worktree prune` is executed in `root` before the add, and the add is
  `git worktree add -b <branch> <path> <base>`.

### Scenario 2c: filtering alone would not have been enough

- **Given** the reconciliation step is exercised for a prunable path,
- **When** the resulting git invocation sequence is inspected,
- **Then** it contains a `worktree prune` call — asserting that the fix reconciles the
  registration and does not merely decline to reuse it. This scenario exists specifically
  because omitting the prune moves the 128 from the create path to the attach path.

### Scenario 2d: a healthy repo issues no prune (negative path)

- **Given** the requested path has no prunable record — whether it is healthy-registered,
  or absent with an existing branch, or absent with no branch,
- **When** `ensureWorktree` runs,
- **Then** **no** `git worktree prune` is executed, and the git call sequence is identical to
  the pre-change behavior for all three cases.

### Scenario 2e: lazy base resolution is preserved (negative path)

- **Given** any path that resolves via the reuse or attach route, including the
  prune-then-attach route,
- **When** `ensureWorktree` runs,
- **Then** `resolveBase` is never invoked — the lazy-base contract asserted by the existing
  daemon-deps call-ordering test still holds.

---

## Story S3: A worktree-creation failure is recorded durably and stops re-dispatch (happy path)

**As** an operator
**I want** a failure that happens before the worktree exists to leave a durable record that
also gates dispatch
**So that** the daemon stops re-dispatching the feature and I can see why, even after a
daemon restart.

### Scenario 3a: a pre-worktree throw writes an auto-park

- **Given** `deps.createWorktree(slug)` throws (e.g. `git worktree add` exit 128),
- **When** the daemon runner's catch block handles it,
- **Then** a durable auto-park is written for that slug via `writeAutoPark(projectRoot, slug,
  reason)`, and the feature outcome is still `status: 'error'` carrying the same reason.

### Scenario 3b: the park body carries cause and remedy

- **Given** the auto-park from 3a,
- **When** its body is read,
- **Then** it contains the underlying git error text (including the 128 `already registered`
  message when that was the cause) and the concrete remedy naming `git worktree prune`.

### Scenario 3c: the parked slug is not re-dispatched

- **Given** a durable auto-park exists for a slug,
- **When** `pickEligible` evaluates the backlog,
- **Then** the slug is skipped via the unconditional `isParked` gate and is never dispatched —
  including on a fresh daemon process where the in-memory `parked`/`started` sets are empty.

### Scenario 3d: park provenance is auto, not operator

- **Given** the auto-park from 3a,
- **When** `getProvenanceType` inspects it,
- **Then** it reports the auto provenance (the `auto-parked:` body prefix), and
  `conduct daemon unpark <slug>` clears it.

### Scenario 3e: a post-worktree throw is unchanged (negative path)

- **Given** a throw that occurs **after** the worktree was successfully created,
- **When** the catch block handles it,
- **Then** the existing behavior is unchanged — `writeErrorHalt` writes `.pipeline/HALT` into
  the worktree and `teardownWorktree(worktree, true)` keeps it — and **no** auto-park is
  written.

### Scenario 3f: the park write never masks the original error (negative path)

- **Given** the auto-park write itself fails (e.g. the `.daemon` directory is unwritable),
- **When** the catch block completes,
- **Then** the feature outcome still reports `status: 'error'` with the **original** worktree
  failure reason, and the park failure does not throw out of the runner.

---

## Story S4: The engineer path inherits the fix (happy path)

**As** an operator running `/engineer`
**I want** a stale engineer worktree registration handled by the same mechanism
**So that** I get either a working worktree or the documented strict-abort message, never a
bare filesystem error.

### Scenario 4a: a stale engineer registration is reconciled

- **Given** `<target>/.worktrees/engineer-<slug>` has a prunable registration and its
  `spec/<slug>` branch exists,
- **When** `createEngineerWorktree` runs,
- **Then** the registration is pruned, the worktree is attached, and the returned reconcile
  verdict is `'attached'` — not `'reused'`.

### Scenario 4b: an unreconcilable failure strict-aborts with the FR-7 message (negative path)

- **Given** `ensureWorktree` throws for an engineer worktree for a cause that cannot be
  reconciled,
- **When** `createEngineerWorktree` handles it,
- **Then** the thrown error is the documented FR-7 strict-abort message naming the idea and
  the target path — not a bare `ENOENT` from running `git status` in a nonexistent directory —
  and the target's primary checkout is not mutated.

### Scenario 4c: the dirty-leftover refusal still applies (negative path)

- **Given** a genuinely present, healthy-registered leftover engineer worktree that is dirty,
- **When** `createEngineerWorktree` runs,
- **Then** it still refuses with the existing FR-11 dirty-leftover error — the prunable change
  does not weaken the stale-artifact guard.

---

## Story S5: The operator-facing documentation matches the new behavior (happy path)

**As** an operator following a runbook
**I want** the docs to describe what the engine now does automatically
**So that** I do not perform a manual recovery the engine already handles, and I recognize the
new auto-park.

### Scenario 5a: the worktree recovery runbook reflects automatic reconciliation

- **Given** `docs/runbooks/worktree-and-evidence-recovery.md`, whose Symptom list currently
  names the prunable record and the 128 `already registered` failure,
- **When** the runbook is read after this change,
- **Then** the prunable case is described as reconciled automatically by the engine on the next
  dispatch, and the manual `git worktree prune` step is reframed as a fallback rather than the
  required action.

### Scenario 5b: the new auto-park reason is documented

- **Given** `docs/guides/running-the-daemon.md`,
- **When** its auto-park reasons are read,
- **Then** the worktree-creation-failure auto-park is listed with its cause and the
  `conduct daemon unpark <slug>` recovery.

### Scenario 5c: the changelog records the fix

- **Given** `CHANGELOG.md`,
- **When** the `[Unreleased]` section is read,
- **Then** it carries a `### Fixed` entry describing the reconciliation and the durable
  creation-failure park. VERSION is **not** bumped (pre-v1 policy).
