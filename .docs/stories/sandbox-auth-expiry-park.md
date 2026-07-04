**Status:** Accepted

# Stories: Sandbox auth-expiry park-and-poll

**Track:** technical (no PRD; requirements TR-1…TR-5 derive from
adr-2026-07-04-auth-failure-park-and-poll + architecture-review-2026-07-04-sandbox-auth-expiry-park)
**Source:** jstoup111/ai-conductor#210

---

## Story: Classify "Not logged in" as an auth failure, ordered before model handling

**Requirement:** TR-1

As the daemon operator, I want a failed headless invocation whose output matches the
CLI's login-error shape classified as `authFailure` — before model-availability or
retry handling — so that an auth window is never misread as a build defect or a dead
model.

### Acceptance Criteria

#### Happy Path
- Given a `claude -p` invocation that exits non-zero with output containing the CLI
  login-error signature ("Not logged in" / "Please run /login" / "Invalid API key"),
  when the provider classifies the result, then the result carries `authFailure: true`
  and `success: false`, and the flag propagates through `StepRunResult` to the
  conductor step loop.
- Given a result with `authFailure: true`, when the conductor handles it, then no
  model in the availability ladder is marked unavailable and no fallback-ladder step
  occurs.

#### Negative Paths
- Given an invocation that exits **zero** and whose output merely mentions
  "Not logged in" (e.g. build log text quoting the string), when classified, then
  `authFailure` is false and the step is treated as a normal success.
- Given a failed invocation whose output matches `MODEL_UNAVAILABLE_RE` but not the
  auth signature, when classified, then the existing model-fallback behavior runs
  unchanged (`authFailure` false).
- Given a failed invocation matching both the rate-limit signature and no auth
  signature, when classified, then the existing rateLimited no-budget-burn path runs
  unchanged.

### Done When
- [ ] `AUTH_FAILURE_RE` exists in `claude-provider.ts` beside the existing signature
      regexes, matched only when `exitCode !== 0`.
- [ ] `StepRunResult` exposes `authFailure`; `step-runners.ts` threads it through.
- [ ] Unit tests cover: signature match on failure → flag true; same text on
      success → flag false; model-unavailable and rate-limit outputs → flag false.
- [ ] A test asserts the model ladder's dead-model set is byte-identical before and
      after an auth-classified failure.

---

## Story: Pre-flight credential expiry check with fail-open

**Requirement:** TR-2

As the daemon operator, I want each self-host build dispatch preceded by a read of my
credentials' `claudeAiOauth.expiresAt` so that a dispatch that cannot authenticate is
never spawned.

### Acceptance Criteria

#### Happy Path
- Given operator credentials whose `expiresAt` is in the past (or within the
  imminent-expiry margin), when a self-host build attempt would dispatch, then no
  sandbox is provisioned, no process is spawned, and the attempt enters the shared
  park loop (TR-3) with the retry budget untouched.
- Given credentials whose `expiresAt` is comfortably in the future, when a build
  attempt dispatches, then provisioning and invocation proceed exactly as today.

#### Negative Paths
- Given a **missing** credentials file (env-key auth path), when the pre-flight runs,
  then it fails open: dispatch proceeds normally and nothing parks.
- Given a credentials file containing **malformed JSON**, when the pre-flight runs,
  then it fails open (dispatch proceeds) and the condition is logged, not thrown.
- Given a well-formed credentials file **without a `claudeAiOauth` block**, when the
  pre-flight runs, then it fails open (dispatch proceeds).
- Given the pre-flight reader, when it resolves the credentials path, then it uses
  the existing `globalConfigDir` resolution (`$CLAUDE_CONFIG_DIR` → `~/.claude`) —
  a test with `CLAUDE_CONFIG_DIR` set to a temp dir reads that dir, never the real
  home path.

### Done When
- [ ] A single small credentials-reader function (the identity seam) returns
      expiry state: fresh | expired | unknown(fail-open).
- [ ] Pre-flight wired into the self-host dispatch path only (non-self-host builds
      unaffected), before sandbox provisioning.
- [ ] Unit tests cover all four fail-open shapes plus expired and fresh.

---

## Story: Shared park-and-poll with sandbox credential refresh on resume

**Requirement:** TR-3

As the daemon operator, I want auth-blocked attempts (from TR-1 or TR-2) to wait for
my credentials file to change and then resume with the refreshed credentials, so that
a token refresh by any live session un-blocks the daemon automatically.

### Acceptance Criteria

#### Happy Path
- Given an attempt parked on credentials, when the operator credentials file's mtime
  advances and its `expiresAt` (when parseable) is unexpired, then the park loop
  exits, the sandbox's `.credentials.json` is **re-copied** from the operator file
  into the existing sandbox config dir, and the same attempt resumes.
- Given a park-resume cycle completes and the invocation then succeeds, when the step
  finishes, then the step's attempt counter equals its value before the park (zero
  budget consumed by parking).

#### Negative Paths
- Given a parked attempt, when the credentials file mtime advances but the new
  content's `expiresAt` is still expired, then the loop keeps parking (no resume, no
  spawn) until a genuinely unexpired refresh or timeout.
- Given a parked attempt resumes, when the sandbox credentials were NOT re-copied
  (stale copy), then the acceptance spec fails — resume-without-refresh is forbidden
  (guards the once-per-feature `activeSandbox` reuse trap).
- Given the credentials file is deleted mid-park, when the poller next reads it, then
  the loop treats it as not-yet-refreshed (keeps waiting toward timeout) rather than
  crashing.
- Given a resumed attempt fails again with `authFailure` (rotated-but-invalid token),
  when classified, then it re-enters the park loop, still without consuming retry
  budget.

### Done When
- [ ] One park primitive is used by both TR-1 (signature) and TR-2 (pre-flight)
      entry points.
- [ ] Re-copy on resume goes through the existing copy helper (a file copy, never a
      symlink — TR-6 invariant of adr-2026-06-30-sandbox-build-isolation).
- [ ] Tests simulate mtime advance with fake timers/temp files; no test sleeps
      real wall-clock minutes.
- [ ] A test asserts attempt-counter equality across a park-resume cycle.

---

## Story: Park timeout HALTs with a credentials-specific reason

**Requirement:** TR-4

As the daemon operator, I want a park that outlasts its timeout to HALT with a reason
naming the credentials file and the observed expiry so that I immediately recognize an
auth-window condition instead of debugging a build failure.

### Acceptance Criteria

#### Happy Path
- Given a parked attempt whose configured timeout elapses with no qualifying
  credentials refresh, when the park loop gives up, then `writeHaltMarker` is called
  with a reason containing (a) the resolved credentials file path and (b) the
  observed `expiresAt` (or "unparseable" when unknown), and the feature parks exactly
  as today's HALT flow does.
- Given such a HALT, when the operator refreshes credentials and applies the standard
  remediation (`HALT` → `HALT.cleared` + `REKICK`), then the daemon re-dispatches on
  the next poll unchanged from today's behavior.

#### Negative Paths
- Given the timeout HALT fires, when the HALT reason is written, then it does NOT
  read "retries exhausted" and the step retry budget shows no consumption from the
  parked period (distinguishes auth HALT from build-defect HALT).
- Given a needs-remediation escalation PR is opened for the halt, when its body is
  composed, then it carries the auth-window reason (credentials path + expiry), not
  the generic step-failure text.

### Done When
- [ ] Timeout is configurable (config key, default 60 minutes) and documented.
- [ ] HALT reason format asserted by test: includes credentials path + expiresAt.
- [ ] A test asserts the generic "failed in auto mode (retries exhausted)" reason is
      NOT used for auth-park timeouts.

---

## Story: Configuration knob and documentation

**Requirement:** TR-5

As a harness consumer, I want the park behavior configurable and documented so that I
can tune (or effectively disable) it per repo without reading engine source.

### Acceptance Criteria

#### Happy Path
- Given a repo config setting the auth-park timeout (e.g.
  `auth_park_timeout_minutes: 15`), when the daemon parks on credentials, then the
  configured value bounds the park instead of the 60-minute default.
- Given no configuration, when the daemon parks, then the default (60 minutes) and a
  modest poll interval apply.

#### Negative Paths
- Given a config value of `0` (or negative), when the park would begin, then the
  behavior degrades to today's semantics — no poll loop; the auth failure HALTs
  immediately with the credentials-specific reason (explicit opt-out, not an
  infinite park and not a crash).
- Given a non-numeric config value, when config resolves, then resolution fails
  loudly at startup (consistent with existing config validation), not silently at
  park time.

### Done When
- [ ] Config key resolved through the existing resolved-config path with validation.
- [ ] `README.md` + `src/conductor/README.md` document the behavior and the knob;
      `CHANGELOG.md` gains an `[Unreleased]` entry (harness repo requirement).
- [ ] Tests cover default, override, zero/negative opt-out, and invalid value.
