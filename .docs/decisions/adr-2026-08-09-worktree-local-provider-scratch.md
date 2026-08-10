# ADR: Throwaway provider homes live in the worktree, reclaimed by lease-owner liveness

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** Operator (jstoup111), during DECIDE for intake #1223

## Context

Self-host provider execution provisions a throwaway provider home per attempt and
removes it from a `finally` (`provider-execution.ts:584`, `provider-home.ts:113-118`,
`sandbox-build-env.ts:150-156`). That `finally` is unreachable when the owning process
dies abruptly — SIGKILL, OOM, or a daemon self-restart — which is precisely the reported
failure. Homes are created with `mkdtemp` under `os.tmpdir()` and carry a random suffix
(`provider-home.ts:135`, `sandbox-build-env.ts:174`), so nothing on disk records which
attempt owns a directory or whether that attempt is still running.

On the reporting host `/tmp` is RAM-backed tmpfs with quotas enabled. Fifteen orphaned
`self-host-codex-*` directories accumulated to roughly 668 MB, and Codex began failing to
persist thread events with `Quota exceeded (os error 122)` while builds were in flight.
Recovery required manual, host-specific inspection and deletion.

Forces:

- Cleanup must never delete a **live** provider home; doing so corrupts an in-flight attempt.
- It must work on Linux and macOS with no systemd, launchd, cron, or operator-installed
  configuration.
- Issue #564 relocates durable `.pipeline` run-state out of worktrees, and its placement is
  already decided: `adr-2026-07-21-run-state-home-dir-placement` (APPROVED) moves run-state to
  `~/.ai-conductor/runs/«projectKey»/«slug»/` and leaves **`«worktree»/.pipeline` as an outward
  symlink**. Scratch ownership must not silently break when that lands.
- Cleanup decisions and failures must be observable.

One constraint reframes the whole problem: **a provider home carries no post-attempt
value.** It holds Codex `rollout-*.jsonl` thread history, a copy of the worktree's
`skills/` tree, provider-written auth config, and the generated write-fence settings.
Nothing reads any of it after the attempt ends, and the rollout history in particular is
dead weight because this harness never resumes provider sessions. The durable run-state
the intake asks to preserve — task-status, the evidence sidecar, gate verdicts — is
`.pipeline/` content, not scratch. There is therefore no retention requirement at all: the
only reason to keep a home is that its owner is still using it.

## Options Considered

### Option A: Keep `os.tmpdir()`, add identity-bearing names, a lease, and a sweep
- **Pros:** smallest diff; leaves the fast path untouched; tmpfs is fast.
- **Cons:** even a correctly-swept live set competes for RAM shared with the whole host;
  the quota failure mode is bounded rather than removed. Requires a new sweeper with
  cross-repo delete safety, because one `/tmp` is shared by every repo and every daemon.

### Option B: A platform cache root (XDG on Linux, Application Support on macOS)
- **Pros:** off tmpfs; conventional location.
- **Cons:** introduces platform-specific directory resolution for no gain here, and a
  shared root across repositories means the sweeper must prove it is not deleting another
  repository's live home. Requires a brand-new reaper with no existing backstop.

### Option C: Supervision-based teardown (signal handlers plus a child-tied reaper)
- **Pros:** no storage change; cleans up on ordinary restarts.
- **Cons:** cannot cover SIGKILL, OOM, or power loss — the reported case — and offers no
  recovery for directories already leaked. Signal handlers are additionally fragile across
  the daemon's own self-restart path.

### Option D: `.daemon/scratch/` at the **repository root**
- **Pros:** repo-local, off tmpfs, excluded from the self-host live boundary.
- **Cons:** nothing ever sweeps the root `.daemon/`. Choosing it means inventing a reaper for
  a case that existing machinery already covers elsewhere.

### Option E: `«worktree»/.pipeline/scratch/«runId»/«attempt»-«provider»/`
- **Pros:** worktree-local, so the reap backstop is free; `.pipeline/` is already gitignored
  and already excluded from the live-boundary fingerprint.
- **Cons:** **defeated by #564.** `adr-2026-07-21-run-state-home-dir-placement` (APPROVED)
  makes `«worktree»/.pipeline` an outward symlink to `~/.ai-conductor/runs/«projectKey»/«slug»/`.
  Every path beneath it would then resolve outside the worktree; `git worktree remove --force`
  would delete only the symlink, and scratch would accumulate inside the durable run-state
  store — precisely the mixing of ephemeral scratch with audit state the intake forbids.
  Anchoring to the worktree path is not sufficient when that path becomes a portal out.

### Option F: `«worktree»/.scratch/«runId»/«attempt»-«provider»/`
- **Pros:** a real worktree-local directory, immune to the `.pipeline` symlink.
- **Cons:** a new top-level name is not on `LIVE_CHECKOUT_VOLATILE` (`live-boundary.ts:57-60`),
  and that guard **deliberately does not consult `.gitignore`** (`live-boundary.ts:48`). An
  inline run at the root checkout would therefore make an unattributable untracked path appear
  and halt any concurrent self-host build. The only remedy is widening the exclusion list,
  which `CLAUDE.md` explicitly forbids.

### Option G: `«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»/` — chosen
- **Pros:** worktree-local, so the reap backstop is free and already correct; identity is the
  path; `.daemon` is already gitignored **and** already on `LIVE_CHECKOUT_VOLATILE`, so no
  exclusion-list change is needed; #564 does not relocate `.daemon`.
- **Cons:** scratch moves from RAM to the repository's disk; the run id must be threaded to
  the provisioning call sites; `.daemon` at the worktree level carries a historical association
  with misplaced park markers (#486), so the distinction from the root `.daemon` must stay
  explicit in the code.

## Decision

Throwaway provider homes are created under
`«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»/`, resolved by a single
worktree-anchored scratch port that replaces the direct `os.tmpdir()` default in
`provisionProviderHome` and `provisionSandboxBuildEnv`. Each home carries an owner lease
recording repository, feature slug, run id, attempt, owning process id, and start time. The
existing `finally` teardown remains the fast path, unchanged. A dead-owner sweep runs at the
daemon dispatch boundary alongside the existing reconciliation hooks. Cleanup decisions and
failures are emitted as `ConductorEvent` variants.

**Why the worktree and not `/tmp`, a cache root, or `.daemon/`.** `git worktree remove
--force` deletes the whole worktree directory including gitignored content, and it is the
removal path at every site that retires a worktree — `worktree.ts:81`,
`park-reconciliation.ts:660`, `daemon-deps.ts:134`, `autoresolve.ts:338`, each with an
`rm -rf` fallback. Placing scratch inside the worktree therefore inherits a backstop that
already exists and is already exercised, instead of requiring a new reaper. It also makes
the sweeper's blast radius a single repository's own worktrees rather than a shared
system directory, which removes the cross-repo delete hazard that Options A and B both
carry. The objection that orphans become unfindable after a reap is vacuous: scratch
inside a worktree cannot outlive it.

**Why under `.daemon/` and not `.pipeline/` or a new name.** The scratch root is constrained
from two directions at once, and only one path satisfies both.

It must sit beneath a prefix already on `LIVE_CHECKOUT_VOLATILE` (`live-boundary.ts:57-60`:
`.git`, `.daemon`, `.worktrees`, `.pipeline`, `.claude/worktrees`). That guard
**deliberately does not consult `.gitignore`** — "`.gitignore` is deliberately not used"
(`live-boundary.ts:48`) — so being gitignored is not enough. A new top-level name would make
an unattributable untracked path appear in the root checkout and halt a concurrent self-host
build, and the documented remedy of widening the exclusion list is forbidden by `CLAUDE.md`.
That eliminates Option F.

It must also remain a **real directory inside the worktree** after #564 lands. `.pipeline`
becomes an outward symlink under `adr-2026-07-21-run-state-home-dir-placement`, so anything
beneath it leaves the worktree and loses the reap backstop. That eliminates Option E.

`.daemon` is the only prefix that is both already excluded and untouched by #564. Note this
is the **worktree's** `.daemon`, not the repository root's: the root `.daemon` is swept by
nothing, which is exactly why Option D was rejected, whereas a worktree-local `.daemon` is
removed by the same `git worktree remove --force` as everything else in the worktree.

**Why the resolver is anchored to the worktree, not to run-state.** The root is computed
from the worktree path alone, and the run id is **injected by the caller** rather than read
from `.pipeline/conduct-session-id`. `step-runners.ts:384` already holds it as `this.runId`.
Resolving it by reading that file would make scratch placement depend on wherever durable
run-state lives, reintroducing the #564 coupling through the back door. Injection plus the
`.daemon` prefix makes the design correct under #564 by construction rather than by vigilance.

**Why liveness and not age.** Because a home has no post-attempt value, the sweep does not
need a retention window; a dead owner is deleted immediately. The lease exists solely to
make "dead" decidable. Liveness is a signal-0 probe of the recorded process id, which behaves
identically on Linux and macOS and needs no platform branch — this is what satisfies the
"no systemd, launchd, or cron" requirement.

**Why the sweep fails toward retention.** A home whose lease is missing, unreadable, or
whose liveness cannot be established is **retained**, and the reason is reported. Deleting a
live provider home corrupts an in-flight attempt; retaining a dead one costs disk until the
worktree is reaped. The asymmetry is decisive, and the reap backstop makes over-retention
self-correcting. This also covers the provision race, where a directory exists momentarily
before its lease is written.

**Why token-liveness is out of scope.** `verifyTokenLiveness` is reached only from
`build-auth-cli.ts`'s `build-auth-status`, a foreground CLI command with no worktree, run, or
attempt to key on. It is not a leak source — every directory in the report was
`self-host-codex-*` — and a foreground process reliably runs its own `finally`. It keeps
using `os.tmpdir()`.

**Observability rides the existing spine.** Per the repository's event-spine rule, a cleanup
decision is an occurrence in time and becomes a `ConductorEvent` variant; the daemon log is a
consumer of the bus, never a second channel. The owner lease is the one new file, and it is
durable state read by name — exception C of the event-spine skill — not telemetry.

### Assumption ledger

| Assumption | Basis | Confidence | Impact if wrong |
|---|---|---|---|
| `git worktree remove --force` deletes gitignored content under the worktree | verified — it removes the working-tree directory, and every call site has an `rm -rf` fallback (`worktree.ts:83-85`, `park-reconciliation.ts:669`) | 97% | The backstop weakens to the dispatch-boundary sweep alone; still correct, slower to reclaim |
| `.daemon/` is gitignored and live-boundary excluded | verified — root `.gitignore`; `live-boundary.ts:57-60` lists `.git, .daemon, .worktrees, .pipeline, .claude/worktrees` | 99% | A scratch write would dirty the tree and trip cleanliness gates |
| The live-boundary guard fingerprints gitignored paths | verified — `live-boundary.ts:48`, "`.gitignore` is deliberately not used" | 97% | A new top-level scratch name would have been viable after all |
| #564 makes `«worktree»/.pipeline` an outward symlink | verified — `adr-2026-07-21-run-state-home-dir-placement`, Option A (chosen), on `origin/spec/pipeline-run-state-lives-inside-the-worktree-cwd-r` | 93% | If #564 changes course or never merges, `.pipeline/scratch/` would also have worked; `.daemon/` remains correct either way |
| #564 does not relocate `.daemon` | inferred — that ADR's scope is pipeline run-state; `.daemon` is named only as the park-marker root it must not be confused with | 88% | Scratch would need to move again; the port's single resolver makes that a one-line change |
| All targeted creators already accept an injectable base directory | verified — `provider-home.ts:129`, `sandbox-build-env.ts:169` | 98% | The change becomes a rewrite rather than an injection |
| A canonical run id is available at the provisioning call site | verified — `step-runners.ts:384` holds `this.runId`; `otel/resource.ts:54-61` mints and persists it | 92% | The path scheme falls back to an attempt-scoped id and loses per-run grouping only |
| A signal-0 process probe is a sufficient liveness test on Linux and macOS | verified for the mechanism; pid reuse is the known imperfection | 90% | A recycled pid makes a dead owner read as live — retention, the safe direction, resolved at reap |
| The daemon dispatch boundary can host a best-effort sweep | verified — the same seam already hosts `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepMergeableLabels` (`daemon.ts:425-447`) | 96% | The sweep needs a new boundary of its own |

## Consequences

### Positive

- The reported failure mode is removed rather than bounded: scratch no longer consumes
  RAM-backed tmpfs shared with the whole host.
- Orphan recovery needs no new reaper, no scheduler, and no platform branch.
- Every scratch directory is self-describing — its path names the run and attempt, and its
  lease names the repository, feature, and owning process.
- The design stays correct when #564 relocates `.pipeline` run-state: scratch sits under
  `.daemon`, which that relocation does not touch, and the run id is injected rather than
  read from a run-state file.
- Cleanup becomes observable through the same spine every existing consumer already reads.

### Negative

- Scratch now occupies the repository's disk instead of RAM, and provider-home I/O
  (notably Codex rollout appends) is correspondingly slower. Accepted: those writes are
  never read back.
- A long-lived feature that re-dispatches many times accumulates dead attempt homes inside a
  live worktree between sweeps. This is what the dead-owner sweep exists to bound; the reap
  is only the final backstop.
- The run id must be threaded from `step-runners` down to the provisioning call sites, which
  widens two signatures.
- Pid reuse can defer a reclaim to worktree-reap time. Accepted as the safe-direction failure.
- Scratch homes created before this change remain under `/tmp`; a one-time collection of the
  historical prefixes is required to clear them.

### Follow-up Actions

- [ ] Introduce the worktree-anchored scratch port and route `provisionProviderHome` and
      `provisionSandboxBuildEnv` through it.
- [ ] Write and read the owner lease; thread the injected run id and attempt through both
      call sites.
- [ ] Add the dead-owner sweep at the daemon dispatch boundary, best-effort, retention-biased.
- [ ] Add the `ConductorEvent` variants for reclaimed, retained, and failed cleanup.
- [ ] Collect the historical `/tmp` prefixes once so the already-leaked set is reclaimed.
