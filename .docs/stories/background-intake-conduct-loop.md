**Status:** Accepted

# Stories: Background Auto-Intake on the Conduct Loop

Source PRD: `.docs/specs/2026-06-30-background-intake-conduct-loop.md` (tier M).

---

## Story: Loop polls all registered repos on an interval without a human

**Requirement:** FR-1, FR-10

As the operator, I want the background loop to poll every registered repo for my assigned open
issues on a recurring interval so that intake happens without me launching the engineer.

### Acceptance Criteria

#### Happy Path
- Given two registered repos each with an open issue assigned to me, when a loop tick fires with
  no interactive session running, then both repos are polled and both issues are captured into the
  durable intake queue.
- Given the loop is running, when one configured interval elapses, then exactly one intake poll
  pass executes (one pass per interval, not per repo per arbitrary timer).

#### Negative Paths
- Given no registered repos, when a tick fires, then the pass completes with zero captures and no
  error is raised.
- Given a registered repo with no issues assigned to me, when a tick fires, then nothing is
  captured for that repo and the pass continues to the next repo.
- Given an issue assigned to a *different* user, when a tick polls that repo, then the issue is
  not captured (assignee-scoped `@me` filter is preserved).

### Done When
- [ ] A loop tick invokes an intake poll across all repos returned by the registry reader.
- [ ] The poll uses the assignee-scoped (`--assignee @me`, open-state) issue query per repo.
- [ ] A test drives N ticks and asserts exactly N poll passes (interval-driven, not unbounded).
- [ ] No interactive `claude` session is spawned by the poll pass.

---

## Story: Each new issue is captured exactly once

**Requirement:** FR-2

As the operator, I want each newly discovered issue captured into the queue exactly once so that I
never see the same idea twice in my inbox.

### Acceptance Criteria

#### Happy Path
- Given an assigned issue not yet in the ledger, when a tick captures it, then exactly one envelope
  is enqueued and one ledger entry is recorded for that source reference.

#### Negative Paths
- Given an issue captured in a prior tick, when the next tick runs, then no second envelope is
  enqueued for the same source reference (dedup against the ledger).
- Given the same issue surfaced twice within a single poll pass (e.g., duplicate in the `gh`
  payload), when captured, then only one envelope is enqueued.
- Given two issues with different numbers but identical titles/bodies, when captured, then both are
  enqueued (dedup key is the source reference, not the text — no false-positive suppression).

### Done When
- [ ] Capturing an un-recorded issue enqueues exactly one envelope and records one ledger entry.
- [ ] A second tick over the same issue enqueues nothing (asserted on queue length).
- [ ] A dedup-key test confirms two distinct issues with identical text are both captured.

---

## Story: Captured ideas are auto-routed to their originating repo with source-ref retained

**Requirement:** FR-3

As the operator, I want each captured idea routed to the repo whose issue tracker it came from,
carrying its source reference, so that I don't have to confirm routing and the origin is preserved.

### Acceptance Criteria

#### Happy Path
- Given an issue captured from repo `owner/X`, when it is enqueued, then its envelope's target is
  `owner/X` and its source reference is `owner/X#N`.
- Given a captured idea, when the operator later claims it, then the claim payload includes the
  retained source reference (no manual re-routing step is required).

#### Negative Paths
- Given an issue whose origin repo cannot be resolved from the registry (missing remote), when
  captured, then it is still enqueued with its raw source reference and is logged as
  origin-unresolved rather than dropped or routed to an arbitrary repo.

### Done When
- [ ] Captured envelopes carry both the target repo and the `owner/repo#N` source reference.
- [ ] A claim of an auto-captured idea returns the source reference intact.
- [ ] No LLM/registry-reasoning call is made to determine the target for an origin-bearing idea.

---

## Story: Already-recorded or already-handled issues are not re-captured

**Requirement:** FR-4

As the operator, I want issues already in the ledger or marked handled to be skipped on later
ticks so that completed or in-flight work doesn't re-enter the queue.

### Acceptance Criteria

#### Happy Path
- Given an issue with a ledger entry in any non-reopenable state, when a later tick runs, then it
  is not re-captured.
- Given an issue carrying the `engineer:handled` label, when a tick runs, then it is skipped at
  capture (the label is a re-capture skip, not an intake filter for first capture).

#### Negative Paths
- Given a handled-labelled issue whose spec PR was closed **unmerged** (re-eligibility), when a
  tick runs, then it is re-emitted for routing subject to the existing reopen-attempts cap.
- Given a handled-labelled issue whose spec PR was **merged**, when a tick runs, then it is never
  re-captured.
- Given a handled issue that has exceeded the reopen-attempts cap, when a tick runs, then it is
  parked as needs-manual and not re-emitted.

### Done When
- [ ] A ledger-known issue produces no new envelope on a subsequent tick.
- [ ] A `engineer:handled`-labelled issue is skipped unless re-eligibility applies.
- [ ] Re-eligibility (closed-unmerged) and the reopen cap behave exactly as the existing adapter
      contract specifies (no regression).

---

## Story: Operator is notified (push + status) when new work is queued

**Requirement:** FR-5

As the operator, I want a push notification and a status indicator when new ideas are queued so
that I know there is work to DECIDE no matter where I am.

### Acceptance Criteria

#### Happy Path
- Given a tick captures one or more new ideas, when the pass completes, then a push notification is
  sent summarizing the new queued work (count and/or source references).
- Given new ideas were captured, when the operator views engineer/daemon status, then the
  queued-work count/list reflects the newly captured ideas.

#### Negative Paths
- Given a tick captures **zero** new ideas, when the pass completes, then no push notification is
  sent (no empty-pass spam).
- Given the push-notification transport fails/raises, when the pass completes, then the failure is
  logged, the captures are still persisted, and the status surface still reflects the new work
  (notification failure is non-fatal and never rolls back capture).

### Done When
- [ ] A non-empty capture pass triggers exactly one push notification describing the new work.
- [ ] An empty capture pass triggers no notification.
- [ ] The status surface (engineer/daemon status) shows the current queued-work count.
- [ ] A notification-transport failure is caught, logged, and does not discard captured ideas.

---

## Story: Empty issues are skipped, not captured

**Requirement:** FR-6

As the operator, I want issues with no title and no body skipped so that blank placeholders never
enter my queue.

### Acceptance Criteria

#### Happy Path
- Given an assigned issue with a non-empty title or body, when a tick runs, then it is captured.

#### Negative Paths
- Given an assigned issue with neither title nor body (both empty/whitespace), when a tick runs,
  then it is skipped, logged as empty, and no envelope or ledger entry is created.

### Done When
- [ ] An empty issue produces no envelope and no ledger entry.
- [ ] A whitespace-only title+body is treated as empty (trimmed before the check).
- [ ] A title-only or body-only issue is captured.

---

## Story: A failing repo is isolated and does not abort the pass

**Requirement:** FR-7

As the operator, I want one repo's poll failure to not stop the others so that intake is resilient
to a single repo's auth/availability problem.

### Acceptance Criteria

#### Happy Path
- Given three registered repos where the second errors on poll (bad auth, missing path, `gh`
  failure), when a tick runs, then repos one and three are still polled and their issues captured.

#### Negative Paths
- Given a repo whose `gh` invocation throws, when polled, then the error is logged with the repo
  identifier and the pass continues to the next repo (no thrown exception escapes the tick).
- Given every repo fails to poll, when a tick runs, then the pass completes with zero captures, all
  failures are logged, and the loop continues to the next interval (the loop does not crash).

### Done When
- [ ] A mid-list repo failure does not prevent capture from the remaining repos.
- [ ] Each poll failure is logged with its repo identifier.
- [ ] No poll failure propagates out of the tick or terminates the loop.

---

## Story: Auto-captured ideas thread the source-ref so the issue auto-closes

**Requirement:** FR-8

As the operator, I want an auto-captured idea to carry its source reference all the way through
DECIDE so that the spec PR links the issue and the implementation PR auto-closes it on merge.

### Acceptance Criteria

#### Happy Path
- Given an idea auto-captured from `owner/X#N`, when the operator runs the engineer for it, then
  the land step commits the intake marker carrying `owner/X#N` and the spec PR body carries a
  non-closing `Refs owner/X#N`.
- Given the spec is merged and the daemon builds it, when the implementation PR is opened, then its
  body carries `Closes owner/X#N`, and merging it closes the originating issue.

#### Negative Paths
- Given an idea auto-captured **without** a resolvable source reference, when the engineer runs it,
  then no `Refs`/`Closes` line is injected (no malformed/empty linkage) and the flow still
  completes.
- Given the write-back (issue comment/label) fails during land/handoff, when the step completes,
  then the failure is logged and does not roll back the committed marker or the opened spec PR
  (write-back is advisory).

### Done When
- [ ] An auto-captured idea reaches land with its source reference, producing the intake marker.
- [ ] The spec PR body contains `Refs owner/repo#N`; the impl PR body contains `Closes owner/repo#N`.
- [ ] An end-to-end test (or scripted equivalent) shows the originating issue closes on impl-PR merge.
- [ ] A missing-source-ref idea produces no linkage line and does not error.

---

## Story: Polling and routing consume no model tokens

**Requirement:** FR-9

As the operator, I want intake discovery and routing to be purely mechanical so that the loop
costs no tokens when there is nothing to DECIDE.

### Acceptance Criteria

#### Happy Path
- Given a tick that captures and routes several ideas, when the pass completes, then no LLM/model
  invocation occurred during polling, capture, routing, or notification.

#### Negative Paths
- Given a tick over a repo with origin-bearing issues, when routing assigns targets, then routing
  uses the issue origin (no model call) — verified by the absence of any LLM client invocation in
  the poll/route path.

### Done When
- [ ] The poll/capture/route/notify path contains no LLM/model client call (asserted by injected
      spy or by construction — the path has no LLM dependency).
- [ ] A tick with N captured ideas records zero model-token usage.

---

## Story: The loop never runs DECIDE or opens a spec PR unattended

**Requirement:** FR-11

As the operator, I want the loop to stop at "routed + notified" so that no spec PR is ever produced
without me present.

### Acceptance Criteria

#### Happy Path
- Given a tick captures and routes ideas, when the pass completes, then the ideas sit in the queue
  awaiting the operator and no DECIDE skill, no land, and no handoff has run.

#### Negative Paths
- Given queued ideas exist across many ticks, when the loop continues running, then it never
  auto-invokes brainstorm/stories/plan/land/handoff and never opens a spec PR on its own.
- Given a queued idea remains unclaimed indefinitely, when ticks continue, then it is not
  auto-processed and not dropped (it persists in the durable queue).

### Done When
- [ ] After any number of ticks, no spec PR is opened by the loop and no DECIDE artifact is written.
- [ ] Queued-but-unclaimed ideas persist across ticks without auto-processing.

---

## Story: The operator is not notified twice for the same idea

**Requirement:** FR-12

As the operator, I want at most one notification per queued idea so that repeated ticks don't spam
me about work I already know about.

### Acceptance Criteria

#### Happy Path
- Given an idea captured and notified in one tick, when subsequent ticks run with no new captures,
  then no further notification is sent for that idea.

#### Negative Paths
- Given an idea was notified, then the process restarts, when a later tick runs and the idea is
  already ledger-known (so not re-captured), then it is not re-notified (notification keys off new
  captures, which dedup against the durable ledger).
- Given a tick captures three new ideas, when the pass completes, then the operator receives a
  single batched notification (or one per new idea) but never a duplicate for an
  already-notified idea.

### Done When
- [ ] A re-tick over already-captured ideas sends no notification.
- [ ] Notification is driven by *newly captured* ideas only, so durable-ledger dedup prevents
      cross-restart duplicate notifications.
- [ ] A test asserts notification count equals the number of newly captured ideas (zero on a
      no-new-capture tick).

---

## Story: The poll interval is operator-configurable

**Requirement:** FR-10

As the operator, I want to configure how often intake polls so that I can tune responsiveness vs.
GitHub API load.

### Acceptance Criteria

#### Happy Path
- Given a configured intake poll interval, when the loop runs, then poll passes occur on that
  interval.
- Given no interval is configured, when the loop runs, then a documented default interval is used.

#### Negative Paths
- Given an invalid interval value (non-numeric, zero, negative), when the loop starts, then it
  falls back to the default and logs the rejected value (it does not busy-loop or crash).

### Done When
- [ ] The intake poll cadence is read from a documented config key/flag with a default.
- [ ] An invalid interval value falls back to the default with a logged warning.
