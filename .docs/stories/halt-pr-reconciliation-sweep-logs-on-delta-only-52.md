**Status:** Accepted

# Stories: Halt-PR reconciliation sweep logs on delta only

Technical track (no PRD). Source: jstoup111/ai-conductor#521. Tier S — happy +
negative paths per behavior. The sweep's healing actions are unchanged; only
which log lines it emits changes. "Log on delta" = a per-PR line is emitted only
when that PR's observed outcome differs from the last sweep's outcome for the
same PR, or when the sweep takes an action on it.

---

## Story 1: Steady-state all-conforming sweep is silent

**Requirement:** #521 desired outcome 1 ("a steady-state sweep in which every
marked PR is already conforming and no action is taken produces no per-PR log
lines").

As a daemon operator, I want a reconciliation sweep that finds every marked PR
already conforming (draft + labeled) and unchanged since the previous sweep to
emit no log lines, so that `tail`-based checks and log watchers surface real
events instead of no-op sweep spam.

### Acceptance Criteria

#### Happy Path
- Given a persistent per-run outcome cache already holding
  `conforming` for every currently-marked PR, and a sweep in which those same
  PRs are all still draft+labeled and no PR set membership changed, when the
  sweep runs, then the injected `log` receives zero lines (no per-PR
  "already conforming … skipping" lines and no summary line).
- Given the same steady state repeated across N consecutive sweeps, when all N
  run, then the total number of logged lines is zero (the 79-sweeps-in-80-min
  idle case from #521 produces silence, not 308 lines).

#### Negative Paths
- Given an unmarked PR (no body marker) that is present every sweep, when the
  sweep runs in steady state, then it is never logged (unmarked PRs were never
  logged before and remain silent — no regression that starts logging them).
- Given the cache holds `conforming` for a PR that is NO LONGER in the open-PR
  list (merged/closed), when the next sweep runs, then that PR's stale cache
  entry is pruned and its absence produces no log line (pruning is silent).

### Done When
- [ ] A steady-state sweep over an all-conforming, unchanged marked-PR set with
      a warm cache emits zero lines through the injected `log`.
- [ ] A unit test asserts zero `log` calls across ≥3 repeated steady-state
      sweeps sharing one cache instance.

---

## Story 2: A newly-marked or state-changed PR is logged once

**Requirement:** #521 desired outcome 4 ("the first sweep that discovers a newly
marked or newly non-conforming PR still logs it") and outcome 1's "at most one"
bound.

As a daemon operator, I want the first sweep that observes a change in a PR's
reconciliation outcome to log that PR exactly once, so that genuine transitions
(a new halt PR, a PR that drifted out of conformance) are visible without
per-cycle repetition afterward.

### Acceptance Criteria

#### Happy Path
- Given a cache with no entry for PR X, and a sweep in which X is marked and
  already conforming (draft+labeled), when the sweep runs, then X's
  "already conforming … skipping" line is logged exactly once and the cache
  now records `conforming` for X.
- Given the immediately following sweep with X unchanged and its cache entry
  intact, when it runs, then X produces zero log lines (logged on the delta,
  silent thereafter).
- Given a PR X cached as `conforming` that has since drifted to
  non-conforming (e.g. label removed), when the next sweep runs, then X's
  transition is logged (the healing path in Story 3 fires — a state change,
  so it is not suppressed).

#### Negative Paths
- Given a summary line ("enumerated N open PRs, found M marked"), when a sweep
  emits at least one per-PR line OR the (open-count, marked-count) signature
  changed since the last sweep, then exactly one summary line is emitted;
  otherwise the summary line is suppressed (the summary is itself delta-gated,
  never a per-cycle constant).
- Given two distinct PRs both newly observed as conforming in the same sweep,
  when it runs, then each is logged exactly once (delta is tracked per PR URL,
  not collapsed across PRs).

### Done When
- [ ] A first-observation sweep logs a newly-marked conforming PR once; the next
      identical sweep logs it zero times.
- [ ] The summary line is emitted only when a per-PR line is emitted or the
      enumerated/marked counts changed, and suppressed in pure steady state.

---

## Story 3: A sweep that takes an action always logs it

**Requirement:** #521 desired outcome 3 ("sweeps that DO act (retitle,
re-draft, re-label a halt PR) still log what they changed and why — per-PR, as
today").

As a daemon operator, I want every sweep that heals a PR (flips it to draft,
adds the label, or otherwise calls `ensureHaltPresentation`) to log the healing
attempt and its result verbatim, so that no corrective action is ever silent
regardless of cache state.

### Acceptance Criteria

#### Happy Path
- Given a marked PR that is non-conforming (missing draft and/or label), when
  the sweep runs, then the existing `healing … isDraft=… hasLabel=…` line and
  the `healed (confirmed)` / `heal unconfirmed (will retry …)` result line are
  both logged, unchanged from today's wording.
- Given a PR that healed to `confirmed` this sweep, when the next sweep observes
  it now conforming for the first time, then that first post-heal conforming
  observation is logged once (a state change from `healed` → `conforming`),
  and subsequent unchanged sweeps are silent.

#### Negative Paths
- Given `ensureHaltPresentation` returns `unconfirmed` two sweeps in a row for
  the same PR, when both sweeps run, then BOTH sweeps log the healing attempt
  (an action attempted each tick is always logged — action lines are never
  delta-suppressed even when the outcome string is unchanged).
- Given `ensureHaltPresentation` throws for a PR, when the sweep runs, then the
  existing `error healing <url>: <err>` line is logged and the sweep continues
  to the next PR (error logging is verbatim and never suppressed).

### Done When
- [ ] Healing/`healed`/`unconfirmed`/`error healing` lines are emitted whenever
      an action is attempted, independent of the cache, with wording unchanged.
- [ ] A unit test asserts a repeated-`unconfirmed` PR logs its healing lines on
      every sweep (no action-line suppression).

---

## Story 4: Cache loss on restart re-logs the first post-boot observation

**Requirement:** #521 desired outcome 2 ("`tail -50` on an idle daemon still
shows the most recent real events") — guaranteed by re-establishing a visible
baseline after every boot.

As a daemon operator, I want the first sweep after a daemon restart (empty
cache) to log its full observation once and then fall silent, so that a
freshly-booted daemon leaves a current baseline in the log without resuming
per-cycle spam.

### Acceptance Criteria

#### Happy Path
- Given a fresh (empty) cache — the state at daemon boot — and a sweep over an
  all-conforming marked-PR set, when the sweep runs, then every marked PR's
  outcome is logged once (a full observation), the summary line is emitted
  once, and the cache is populated.
- Given the immediately following sweep with the now-warm cache and no state
  change, when it runs, then it emits zero lines (one full log, then quiet).

#### Negative Paths
- Given the cache is an in-memory structure that does NOT survive process exit,
  when the daemon restarts and the first sweep runs, then it re-logs the full
  observation (the design MUST NOT persist the cache to disk in a way that
  suppresses the first post-boot observation).
- Given a sweep whose `gh pr list` enumeration fails (throws), when it runs,
  then the existing `failed to enumerate PRs: <err>` line is logged, the sweep
  returns without touching the cache, and the next successful sweep still
  treats its observations as first-seen (an enumeration failure never advances
  the baseline).

### Done When
- [ ] The outcome cache is in-memory and owned per daemon run; a new run starts
      with an empty cache.
- [ ] A unit test with a fresh cache asserts a full-observation log on sweep 1
      and silence on sweep 2; a separate assertion confirms a second fresh cache
      re-logs (no cross-run suppression).

---

Status: Accepted
