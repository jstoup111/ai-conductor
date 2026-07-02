# PRD: Background Auto-Intake on the Conduct Loop

**Date:** 2026-06-30
**Status:** Approved

## Problem / Background

GitHub-issue intake only runs when the operator manually starts the bare `conduct-ts engineer`
launcher (which pre-polls once at session start). Two failure modes follow directly:

- **Issues created after the last launch are never seen.** A `/engineer` session invoked directly
  inside an existing session does not pre-poll, so `claim` returns empty even when assigned issues
  exist. This is exactly how `best-stock-picker#65` ("Merge conflicts") sat un-captured — a manual
  `conduct-ts engineer poll` picked it up instantly, proving the mechanism works but the *trigger*
  never fired.
- **Ideas processed without a live source reference never auto-close their issue.** The
  issue→PR auto-close chain (intake marker → `Refs` on the spec PR → `Closes` on the daemon's
  implementation PR) is keyed entirely on the source reference, which only exists for `claim`ed
  ideas. `honeydew-or-handymando#49` shipped its work (spec PR #53 → impl PR #54, both merged) but
  stayed OPEN because no source reference was threaded, so no marker/`Closes` was ever produced.

There is no continuous, automatic intake. The operator must remember to launch the engineer for
intake to happen at all, and must do so through the one path that threads source references. This
matters now because the operator is frequently away from the terminal (phone-driven) and expects
filed issues to be picked up without babysitting a launcher.

## Goals & Non-Goals

**Goals**
- Intake runs **automatically and continuously** without a human launching the engineer.
- Polling is **mechanical and zero-token** — no LLM is invoked to discover or capture issues.
- Each captured idea is **auto-routed to its originating repo** and retains its source reference,
  so the downstream spec PR links and auto-closes the issue on implementation merge.
- The operator is **notified** (push + a status surface) when there is new queued work to DECIDE.
- DECIDE stays **operator-gated** — the loop never opens a spec PR unattended.

**Non-Goals**
- No unattended DECIDE phase and no unattended spec PRs (the loop stops at "routed + notified").
- No headless / non-interactive LLM engineer session.
- No LLM-based routing in this feature — origin-based routing only (chat/CLI ideas without an
  origin are out of scope here).
- No change to how the build daemon discovers and builds **merged** spec PRs.
- No new cron/scheduler service — reuse the existing autonomous loop infrastructure.

## Users / Personas

- **The operator (solo developer, frequently phone-driven).** Files GitHub issues against their
  repos as the capture surface, then wants those issues to flow into the intake queue and be
  surfaced for a DECIDE pass without manually starting a poller. Acts on notifications from
  wherever they are; runs the interactive DECIDE when ready.

## Functional Requirements

- **FR-1:** The system polls every registered repo for the operator's assigned, open GitHub issues
  automatically on a recurring interval, with no human launching the engineer.
- **FR-2:** Each newly discovered issue is captured into the durable intake queue exactly once.
- **FR-3:** Each captured idea is auto-routed to its **originating repo** as its target and
  retains the originating issue's source reference.
- **FR-4:** An issue already recorded in the intake ledger, or already marked handled, is not
  re-captured on subsequent ticks (idempotent polling).
- **FR-5:** When one or more new ideas are queued in a tick, the operator receives a **push
  notification** and the new work is reflected in a **status surface** (a queued-work count/list
  visible from the engineer/daemon status).
- **FR-6:** An empty issue (no title and no body) is skipped, not captured.
- **FR-7:** A repo that fails to poll (auth failure, unavailability, missing path) is isolated:
  the failure is logged and polling continues for the remaining repos.
- **FR-8:** When the operator runs the engineer against a queued idea, the idea is delivered with
  its source reference intact, such that the resulting spec PR links the originating issue and the
  daemon's implementation PR auto-closes it on merge.
- **FR-9:** Polling and routing perform no LLM/token-consuming work; the LLM is invoked only for
  the operator-driven DECIDE phase.
- **FR-10:** Background intake polling runs as part of the existing autonomous background loop on a
  **configurable interval**, not as a separate scheduler process.
- **FR-11:** The loop does not open a spec PR or run any DECIDE step unattended; DECIDE begins only
  when the operator acts.
- **FR-12:** The operator is not notified more than once for the same queued idea (notification
  de-duplication).

## Non-Functional Requirements
- **Zero-token polling:** intake discovery must not consume model tokens.
- **Failure isolation:** one repo's polling failure must never abort the whole tick.
- **Idempotency:** re-running a tick enqueues nothing already captured and re-notifies nothing.
- **Configurability:** the poll interval is operator-configurable.

## Acceptance Criteria / Success Metrics
- All FRs are covered by passing tests.
- End-to-end: an operator-assigned issue filed on a registered repo is, within one interval and
  with no manual launch, captured into the queue, routed to its originating repo, and surfaced via
  push + status — then, when the operator runs DECIDE, the produced spec PR carries the source
  reference and the implementation PR auto-closes the issue on merge.
- Re-running the loop over an already-captured/handled issue produces no duplicate capture and no
  duplicate notification.
- A deliberately broken repo (bad auth/path) does not prevent the other repos from being polled.

## Scope

### In Scope
- Continuous mechanical polling of all registered repos on the existing autonomous loop.
- Capture into the durable intake queue with dedup against the ledger/handled marker.
- Origin-based auto-routing that preserves the source reference.
- Operator notification: push notification + status-surface queued-work indicator, de-duplicated.
- Configurable poll interval.

### Out of Scope
- Unattended DECIDE and unattended spec PRs.
- Headless/non-interactive LLM engineer sessions.
- LLM-based routing for ideas without a GitHub origin (chat/CLI ideas).
- Changes to the build daemon's merged-spec discovery and build path.
- Building a new notification transport from scratch (reuse the existing push mechanism).

## Key Decisions & Rationale
- **Run on the existing autonomous loop, not a new cron/scheduler.** Operator directive; reuses the
  proven idle-poll/interval pattern and process management instead of adding a new long-running
  service.
- **Mechanical origin-based routing, not LLM registry reasoning.** A GitHub issue filed on repo X
  belongs to repo X; the intake envelope already carries the origin, so routing needs no model
  call. LLM registry routing is reserved for origin-less ideas, which are out of scope here.
- **Human-gated DECIDE; the loop stops at "routed + notified."** Matches the operator's
  conservative, human-in-the-loop posture: no spec PRs are produced without the operator present.
- **Source-reference threading is mandatory.** This is the root cause of the `honeydew#49`
  non-close; every auto-captured idea must carry its origin so the auto-close chain engages.

## Dependencies
- Existing `github-issues` intake adapter (poll, ledger, durable queue, source-reference helpers).
- Existing autonomous background loop infrastructure and its interval/idle mechanism.
- An existing push-notification mechanism for operator alerts.

## Open Questions
- **Which loop process hosts the cross-repo intake poll** — a single supervisor/"brain" loop that
  polls all registered repos, versus each per-repo daemon polling its own repo's issues. This is an
  architecture decision (defer to architecture-review); the cross-repo scope and the
  brain-vs-daemon ownership boundary are the deciding factors.
- The exact push-notification channel/transport to reuse for the operator alert.
