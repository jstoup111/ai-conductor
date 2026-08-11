# Implementation Plan: Worktree-local provider scratch lifecycle

**Date:** 2026-08-10
**Stories:** .docs/stories/interrupted-self-host-runs-leak-provider-homes-unt.md
**Conflict check:** Clean as of 2026-08-10

## Summary

Moves throwaway provider homes out of the system temporary directory into the owning worktree's
`.daemon/scratch/`, gives each home an owner lease, and reclaims orphans left by abruptly-killed
attempts through a retention-biased sweep at the daemon dispatch boundary. 25 tasks.

## Technical Approach

A new module, `src/conductor/src/engine/self-host/provider-scratch.ts`, owns the whole scratch
lifecycle. It exposes four things: a pure path resolver, an acquire that creates the home and
writes its lease, a release that removes both, and a sweep that reclaims dead-owner homes.

**Placement.** The resolver returns `«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»`. The
worktree path is a required parameter with no default and no main-root fallback, so scratch can
never land in the main checkout's `.daemon/` (#486's failure). `.daemon` is chosen because it is
the only prefix that is simultaneously gitignored, present in `LIVE_CHECKOUT_VOLATILE`
(`live-boundary.ts:57-60`), and not relocated by #564 — which turns `«worktree»/.pipeline` into an
outward symlink and would otherwise carry scratch out of the worktree. The run id is passed in by
the caller rather than read from `.pipeline/conduct-session-id`, for the same decoupling reason.

**Lease.** Acquire writes an owner record — repository, feature slug, run id, attempt, owner pid,
start time — inside the home before returning its path, so no caller ever observes a home without
one. The reader is total: it returns a discriminated result for present, missing, malformed, and
incomplete, and never throws or defaults a pid.

**Reclamation, in three layers.** The existing `finally` teardown stays exactly as it is and
remains the fast path — only the base directory it operates on changes. The sweep is the primary
reclaimer for interrupted attempts and is **retention-biased**: it removes only homes whose lease
names a positively-dead owner, and retains on missing, malformed, incomplete, or undeterminable
liveness. Worktree removal is the final backstop and needs no new code — `git worktree remove
--force` already deletes gitignored content, at all four removal sites.

**Wiring.** `provisionProviderHome` and `provisionSandboxBuildEnv` obtain their default base
directory by **calling `acquireScratchHome`** — not by calling the resolver and creating the
directory themselves. This distinction is load-bearing: the resolver returns a path, only acquire
writes the lease, and a creator that resolves-and-mkdirs produces a home no sweep can ever reclaim.
Both creators therefore require all six lease identity fields — repository, feature slug, run id,
attempt, owner pid, start time — as arguments, and `conductor.ts` threads the first four from the
values it already holds. An explicit `baseDir` override still bypasses the port, for test injection
only. `token-liveness.ts` is untouched.

The sweep is added as an optional best-effort daemon dep, invoked from `runDaemon`'s existing
boundary alongside `sweepMergeableLabels`, and constructed in `daemon-cli.ts` where the other daemon
deps are built. It is bound to **each per-feature worktree root** — the CLI enumerates the
directories beneath `.worktrees/` and sweeps each one. Binding it to the `.worktrees` container
itself would make it scan `.worktrees/.daemon/scratch`, a path nothing ever creates, and the
directory read would swallow the resulting ENOENT and return no candidates on every tick.

**Sequencing.** The resolver and lease come first because everything else depends on them; the two
creators adopt the port next; the sweep is built against the lease reader; observability and the
one-time legacy collection land last, since both consume the sweep's decisions.

## Prerequisites

- None. No migration, no new dependency, no external setup.

## Tasks

### Task 1: Resolve a scratch root beneath the worktree
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test: assert `resolveScratchHome({ worktreeRoot: '/wt', runId: 'R', attempt: 2, provider: 'codex' })` returns `/wt/.daemon/scratch/R/2-codex`.
2. Verify test fails (RED)
3. Implement: create `provider-scratch.ts` with a pure `resolveScratchHome` joining the four inputs; normalize the worktree root.
4. Verify test passes (GREEN)
5. Commit with message: "resolve provider scratch homes beneath the worktree"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — new resolver
- src/conductor/test/engine/self-host/provider-scratch.test.ts — resolver test

**Wired-into:** src/conductor/src/engine/self-host/provider-home.ts#provisionProviderHome

**Dependencies:** none

### Task 2: Reject a resolution with no worktree, run id, or attempt
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: assert each of a missing worktree root, missing run id, and missing attempt raises an explicit error, and that the module contains no `process.cwd()` or main-root fallback.
2. Verify test fails (RED)
3. Implement: make all four parameters required and validate them; add no default.
4. Verify test passes (GREEN)
5. Commit with message: "require explicit scratch identity with no cwd fallback"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — parameter validation
- src/conductor/test/engine/self-host/provider-scratch.test.ts — missing-parameter tests

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Pin the scratch root against a symlinked `.pipeline` and a differing main root
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: build a fixture worktree whose `.pipeline` is a symlink to an outside temp dir, and a main root distinct from the worktree; assert the resolved home is a real path beneath the worktree containing no segment of the main root.
2. Verify test fails (RED)
3. Implement: confirm the resolver never touches `.pipeline` and never consults a main-root resolver.
4. Verify test passes (GREEN)
5. Commit with message: "pin scratch resolution against relocated run-state"

**Files likely touched:**
- src/conductor/test/engine/self-host/provider-scratch.test.ts — symlink and main-root fixtures

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 4: Assert the scratch root is ignored and live-boundary excluded
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: assert the resolved path is reported ignored by `git check-ignore` from the worktree, and that its first relative segment is a member of `LIVE_CHECKOUT_VOLATILE`.
2. Verify test fails (RED)
3. Implement: export `LIVE_CHECKOUT_VOLATILE` from `live-boundary.ts` if it is not already reachable, and assert membership against it rather than a duplicated literal.
4. Verify test passes (GREEN)
5. Commit with message: "assert scratch sits under an ignored, boundary-excluded prefix"

**Files likely touched:**
- src/conductor/src/engine/self-host/live-boundary.ts — export the exclusion list for assertion
- src/conductor/test/engine/self-host/provider-scratch.test.ts — ignore and exclusion assertions

**Wired-into:** src/conductor/src/engine/self-host/live-boundary.ts#verifyLiveBoundary

**Dependencies:** Task 1

### Task 5: Write an owner lease when a scratch home is acquired
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: acquire a home and assert a lease exists recording repository, slug, run id, attempt, owner pid, and start time, and that all six round-trip on read.
2. Verify test fails (RED)
3. Implement: add `acquireScratchHome` creating the directory and writing the lease before returning the path.
4. Verify test passes (GREEN)
5. Commit with message: "write an owner lease for each scratch home"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — acquire plus lease writer
- src/conductor/test/engine/self-host/provider-scratch.test.ts — lease round-trip test

**Wired-into:** same as Task 1

**Dependencies:** Task 2

### Task 6: Read leases totally — missing, malformed, incomplete
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: assert reading an absent lease, a syntactically invalid lease, and a lease missing its pid each returns its own discriminated result, and that none throws or substitutes a default pid.
2. Verify test fails (RED)
3. Implement: add `readScratchLease` returning a discriminated union over present, missing, malformed, incomplete.
4. Verify test passes (GREEN)
5. Commit with message: "read scratch leases without throwing or defaulting"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — lease reader
- src/conductor/test/engine/self-host/provider-scratch.test.ts — reader cases

**Wired-into:** same as Task 1

**Dependencies:** Task 5

### Task 7: Fail acquisition closed when the lease cannot be written
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: inject a filesystem whose lease write rejects; assert acquisition rejects, the partial home is removed, and no home path is returned.
2. Verify test fails (RED)
3. Implement: wrap acquisition so a lease-write failure removes the partial directory and rethrows.
4. Verify test passes (GREEN)
5. Commit with message: "remove the partial home when a lease write fails"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — acquisition failure path
- src/conductor/test/engine/self-host/provider-scratch.test.ts — injected-failure test

**Wired-into:** same as Task 1

**Dependencies:** Task 5

### Task 8: Keep credential material out of the lease
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: enumerate the serialized lease keys and assert the set is exactly the six identity fields, with no token, credential, key, or environment map.
2. Verify test fails (RED)
3. Implement: give the lease an explicit serializer over the six fields rather than spreading an options object.
4. Verify test passes (GREEN)
5. Commit with message: "serialize only identity fields into the lease"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — explicit lease serializer
- src/conductor/test/engine/self-host/provider-scratch.test.ts — key-set assertion

**Wired-into:** same as Task 1

**Dependencies:** Task 5

### Task 9: Release a scratch home and prune its empty run directory
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing test: acquire two attempts of one run, release one, assert its home and lease are gone and the sibling survives; release the second and assert the run directory is pruned.
2. Verify test fails (RED)
3. Implement: add `releaseScratchHome` removing the home and pruning the parent run directory only when empty.
4. Verify test passes (GREEN)
5. Commit with message: "release scratch homes and prune empty run directories"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — release
- src/conductor/test/engine/self-host/provider-scratch.test.ts — sibling and prune tests

**Wired-into:** same as Task 1

**Dependencies:** Task 5

### Task 10: Keep release idempotent and non-throwing
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test: assert a second release is a no-op, an already-deleted home releases cleanly, and an undeletable file makes release report rather than throw.
2. Verify test fails (RED)
3. Implement: force removal, guard re-entry, and return a reported outcome instead of propagating.
4. Verify test passes (GREEN)
5. Commit with message: "make scratch release idempotent and non-throwing"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — release guards
- src/conductor/test/engine/self-host/provider-scratch.test.ts — idempotency and failure tests

**Wired-into:** same as Task 1

**Dependencies:** Task 9

### Task 11: Route `provisionProviderHome` through the scratch port
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test: provision a codex home for a fixture worktree and assert the returned home and the child `CODEX_HOME` both resolve beneath that worktree's scratch root; that `owner.json` exists inside the returned home, carrying exactly the six identity fields, **before** the call returns and without the test pre-creating it; and that an explicit `baseDir` override still wins.
2. Verify test fails (RED)
3. Implement: default `provisionProviderHome`'s base directory by calling `acquireScratchHome` — never the resolver plus a direct `mkdir` — requiring repository and feature slug alongside worktree root, run id, attempt, and provider. Reject a call that cannot supply a complete identity rather than substituting a generated placeholder.
4. Verify test passes (GREEN)
5. Commit with message: "provision codex homes from the worktree scratch port"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-home.ts — base directory now from the port
- src/conductor/test/engine/self-host/provider-home.test.ts — placement and override tests

**Wired-into:** src/conductor/src/engine/self-host/provider-home.ts#provisionProviderHome

**Dependencies:** Task 9

### Task 12: Route `provisionSandboxBuildEnv` through the scratch port
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test: provision a claude sandbox and assert the config dir and child `CLAUDE_CONFIG_DIR` resolve beneath the worktree scratch root; that `owner.json` exists with its six fields before the call returns, again without the test pre-creating it, and disappears on teardown; and that `token-liveness.ts` is unchanged and still uses the system temporary directory.
2. Verify test fails (RED)
3. Implement: default `provisionSandboxBuildEnv`'s base directory by calling `acquireScratchHome` with the same complete identity, on the same no-placeholder terms as Task 11.
4. Verify test passes (GREEN)
5. Commit with message: "provision claude sandboxes from the worktree scratch port"

**Files likely touched:**
- src/conductor/src/engine/self-host/sandbox-build-env.ts — base directory now from the port
- src/conductor/test/engine/self-host/sandbox-build-env.test.ts — placement and scope tests

**Wired-into:** src/conductor/src/engine/self-host/sandbox-build-env.ts#provisionSandboxBuildEnv

**Dependencies:** Task 9

### Task 13: Thread the full lease identity from the conductor to both creators
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test: drive `prepareCandidateSelfHost` for both providers and read the `owner.json` each call actually wrote, asserting all four threaded fields — repository, feature slug, run id, attempt — carry the conductor's real values rather than generated placeholders. Assert against the lease on disk, never against the provisioning call's arguments; an argument assertion passes while production writes no lease at all. Cover the legacy sandbox path at `conductor.ts` that currently provisions with no identity.
2. Verify test fails (RED)
3. Implement: pass the repository and feature slug the conductor already holds, plus the run id held by the step runner and the candidate attempt index, into both provisioning calls. Add all four to `ProvisionProviderHomeOptions` and `ProvisionOptions` as required fields, so an incomplete call fails to compile.
4. Verify test passes (GREEN)
5. Commit with message: "thread run id and attempt into scratch provisioning"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — provisioning call sites gain identity arguments
- src/conductor/src/engine/step-runners.ts — expose the held run id to the provisioning path
- src/conductor/test/engine/conductor.test.ts — identity threading test

**Wired-into:** src/conductor/src/engine/conductor.ts#prepareCandidateSelfHost

**Dependencies:** Task 11, Task 12

### Task 14: Preserve provisioning failure semantics and worktree cleanliness
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing test: assert a missing `skills/` asset still raises the existing provisioning error with the partial home removed, that a post-acquire failure leaves no leased home, and that `git status` in the worktree is clean while a provider home exists inside it.
2. Verify test fails (RED)
3. Implement: route the existing catch blocks through the port's release so partial homes are cleaned by the same path.
4. Verify test passes (GREEN)
5. Commit with message: "keep provisioning failures from leaving leased homes"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-home.ts — failure path uses the port's release
- src/conductor/src/engine/self-host/sandbox-build-env.ts — same
- src/conductor/test/engine/self-host/provider-home.test.ts — failure and cleanliness tests

**Wired-into:** same as Task 11

**Dependencies:** Task 13

### Task 15: Reclaim dead-owner homes, retaining everything else
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing test: build a scratch root holding a dead-owner home and a live-owner home; assert the sweep removes only the dead one and reports the live one as retained.
2. Verify test fails (RED)
3. Implement: add `sweepScratch` enumerating attempt homes, reading each lease, probing owner liveness with a signal-0 check, and removing only positively-dead owners.
4. Verify test passes (GREEN)
5. Commit with message: "reclaim dead-owner scratch homes"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — sweep and liveness probe
- src/conductor/test/engine/self-host/provider-scratch.test.ts — dead and live owner cases

**Wired-into:** src/conductor/src/engine/daemon.ts#runDaemon

**Dependencies:** Task 6, Task 10

### Task 15b: Keep reclamation platform-neutral and scheduler-free
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: assert the liveness probe and the sweep contain no platform branch on `process.platform`, and that the module references no scheduler, service manager, or cron mechanism.
2. Verify test fails (RED)
3. Implement: confirm liveness is a signal-0 probe used identically on both supported platforms, and that the sweep's only trigger is the daemon dispatch boundary.
4. Verify test passes (GREEN)
5. Commit with message: "keep scratch reclamation platform-neutral and scheduler-free"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — single-path liveness probe
- src/conductor/test/engine/self-host/provider-scratch.test.ts — platform-neutrality assertions

**Wired-into:** same as Task 15

**Dependencies:** Task 15

### Task 16: Retain on every uncertain lease state
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: assert a home with no lease, a malformed lease, an incomplete lease, an undeterminable-liveness owner, and a home acquired concurrently with the sweep are each retained with its own distinct reason.
2. Verify test fails (RED)
3. Implement: make retention the default branch, with removal reachable only from a positively-dead verdict.
4. Verify test passes (GREEN)
5. Commit with message: "retain scratch homes on every uncertain lease state"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — retention branches
- src/conductor/test/engine/self-host/provider-scratch.test.ts — five retention cases

**Wired-into:** same as Task 15

**Dependencies:** Task 15

### Task 17: Continue the sweep past a failed removal
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: place two dead-owner homes where the first fails to remove; assert the failure is reported, the second is still removed, and the sweep resolves rather than rejecting.
2. Verify test fails (RED)
3. Implement: catch per-candidate removal failures, record them, and continue the enumeration.
4. Verify test passes (GREEN)
5. Commit with message: "continue the scratch sweep past a failed removal"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — per-candidate error handling
- src/conductor/test/engine/self-host/provider-scratch.test.ts — partial-failure test

**Wired-into:** same as Task 15

**Dependencies:** Task 15

### Task 18: Invoke the sweep at the daemon dispatch boundary
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test: run the daemon core with a stub sweep dep and assert it is invoked at the same boundary as the existing best-effort hooks, and that a sweep that rejects does not stop dispatch.
2. Verify test fails (RED)
3. Implement: add an optional `sweepProviderScratch` dep, invoke it inside the existing best-effort boundary, and catch and log any throw as the adjacent hooks do.
4. Verify test passes (GREEN)
5. Commit with message: "sweep provider scratch at the dispatch boundary"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — optional dep plus best-effort invocation
- src/conductor/test/engine/daemon.test.ts — invocation and throw-tolerance tests

**Wired-into:** src/conductor/src/engine/daemon.ts#runDaemon

**Dependencies:** Task 17

### Task 19: Construct the sweep dep in the daemon CLI
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test: build a realistic `«project»/.worktrees/«slug»/.daemon/scratch/«runId»/«attempt»-«provider»` layout holding a dead-owner lease, invoke the dep the CLI actually constructs, and assert that home is reclaimed while a live-owner and a lease-less sibling are retained. Exercise the real `sweepScratch` against a real directory layout — a regex over `daemon-cli.ts`'s source text, or a stubbed sweep, cannot detect a mis-bound root and must not be used here.
2. Verify test fails (RED)
3. Implement: construct the dep where the other daemon deps are built, enumerating the concrete per-feature worktree directories beneath the worktree base and sweeping each one. Do not pass the `.worktrees` container itself as though it were a single worktree root.
4. Verify test passes (GREEN)
5. Commit with message: "wire the scratch sweep into the daemon dependency set"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — sweep dep construction
- src/conductor/test/daemon-cli.test.ts — dep construction test

**Wired-into:** src/conductor/src/daemon-cli.ts#runDaemonMode

**Dependencies:** Task 18

### Task 20: Emit reclaimed, retained, and failed cleanup events
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing test: run a sweep over one reclaimed, one retained, and one failing home; assert three events are emitted carrying repository, slug, run id, attempt, path, and reason, and that they persist into the ledger in the existing schema.
2. Verify test fails (RED)
3. Implement: add the three variants to the `ConductorEvent` union and emit them from the sweep through the existing emitter.
4. Verify test passes (GREEN)
5. Commit with message: "emit scratch cleanup decisions on the event spine"

**Files likely touched:**
- src/conductor/src/types/events.ts — three new union variants
- src/conductor/src/engine/self-host/provider-scratch.ts — emission from the sweep
- src/conductor/test/engine/self-host/provider-scratch.test.ts — emission and persistence tests

**Wired-into:** same as Task 18

**Dependencies:** Task 19

### Task 21: Report unknown identity and survive emission failure
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing test: assert a home with no readable lease emits a retention event whose identity fields are explicitly unknown rather than fabricated, that each of the five retention reasons is distinct, and that an emitter which throws neither aborts the cleanup nor propagates.
2. Verify test fails (RED)
3. Implement: model the identity fields as optional-with-unknown and wrap emission in a guard.
4. Verify test passes (GREEN)
5. Commit with message: "report unknown scratch identity without fabricating it"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — unknown identity and emission guard
- src/conductor/test/engine/self-host/provider-scratch.test.ts — unknown-identity and emitter-failure tests

**Wired-into:** same as Task 18

**Dependencies:** Task 20

### Task 22: Collect the historical temporary-directory prefixes once
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing test: seed a fixture temp root with `self-host-*` and `harness-selfbuild-*` directories older than the process start; assert they are removed on the first boundary, that an event names every removal and retention, and that a second boundary does not repeat the collection.
2. Verify test fails (RED)
3. Implement: add a once-guarded `collectLegacyScratch` invoked from the same daemon boundary as the sweep.
4. Verify test passes (GREEN)
5. Commit with message: "collect historical leaked provider homes once"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — once-guarded legacy collection
- src/conductor/test/engine/self-host/provider-scratch.test.ts — collection and once-only tests

**Wired-into:** same as Task 18

**Dependencies:** Task 21

### Task 23: Refuse every legacy candidate that is not provably stale
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing test: assert a non-matching sibling directory, a matching directory covered by a live lease, and a matching directory newer than the process start are all retained; assert one failed removal does not stop the remaining candidates, and an unlistable temp root is reported without disrupting dispatch.
2. Verify test fails (RED)
3. Implement: require exact prefix match plus absence of a live lease plus an mtime older than process start before any removal.
4. Verify test passes (GREEN)
5. Commit with message: "refuse legacy scratch candidates that are not provably stale"

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-scratch.ts — legacy candidate guards
- src/conductor/test/engine/self-host/provider-scratch.test.ts — five refusal cases

**Wired-into:** same as Task 18

**Dependencies:** Task 22

### Task 24: Prove worktree removal takes all scratch with it
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing test: create scratch homes inside a real worktree, remove it through the production removal path, and assert no scratch remains; separately assert run-state located outside the worktree survives that removal, and that a second removal of an already-removed worktree is a clean no-op.
2. Verify test fails (RED)
3. Implement: no production change is expected — confirm the existing force-removal and its filesystem fallback already cover scratch, and record the result.
4. Verify test passes (GREEN)
5. Commit with message: "prove worktree removal reclaims all feature scratch"

**Files likely touched:**
- src/conductor/test/engine/worktree.test.ts — removal-reclaims-scratch tests

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 12

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ── Task 5 ──┬── Task 6 ──────────────┐
         ├── Task 3             ├── Task 7               │
         └── Task 4             ├── Task 8               │
                                └── Task 9 ── Task 10 ───┤
                                      │                  │
                                      ├── Task 11 ──┐    │
                                      ├── Task 12 ──┤    │
                                      │             │    │
                                      │        Task 13 ── Task 14
                                      │             │
                                      └── Task 24   │
                                                    │
                            Task 15 ◄───────────────┘
                              ├── Task 15b
                              ├── Task 16
                              └── Task 17 ── Task 18 ── Task 19 ── Task 20 ── Task 21 ── Task 22 ── Task 23
```

## Integration Points

- **After Task 13:** both providers provision from the worktree scratch root end to end, with real run and attempt identity in every lease.
- **After Task 19:** the sweep runs for real at every dispatch boundary; an interrupted attempt is reclaimed without operator action.
- **After Task 23:** the already-leaked backlog that caused the reported quota failure is collected on the next daemon start.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
