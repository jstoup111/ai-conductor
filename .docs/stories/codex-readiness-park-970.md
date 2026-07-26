**Status:** Accepted

# Technical Stories: Codex readiness park loops on unrelated doctor failure (#970)

**Source:** Approved technical intent, architecture review, and
`adr-2026-07-26-codex-auth-evidence-and-recovery-backoff`

## Technical Intent Traceability

| Intent | Stories |
|---|---|
| TI-1: Auth-specific doctor evidence is authoritative under unrelated degraded health | Story 1 |
| TI-2: Missing, rejected, malformed, unsupported, and absent auth evidence remains fail-closed | Story 1 |
| TI-3: Cached-login recovery uses deadline-preserving capped exponential backoff | Story 2 |
| TI-4: Recovery progress is durable, rate-limited, and sanitized | Story 3 |
| TI-5: Serial, grouped, and auxiliary recovery preserve provider/source and zero-budget invariants | Story 4 |
| TI-6: The #254 canary can continue across adjacent Codex steps under the same usable cached login | Story 4 |

## Story 1: Distinguish credential readiness from unrelated doctor health

**Requirement:** TI-1, TI-2

As a daemon operator, I want authentication evidence classified independently from unrelated
diagnostic health so that a usable Codex login is not reported as a credential failure.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given a supported versioned doctor report contains
  `auth.credentials.status: ok` and an unrelated check makes `overallStatus: fail`, when readiness
  is classified, then the selected Codex source is `ready`, the unrelated degradation is retained
  only as sanitized context, and exactly one requested substantive invocation may proceed.
- **HP-2:** Given the same supported report has auth credentials `ok` and overall status `ok`, when
  readiness is classified, then the existing `ready` behavior remains unchanged and no degraded
  context is reported.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a supported report explicitly says credentials are missing,
  rejected, unauthorized, or expired, when readiness is classified, then it is `missing` or
  `unusable`, zero substantive invocations begin, and unrelated doctor fields cannot override the
  auth failure.
- **NP-2 (covers HP-1):** Given `auth.credentials` is absent, malformed, has an unsupported status,
  conflicts with the selected source, or appears under an unsupported schema, when readiness is
  classified, then it is `unverifiable`, zero substantive invocations begin, and no raw report
  detail is surfaced.
- **NP-3 (covers HP-1):** Given mixed-health readiness returned `ready` but the subsequent Codex
  invocation explicitly rejects the selected source, when completion is classified, then the
  actual rejection enters the existing auth park for that same provider/source without provider,
  model, or auth-source fallback.
- **NP-4 (covers HP-2):** Given an overall-green report has ambiguous or malformed auth evidence,
  when readiness is classified, then overall health alone cannot produce `ready`; the result is
  `unverifiable` and substantive work remains blocked.

### Done When

- [ ] A mixed-health fixture produces `ready`, sanitized degraded context, and one substantive
      invocation.
- [ ] The existing all-green fixture remains `ready` without degraded context.
- [ ] Missing, rejected, malformed, unsupported, absent, and conflicting auth fixtures all produce
      their exact fail-closed state with zero substantive invocation.
- [ ] A post-readiness rejection proves the selected provider/source is retained and every fallback
      attempt count remains zero.

## Story 2: Back off cached-login recovery without extending its deadline

**Requirement:** TI-3

As a daemon operator, I want an unchanged cached-login recovery condition probed less frequently
so that a long park does not spawn one diagnostic subprocess every second.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given cached-login recovery remains non-ready, when the park starts, then it performs one
  immediate recheck followed by delays of 1, 2, 4, 8, 16, and 30 seconds, and every later delay is
  capped at 30 seconds until the configured deadline.
- **HP-2:** Given cached login becomes `ready` on any scheduled recheck before the deadline, when
  that result is observed, then the failed work resumes once without waiting for another interval
  and with retry, effort, model, provider, and auth-source fallback budgets unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given less time remains before the configured deadline than the next
  scheduled delay, when recovery waits, then it never sleeps beyond the remaining time and emits
  the existing sanitized timeout HALT at the deadline.
- **NP-2 (covers HP-1):** Given the auth-park timeout is disabled or non-positive, when cached-login
  recovery begins, then it performs no repeated sleep/probe loop and reaches the existing
  source-specific terminal disposition without entering normal retry.
- **NP-3 (covers HP-1):** Given API-key restart-required recovery or Claude credential recovery,
  when those paths run, then the new cached-login cadence does not alter their probe, wait, reload,
  timeout, or remediation behavior.
- **NP-4 (covers HP-2):** Given readiness never becomes `ready`, when repeated probes run through
  timeout, then no substantive invocation, completed grouped sibling, retry rung, model rung,
  provider candidate, or alternate auth source is dispatched.

### Done When

- [ ] An injected clock/sleep test records the exact immediate/1/2/4/8/16/30/capped cadence.
- [ ] A near-deadline test proves the final sleep is bounded by remaining time and the timeout is
      not extended.
- [ ] Recovery-at-each-rung tests resume the failed work exactly once with every budget counter
      unchanged.
- [ ] API-key and Claude regression tests prove their existing recovery traces are unchanged.

## Story 3: Report parked recovery progress without leaking diagnostics

**Requirement:** TI-4

As a daemon operator, I want durable, rate-limited recovery progress so that I can distinguish a
credential wait from unrelated diagnostic degradation without exposing authentication material.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given cached-login recovery starts, when the park lifecycle begins, then exactly one
  `credentials_park` start event is emitted and subsequent updates use
  `credentials_park_progress` with provider, selected source, sanitized readiness state, elapsed
  seconds, next delay, and sanitized degradation kind.
- **HP-2:** Given the sanitized readiness or degradation state changes, when the next probe is
  classified, then one progress event is emitted immediately and is persisted and rendered by the
  same durable event pipeline used by other conductor events.
- **HP-3:** Given the sanitized state remains unchanged for a long park, when time advances, then a
  progress event is emitted no more often than once per 60 seconds and includes the next planned
  probe delay.

#### Negative Paths

- **NP-1 (covers HP-1):** Given multiple recovery probes occur, when their events are inspected,
  then no additional `credentials_park` start event is emitted and consumers do not misreport
  progress as multiple park lifecycles.
- **NP-2 (covers HP-1):** Given raw doctor stdout/stderr or summaries contain credential paths,
  tokens, key prefixes/suffixes, upstream check names, or arbitrary diagnostic text, when progress
  is emitted, persisted, rendered, or written to a HALT, then none of those raw values appear.
- **NP-3 (covers HP-2):** Given an event consumer handles every pre-existing event variant, when it
  receives `credentials_park_progress`, then it persists/renders the typed event or deliberately
  classifies it; it cannot silently drop it or crash an exhaustive switch.
- **NP-4 (covers HP-3):** Given probes occur more frequently than 60 seconds while state is
  unchanged, when event output is counted, then no extra unchanged-state progress event is present;
  subprocess cadence and telemetry cadence remain independently bounded.

### Done When

- [ ] Event-sequence tests prove one lifecycle-start event plus immediate state-change and
      at-most-60-second unchanged progress events.
- [ ] Audit persistence, daemon rendering, and exhaustive event-contract tests consume the new
      variant without dropping or duplicating it.
- [ ] Adversarial fixtures leave no raw diagnostic or credential fragment in event, log, audit,
      terminal, state, or HALT output.
- [ ] Numeric fields are non-negative, bounded by the configured timeout/cadence, and contain no
      provider-supplied strings.

## Story 4: Preserve recovery invariants across every Codex dispatch shape

**Requirement:** TI-5, TI-6

As an autonomous harness operator, I want adjacent and auxiliary Codex steps to share the corrected
readiness and recovery behavior so that the fix cannot work in one dispatch path while another
still stalls or crosses a provider boundary.

### Acceptance Criteria

#### Happy Paths

- **HP-1:** Given one unattended Codex step succeeds under cached login and the immediately
  following step receives mixed doctor health with auth credentials `ok`, when the second step
  starts, then it proceeds under the same selected source without entering a credential park.
- **HP-2:** Given a genuine cached-login auth failure occurs in a serial, grouped, judgment, or
  auxiliary dispatch, when recovery handles it and the same source later becomes ready, then only
  the failed work resumes through the shared backed-off park and completed work remains completed.

#### Negative Paths

- **NP-1 (covers HP-1):** Given the second adjacent step has explicit missing, rejected, malformed,
  unsupported, or absent auth evidence rather than mixed unrelated health, when it starts, then it
  remains fail-closed and cannot borrow the prior step's success as authorization.
- **NP-2 (covers HP-1):** Given auth-specific evidence is `ok` but the real invocation later fails
  for a non-auth provider or network reason, when completion is classified, then it follows that
  actual non-auth disposition rather than being relabeled as a credential failure solely because
  doctor health was degraded.
- **NP-3 (covers HP-2):** Given one grouped member fails authentication after another member
  completed, when recovery resumes, then the completed sibling is not rerun and only the failed
  member may dispatch after fresh readiness.
- **NP-4 (covers HP-2):** Given any genuine auth failure remains non-ready until timeout, when the
  serial, grouped, judgment, and auxiliary paths terminate, then they produce the same sanitized
  provider/source-specific disposition with no retry, effort, model, provider, or auth-source
  fallback consumption.

### Done When

- [ ] A #254-shaped acceptance scenario records successful BUILD followed by successful
      `build_review` under the same cached login and zero credential-park events.
- [ ] Serial, grouped, judgment, and auxiliary acceptance scenarios share the corrected readiness,
      progress, timeout, and resume contract.
- [ ] Group assertions prove completed siblings are never rerun and only the failed index resumes.
- [ ] Attempt/event evidence proves every genuine auth failure retains provider/source identity and
      all retry/escalation/fallback counters remain unchanged.
