**Status:** Accepted

# Stories: Build-Auth Token — Check and Classify

Feature: `build-auth-token-check-and-classify` (jstoup111/ai-conductor#498, Tier M,
product track). Extracted from PRD `.docs/specs/2026-07-22-build-auth-token-check-and-classify.md`
(FR-1..FR-7). Acceptance signals are CLI exit codes/output, daemon log/status entries,
and marker-file state — this project has no HTTP API or frontend.

---

## Story: Health check reports credential state in daemon-token mode

**Requirement:** FR-1

As an operator, I want the install health check to tell me whether the build credential
is missing, unreadable, invalid, or verified valid, so that a broken token is caught
before any dispatch depends on it.

### Acceptance Criteria

#### Happy Path
- Given daemon-token mode and a stored credential that the liveness probe verifies
  usable, when the operator runs the install health check, then the output contains an
  OK line for the build token identifying its state as valid.
- Given daemon-token mode and a stored credential the probe rejects with an
  authentication error (includes expired), when the health check runs, then the output
  contains a FAIL line identifying the state as invalid and pointing at the
  remediation message.

#### Negative Paths
- Given daemon-token mode and no credential file at the resolved path, when the health
  check runs, then the token line reports **missing** (FAIL) with the full remediation
  message, and no probe is attempted.
- Given daemon-token mode and a credential file containing only whitespace, when the
  health check runs, then the token line reports **missing** (not invalid), matching
  the existing fail-closed read.
- Given daemon-token mode and a credential file that exists but cannot be read
  (permissions), when the health check runs, then the token line reports
  **unreadable** (FAIL) — distinct from missing.
- Given daemon-token mode and a probe that itself fails (network down, spawn failure,
  timeout, unparseable result), when the health check runs, then the token line
  reports **unverifiable — state unknown** as a FAIL (strict: unknown is not passing),
  distinct from invalid, and the check never claims valid.

### Done When
- [ ] `bin/install --check` output includes exactly one build-token status line per run
      in daemon-token mode, showing one of: valid / invalid / missing / unreadable /
      unverifiable.
- [ ] Each of the five states is exercised by a test fixture (valid via stubbed probe
      success; invalid via stubbed 401 envelope; missing / whitespace-only / chmod-000
      via real files).
- [ ] The bash side contains no token path or mode derivation — it invokes the
      conductor delegate and formats its result (verified by inspection/test of the
      delegate call).

---

## Story: Health check is mode-aware (api-key mode)

**Requirement:** FR-2

As an operator running in api-key mode, I want the health check to report the mode and
skip token checks, so that a missing token file is not a false failure.

### Acceptance Criteria

#### Happy Path
- Given api-key mode in the resolved config, when the health check runs, then the
  build-auth line reports api-key mode, performs no token-file checks and no probe,
  and contributes no failure.

#### Negative Paths
- Given api-key mode and NO credential file present, when the health check runs, then
  the check still exits successfully (no missing-token failure in this mode).
- Given no build-auth config block at all (defaults apply → daemon-token mode), when
  the health check runs, then the token check runs against the documented default
  path — absence of config never silently skips the check.

### Done When
- [ ] Test: api-key mode + absent token file → build-auth line present, exit code
      unaffected.
- [ ] Test: empty/absent config → daemon-token behavior at the default path.

---

## Story: Health check outcome is scriptable

**Requirement:** FR-3

As an operator (and as scripts wrapping the health check), I want token problems
reflected in the exit status, so that automation can rely on it.

### Acceptance Criteria

#### Happy Path
- Given daemon-token mode and a valid credential, when the health check runs and all
  other checks pass, then the exit code is 0.

#### Negative Paths
- Given daemon-token mode and a missing, unreadable, or invalid credential, when the
  health check runs, then the exit code is non-zero even if every other check passes.
- Given an unverifiable probe result, when the health check runs, then the exit code
  is non-zero (strict, operator-selected 2026-07-22): an unverified credential is not
  a passing check — while the reported state stays "unverifiable", never "invalid".

### Done When
- [ ] Exit-code assertions for: valid→0, missing→non-zero, unreadable→non-zero,
      invalid→non-zero, unverifiable→non-zero.

---

## Story: Invalid credential at dispatch parks instead of burning the retry ladder

**Requirement:** FR-4

As the daemon, I want a rejected-credential build failure classified as an auth
failure on every dispatch path, so that no retry or escalation budget is burned on a
credential that cannot succeed (#484).

### Acceptance Criteria

#### Happy Path
- Given a dispatched build that fails with the observed rejected-credential output
  (`Failed to authenticate. API Error: 401 Invalid bearer token`), when the result is
  classified, then the auth-failure flag is set and the serial dispatch path enters
  park-and-poll on the daemon credential source without consuming a retry attempt.
- Given the same failure on the concurrent group path, when the result is classified,
  then the group path routes to the same park semantics — the audit trail shows zero
  retry attempts and zero model/effort escalations for that failure.

#### Negative Paths
- Given a build whose ordinary output merely mentions "401" outside an
  authentication-error context (e.g. discussing an HTTP test asserting 401), when the
  build otherwise succeeds or fails generically, then it is NOT classified as an auth
  failure (no false park) — patterns are anchored to the error shape, never a bare
  number.
- Given an auth-classified failure, when park-and-poll is active, then no
  model-tier or effort escalation occurs while parked (never retry, never escalate —
  adr-2026-07-04).
- Given a failure matching a HIGHER-precedence classification (e.g. session limit),
  when classified, then the existing precedence order is preserved (auth patterns do
  not shadow existing classifications).

### Done When
- [ ] Classifier fixture tests use the verbatim observed output strings from
      adr-2026-07-22-auth-failure-classification-observed-401-patterns (both text
      variants) plus a bare-"401"-in-prose non-match fixture.
- [ ] A group-core test asserts: auth-classified result → zero attempt-counter
      consumption and no escalation call.
- [ ] A serial-path test asserts the park branch is taken on the new patterns.

---

## Story: Missing-credential message is complete and self-sufficient

**Requirement:** FR-5

As an operator, I want the missing-token message to contain everything needed to
recover, so that I never need insider knowledge (path, byte-exactness, permissions).

### Acceptance Criteria

#### Happy Path
- Given the credential is missing, when the daemon gate, per-feature preflight, or
  health check reports it, then the message includes: what is wrong, the exact mint
  command, the resolved storage path, and the three field-observed pitfalls (mint
  command prints to the terminal — shell redirection captures nothing; trailing
  whitespace breaks the credential; the file must not be readable by other users).

#### Negative Paths
- Given any of the three surfaces emits the message, when their outputs are compared,
  then they are produced by one shared builder — a divergence between surfaces is a
  test failure.
- Given a token_path override in config, when the message renders, then it shows the
  RESOLVED override path, not the default.

### Done When
- [ ] One message-builder unit test asserts all required elements; gate, preflight,
      and health check each have a test proving they render the builder's output.
- [ ] Manual walkthrough: following only the message on a machine with no token
      produces a working token file (documented in the story's test notes or
      manual-test evidence).

---

## Story: Missing credential is one waiting condition, not a HALT cascade

**Requirement:** FR-6

As an operator, I want a missing credential to surface once and work to resume by
itself when I store the token, so that recovery requires zero per-feature cleanup
(#483).

### Acceptance Criteria

#### Happy Path
- Given daemon-token mode, a missing credential, and N features queued, when the
  dispatch cycle starts, then the daemon parks BEFORE dispatching any feature: exactly
  one waiting-condition entry appears in the daemon log/status (carrying the FR-5
  message), and zero per-feature HALT markers are written.
- Given the daemon is parked on the missing credential, when a valid token file is
  stored at the resolved path, then the park loop detects the change and the queued
  features dispatch without any operator unpark/cleanup action.

#### Negative Paths
- Given the credential exists at cycle start but is deleted mid-cycle, when a feature's
  per-feature preflight runs, then that feature still fail-closed HALTs with the FR-5
  message (backstop preserved — the gate never weakens per-feature fail-closed
  semantics).
- Given the daemon is parked on the credential, when a whitespace-only file is stored,
  then the daemon remains parked (freshness requires non-empty content — no dispatch
  on a still-unusable credential).
- Given api-key mode, when the dispatch cycle starts with no token file, then the gate
  does not park (mode-aware, matching FR-2).
- Given other pre-dispatch gates are active (operator PAUSE, operator-park marker, or
  a rate-limit episode), when the credential gate's condition clears, then the other
  gates remain authoritative — dispatch occurs only when every gate passes (gates
  compose, per the rate-limit-episode precedent) — and an in-flight feature is never
  cancelled by the credential gate going active mid-build.

### Done When
- [ ] Daemon-loop test: missing token + N≥2 queued features → 1 waiting-condition
      entry, 0 `.pipeline/HALT` markers, 0 dispatches.
- [ ] Resume test: storing a non-empty token during park → dispatch proceeds in the
      same daemon run.
- [ ] Backstop test: mid-cycle deletion → per-feature HALT with the shared message.

---

## Story: The credential value is never printed

**Requirement:** FR-7

As an operator, I want every new surface to keep the credential secret, so that logs,
halt messages, and check output can be shared safely.

### Acceptance Criteria

#### Happy Path
- Given any state (valid, invalid, missing, unreadable, unverifiable), when the health
  check, gate, preflight, or classifier reports it, then no output contains the
  credential value in full or partial form.

#### Negative Paths
- Given the liveness probe runs, when its invocation is inspected, then the credential
  reaches the probe via environment only — never argv (visible in `ps`), never a log
  line, never an error message echo.
- Given the probe fails with an error that embeds request details, when the failure is
  reported as unverifiable, then the reported detail is sanitized (no credential
  substring).

### Done When
- [ ] A test greps all new-surface outputs (check line, remediation message, park
      entry, probe error path) against a known fixture token and asserts zero
      occurrences of any token substring (≥8 chars).
- [ ] Probe invocation test asserts argv contains no token material.

---

## Coverage

| FR | Stories |
|---|---|
| FR-1 | Health check reports credential state |
| FR-2 | Health check is mode-aware |
| FR-3 | Health check outcome is scriptable |
| FR-4 | Invalid credential at dispatch parks |
| FR-5 | Missing-credential message is complete |
| FR-6 | One waiting condition, not a cascade |
| FR-7 | Credential value never printed |
