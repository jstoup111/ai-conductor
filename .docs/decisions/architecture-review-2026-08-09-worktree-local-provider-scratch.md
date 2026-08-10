# Architecture Review: Worktree-local provider scratch lifecycle

**Date:** 2026-08-09
**Mode:** design-time, lightweight (Medium tier — Sections 2 and 4 only)
**Input reviewed:** intake jstoup111/ai-conductor#1223, `.docs/track/interrupted-self-host-runs-leak-provider-homes-unt.md`, `.docs/architecture/2026-08-09-worktree-local-provider-scratch.md` and its sequences, `.memory/decisions/worktree-local-provider-scratch.md`
**Verdict:** APPROVED WITH CONDITIONS

> This review reached **BLOCKED** on its first pass and was resolved before approval. The advisory overlap scan surfaced `origin/spec/pipeline-run-state-lives-inside-the-worktree-cwd-r` (#564), whose APPROVED `adr-2026-07-21-run-state-home-dir-placement` turns `«worktree»/.pipeline` into an outward symlink to `~/.ai-conductor/runs/«projectKey»/«slug»/`. The originally-confirmed scratch root, `«worktree»/.pipeline/scratch/`, would therefore have resolved outside the worktree, lost the `git worktree remove --force` backstop, and accumulated ephemeral scratch inside the durable run-state store. The operator selected the worktree's `.daemon/scratch/` as the resolution; see `adr-2026-08-09-worktree-local-provider-scratch` Options E, F, and G.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency, service, or infrastructure. `mkdtemp`, `rm`, and a signal-0 process probe are all already in use. The signal-0 probe is the only new primitive and is identical on Linux and macOS. |
| Prerequisites | None external. The one internal prerequisite is threading an injected run id and attempt index to the two provisioning call sites. |
| Integration surface | Two provisioning creators, one conductor wiring site (`conductor.ts:2921-2969`), one daemon boundary hook, one event union. Does not cross a domain boundary. |
| Data implications | No schema, no migration. One new on-disk record — the owner lease — written under an already-gitignored path. |
| Performance risk | Provider-home I/O moves from tmpfs to disk. Codex rollout appends are the heaviest writer and are never read back, so the regression is unobserved work getting slower. The sweep enumerates one repository's scratch roots at a dispatch boundary; bounded by concurrent features times attempts. |
| Worktree isolation | Improved, not merely preserved. Scratch becomes per-worktree by construction, so two worktrees can no longer contend on a shared `/tmp` namespace, and a sweep in one repository can no longer reach another's directories. |

**Verified before approval** (each claim below was checked against source, not inferred):

- `.daemon/` is gitignored (root `.gitignore`, unanchored) and is on the self-host live-boundary exclusion list (`live-boundary.ts:57-60`).
- That guard **does not** consult `.gitignore` — `live-boundary.ts:48` states it explicitly — so a gitignored-but-unlisted top-level name is not safe. This is what forces the scratch root under an already-listed prefix.
- #564's chosen placement makes `«worktree»/.pipeline` an outward symlink (`adr-2026-07-21-run-state-home-dir-placement`, Option A), which is what disqualifies `.pipeline/scratch/`.
- Every worktree-removal site force-removes the directory and falls back to `rm -rf`: `worktree.ts:81-85`, `park-reconciliation.ts:660-669`, `daemon-deps.ts:134`, `autoresolve.ts:338`.
- Both targeted creators already accept an injectable base directory: `provider-home.ts:129`, `sandbox-build-env.ts:169`.
- A canonical run id exists and is already held at the call site: `step-runners.ts:384`, minted and persisted by `otel/resource.ts:54-61`.
- The daemon already hosts best-effort maintenance hooks at the same boundary: `daemon.ts:425-447`.
- `.daemon/` is swept by nothing, which is why it was rejected as the scratch root.

**Two scope corrections made during this review**, both operator-confirmed and recorded as amendments on the approved diagram:

1. `verifyTokenLiveness` is excluded from the port. Its only caller is `build-auth-cli.ts`'s `build-auth-status`, a foreground CLI with no worktree, run, or attempt to key on, and it is not a leak source. It keeps `os.tmpdir()`.
2. The run id is injected by the caller rather than read from `.pipeline/conduct-session-id`, so scratch placement stays decoupled from wherever durable run-state lives.

## Alignment

**Documented decisions.** The design conforms to the repository's deterministic-where-possible principle: reclamation is decided by an on-disk lease and a process probe, not by agent judgment, and the primary backstop is existing machinery reused rather than new machinery added.

**Event spine.** Checked against `.agents/skills/event-spine/SKILL.md` before the design was written down.

```
Channel?    yes  — an owner lease per scratch home, plus cleanup reporting
Concern:    lease = durable state; cleanup decisions = occurrence in time
Verdict:    lease is state read by name; cleanup extends the ConductorEvent union
Exception:  C for the lease; none needed for the cleanup events
```

No bespoke log, no sidecar telemetry format, and no status stamped into an existing artifact to stand in for an event. The daemon log remains a consumer of the bus.

**Pattern consistency.** The sweep follows the established shape of `reconcileHaltPrs`, `reconcileParkedFeatures`, and `sweepMergeableLabels`: optional, best-effort, a throw caught and reported, the dispatch loop never disrupted.

**Isolation invariants.** `provider-home.ts:145-152` deliberately copies the `skills/` asset rather than symlinking it, so provider-owned writes cannot land inside the git-tracked worktree through a live link. Placing the provider home itself inside the worktree does not reopen that hole: the scratch root is under the worktree's gitignored `.daemon/`, so no provider write reaches a tracked path. This is a standing constraint on the implementation, recorded as Condition 1.

**Root disambiguation.** The scratch root is the **worktree's** `.daemon/`, never the main checkout's. #486 is the precedent for why this distinction must be explicit in code rather than left to convention: park markers written to a worktree's `.daemon` instead of the main checkout's caused capped features to re-dispatch on every sweep. Scratch has the opposite ownership — it belongs to the worktree and must die with it — so the resolver must take the worktree path as an argument and must never fall back to a main-root resolution. Recorded as Condition 6.

**State management.** Reclamation is a two-valued decision over an explicit lease record, not an inferred boolean. There is no `is_*` flag and no implicit state.

**Security boundaries.** The lease records a process id and identity metadata only. It must not record credential material, provider tokens, or environment contents — the home it describes holds provider auth config. Recorded as Condition 2.

**Production DI defaults.** Not applicable; no stateful store is introduced.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| Worktree-anchored scratch root resolver | Called by the acquire path below; never called directly by a step. |
| Scratch acquire (creates the attempt home, writes the lease) | Invoked from `provisionProviderHome` (`provider-home.ts`) and `provisionSandboxBuildEnv` (`sandbox-build-env.ts`), both reached from the conductor's `prepareCandidateSelfHost` wiring at `conductor.ts:2921-2969`, which itself is installed on `providerExecution` and consumed by `provider-execution.ts:575`. |
| Scratch release | Invoked from the existing candidate `teardown()` already called in the `finally` at `provider-execution.ts:584`. No new call site. |
| Dead-owner sweep | Wired as a new optional best-effort daemon hook invoked at the dispatch boundary in `daemon.ts`, adjacent to the existing `sweepMergeableLabels` invocation (`daemon.ts:972`). |
| Legacy `/tmp` prefix collection | Invoked once from the same daemon hook, guarded so it runs at the first boundary only. |
| New `ConductorEvent` variants for reclaimed / retained / failed cleanup | Emitted through `ConductorEventEmitter` by the sweep and the release path; persisted by the existing `EventPersister` and read by the existing bus consumers with no consumer change. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Sweep deletes a live provider home mid-attempt | Data | Low | High | Retention-biased: missing, unreadable, or undeterminable liveness retains and reports. Only a positively-dead owner is reclaimed. |
| Provision race — directory exists before its lease is written | Technical | Medium | High | Same retention bias covers it: a home with no readable lease is never reclaimed. Lease is written before the path is returned to the caller. |
| Pid reuse makes a dead owner read as live | Technical | Low | Low | Fails toward retention; reclaimed at worktree reap. Lease carries `startedAt` so a later refinement can compare process start time if the deferral proves material. |
| Long-lived feature accumulates dead attempt homes between sweeps | Performance | Medium | Medium | Dead-owner sweep at every dispatch boundary bounds it; reap is the final backstop. |
| Disk growth in a repository with many retained worktrees | Performance | Low | Medium | Bounded by live attempts plus undeterminable leases; observable through the new cleanup events. |
| Legacy `/tmp` collection removes a directory belonging to another tool or another repository's live run | Data | Low | High | Match the historical prefixes exactly, require the directory to be unowned by any live lease and older than the current process start, and report every removal. Recorded as Condition 3. |
| #564 relocates `.pipeline`, moving scratch out of the worktree | Technical | Medium | High | Resolved during this review: scratch sits under `.daemon`, which #564 does not touch, and the run id is injected rather than read from run-state. Condition 4 pins this as a test, not a convention. |
| A future change relocates the worktree's `.daemon` as well | Technical | Low | High | Single resolver, so the fix is one place. Condition 4's test fails loudly if the root ever stops being worktree-relative. |
| Scratch resolves to the main checkout's `.daemon` instead of the worktree's | Data | Low | High | Resolver takes the worktree path as a required argument with no main-root fallback (#486 precedent). Condition 6. |

## ADRs Created

- `adr-2026-08-09-worktree-local-provider-scratch` — Status: APPROVED. Records the placement decision, the five rejected options, the liveness-not-age reclamation rule, the retention bias, and the assumption ledger.

## Conditions

1. **No scratch path may resolve to a git-tracked location.** The root must remain under the worktree's gitignored `.daemon/`, preserving the isolation invariant that `provider-home.ts:145-152` established by copying rather than symlinking `skills/`. A test must assert the resolved root is ignored by git and that its first path segment is on `LIVE_CHECKOUT_VOLATILE`.
2. **The owner lease records identity only** — repository, feature slug, run id, attempt, process id, start time. No token, credential, or environment capture.
3. **The legacy `/tmp` collection is prefix-exact and evidence-reporting.** It matches only the historical `self-host-*` and `harness-selfbuild-*` prefixes, refuses anything covered by a live lease, and emits an event naming every directory removed and every one retained.
4. **A test must pin the #564 decoupling** by resolving a scratch root with run-state configured to a location outside the worktree — including the case where `«worktree»/.pipeline` is an outward symlink — and asserting the scratch root is still a real directory beneath the worktree.
5. **The sweep must not be able to disrupt dispatch.** A throw inside it is caught and reported in the same manner as the adjacent reconciliation hooks.
6. **The resolver takes the worktree path as a required argument and has no main-root fallback**, so scratch can never land in the main checkout's `.daemon/` (#486 precedent).
