# Stories: On-Demand Management of the Per-Repo Build Daemon

**Status:** Accepted

Derived from `.docs/specs/2026-06-29-daemon-supervised-hosting.md`. Behavior (WHAT)
only — mechanism lives in `.docs/plans/2026-06-29-daemon-tmux-supervisor.md`. The
operator-facing surface is the `conduct-ts daemon <verb>` command family.

---

## Story: Start a repo's daemon on demand (idempotent)

**Requirement:** FR-1, FR-2

As an operator, I want to start a repo's build daemon with one command so that the
backlog gets drained without me hunting for processes.

### Acceptance Criteria

#### Happy Path
- Given no daemon is running for the repo, when I run `daemon start`, then a daemon is
  hosted for the repo and reports as running.
- Given a daemon is already running for the repo, when I run `daemon start` again, then
  it is a no-op — the existing daemon is untouched and no second daemon is created.

#### Negative Paths
- Given the daemon-management substrate is unavailable on the host, when I run
  `daemon start`, then the command fails with an actionable message naming what is
  missing and how to enable it (FR-8) — no partial/half-started state.
- Given two `daemon start` invocations race for the same repo, when both run, then
  exactly one daemon ends up hosting the repo (the single-owner lock still holds).

### Done When
- [ ] `daemon start` with no prior daemon results in a running daemon and a written
      pidfile/lock for the repo.
- [ ] A second `daemon start` while one is live performs no spawn (verified: the host
      "already present" branch is taken, not the create branch).
- [ ] Missing-substrate path returns a non-zero result carrying the actionable error text.

---

## Story: Stop a repo's daemon on demand

**Requirement:** FR-3

As an operator, I want to stop a repo's daemon cleanly so that I can take it offline
without killing processes by hand.

### Acceptance Criteria

#### Happy Path
- Given a daemon is running for the repo, when I run `daemon stop`, then the daemon host
  is torn down and the repo's daemon lock is released.

#### Negative Paths
- Given no daemon is running for the repo, when I run `daemon stop`, then it is a safe
  no-op (success, not an error or a hang).
- Given the management substrate is unavailable, when I run `daemon stop`, then the
  command fails with the same actionable missing-substrate message (FR-8).

### Done When
- [ ] `daemon stop` on a running daemon removes the host and releases the lock.
- [ ] `daemon stop` on an absent daemon exits success with no side effects.

---

## Story: Restart a repo's daemon on demand

**Requirement:** FR-4

As an operator, I want to restart a repo's daemon so that I can recover from a wedged
run while keeping it the repo's single daemon.

### Acceptance Criteria

#### Happy Path
- Given a daemon is running for the repo, when I run `daemon restart`, then the running
  daemon is replaced by a fresh one (the inner process changes) and the repo still has
  exactly one daemon, reachable by the same management commands.

#### Negative Paths
- Given no daemon is running for the repo, when I run `daemon restart`, then a fresh
  daemon is started (restart subsumes start) rather than erroring.
- Given the management substrate is unavailable, when I run `daemon restart`, then the
  command fails with the actionable missing-substrate message (FR-8).

### Done When
- [ ] After `daemon restart`, the daemon's inner process identity differs from before but
      the management endpoint persists.
- [ ] Exactly one daemon hosts the repo after restart.

---

## Story: Watch a running daemon live (read-only)

**Requirement:** FR-5

As an operator, I want to connect to a running daemon and watch its live, full-color
activity so that I can see what it's doing without disturbing the build.

### Acceptance Criteria

#### Happy Path
- Given a daemon is running, when I run `daemon connect`, then I see its live output in
  full color, in real time, in **read-only** mode (my input cannot alter the build).
- Given I am connected read-only, when I detach, then the daemon keeps running unaffected.

#### Negative Paths
- Given no daemon is running for the repo, when I run `daemon connect`, then I get a clear
  "not running — start it first" message, not an error dump or a hang (FR-9).
- Given the management substrate is unavailable, when I run `daemon connect`, then the
  command fails with the actionable missing-substrate message (FR-8).

### Done When
- [ ] `daemon connect` attaches in a read-only mode (verified: the read-only attach option
      is used, write input is rejected).
- [ ] Detaching from a connect session leaves the daemon running.
- [ ] Connect with no running daemon returns the "start it first" message.

---

## Story: Debug a running daemon (take interactive control)

**Requirement:** FR-6

As an operator, I want to take interactive control of a running daemon so that I can
pause the work, inspect, and then resume or restart it.

### Acceptance Criteria

#### Happy Path
- Given a daemon is running, when I run `daemon debug`, then I attach with read/write
  control: I can interrupt the in-progress work, inspect, and resume or restart.

#### Negative Paths
- Given no daemon is running for the repo, when I run `daemon debug`, then I get the same
  "not running — start it first" message (FR-9), not an error dump.
- Given the management substrate is unavailable, when I run `daemon debug`, then the
  command fails with the actionable missing-substrate message (FR-8).

### Done When
- [ ] `daemon debug` attaches in read/write mode (verified: full attach, no read-only flag).
- [ ] Debug with no running daemon returns the "start it first" message.

---

## Story: Check a repo's daemon status

**Requirement:** FR-7, FR-10

As an operator, I want a status command that tells me whether each repo's daemon is
running so that I know the fleet's state at a glance.

### Acceptance Criteria

#### Happy Path
- Given a repo's daemon is running, when I run `daemon status`, then the row shows it as
  running (with pid / since / last activity).
- Given a repo's daemon is not running, when I run `daemon status`, then the row shows it
  as stopped.

#### Negative Paths
- Given a repo whose daemon host is present but whose inner process is dead, when I run
  `daemon status`, then the row reports **stale** — distinguishable from a healthy running
  daemon (FR-10).
- Given a registered repo whose path is missing/unreadable, when I run `daemon status`,
  then that row reports the condition without crashing the whole sweep.

### Done When
- [ ] Status reflects running vs stopped per repo.
- [ ] A present-host-but-dead-process daemon is reported as a distinct "stale" state.
- [ ] One bad repo row never aborts the full status sweep.

---

## Story: Daemon management is isolated per repo

**Requirement:** FR-11

As an operator with multiple repos, I want each repo's daemon managed independently so
that acting on one never touches another — even when two repos share a name.

### Acceptance Criteria

#### Happy Path
- Given two distinct repos each with a running daemon, when I stop/restart one, then the
  other is unaffected.

#### Negative Paths
- Given two repos that share the same directory name (e.g. both `app`), when I start a
  daemon for each, then they get distinct daemon hosts and managing one never resolves to
  or disturbs the other (FR-11).

### Done When
- [ ] Two same-named repos produce distinct daemon host identities.
- [ ] A management action scoped to repo A leaves repo B's daemon running and untouched.

---

## Story: Engineer handoff ensures a daemon without disturbing the operator

**Requirement:** FR-12

As the engineer automation, I want to ensure a repo's daemon is running after routing a
spec so that the new work gets picked up — without stealing a session a human is watching.

### Acceptance Criteria

#### Happy Path
- Given a spec has just been routed to a repo with no running daemon, when the handoff
  runs ensure-running, then a daemon is started for that repo.

#### Negative Paths
- Given a daemon is already running for the repo, when the handoff runs ensure-running,
  then it is a no-op — no duplicate daemon, and an operator currently connected to it is
  not disturbed (FR-12).
- Given the handoff needs to inspect daemon state non-interactively, when it checks, then
  it reads the daemon's current state **without attaching** (so it never steals the
  operator's interactive session).

### Done When
- [ ] Handoff ensure-running starts a daemon only when none is live.
- [ ] When a daemon is live, ensure-running performs no spawn and no attach.
- [ ] Non-interactive state inspection uses a snapshot read, not an attach.

---

## Story: A daemon builds one feature at a time

**Requirement:** FR-13

As an operator, I want a daemon to build a single feature at a time so that when I
connect I see exactly the one feature currently in progress.

### Acceptance Criteria

#### Happy Path
- Given a daemon with multiple ready features, when it runs, then it builds them serially
  (one in progress at any moment), so a connect shows that single feature.

#### Negative Paths
- Given a request to run the daemon with more than one concurrent worker, when it starts,
  then concurrency is clamped to one and a clear log line explains that multi-build
  concurrency is out of scope (pointing at the plan).

### Done When
- [ ] Daemon concurrency is forced to 1 regardless of a higher requested value.
- [ ] A `>1` concurrency request emits the explanatory clamp log line.

---

## Story: The daemon builds correctly without the management layer

**Requirement:** FR-14

As an operator on a host without the management substrate, I want the daemon to still
build correctly so that management is a convenience, never a requirement.

### Acceptance Criteria

#### Happy Path
- Given a host where the management substrate is absent, when the daemon runs directly,
  then it discovers the backlog, builds features, and opens PRs exactly as before — the
  management layer is purely additive.

#### Negative Paths
- Given the management substrate is absent, when only management verbs (start/connect/…)
  are attempted, then those fail with the actionable message (FR-8), but the core daemon
  run is never blocked by the absence (FR-14) — the two paths are independent.

### Done When
- [ ] The daemon's core run path has no hard dependency on the management substrate
      (verified: bare-run completes with the substrate absent).
- [ ] Management-verb failure and core-run success are independent.

---

## Story: Management actions route consistently, never mis-firing a build

**Requirement:** FR-15

As an operator, I want a daemon-management command to always reach the management
machinery so that, e.g., a status check never accidentally launches a feature build.

### Acceptance Criteria

#### Happy Path
- Given I invoke a daemon-management action through the standard command surface, when it
  runs, then it reaches the daemon-management command path (start/stop/restart/connect/
  debug/status), not the feature-build path.

#### Negative Paths
- Given I run a daemon-management verb through the convenience wrapper (not the direct
  binary), when it runs, then it is forwarded to the daemon-management path — it must NOT
  be misinterpreted as a feature description and launch a build named after the verb
  (FR-15).
- Given an unknown daemon verb, when I run it, then I get a clear "unknown daemon command"
  message, not a silent fall-through to a build.

### Done When
- [ ] Every management verb dispatches to management, never to feature build, from both
      the direct binary and the convenience wrapper.
- [ ] An unrecognized daemon verb produces an explicit error, not a build.
