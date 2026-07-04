**Status:** Accepted

# Stories: Daemon Lifecycle Controls

**PRD:** `.docs/specs/2026-07-04-daemon-lifecycle-controls.md`
**ADRs:** adr-2026-07-04-versioned-engine-store-atomic-flip, adr-2026-07-04-durable-pause-marker,
adr-2026-07-04-respawn-in-place-restart, adr-2026-07-04-pending-restart-queue
**Source:** jstoup111/ai-conductor#215

---

## Story: Pause stops new work pickup while in-flight work drains

**Requirement:** FR-1

As an operator, I want to pause a repo's daemon so that it stops dispatching new work
while finishing what it already started.

### Acceptance Criteria

#### Happy Path
- Given a running daemon with two eligible backlog items and one feature in flight,
  when the operator pauses the repo, then no new item is dispatched at any subsequent
  tick, the in-flight feature runs to its normal completion, and the daemon stays
  alive and standing by.
- Given a paused daemon, when its in-flight feature HALT-parks instead of finishing,
  then parking proceeds exactly as unpaused (HALT marker written, item parked) and
  the daemon idles without dispatching.

#### Negative Paths
- Given a paused repo whose durable pause state is unreadable due to a permission
  error (not merely absent), when the daemon evaluates dispatch, then it treats the
  repo as paused, dispatches nothing, and emits a warning identifying the degraded
  read — ambiguity never dispatches work.
- Given a paused daemon, when a newly merged spec appears in the backlog, then
  discovery may observe it but no dispatch occurs until resume.
- Given a paused daemon with HALT-parked work, when the base branch advances (the
  re-kick trigger), then no re-kick dispatch occurs while paused; the re-kick becomes
  eligible again on resume. (Pause gates EVERY dispatch path, including
  halted-work re-kick — added by conflict-check vs adr-013.)

### Done When
- [ ] Daemon-loop test: with pause state set, the fill-pool boundary dispatches zero
      items across multiple ticks while `discoverBacklog` returns eligible work.
- [ ] Test: in-flight work injected before pause completes/parks normally; no new
      dispatch afterward.
- [ ] Test: injected pause-state read error (EACCES) → zero dispatch + warning logged.

---

## Story: Resume restores pickup with nothing lost

**Requirement:** FR-2

As an operator, I want resume to be the exact mirror of pause so that pausing costs
the repo nothing but time.

### Acceptance Criteria

#### Happy Path
- Given a paused daemon with eligible backlog items queued, when the operator resumes
  the repo, then the next tick dispatches exactly the item the scheduler would have
  chosen had the pause never happened (ordering, priority, and ledger state unchanged).
- Given a repo paused and resumed, when backlog state is compared before/after, then
  ledger entries, processed markers, and ordering inputs are byte-identical.

#### Negative Paths
- Given a paused daemon whose backlog gained new higher-priority work during the
  pause, when resumed, then the scheduler's normal ordering decides (pause inserted no
  artificial ordering), and nothing queued before the pause was dropped.
- Given a resume that races a tick in progress, when the pause state is removed
  mid-tick, then the daemon dispatches no earlier than the next boundary and never
  double-dispatches an item.

### Done When
- [ ] Test: pause → enqueue work → resume → dispatch order equals the no-pause control
      run.
- [ ] Test: backlog/ledger state assertions before pause and after resume are equal.
- [ ] Test: concurrent resume-during-tick dispatches each item at most once.

---

## Story: Pause and resume act on one, several, or all repos

**Requirement:** FR-3

As an operator, I want one command to pause or resume a chosen set of daemons (or the
whole fleet) so that quiescing doesn't scale linearly with repo count.

### Acceptance Criteria

#### Happy Path
- Given three registered repos, when the operator pauses two by name, then both named
  repos are paused, the third is untouched, and the output reports each repo's outcome
  on its own line.
- Given the all-repos form, when invoked, then every registered repo is paused and
  individually reported.

#### Negative Paths
- Given a fleet pause where one repo's path no longer exists on disk, when invoked,
  then that repo reports a clear per-repo error and every other repo is still paused
  (no abort — FR-17 behavior at this call site).
- Given an empty registry, when the all-repos form is invoked, then the command
  reports "no registered repos" and exits successfully (not a crash or silent nothing).

### Done When
- [ ] CLI test: subset selection pauses exactly the named repos; unnamed repo's state
      unchanged.
- [ ] CLI test: `--all` iterates every registry entry; per-repo outcome lines present.
- [ ] CLI test: missing-path repo → per-repo error, remaining repos succeed, non-zero
      detail surfaced without failing the whole action.

---

## Story: Pause state survives crashes, reboots, and automation launches

**Requirement:** FR-4

As an operator, I want a pause to stick until I lift it so that no crash, restart, or
automation can silently un-quiesce a repo.

### Acceptance Criteria

#### Happy Path
- Given a paused repo whose daemon process is killed hard, when a new daemon starts in
  that repo, then it comes up paused (logs its paused state at boot, dispatches
  nothing).
- Given a paused repo with no running daemon, when spec-handoff automation ensures the
  daemon is running, then the daemon launches (launch-not-manage preserved) and
  immediately honors the pause — zero dispatch.

#### Negative Paths
- Given a paused repo, when the daemon crashes mid-feature and is relaunched, then the
  relaunched daemon is still paused and the crashed feature follows its normal
  recovery path (no pause-triggered special casing).
- Given automation that ensures a daemon is running in a paused repo, when it runs
  repeatedly, then it never removes or overrides the pause state (automation has no
  resume capability).

### Done When
- [ ] Test: pause state set → daemon boot honors it and logs paused at startup.
- [ ] Test: `ensureRunning` path in a paused repo launches a daemon that dispatches
      nothing; pause state file untouched by automation.
- [ ] Test: kill + relaunch cycle preserves paused behavior.

---

## Story: Status shows paused as a first-class state

**Requirement:** FR-5

As an operator, I want status to distinguish paused from running, stopped, and stale
so that I can trust a glance at the fleet.

### Acceptance Criteria

#### Happy Path
- Given a paused repo with a live daemon, when status is queried, then the repo's row
  shows a distinct paused indicator (not the running badge) plus when/by whom it was
  paused.
- Given a mixed fleet (one running, one paused, one stopped, one stale pidfile), when
  status is queried, then each row shows its correct distinct state.

#### Negative Paths
- Given a paused repo whose daemon is dead but pause state remains, when status is
  queried, then the row shows both facts (paused + no live daemon), never a false
  "running" or a bare "stopped" that hides the pause.
- Given pause metadata that is corrupt JSON, when status renders, then the paused
  state still displays (existence is authoritative) with the metadata marked
  unavailable — no crash, no row omitted.

### Done When
- [ ] Status test: four-state fleet renders four visually distinct states.
- [ ] Status test: paused+dead combination renders both facts.
- [ ] Status test: corrupt metadata → paused shown, renderer does not throw.
- [ ] Status model uses an explicit state enum with exhaustive matching (no default
      arm swallowing unknown states).

---

## Story: Redundant pause/resume are honest no-ops

**Requirement:** FR-6 (negative FR)

As an operator, I want repeating a pause or resume to be safe so that scripts and
retries can be idempotent.

### Acceptance Criteria

#### Happy Path
- Given a paused repo, when paused again, then the command succeeds reporting
  "already paused" and the original pause metadata (time/actor) is preserved or
  refreshed deterministically — documented either way.
- Given a repo that is not paused, when resumed, then the command succeeds reporting
  "not paused" and no state is created.

#### Negative Paths
- Given rapid repeated pause/resume alternation, when the sequence ends on pause, then
  the final state is exactly paused (no lost updates, no leftover intermediate state).
- Given a resume of a repo that was never paused in its lifetime, when invoked, then
  exit is success with the no-op reported — never an error that would break a fleet
  script mid-iteration.

### Done When
- [ ] CLI tests: pause-when-paused and resume-when-not-paused both exit 0 with
      distinct no-op messages.
- [ ] Test: alternating sequence converges to the last operation's state.

---

## Story: A stopped repo can be paused in advance

**Requirement:** FR-7 (negative FR)

As an operator, I want to pause a repo whose daemon isn't running so that the pause is
waiting when anything later starts a daemon there.

### Acceptance Criteria

#### Happy Path
- Given a registered repo with no running daemon, when paused, then the command
  succeeds, status shows the repo paused (and not running), and a subsequently started
  daemon comes up paused.

#### Negative Paths
- Given a repo paused while stopped, when automation ensures a daemon is running,
  then the launched daemon dispatches nothing (advance pause holds against
  automation, not just manual starts).
- Given a repo paused while stopped and then resumed while still stopped, when a
  daemon later starts, then it dispatches normally (resume while stopped also works).

### Done When
- [ ] Test: pause with no live pidfile succeeds; status reflects paused+stopped.
- [ ] Test: daemon started after advance-pause dispatches zero items.
- [ ] Test: resume-while-stopped → later daemon dispatches normally.

---

## Story: Restart replaces the daemon with one on the newest engine

**Requirement:** FR-8

As an operator, I want restart to bring up a fresh daemon on the current engine
version while keeping the single-daemon guarantee.

### Acceptance Criteria

#### Happy Path
- Given an idle running daemon and a newly published engine version, when restarted,
  then the replacement process runs the newest version (visible in status), has a
  different pid, and holds the repo's single ownership lock.
- Given a restart, when ownership is inspected during the swap, then at no point do
  two live daemons both believe they own the repo.

#### Negative Paths
- Given the old process dies hard without releasing its ownership record, when the
  replacement starts, then it reclaims the stale record via the established
  liveness+uuid path and proceeds — restart is self-healing.
- Given a restart that races automation's ensure-running, when both act, then exactly
  one daemon results (lock arbitration), never two.

### Done When
- [ ] Test: post-restart pid differs, engine version recorded in the ownership record
      is the newest, single lock holder asserted.
- [ ] Test: stale-pidfile reclaim path exercised by the restart flow.
- [ ] Race test: restart + ensureRunning concurrently → exactly one live daemon.

---

## Story: Restart never interrupts a build — it queues and reports

**Requirement:** FR-9

As an operator, I want restarting a busy daemon to be safe and fire-and-forget so
that I never choose between waiting around and corrupting a build.

### Acceptance Criteria

#### Happy Path
- Given an idle or paused daemon, when restarted, then the swap happens immediately.
- Given a daemon mid-feature, when restarted, then the command returns at once
  reporting the restart is queued and which feature it is waiting on; when that
  feature finishes or parks, the daemon restarts itself at the idle boundary with no
  further operator action.

#### Negative Paths
- Given a queued restart, when the daemon crashes before the idle boundary, then the
  queued intent is consumed by the next daemon start (a fresh boot IS the restart) —
  it never fires a second time afterward.
- Given a restart requested twice while busy, when the daemon reaches idle, then
  exactly one restart fires.
- Given a queued restart whose self-trigger fails (session tooling error), when the
  failure occurs, then the daemon logs it and retries at the next idle boundary —
  it never exits without a successor arranged.

### Done When
- [ ] Test: busy daemon → command exits immediately, pending state + blocking feature
      visible in status.
- [ ] Test: in-flight completion → restart fires at sweep boundary (fake clock/idle
      injection).
- [ ] Tests: crash-before-fire consume-once; double-request single fire; failed
      trigger retries.

---

## Story: Fleet restart with per-repo outcomes

**Requirement:** FR-10

As an operator, I want one command to restart selected or all daemons so that fleet
upgrades are one action, not N.

### Acceptance Criteria

#### Happy Path
- Given three registered repos (two idle daemons, one busy), when fleet restart runs,
  then the two idle daemons swap immediately, the busy one reports queued-with-reason,
  and the output shows each repo's outcome individually.

#### Negative Paths
- Given a fleet restart where one repo's daemon is stopped, when invoked, then that
  repo reports its not-running outcome (per FR-12) and the others restart normally.
- Given a fleet restart where one repo path is missing, when invoked, then the error
  is confined to that repo's outcome line; remaining repos complete.

### Done When
- [ ] CLI test: mixed-state fleet → per-repo outcome lines (restarted / queued /
      not-running / error) all present and accurate.
- [ ] Test: one repo's failure does not short-circuit iteration.

---

## Story: Restarting a paused daemon yields a paused daemon

**Requirement:** FR-11

As an operator, I want pause to survive restart so that "pause fleet → upgrade →
restart fleet" leaves everything still safely quiesced until I resume.

### Acceptance Criteria

#### Happy Path
- Given a paused idle daemon, when restarted, then the restart fires immediately
  (paused counts as idle) and the replacement comes up paused on the new engine.

#### Negative Paths
- Given a paused daemon with a queued restart, when the restart fires, then the
  replacement is paused — the restart consumed its own intent but never touched the
  pause state.
- Given a paused daemon restarted and later resumed, when resumed, then dispatch
  begins with backlog intact (composition of FR-2 and FR-11 verified end-to-end).

### Done When
- [ ] Test: restart of paused daemon → new pid, new engine version, still paused,
      zero dispatch until resume.
- [ ] Test: pause state file unmodified by the restart flow.

---

## Story: Restarting a stopped daemon is a clear, safe outcome

**Requirement:** FR-12 (negative FR)

As an operator, I want restart on a not-running daemon to do something sensible and
tell me what it did.

### Acceptance Criteria

#### Happy Path
- Given a repo with no running daemon and no session, when restarted, then the daemon
  is started fresh (restart degrades to start) and the outcome says so explicitly.

#### Negative Paths
- Given a repo whose session exists but whose process is dead (visible corpse), when
  restarted, then the dead pane is revived in place — same session, fresh process —
  and the outcome reports the revival.
- Given a stale ownership record (dead pid) and no session, when restarted, then the
  stale record is reclaimed and a fresh daemon starts — never a hang waiting on a
  dead process, never an unexplained silent exit.

### Done When
- [ ] Test: no-daemon/no-session restart → started, reported as such, exit 0.
- [ ] Test: dead-pane revival keeps the session identity.
- [ ] Test: stale pidfile + restart → reclaim + fresh start, no hang (bounded time).

---

## Story: Rebuilding the engine never crashes a running daemon

**Requirement:** FR-13

As a harness maintainer, I want to rebuild the shared engine at any time without
auditing which daemons are running.

### Acceptance Criteria

#### Happy Path
- Given a running daemon started before a rebuild, when the engine is rebuilt and
  published, then the daemon continues operating on the version it started with —
  including functionality it loads lazily for the first time *after* the rebuild —
  with no error.
- Given two consecutive rebuilds while a daemon runs, when the daemon later exercises
  late-loading functionality, then it still resolves within its original version.

#### Negative Paths
- Given a rebuild published mid-way through a daemon's lazy load, when the publish
  switches the current version at the same moment, then the daemon's load completes
  from its pinned version (atomic switch: wholly-old or wholly-new, never missing).
- Given a raw build invoked the old way (habit path), when it targets the live
  layout, then it fails loudly with an actionable message instead of recreating the
  in-place-clobber hazard.
- Given a build that crashes partway, when inspected, then the previously current
  version is untouched and still what new processes get.

### Done When
- [ ] **Real-binary smoke (the #215 acceptance proof):** start a real daemon, run a
      real publish, then force a first-time lazy import in the old daemon — no ENOENT,
      correct behavior; after restart the daemon reports the new version.
- [ ] Test: publish flow is staging → finalize → atomic switch; live version dirs are
      never written in place.
- [ ] Test: legacy build entry against the live layout exits non-zero with guidance.
- [ ] Test: interrupted publish leaves the current version untouched.

---

## Story: Version visibility — restart adopts the newest engine

**Requirement:** FR-14

As an operator, I want to see which engine version each daemon runs so that I know
who still needs a restart after an upgrade.

### Acceptance Criteria

#### Happy Path
- Given daemons started before and after a publish, when status is queried, then each
  row shows that daemon's actual running version (old for pre-publish, new for
  post-publish).
- Given a restart after a publish, when status is queried, then the repo now shows
  the newest version.

#### Negative Paths
- Given an ownership record written by an older engine that lacks the version field,
  when status renders, then the row shows version-unknown (honest absence) — never a
  crash or a fabricated value (transition-window compatibility).
- Given a version dir that was garbage-collected after its daemon stopped, when
  status renders for that stopped repo, then no error results from the dangling
  reference.

### Done When
- [ ] Status test: mixed-version fleet renders per-daemon versions.
- [ ] Test: legacy record without the additive field renders version-unknown.
- [ ] Test: restart flips the reported version to the current publish.

---

## Story: Superseded engine versions are cleaned up safely

**Requirement:** FR-15

As a harness maintainer, I want old engine versions garbage-collected so that disk
use is bounded — but never at the cost of a running daemon.

### Acceptance Criteria

#### Happy Path
- Given several superseded, unreferenced, aged-out versions beyond the keep-window,
  when a publish runs, then those versions are deleted and current + referenced +
  recent + keep-window versions remain.

#### Negative Paths
- Given a version referenced by a live daemon's ownership record, when GC evaluates
  it — even if it is old and many publishes behind — then it is retained.
- Given a registry that fails to enumerate (unreadable, malformed), when GC runs,
  then **no deletion occurs at all** (fail-closed) and the publish itself still
  succeeds.
- Given an ownership record that is unreadable/corrupt for one repo, when GC runs,
  then deletion is skipped entirely (any read error poisons the delete pass, not just
  that repo's references).
- Given a version dir published moments ago (within minimum age), when GC runs, then
  it is never eligible regardless of reference state (protects the exec-to-pidfile
  startup window).

### Done When
- [ ] GC tests: each of the four conditions (not-current, unreferenced-by-live-pid,
      min-age, keep-last-K) independently blocks deletion.
- [ ] Test: enumeration error → zero deletions, publish exit 0, warning emitted.
- [ ] Test: keep-last-K honored even when all candidates are unreferenced and aged.

---

## Story: A broken current engine fails loudly, harms nothing running

**Requirement:** FR-16 (negative FR)

As an operator, I want a broken build to be impossible to miss and impossible to
spread.

### Acceptance Criteria

#### Happy Path
- Given a healthy published version, when a daemon starts, then it runs it (baseline).

#### Negative Paths
- Given a current pointer whose target is missing or incomplete, when any engine
  invocation starts (daemon start, restart, or CLI), then it fails fast with a
  message naming what is broken and how to fix it (rebuild/republish) — never a blank
  stack trace or a hang.
- Given a broken current pointer, when already-running daemons are observed, then
  they are unaffected (they never consult the pointer after start).
- Given a queued restart and a broken current version at fire time, when the swap is
  attempted, then the failure is visible in the session/scrollback and status, and
  the repo is recoverable by republishing + restart (documented, no wedged state).

### Done When
- [ ] Launcher test: dangling/incomplete current target → non-zero exit + actionable
      message.
- [ ] Test: running daemon unaffected by pointer breakage introduced mid-run.
- [ ] Test: failed swap leaves an inspectable state that a subsequent good publish +
      restart fully recovers.

---

## Story: Fleet actions are best-effort per repo

**Requirement:** FR-17

As an operator, I want one bad repo to cost me one line of output, not the whole
fleet action.

### Acceptance Criteria

#### Happy Path
- Given a healthy fleet, when any fleet-wide lifecycle action runs, then every repo
  is acted on and reported.

#### Negative Paths
- Given a fleet with one dead-stale daemon, one missing path, and one unreadable
  state dir, when a fleet action runs, then each failure is reported against its repo
  with a specific reason, all healthy repos complete, and the overall exit signals
  partial failure distinctly from total success.
- Given the first repo in iteration order failing, when the action runs, then later
  repos are still processed (no early abort).

### Done When
- [ ] Test matrix: each failure kind (stale, missing path, unreadable) is contained
      to its repo across pause, resume, and restart.
- [ ] Test: exit code / summary distinguishes all-succeeded from partial-failure.

---

## Story: Unknown repo names error clearly without sinking the batch

**Requirement:** FR-18 (negative FR)

As an operator, I want a typo in one repo name to be pointed out while my other named
repos are still acted on.

### Acceptance Criteria

#### Happy Path
- Given valid repo names, when a lifecycle action names them, then all are acted on.

#### Negative Paths
- Given a mix of two valid names and one unregistered name, when the action runs,
  then the unknown name is reported verbatim as unknown, both valid repos are acted
  on, and the exit signals partial failure.
- Given only unknown names, when the action runs, then nothing is acted on, each name
  is reported, and the exit is non-zero.

### Done When
- [ ] CLI test: mixed valid/unknown selection → valid acted on, unknown named in the
      error, partial-failure exit.
- [ ] CLI test: all-unknown → non-zero, zero side effects.

---

## Story: Lifecycle actions never leak across repos

**Requirement:** FR-19 (negative FR)

As an operator, I want per-repo actions to be surgically scoped so that pausing or
restarting one repo cannot disturb another.

### Acceptance Criteria

#### Happy Path
- Given repos A and B with running daemons, when A is paused and restarted, then B's
  daemon never misses a tick: its dispatch, session, ownership record, and state
  files are byte-for-byte untouched.

#### Negative Paths
- Given two registered repos with the same basename at different paths, when one is
  paused/restarted by path-distinct identity, then the other same-named repo is
  untouched (naming collision safety, per the established session/pathhash
  precedent).
- Given a fleet restart of only repo A, when A's swap runs, then B's engine version
  and process are unchanged (no accidental fleet-wide effect from a scoped action).

### Done When
- [ ] Test: A-scoped pause/restart leaves B's `.daemon/` contents and session
      untouched (snapshot comparison).
- [ ] Test: same-basename repos remain independent through lifecycle actions.

---

## Story: Restart keeps the operator's session, scrollback, and windows

**Requirement:** FR-20

As an operator, I want to stay attached through a restart so that restart stops
feeling destructive.

### Acceptance Criteria

#### Happy Path
- Given an operator attached to a daemon's session with accumulated scrollback, when
  the daemon is restarted, then the attachment survives, prior scrollback remains
  readable above the new process's boot output, and the session identity (name,
  windows, arrangement) is unchanged.

#### Negative Paths
- Given a session where the operator created extra windows, when restart runs, then
  only the daemon's own pane is respawned; operator windows are untouched.
- Given a host whose session tooling cannot respawn in place (feature missing), when
  restart runs, then it falls back to recreating the session and **explicitly
  reports** the continuity loss — degraded, never silent.
- Given a restart, when the old process resists termination, then the swap still
  completes (forced within the pane) and ownership passes cleanly (FR-8's reclaim).

### Done When
- [ ] **Real tmux smoke:** restart preserves session name, window layout, and
      pre-restart scrollback content; new pid inside the same session (standing
      real-binary convention — injected-runner argv tests alone are insufficient).
- [ ] Injected-runner tests: respawn argv targets exactly the daemon's pane with
      exact-name (=) targeting.
- [ ] Test: fallback path taken only on respawn failure and always reports the
      session loss in output/status.

---

## Story: Missing session never blocks a restart

**Requirement:** FR-21 (negative FR)

As an operator, I want restart/start to work from any starting condition so that
session preservation is a bonus, never a prerequisite.

### Acceptance Criteria

#### Happy Path
- Given a repo with no session (first start or externally killed session), when
  restart or start runs, then a session is created cleanly and the daemon boots in it.

#### Negative Paths
- Given a session killed externally while its daemon somehow survived (orphaned
  process), when restart runs, then the orphan is terminated, ownership is reclaimed,
  and a fresh session+daemon starts — one daemon, one session, no leak.
- Given session tooling entirely absent on the host, when restart runs, then the
  outcome is the established actionable error (install guidance), and the bare-run
  daemon path remains available and unaffected.

### Done When
- [ ] Test: no-session restart creates the canonical session and boots the daemon.
- [ ] Test: orphaned-process reconciliation ends with exactly one daemon and one
      session.
- [ ] Test: missing tooling → actionable error, bare-run unaffected.
