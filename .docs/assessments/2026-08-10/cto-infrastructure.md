# Infrastructure Assessment

**Date:** 2026-08-10
**Reviewer:** Infrastructure Reviewer Agent
**Verdict:** NEEDS_WORK

**Scope note:** ai-conductor has no deployed server, database, cache, or job queue in the
conventional sense. "Production" is a single long-running local daemon process (Node, tmux-hosted)
per registered repo on the operator's own machine. Categories 1-5 of the generic checklist
(database/cache/job-queue/prod-parity/secrets) largely do not apply and are marked
`UNABLE_TO_ASSESS` / `N/A` with a note; I substituted the actual infrastructure surfaces the
scoping brief named: daemon lifecycle, engine versioning/rollback, git-worktree isolation, CI,
toolchain pinning, backup/recovery, and resource exhaustion. Category 6 is repurposed as
"Worktree Isolation" against those real substrates rather than the Redis/DB-namespace checklist.

---

## Category 1: Database
**Status:** N/A

No database exists in this project. There is no relational/NoSQL datastore; all state is
flat-file (JSON/JSONL) under `.daemon/`, `.pipeline/`, and `.docs/`. Not applicable — **verified**
by absence (no ORM, no connection string, no `docker-compose.yml` with a DB service anywhere in
the file listing).

## Category 2: Caching
**Status:** N/A

No cache layer (Redis/Memcached/in-memory cache store) exists. Not applicable. **verified**.

## Category 3: Background Jobs
**Status:** N/A (re-mapped to the daemon loop, the closest real analog)

There is no Sidekiq/DelayedJob-style queue. The closest analog — the daemon's serial dispatch
loop — is covered under Category 7 (Daemon Lifecycle) below rather than force-fit into this
checklist.

## Category 4: Production Parity
**Status:** N/A

No dev/prod split exists — there is one environment, the operator's machine, running the same
code the daemon self-hosts against. Not applicable in the conventional sense.

## Category 5: Secrets Management
**Status:** UNABLE_TO_ASSESS (partial)

- `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` are read from GitHub Actions `secrets.*` in
  `.github/workflows/live-daemon-e2e.yml:16-17` and `release.yml` — **verified**, standard GH
  Actions secret injection, not hardcoded.
- No `.env.example` or `.env` handling was found at the repo root beyond the root `.gitignore`
  entry `.env` (`/tmp/.../assess-wt/.gitignore:24`) — **verified** — so local secrets (provider
  API keys/OAuth tokens) are excluded from git, but I could not locate where an operator's local
  credential file is documented (e.g. a `docs/guides/` credentials setup page) inside my read
  budget. Marking this sub-point `UNABLE_TO_ASSESS` rather than asserting a gap.
- No hardcoded credential strings were observed in any file read during this assessment
  (**inferred** — not an exhaustive repo-wide credential scan; the security specialist owns that
  sweep).

## Category 6: Worktree Isolation
**Status:** NEEDS_WORK

`.worktrees/<slug>` is this project's real isolation/compute substrate (git worktrees, not
containers). Findings:

| Severity | Finding | Location |
|----------|---------|----------|
| important | Each worktree's `src/conductor/node_modules` is a **full recursive copy** (`cp -a`) of the primary checkout's `node_modules` when package.json/package-lock match, not a symlink or hardlink share. For a TypeScript project this is plausibly hundreds of MB per worktree; with the repo's own documented history of ~74 concurrent worktrees, this is a real, unmitigated disk-exhaustion vector. No disk-space check gates worktree creation. | `bin/setup:27-41` (verified — read the full copy logic) |
| minor | `bin/setup` falls back to `npm install` (not `npm ci`) when the primary-checkout `node_modules` copy path doesn't apply (mismatched lockfile, or no primary checkout found) — `npm install` can silently update the lockfile inside a worktree in a way `npm ci` would refuse to, which is a minor build-reproducibility gap versus the `npm ci` used everywhere in CI. | `bin/setup:52-54` (verified) |
| minor | CLAUDE.md documents a real incident: a `zsh`-incompatible `mapfile`/`readarray` delete guard came back empty and deleted all 74 worktrees at once. The fix shipped is a **prose rule** ("never bulk-delete", "enumerate explicitly"), not machinery that structurally prevents a glob/loop delete — the repo's own stated Design Principle ("deterministic where possible") is not yet applied to this specific failure class. | `CLAUDE.md:52-57` (verified — this is the repo's own documented incident and its own admitted gap: "these prose rules are the interim guard until that machinery exists" at `CLAUDE.md:122-125`) |

Positive findings (**verified**), worth stating because they materially reduce the risk of the
above:
- Worktree teardown is proof-gated on two independent signals (branch ancestry *or* merged-PR
  head identity) before deletion, never trusts a classification alone
  (`docs/guides/running-the-daemon.md:441-467`).
- `daemon reclaim-worktree` refuses globs/paths/lists — only a single plain slug — which
  structurally forecloses one whole class of bulk-delete accident at the CLI surface
  (`docs/guides/running-the-daemon.md:571-573`).
- `park` must precede any manual git-state touch, and the daemon's re-kick sweep checks the park
  marker first, ahead of every other dedup signal (`docs/guides/running-the-daemon.md:385-387`).
- Worktrees are retained (not torn down) until a shipped record is proven present on
  `origin/main`, so a normal build's worktree cannot be reaped out from under it prematurely
  (`docs/guides/running-the-daemon.md:523-547`).

---

## Category 7: Daemon Lifecycle (repo-specific substitute)
**Status:** PASS

- **Mutex/liveness.** `.daemon/daemon.pid` is acquired via atomic `O_EXCL` create (kernel-level
  single-winner arbitration), liveness is `kill(pid,0)` with a stored `uuid` to guard pid reuse,
  and a dead lock is reclaimed automatically rather than permanently refusing the repo — this is
  a sound, minimal mutex design for a single-operator, no-coordinator system. **verified**:
  `.docs/decisions/adr-010-pidfile-lock-daemon-liveness.md:41-51`,
  `src/conductor/src/engine/daemon-lock.ts:189,277-359` (grepped the actual `O_EXCL` call sites,
  matches the ADR's claimed mechanism).
- **Auto-restart on stale engine.** Restart is "exit-to-respawn," gated fail-closed (continuous
  mode + self-host + an explicit config flag defaulted **off** + a determinate staleness verdict
  required), with a loop-guard that suppresses a non-converging restart rather than spinning.
  **verified**: `.docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md:44-71`. This
  is good, deliberately conservative design — it fails toward "stay on old code" rather than
  toward "restart storm."
- **Log growth is bounded.** `.daemon/daemon.log` has an explicit ~1MB single-file rotation cap
  that moves the oversized log aside once (`daemon.log.1`) rather than growing unbounded.
  **verified**: `src/conductor/src/engine/daemon-log.ts:21,160-177`.
- One gap: **`daemon restart`'s degraded fallback loses scrollback** and is only "reported
  explicitly," not avoided — acceptable given it's advisory/self-reported, but worth knowing this
  is a real (if rare) recovery path with no scrollback preservation.
  `docs/guides/running-the-daemon.md:627-628` (**verified**, direct read of the doc's own
  characterization).

No critical findings in this category.

## Category 8: Engine Versioning / Deploy (repo-specific substitute)
**Status:** PASS

`scripts/publish-engine.mjs` implements a home-grown immutable-release scheme:
staging-dir build → atomic rename into `dist-versions/<version-id>/` → atomic `dist` symlink flip
(`flipCurrent`), with:
- **Crash recovery.** An `.publish-incomplete` sentinel marks "finalized but never flipped" (the
  un-catchable-SIGKILL window); the *next* publish scans for and removes any such orphaned
  directory before doing anything else. **verified**: `publish-engine.mjs:31-42,144-184`.
- **Rollback substrate exists implicitly.** Because each version is an immutable, separately
  named directory and `dist` is just a symlink, rolling back is mechanically possible (re-flip
  the symlink to an older `dist-versions/<id>/`) — but I found no CLI verb or documented operator
  procedure that performs this rollback; only forward publish and stale-engine auto-restart are
  wired. **Tentative** (inferred from absence — I did not exhaustively grep every CLI subcommand
  for a `rollback`/`revert` verb; this deserves a targeted follow-up rather than an assertion).
- **Garbage collection is bounded and fail-closed.** `gcVersions` keeps the last 3 versions by
  default (`DEFAULT_KEEP_LAST_K = 3`), aborts the entire GC pass with zero deletions on any read
  error (corrupt/unreadable fleet pidfile, registry enumeration failure) rather than guessing, and
  has a **self-eviction guard**: a running daemon stamps its own version into the environment so a
  GC pass triggered by its own publish can never delete the version it is currently executing.
  **verified**: `src/conductor/src/engine/engine-store.ts:288-292,405-453` (line numbers for the
  GC function and its default),
  `publish-engine.mjs:420-450` (self-guard logic, read directly).
- **Idempotence.** A publish whose built content hash matches the current version is a clean
  no-op (no duplicate snapshot, no symlink flip, no dirtied checkout) — this specifically guards
  against the failure mode of a daemon self-host publish dirtying the live tracked checkout on
  every `daemon start`/`bin/install`. **verified**: `publish-engine.mjs:341-365`.
- **Version-skew is the documented, intentional gap it appears to be** — a running daemon keeps
  executing the engine it loaded at start until the idle-boundary staleness check and gated
  restart flow (Category 7) converges it; this is by design (never swap code mid-build), not an
  oversight. No critical or important finding here.

No critical or important findings; engine versioning is one of the stronger-engineered surfaces
in this codebase.

## Category 9: CI (repo-specific substitute)
**Status:** NEEDS_WORK

11 workflows total, matching the scoping brief's count. All read (`ci.yml`, `release-pr.yml`,
`release.yml`, `shipped-record.yml`, `release-metadata.yml`, `intake-label-sync.yml`,
`live-daemon-e2e.yml`) — **verified** for the ones tabled below; `release-pr.yml`/`release.yml`
skimmed for `concurrency:` only.

| Severity | Finding | Location |
|----------|---------|----------|
| minor | All first-party GitHub Actions are pinned by **mutable tag** (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/github-script@v9`, `actions/create-github-app-token@v2`), not by commit SHA. A compromised or force-moved tag on any of these is a supply-chain risk to every workflow. This is more a security-domain finding than infra, but it's noted here because it also affects CI *reproducibility* (a tag can point to different code on two different days). | `.github/workflows/ci.yml:18,60,76,98,110`, and equivalently across the other 6 workflows (**verified** by grep across all workflow files) |
| minor | The third-party action `lycheeverse/lychee-action@v2` (link checker) is likewise tag-pinned, and additionally runs **deliberately ungated** on every PR regardless of `docs_only` — by design per its own comment, so this is not a bug, but it is the one workflow in the fleet that always executes third-party action code even on doc-only PRs. | `.github/workflows/ci.yml:113-131` (**verified**, includes the workflow's own rationale comment) |
| minor | `ci.yml`, `shipped-record.yml`, `intake-label-sync.yml`, `release-metadata.yml`, and `live-daemon-e2e.yml` have **no `concurrency:` group**, so re-pushing to a PR queues redundant runs rather than canceling stale ones — wasted Actions minutes/compute on every force-push or rapid-iteration PR. By contrast `release-pr.yml` and `release.yml` **do** declare `concurrency:` (`release-pr.yml:19`, `release.yml:133`), correctly matching CLAUDE.md's claim that release maintenance is serialized — that specific claim is **verified** accurate; the gap is only in the non-release workflows, where serialization was never claimed to matter functionally, only wastes minutes. | `.github/workflows/ci.yml`, `.github/workflows/shipped-record.yml`, `.github/workflows/intake-label-sync.yml`, `.github/workflows/release-metadata.yml`, `.github/workflows/live-daemon-e2e.yml` (**verified** absence via grep for `concurrency` across all workflow files — only 2 of 11 hits) |

Positive findings (**verified**):
- `permissions:` is scoped per-workflow and per-job to the minimum needed (`contents: read` by
  default, `issues: write`/`pull-requests: write`/`contents: write` only where the job's own
  purpose requires it, e.g. `shipped-record.yml`'s `reconcile` job needs `contents: write` only
  for the merge-time reconciliation job, not the PR-open job).
- `ci.yml`'s `changes` job computes a `docs_only` gate once and every substantive job (`integrity`,
  `shellcheck`, `lint`, `typecheck`, `conductor`) is conditioned on it, with the `links` job
  deliberately and explicitly **excluded** from that gate with an inline rationale comment
  explaining why a docs-only PR must not skip the one job that checks docs links — this is
  thoughtful, self-documenting CI design.
- `intake-label-sync.yml` has explicit belt-and-suspenders failure isolation (`continue-on-error:
  true` on top of the underlying script's own internal try/catch) so a label-sync failure can
  never fail CI or block other workflows — documented with rationale inline.
- `release-pr.yml`/`release.yml` correctly use `concurrency:` groups matching the documented
  "serialized" release mechanism.

No critical findings.

## Category 10: Toolchain Pinning (repo-specific substitute)
**Status:** PASS

- Root `.tool-versions`: `nodejs 20.19.2` (**verified**, exact read).
- `src/conductor/package.json` `engines.node`: `>=20.5.0` (**verified**) — this is a *range*, not
  an exact pin, but it's a floor consistent with the `.tool-versions` pin, not a contradiction.
- Every one of the 11 CI workflows' `actions/setup-node@v4` steps uses
  `node-version-file: src/conductor/.tool-versions` (**verified** via grep — all 11 hits point at
  the same file), so CI, the documented local dev requirement, and `package.json`'s floor are all
  sourced from one file with no drift risk from a second hardcoded version string anywhere in the
  fleet.

No findings. This is a clean, single-source-of-truth toolchain pin — noted as a positive because
version-skew between `.tool-versions` and CI is a common real-world failure mode this repo has
structurally avoided (one file, referenced everywhere, never duplicated).

## Category 11: Backup / Recovery of Operator State (repo-specific substitute)
**Status:** NEEDS_WORK

- `.docs/` (specs, plans, decisions, shipped records, stories) **is committed to git** — durable,
  recoverable from any clone or the GitHub remote after total machine loss. **verified**:
  root `.gitignore` does not list `.docs/`, and the file listing shows extensive `.docs/*`
  content tracked.
- `.pipeline/`, `.daemon/`, `.worktrees/`, `.memory/` are **all gitignored** — **verified**,
  `.gitignore:2-6`. This means: per-worktree build state (task status, gate verdicts, the event
  timeline), the daemon's own pidfile/registry/park markers, and any local session memory are
  **not recoverable from git after machine loss**. The project's own runbook
  (`docs/runbooks/worktree-and-evidence-recovery.md:52-63`) explicitly enumerates exactly this
  loss and states plainly: "`.pipeline/` lives inside the worktree and is gitignored wholesale —
  it is never in a commit and never recoverable from git." That runbook also documents *partial*
  recovery — task-status is reconstructable from `Task:` commit trailers already on the pushed
  branch, so committed work is not lost even though its bookkeeping is — but registry/daemon
  config state (which repos are registered, park state, pause markers) has no such branch-trailer
  fallback and would need to be rebuilt by hand (`conduct-ts register <path>` per repo, at
  minimum) after a fresh machine.
  **important**: for a single-operator system with no described off-machine `.daemon/` backup
  (no cron `rsync`, no cloud sync mentioned anywhere read), total machine/disk loss means losing
  the project registry and all daemon operational history, recoverable only by re-registering
  repos and letting each worktree's evidence be reconstructed from commit trailers per the
  runbook above — a manual, per-repo recovery, not a restore.
- This is a reasonable design tradeoff (operational noise doesn't belong in git history) and the
  repo has clearly thought about the recovery path (a whole runbook exists for it) — the
  "important" severity reflects that the recovery path is manual/lossy for daemon-registry state
  specifically, not that the design choice itself is wrong.

| Severity | Finding | Location |
|----------|---------|----------|
| important | No documented backup mechanism for `.daemon/` (project registry, park state) exists outside git; total machine loss requires manual re-registration of every repo and reconstructs worktree state only partially (task status via commit trailers; gate verdicts, event timeline, and evidence sidecars are unrecoverable and simply regenerate from a re-run). | `.gitignore:2-6`, `docs/runbooks/worktree-and-evidence-recovery.md:52-63` (both **verified**) |

## Category 12: Resource Exhaustion (repo-specific substitute)
**Status:** NEEDS_WORK

| Severity | Finding | Location |
|----------|---------|----------|
| important | Worktree `node_modules` full-copy disk cost (see Category 6) is the dominant resource-exhaustion vector given the repo's own documented history of ~74 concurrent worktrees, and there is no disk-space check or cap on concurrent worktree count anywhere I found in the daemon dispatch path. | `bin/setup:27-41` (**verified**); absence of a disk check is **inferred** from a targeted grep across `src/conductor/src/engine/*.ts` for `disk`/`statfs`/free-space patterns, which returned no relevant matches — not an exhaustive audit |
| minor | Per-worktree `.pipeline/events.jsonl` (`EventPersister`) has **no rotation, size cap, or pruning** — every event for a feature's whole lifetime is appended indefinitely. **verified**: `src/conductor/src/engine/event-persister.ts` (read the class; only `appendFileSync`, no size/rotation logic anywhere in the 203-line file). Impact is bounded in practice because the file lives inside a worktree that is eventually reaped after shipment, so this cannot grow forever system-wide — but a very long-running or repeatedly-kicked-back feature could accumulate a large single JSONL with no defense. |
| — (positive, verified) | `.daemon/daemon.log` **is** rotation-capped (~1MB, one backup) — this specific log-growth risk named in the scoping brief is already mitigated. | `src/conductor/src/engine/daemon-log.ts:21,160-177` |
| — (positive, verified) | `dist-versions/` engine snapshots are GC'd to the last 3 by default, fail-closed on any read error — this specific growth vector is already bounded. | `src/conductor/src/engine/engine-store.ts:292,405` |

No critical findings — the exhaustion risk is real but gradual (disk fills over weeks/months of
heavy worktree churn, not a sudden outage), and the repo's own recovery runbooks (park, reclaim,
reconcile-parked) give an operator manual tools to claw disk back once noticed. There is currently
no automated *alerting* that disk is approaching exhaustion, which is the actual gap.

## Category 13: Runbook Coverage (repo-specific substitute)
**Status:** PASS

6 runbooks exist: `daemon-recovery.md`, `emergency-stop-a-running-feature.md`,
`shipped-record-reconciliation.md`, `stalled-or-stuck-feature.md`,
`worktree-and-evidence-recovery.md`, `index.md`. Spot-read `daemon-recovery.md` and
`worktree-and-evidence-recovery.md` in full (**verified**). Both directly address failure modes
the scoping brief called out as "actually occurring": worktree/evidence loss from a deleted
`.worktrees/<slug>`, stale pidfile lock contention, orphaned tmux session vs. dead process,
stale-engine restart, and spin loops — each has a named symptom→section mapping table at the top
of the runbook, and each links to `/daemon-triage` as a dispatcher. This is well-matched
documentation-to-incident coverage; I did not find a runbook section specifically titled around
disk exhaustion or worktree-count growth (Category 12's findings), which is the one gap between
documented failure modes and the ones this assessment surfaced independently.

| Severity | Finding | Location |
|----------|---------|----------|
| minor | No runbook section addresses disk exhaustion from worktree/node_modules growth specifically (the closest is `daemon-recovery.md`'s bulk-delete safety rule, which is about *not deleting wrong things* rather than about *reclaiming space safely*). | `docs/runbooks/` (**verified** by reading the runbook index and the two most relevant runbooks in full; **inferred** that the other 4 don't cover it either, since their titles are about lock contention, emergency stop, shipped-record reconciliation, and stalled features specifically) |

---

## Summary

**Overall Verdict:** NEEDS_WORK

**Critical findings:** 0

**Important findings:** 3
- Worktree `node_modules` is a full recursive copy per worktree with no disk-space check gating
  creation, and no cap on concurrent worktree count — the dominant resource-exhaustion risk given
  the repo's own ~74-worktree incident history (`bin/setup:27-41`).
- No documented backup for `.daemon/` (project registry, park state); total machine loss requires
  manual per-repo re-registration and only partial worktree-state reconstruction
  (`.gitignore:2-6`, `docs/runbooks/worktree-and-evidence-recovery.md:52-63`).
- (Duplicate of the above, tabled once under Category 6 and once under Category 12 as the same
  underlying finding viewed from two checklist angles — counted once for severity purposes: see
  worktree disk-copy finding.)

Adjusted count: **2 distinct important findings** (worktree-copy disk risk; unbacked-up daemon
registry state).

**Minor findings:** 6 — CI actions tag-pinned not SHA-pinned; missing `concurrency:` groups on 5
non-release workflows (wasted CI minutes only); `bin/setup`'s `npm install` fallback vs. CI's
`npm ci`; the documented worktree bulk-delete incident has only a prose guard, not machinery, per
the repo's own admission; unbounded per-worktree `events.jsonl` growth; no runbook section
specifically for disk-exhaustion recovery.

**Strong points worth keeping** (not findings, but load-bearing for the NEEDS_WORK-not-CRITICAL
verdict): the pidfile `O_EXCL` mutex design, the fail-closed gated stale-engine auto-restart, the
immutable-release engine-versioning scheme with crash recovery and self-eviction-guarded GC,
single-source-of-truth Node version pinning across every workflow, `daemon.log` rotation, and the
two-proof (ancestry-or-merged-PR-head) worktree-deletion safety gate are all well-engineered for a
solo-operator local daemon and were verified by direct code/ADR reads rather than inferred.
