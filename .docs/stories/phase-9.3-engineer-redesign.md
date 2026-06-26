# Stories: Phase 9.3 (Redesign) — Engineer Loop, Intake Port & Daemon Liveness

**Source PRD:** `.docs/specs/2026-06-26-phase-9.3-engineer-redesign.md` (Approved, tier=Large)
**Traceability:** each story tags its `FR-N`. Every FR has ≥1 story; every story has concrete
happy + negative Given/When/Then and a measurable Done When.

---

## Group A — Agent-hosted engineer loop (rework)

## Story: Engineer loop starts and loads context

**Requirement:** FR-1

As the operator, I want `conduct engineer` to start an agent-hosted interactive loop that loads the
registry and engineer store, so that routing and the flywheel have data from the first idea.

### Acceptance Criteria

#### Happy Path
- Given a valid registry and 9.1 store on disk, when I run `conduct engineer`, then the loop starts,
  reports the count of known projects loaded from the registry, and signals it is ready for an idea.
- Given the store contains prior signals, when the loop starts, then the store is opened read-only
  and no signal file is mutated by startup.

#### Negative Paths
- Given the registry file does not exist or is unreadable, when I run `conduct engineer`, then the
  loop starts in **degraded mode** with zero known projects, prints a specific warning naming the
  missing registry path, and does **not** crash or exit non-zero.
- Given the 9.1 store directory is missing, when the loop starts, then it reports "no lessons
  available" and continues; flywheel reads later return empty rather than throwing.
- Given the loop is agent-hosted, when it starts, then it does **not** open a Node TTY REPL and does
  **not** spawn any `claude` subprocess (regression guard against the superseded design).

### Done When
- [ ] `conduct engineer` enters an interactive loop that accepts a first idea without further flags.
- [ ] Startup logs the loaded-project count and the store-open result (or degraded reasons).
- [ ] A test with a missing registry asserts exit code stays 0 and the loop remains usable.
- [ ] A test asserts no child process is spawned at startup.

---

## Story: Idea intake with persistent multi-idea loop

**Requirement:** FR-2

As the operator, I want each loop iteration to accept a free-text idea and keep context across ideas
until I exit, so that I can plan several features in one session.

### Acceptance Criteria

#### Happy Path
- Given the loop is ready, when I enter an idea, then it is accepted and processing begins for that
  idea; when that idea completes, the loop returns to ready for the next idea.
- Given I have processed one idea, when I enter a second idea, then context from the first (e.g.
  loaded projects, lessons cache) is still available without reloading from scratch.

#### Negative Paths
- Given the loop is ready, when I enter an empty/whitespace-only idea, then it is rejected with a
  specific prompt to re-enter and **no** routing/authoring begins.
- Given I issue the exit command, when the loop is mid-ready (no idea in flight), then it exits
  cleanly with code 0 and leaves no lock/temp artifacts behind.

### Done When
- [ ] Loop processes ≥2 ideas sequentially in one session in a test.
- [ ] Empty-idea input produces a re-prompt, asserted by test, with no side effects.
- [ ] Clean-exit test asserts exit code 0 and a clean working tree.

---

## Story: In-chat routing with operator confirmation (no subprocess)

**Requirement:** FR-3

As the operator, I want the engineer to propose a target repo by reasoning over the registry in chat
and wait for my confirmation before any write, so that nothing is authored in the wrong place.

### Acceptance Criteria

#### Happy Path
- Given an idea and a registry with matching projects, when routing runs, then a target repo is
  proposed with a brief rationale, **reasoned in-chat with no spawned `claude -p`**, and the engineer
  pauses for confirmation.
- Given a proposed repo, when I confirm, then authoring proceeds against that repo.

#### Negative Paths
- Given a proposed repo, when I **redirect** to a different repo, then the originally-proposed repo
  receives **no branch, no PR, and no working-tree change**; authoring targets only the redirected repo.
- Given routing is invoked, when it runs, then a test asserts **no `claude`/`claude -p` subprocess**
  is spawned for routing (regression guard).

### Done When
- [ ] Routing returns a proposal + rationale + a confirmation gate (no auto-proceed).
- [ ] Redirect test asserts the first repo is byte-for-byte unchanged (no new refs/files).
- [ ] Spawn-count assertion = 0 for the routing path.

---

## Story: One idea fans out across multiple repos

**Requirement:** FR-4

As the operator, I want an idea that spans repos to author per-repo after I confirm the set, so that
cross-cutting features are planned consistently in each affected repo.

### Acceptance Criteria

#### Happy Path
- Given an idea affecting repos A and B, when routing runs, then it proposes the set {A, B} and waits
  for confirmation; on confirm, authoring runs **independently** in A and in B (separate
  `spec/<slug>` branches and PRs).

#### Negative Paths
- Given the set {A, B}, when authoring in A fails (e.g. dirty tree), then B's authoring is unaffected
  and the failure is reported per-repo (no all-or-nothing abort that loses B's work).
- Given the proposed set {A, B}, when I deselect B before confirming, then only A is authored; B gets
  no branch/PR.

### Done When
- [ ] Multi-repo confirm produces one `spec/<slug>` branch + PR in each confirmed repo.
- [ ] A-fails-B-succeeds test asserts B still produces its artifacts + PR.
- [ ] Deselect test asserts B has no new refs.

---

## Story: Create a project when no registered project fits

**Requirement:** FR-5

As the operator, I want the engineer to offer `conduct create` when no registered repo fits an idea,
so that brand-new initiatives still get a home — but only if I opt in.

### Acceptance Criteria

#### Happy Path
- Given an idea matching no registered project, when routing runs, then the engineer offers to create
  a new project via 9.2 `create`; on my confirmation it scaffolds + registers the project and routes
  the idea there.

#### Negative Paths
- Given the create offer, when I **decline**, then no project is scaffolded, the registry is
  **unchanged**, and the idea is dropped with no repo/filesystem side effects.
- Given I accept create but scaffolding fails partway (e.g. target dir exists), then the registry is
  **not** left with a dangling entry pointing at an incomplete repo.

### Done When
- [ ] No-fit path presents an explicit create offer (not auto-create).
- [ ] Decline test asserts registry file hash is unchanged and no new directory created.
- [ ] Partial-scaffold-failure test asserts no half-registered entry remains.

---

## Story: Human-gated authoring produces real accepted artifacts (the core fix)

**Requirement:** FR-6

As the operator, I want authoring to run the real DECIDE skills in chat and emit `Status: Accepted`
artifacts on a `spec/<slug>` branch, so that the daemon can actually build them and the human gate is
respected — fixing the shipped divergence.

### Acceptance Criteria

#### Happy Path
- Given a confirmed target repo, when authoring runs, then brainstorm→stories→plan execute
  **human-gated in chat**, producing a PRD, stories, and a plan in the target repo's `.docs/` on a
  `spec/<slug>` branch.
- Given authoring completes, when the artifacts are inspected, then the stories file is real and
  carries `Status: Accepted` (no DRAFT) **and** the plan has a dependency tree, so the daemon's
  build-ready predicate passes.

#### Negative Paths
- Given authoring runs, when the produced stories are inspected, then they are **never** the stub
  form (`# Stories: <idea>\n\n_Generated by engineer._`) and **never** left at `Status: DRAFT`
  (regression guard — this is the exact bug being fixed); a stub or DRAFT result is a **test failure**.
- Given authoring runs, when process activity is observed, then **no `claude -p` subprocess** is
  spawned to author (regression guard).
- Given a DECIDE sub-step is not approved by the operator, when authoring proceeds, then it **blocks**
  at that gate and does not fabricate downstream artifacts.

### Done When
- [ ] Authoring yields PRD + stories + plan files on `spec/<slug>` in the target repo.
- [ ] Test asserts produced stories carry `Status: Accepted` (and the plan a dependency tree) and
      reject the stub string.
- [ ] Test asserts zero authoring subprocesses spawned.

---

## Story: Spec PR opened; engineer never builds or merges

**Requirement:** FR-7

As the operator, I want the engineer to open a spec PR and stop, so that my merge is the approval and
no autonomous build/merge ever happens.

### Acceptance Criteria

#### Happy Path
- Given authored artifacts on `spec/<slug>`, when handoff runs, then a PR is opened in the target
  repo containing those artifacts, and the engineer reports the PR URL and returns to the loop.

#### Negative Paths
- Given a spec PR is open, when the engineer continues, then it **never** calls `gh pr merge` and
  never runs a build for that feature; a test asserts `gh pr merge` is not invoked on any path.
- Given PR creation fails (e.g. `gh` not authenticated), then the engineer reports the failure with
  the branch name so the operator can open the PR manually, and does not silently swallow it.

### Done When
- [ ] Handoff opens a PR and surfaces its URL.
- [ ] Test/grep asserts no `gh pr merge` call exists on the engineer code path.
- [ ] PR-failure test asserts a clear error naming the branch, exit stays in-loop.

---

## Story: Flywheel read surfaces relevant prior lessons

**Requirement:** FR-8

As the operator, I want the engineer to read the 9.1 store and inject relevant prior lessons into
planning, so that successive plans improve instead of repeating mistakes.

### Acceptance Criteria

#### Happy Path
- Given seeded store signals for the target repo (kickbacks/halts/retry-hotspots + narrative refs),
  when planning context is assembled, then the **relevant** lessons for that repo / similar features
  are surfaced into the context the plan is authored against.

#### Negative Paths
- Given the store has signals only for unrelated repos, when the flywheel read runs, then it surfaces
  **none** of them (no false-relevant noise) and planning proceeds without spurious lessons.
- Given the store file is corrupt/unparseable, when the read runs, then it logs the parse failure and
  returns zero lessons rather than aborting planning.

### Done When
- [ ] Seeded-signal test asserts the matching lessons appear in planning context.
- [ ] Unrelated-signal test asserts zero lessons surfaced.
- [ ] Corrupt-store test asserts planning still completes with an empty lesson set + a logged warning.

---

## Story: Read-only governor reporting

**Requirement:** FR-9

As the operator, I want aggregate spend + kickback/halt/retry rates reported from the store, so that
I can see flywheel health without the engineer gating execution.

### Acceptance Criteria

#### Happy Path
- Given store signals, when I request the governor report, then it computes aggregate token spend and
  kickback/halt/retry rates and prints them.

#### Negative Paths
- Given the report runs, when it accesses the store, then it performs **no writes** to the store or
  registry (read-only) — asserted by a no-write spy/mtime check.
- Given the store is empty, when the report runs, then it prints zeroes/"no data" rather than
  dividing by zero or throwing.

### Done When
- [ ] Report prints spend + the three rates from seeded data.
- [ ] No-write assertion passes (store/registry mtime unchanged).
- [ ] Empty-store report renders without error.

---

## Story: Non-negotiable human gate — no idea→build without a merged spec PR

**Requirement:** FR-10

As the operator, I want a guarantee that nothing builds without my merged spec PR, so that the human
approval gate is structurally enforced, not just by convention.

### Acceptance Criteria

#### Happy Path
- Given an idea is taken all the way through authoring, when the engineer finishes, then the only
  artifact handed off is an **unmerged** spec PR; no build has run.

#### Negative Paths
- Given any engineer code path, when audited, then there exists **no** call that triggers a build or
  merges a PR for the authored feature; a test/grep asserts no `gh pr merge` and no build invocation.
- Given a proposed harness self-edit, when the engineer acts, then it is emitted as a PR through the
  existing validation/no-auto-merge gates, never auto-applied to the working tree.

### Done When
- [ ] End-to-end test confirms an idea yields an unmerged PR and zero builds.
- [ ] Static check asserts absence of merge/build calls on engineer paths.
- [ ] Self-edit test asserts a PR is produced, not a direct file mutation on main.

---

## Story: Cross-repo isolation during authoring

**Requirement:** FR-11

As the operator, I want authoring for repo A to be confined to A, so that planning one project never
corrupts another.

### Acceptance Criteria

#### Happy Path
- Given two registered repos A and B with distinct canonical paths, when the engineer authors for A,
  then all writes (branch, artifacts, PR) occur in A only.

#### Negative Paths
- Given authoring for A, when it completes, then repo B's working tree, branches, and PR list are
  **byte-for-byte unchanged** (asserted by snapshotting B before/after).
- Given a registry entry with a stale/incorrect path for A, when authoring resolves the target, then
  it fails fast with a clear error instead of writing into the current working directory or B.

### Done When
- [ ] Two-repo test asserts B is unchanged after authoring A.
- [ ] Stale-path test asserts a fail-fast error, no stray writes.
- [ ] All A writes occur under A's canonical path (path-prefix assertion).

---

## Story: Flywheel improvement is measurable

**Requirement:** FR-12

As the operator, I want to compute whether kickback/halt/retry rates fall across successive
engineer-planned features, so that I can tell the flywheel is learning, not just accumulating data.

### Acceptance Criteria

#### Happy Path
- Given store signals across ≥2 successive engineer-planned features, when the metric runs, then it
  reports the per-feature kickback/halt/retry rates and the trend (improving / flat / worsening).

#### Negative Paths
- Given only one feature's signals exist, when the trend is requested, then it reports "insufficient
  data for trend" rather than fabricating a slope.
- Given signals with missing rate fields, when the metric runs, then those records are excluded with
  a count of skipped records, not silently treated as zero.

### Done When
- [ ] Multi-feature test asserts a computed trend direction.
- [ ] Single-feature test asserts the insufficient-data response.
- [ ] Malformed-record test asserts skipped-count reporting.

---

## Group B — Intake port + claude-session adapter

## Story: Intake port defines the Envelope contract

**Requirement:** FR-13

As a maintainer, I want the engineer core to depend only on an intake port whose contract is the
Envelope, so that adding a source later (9.3b) is one adapter file with zero core changes.

### Acceptance Criteria

#### Happy Path
- Given the intake port, when an adapter emits an Envelope
  `{ id, source, sourceRef, text, hintRepo?, status, receivedAt }`, then routing/DECIDE consume it
  through the port interface only, with no import of any concrete adapter.

#### Negative Paths
- Given an Envelope with `status` outside `pending|routed|deciding|done`, when it enters the port,
  then it is rejected with a validation error naming the bad field.
- Given the engineer core module graph, when inspected, then it imports the port interface and **not**
  the `claude-session` (or any) concrete adapter (loose-coupling assertion).

### Done When
- [ ] A typed Envelope schema exists and is validated at the port boundary.
- [ ] Invalid-status Envelope is rejected by test.
- [ ] Import/dependency test asserts core → port only (no concrete adapter import).

---

## Story: claude-session (chat) adapter captures ideas

**Requirement:** FR-14

As the operator, I want to drop an idea into the chat and have it become an Envelope, so that capture
is zero-friction and needs no external system.

### Acceptance Criteria

#### Happy Path
- Given I type an idea in the engineer chat, when the `claude-session` adapter runs, then it produces
  an Envelope with `source = "claude-session"`, a `sourceRef` identifying the chat turn, the idea
  `text`, and `status = "pending"`.

#### Negative Paths
- Given the adapter, when it builds an Envelope, then `sourceRef` is populated (never empty); an empty
  `sourceRef` is a validation failure, since idempotency depends on it.
- Given this phase, when the engineer is configured, then `claude-session` is the **only** wired
  adapter; no github-issues poll runs (deferred to 9.3b) — asserted by config/test.

### Done When
- [ ] Chat input yields a valid `claude-session` Envelope (asserted field-by-field).
- [ ] Empty-`sourceRef` test asserts rejection.
- [ ] Test asserts no github poll/timer is started in this phase.

---

## Story: Intake idempotency via source + sourceRef

**Requirement:** FR-15

As the operator, I want re-submitting the same idea reference to not double-process, so that an
accidental re-entry doesn't create two in-flight features.

### Acceptance Criteria

#### Happy Path
- Given an Envelope with `source=X, sourceRef=Y` already in flight or done, when an Envelope with the
  same `(X, Y)` arrives, then it is recognized as a duplicate and **not** processed a second time.

#### Negative Paths
- Given two Envelopes with the **same** `text` but **different** `sourceRef`, when both arrive, then
  **both** are processed (the dedup key is `source+sourceRef`, not text — no false-positive blocking
  of a legitimately re-stated idea).
- Given a duplicate `(X, Y)`, when it is rejected, then the rejection is reported (not silent) so the
  operator knows it was a dedup, not a dropped idea.

### Done When
- [ ] Same `(source, sourceRef)` second submission is a no-op against the first (asserted).
- [ ] Same-text/different-`sourceRef` test asserts BOTH process (no false positive).
- [ ] Dedup rejection emits a visible "duplicate" signal.

---

## Story: Empty Envelope text is rejected, not dropped

**Requirement:** FR-16

As the operator, I want a malformed/blank idea to be rejected with a clear error, so that a blank
never silently consumes a slot or routes to nowhere.

### Acceptance Criteria

#### Happy Path
- Given an Envelope with non-empty `text`, when it enters the port, then it validates and proceeds.

#### Negative Paths
- Given an Envelope with empty or whitespace-only `text`, when it enters the port, then it is
  **rejected with a specific validation error** and is **not** silently dropped or processed as blank.
- Given an Envelope missing a required field entirely (e.g. no `text` key), when validated, then it is
  rejected naming the missing field.

### Done When
- [ ] Non-empty text validates and proceeds.
- [ ] Whitespace-only `text` test asserts an explicit rejection error (not a silent drop).
- [ ] Missing-field test asserts a field-named validation error.

---

## Group C — Daemon liveness, 1-per-repo & ensure-running

## Story: Pidfile lock is the 1-per-repo mutex

**Requirement:** FR-17

As a maintainer, I want `.daemon/daemon.pid` created atomically with `O_EXCL` to be the single source
of truth for "a daemon owns this repo", so that liveness and the mutex are the same primitive.

### Acceptance Criteria

#### Happy Path
- Given no pidfile exists, when a daemon starts, then it creates `.daemon/daemon.pid` with
  `{ pid, uuid, startedAt }` using `O_EXCL`, and proceeds as the repo's owner.

#### Negative Paths
- Given a pidfile already exists for a **live** pid, when a second daemon attempts to start, then the
  `O_EXCL` create fails, the second daemon does **not** start, and it reports the existing owner.
- Given the `.daemon/` directory does not exist, when a daemon starts, then it is created first; a
  failure to create the lock (e.g. permission denied) aborts start with a specific error, not a
  silent unguarded run.

### Done When
- [ ] Fresh start writes a valid pidfile (fields asserted).
- [ ] Live-owner second start fails the `O_EXCL` create and refuses to run.
- [ ] Lock-create failure aborts with a named error.

---

## Story: Liveness via process.kill(pid, 0)

**Requirement:** FR-18

As a maintainer, I want liveness determined by `process.kill(pid, 0)`, so that ownership is decided by
true process existence, not a heartbeat threshold.

### Acceptance Criteria

#### Happy Path
- Given a pidfile whose pid is a running process, when liveness is checked, then `kill(pid, 0)`
  succeeds and the daemon is treated as alive.

#### Negative Paths
- Given a pidfile whose pid does not exist, when liveness is checked, then `kill(pid, 0)` throws
  `ESRCH` and the daemon is treated as **dead** (stale lock).
- Given a pid that exists but is not ours (e.g. `EPERM`), when liveness is checked, then it is treated
  as **alive** (conservative — do not reclaim a lock we can't prove is dead).

### Done When
- [ ] Live pid → alive (asserted with the current process pid).
- [ ] Non-existent pid → dead via `ESRCH` handling.
- [ ] `EPERM` → treated as alive (no false reclaim).

---

## Story: Stale pidfile after kill -9 is reclaimed and respawned

**Requirement:** FR-19

As the operator, I want a daemon killed with `kill -9` (leaving a stale pidfile and possibly a
half-built worktree) to be recovered on the next ensure-running, so that a repo is never permanently
stuck.

### Acceptance Criteria

#### Happy Path
- Given a stale `.daemon/daemon.pid` (file present, pid dead) and a possibly dirty/half-built
  worktree, when ensure-running runs, then it detects the dead pid, **reclaims** the lock (atomic
  replace), and spawns a fresh daemon.

#### Negative Paths
- Given a stale pidfile, when reclaim runs, then the repo is **never permanently refused** — a second
  ensure-running after a crash always recovers (no "locked forever" state).
- Given reclaim races with another reclaimer, when both try to take the freed lock, then exactly one
  succeeds (reclaim itself goes through the `O_EXCL` mutex), the other no-ops.

### Done When
- [ ] kill-9-then-ensure-running test asserts a new daemon owns the repo and the pidfile holds the new
      pid.
- [ ] Repeated-crash test asserts recovery every time (never permanent refusal).
- [ ] Concurrent reclaim test asserts a single winner.

---

## Story: Concurrent daemon starts in one repo — exactly one wins

**Requirement:** FR-20

As a maintainer, I want two simultaneous daemon starts in one repo to resolve to exactly one running
daemon, so that the repo never has two builders racing on the same worktree.

> *Note (PRD Open Questions):* the `O_EXCL`-single-winner model is the current-iteration contract and
> is expected to change in a future phase; keep this behavior isolated behind the lock module.

### Acceptance Criteria

#### Happy Path
- Given no pidfile, when two daemon starts are launched concurrently for the same repo, then exactly
  one wins the `O_EXCL` create and runs; the other observes the lock and **no-ops** cleanly.

#### Negative Paths
- Given the concurrent race, when the loser no-ops, then it exits 0 (no crash, no error spam) and
  leaves the winner's pidfile intact (does not delete or overwrite it).
- Given the race, when it resolves, then **at no point** do two daemons both pass the lock gate
  (asserted by counting successful lock acquisitions = 1).

### Done When
- [ ] Concurrent-start test asserts exactly one daemon acquires the lock.
- [ ] Loser exits 0 and does not mutate the winner's pidfile.
- [ ] Successful-acquisition count == 1 under the race.

---

## Story: ensure-running spawns only when needed (not manage)

**Requirement:** FR-21

As the operator, I want the engineer to ensure a daemon is running for a repo after landing artifacts
— spawning iff none is alive — so that work gets picked up without the engineer owning daemon
lifecycle.

### Acceptance Criteria

#### Happy Path
- Given artifacts landed for repo X and **no** live daemon for X, when ensure-running runs, then it
  spawns a detached daemon for X (fire-and-forget) and returns immediately.
- Given a **live** daemon already owns X, when ensure-running runs, then it **no-ops** (the running
  daemon will pick up the new spec on its next poll).

#### Negative Paths
- Given a live daemon for X, when ensure-running runs, then it does **not** kill, restart, throttle,
  or send any control signal to the daemon (no management) — asserted by no second spawn and no
  signal sent.
- Given a stale lock for X, when ensure-running runs, then it follows the reclaim path (FR-19) and
  spawns exactly one new daemon.

### Done When
- [ ] No-live-daemon test asserts exactly one detached spawn.
- [ ] Live-daemon test asserts zero spawns and zero signals.
- [ ] Stale-lock test asserts one reclaim + one spawn.

---

## Story: Fix launchDaemonDetached to use cwd and wire it into ensure-running

**Requirement:** FR-22

As a maintainer, I want `launchDaemonDetached` to spawn the daemon with `cwd: repoPath` (the daemon
reads its working directory) instead of the non-existent `--project` flag, and to actually be called
by ensure-running, so that the launch path works at all.

### Acceptance Criteria

#### Happy Path
- Given a target repo path, when `launchDaemonDetached` runs, then it spawns the real daemon CLI form
  with `cwd: repoPath`, `detached: true`, `stdio: 'ignore'`, and unrefs the child.
- Given ensure-running needs to spawn, when it runs, then it **calls** `launchDaemonDetached` (the
  function is no longer dead code).

#### Negative Paths
- Given the spawn args, when inspected, then they do **not** contain the non-existent `--project`
  flag (regression assertion on the exact bug).
- Given a spawned daemon, when it starts, then it operates on `repoPath` (its cwd), not the engineer's
  own working directory — asserted by the daemon writing its pidfile under `repoPath/.daemon/`.

### Done When
- [ ] `launchDaemonDetached` spawns with `cwd: repoPath` and no `--project` (asserted on spawn args).
- [ ] ensure-running invokes `launchDaemonDetached` (call-site test).
- [ ] Spawned daemon's pidfile lands under the target repo, proving correct cwd.

---

## Story: Non-authoritative registry daemonState mirror

**Requirement:** FR-23

As the operator, I want the engineer to optionally mirror daemon liveness into the registry
`daemonState` for the governor's reporting, while the pidfile stays authoritative, so that reports are
informative without becoming a second source of truth.

### Acceptance Criteria

#### Happy Path
- Given a daemon is confirmed alive via the pidfile, when the engineer updates reporting, then it may
  write `daemonState` into the registry for that repo, labeled as derived/non-authoritative.

#### Negative Paths
- Given the registry `daemonState` says "running" but the pidfile shows a dead pid, when
  ensure-running decides, then it trusts the **pidfile** (spawns/reclaims) and does **not** rely on
  `daemonState` — asserted by a stale-registry/dead-pidfile test.
- Given the registry write fails, when mirroring, then the liveness decision and loop are unaffected
  (mirror failure is non-fatal).

### Done When
- [ ] Mirror writes `daemonState` only as derived data.
- [ ] Stale-registry/dead-pidfile test asserts the pidfile wins the decision.
- [ ] Registry-write-failure test asserts the loop continues.

---

## Group D — Handoff invariant

## Story: Merging the spec PR is the build-ready signal

**Requirement:** FR-24

As the operator, I want the daemon to build only specs present on `main` (so merging the spec PR is
the trigger), with the existing build-ready predicate unchanged, so that the human merge is the
handoff and nothing builds prematurely.

### Acceptance Criteria

#### Happy Path
- Given a spec PR is **merged** to `main`, when the daemon scans the working tree, then the
  build-ready predicate passes for that slug: plan exists + stories `Status: Accepted` (no DRAFT) +
  plan has a dependency tree + slug not in `.daemon/processed/`.

#### Negative Paths
- Given a spec PR is **open but unmerged**, when the daemon scans `main`, then the slug is **not**
  build-ready and no build starts (the artifacts aren't on main yet).
- Given a merged spec whose stories are still `Status: DRAFT`, when the predicate runs, then it is
  **not** build-ready (guards against the superseded stub-story regression reaching build).
- Given a slug already in `.daemon/processed/`, when scanned, then it is skipped (no rebuild).

### Done When
- [ ] Merged-spec test asserts build-ready predicate passes.
- [ ] Unmerged-PR test asserts not build-ready (no build).
- [ ] DRAFT-stories-on-main test asserts not build-ready.
- [ ] Already-processed slug is skipped.
