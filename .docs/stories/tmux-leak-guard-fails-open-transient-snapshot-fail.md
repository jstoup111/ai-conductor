**Status:** Accepted

# Stories: tmux-leak-guard fail-closed hardening (#437)

Track: technical (no PRD). Tier: S. Source: jstoup111/ai-conductor#437.
Governing decision: `.memory/decisions/tmux-leak-guard-fail-closed-approach.md` (Approach A).

Degradation contract (operator-approved): a leaked session that survives teardown is an
annoyance and is reported loudly; a killed production daemon is an outage. Whenever any
kill-authorizing signal is unavailable or negative, the guard degrades to report-only.

## Story: Snapshot failure disables reaping (fail-closed baseline)

**Requirement:** TR-1 — teardown must never reap against an empty-because-error baseline.

As the operator running vitest suites next to a live production daemon, I want a failed
suite-start session snapshot to disable teardown reaping entirely, so that a transient
tmux/spawn failure can never mark my healthy daemon as "leaked" and kill it.

### Acceptance Criteria

#### Happy Path
- Given the suite-start snapshot succeeds and returns the live session list, when teardown
  runs, then reaping proceeds against that baseline exactly as before.
- Given the suite-start snapshot fails (spawnSync error or non-zero tmux exit), when teardown
  runs with live `cc-daemon-*` sessions present (e.g. the operator's production daemon), then
  NO session is killed and a warning naming each visible `cc-daemon-*` session and the
  snapshot failure is emitted; the test run does NOT fail on account of these sessions.

#### Negative Paths
- Given the suite-start snapshot failed AND a genuine leak session was created during the run
  (tmpdir-rooted cwd), when teardown runs, then that session is also NOT killed (no baseline ⇒
  no kill authority) and it appears in the emitted warning — degradation is report-only, never
  a guess.
- Given the suite-start snapshot succeeded but the teardown-time session listing fails, when
  teardown runs, then no kill is attempted and no false "leak" failure is raised.
- Given tmux is not installed (spawn ENOENT at both snapshot and teardown), when the suite
  runs, then the guard is a silent no-op (no kills, no failure, no noisy warning) — CI runners
  without tmux stay green, preserving today's degrade-to-no-op behavior.

### Done When
- [ ] The snapshot API distinguishes "no sessions" from "snapshot failed" (e.g. returns
      `{ sessions, failed }` or equivalent), and `global-setup.ts` records the failure state.
- [ ] A regression test proves: failed baseline + live session ⇒ zero `kill-session`
      invocations at teardown.
- [ ] A regression test proves: failed baseline ⇒ teardown does not throw for sessions it can
      see (warn-only), while the warning text names the sessions and the snapshot failure.

## Story: tmpdir pane-cwd corroboration on every kill

**Requirement:** TR-2 — a kill requires a second independent signal: pane cwd resolves and is
under `os.tmpdir()`.

As the operator, I want every kill decision corroborated by the session's active pane cwd
being tmpdir-rooted, so that even a wrong baseline can never authorize killing a daemon whose
pane lives in a real repo checkout.

### Acceptance Criteria

#### Happy Path
- Given a successful baseline and a `cc-daemon-*` session created during the run whose active
  pane cwd resolves to a directory under `os.tmpdir()`, when teardown runs, then the session
  is killed and reported with its pane cwd (existing #377 behavior preserved) and the run
  fails naming it.

#### Negative Paths
- Given a successful baseline and a `cc-daemon-*` session absent from it whose active pane cwd
  is NOT under `os.tmpdir()` (e.g. a repo checkout under `$HOME`), when teardown runs, then the
  session is NOT killed; it is reported as indeterminate (name + cwd) via a warning and the run
  does not fail on account of it.
- Given a session absent from the baseline whose pane cwd cannot be resolved (display-message
  fails / `(unknown)`), when teardown runs, then the session is NOT killed and is reported as
  indeterminate — an unresolvable signal is a failed signal, never an implicit "yes".

### Done When
- [ ] The reap path evaluates pane cwd BEFORE any `kill-session`, and only kills when the cwd
      resolved successfully AND is under `os.tmpdir()` (prefix-safe comparison, e.g.
      `path.resolve` + separator-aware startsWith).
- [ ] A regression test proves: non-tmpdir-cwd session absent from the baseline survives
      teardown and appears in the indeterminate report.
- [ ] A regression test proves: unresolvable-cwd session absent from the baseline survives
      teardown.
- [ ] The existing real-tmux leak test (tmpdir-rooted fixture leak IS killed and reported,
      run fails) still passes unmodified in behavior.

## Story: Guard header contract matches the implementation

**Requirement:** TR-3 — the module's documented guarantee must state the two-signal,
fail-closed contract so future edits don't reintroduce fail-open.

As a future maintainer, I want the guard's header comment and report wording to state the
fail-closed contract (baseline signal + tmpdir cwd signal, report-only degradation), so that
the "never touched" guarantee is auditable against the code.

### Acceptance Criteria

#### Happy Path
- Given the merged change, when reading `tmux-leak-guard.ts`, then the header documents: the
  two kill-authorizing signals, that either signal failing degrades to report-only, and that a
  failed snapshot disables reaping.

#### Negative Paths
- Given a kill-and-fail leak report and a warn-only indeterminate report, when reading their
  wording, then the two are textually distinct (a reader/log-parser can tell "killed leak"
  from "indeterminate, not killed") — no shared ambiguous phrasing.

### Done When
- [ ] Header comment updated to the two-signal fail-closed contract.
- [ ] Kill reports and indeterminate warnings use distinct, greppable prefixes.
