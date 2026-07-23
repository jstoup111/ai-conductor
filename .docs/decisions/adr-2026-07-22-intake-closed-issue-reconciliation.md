---
Status: APPROVED
Date: 2026-07-22
Tags: [intake, engineer, resilience, github]
---

# ADR: Reconcile closed GitHub issues out of the intake ledger at two control points

## Context

The engineer intake path captures GitHub issues into a durable inbox
(`inbox/*.json`) plus a ledger (`ledger.json`, status `pending`) so that
`conduct-ts engineer claim` can later hand an operator the oldest unblocked idea.

The `gh issue list --state open` filter in the poll adapter
(`github-issues.ts:216`) gates **ingestion only**. Once an issue is captured while
open, nothing re-checks its state. If a human closes the issue before it is
claimed, the entry sits in the inbox and `claimUnblocked → createFileQueue.claim()`
dequeues it anyway. Observed live: issue `jstoup111/ai-conductor#538` was captured
open (07-11), closed (07-22 00:38Z), then dequeued by a `claim` — routing a full
DECIDE cycle at a dead issue whose content was already resolved.

Verified facts this decision rests on:

- The claim decorator `createDeliveryGuardedQueue` (`delivery-guard.ts`) currently
  returns a `pending` candidate via a **healthy passthrough** (line 136) with **no
  `gh` probe** — exactly the closed-issue path. (verified — read)
- `GhAbstraction.getIssueState(repo, issue)` already exists
  (`halt-issues-cli.ts:148`) and returns `'open' | 'closed' | null`, where `null`
  is returned on any `gh` non-zero exit or throw. (verified — read)
- The ledger is load-modify-save with an atomic tmp+rename file replace but **no
  cross-operation lock** (`ledger.ts:84,94`); `forget()` deletes a key and is a
  no-op when the key is absent (`ledger.ts:170`). (verified — read)
- Poll dedup keys off `ledger.known` (`github-issues.ts`), so an entry that is
  fully forgotten is re-ingested cleanly if its issue is later reopened. (verified)

## Decision

Remove closed-issue entries from the intake stores at **two complementary control
points**, using the existing `forget` primitive (no new `LedgerStatus`):

1. **Synchronous claim guard** — extend `createDeliveryGuardedQueue` so that, for a
   `github-issues` envelope, before delivering it (including the `pending`
   healthy-passthrough branch) it probes issue state. On `closed`: `ledger.forget`
   the entry, `queue.ack` (drop) the inbox envelope, and continue to the next
   candidate via the existing `return this.claim()` recursion. This guarantees
   `claim` never hands out a closed issue. The probe reuses the guard's existing
   `GhRunner` with `gh issue view <n> --json state -q .state` (mirroring
   `verifyPrState`), parsing `sourceRef` (`owner/repo#n`) into repo + number.

2. **Asynchronous brain sweep** — a new periodic reconciliation task modeled on
   `halt-issues/sweep.ts` (load ledger → per-entry try/catch → `getIssueState` →
   reconcile → atomic write → summary + `dryRun`), wired into the brain intake-loop
   tick (`intake-loop.ts` `intakeTick`; the brain is the host-wide singleton). It
   walks only **`pending`** (unclaimed) entries and, for any whose issue is
   `closed`, forgets them and drops the matching inbox envelope. This keeps the
   stores clean between claims, even when no operator claims for a while.

**Disposition = forget** (not a new terminal status). A closed issue that is
reopened is re-ingested fresh by the `--state open` poll because `ledger.known` no
longer matches — this is the property that makes a `LedgerStatus` unnecessary and
avoids blocking reopen re-capture.

**Fail-safe on unknown.** `getIssueState` returning `null` (transient `gh`
failure, network, auth) is treated as **still-open** — the entry is never dropped
on an unconfirmed state. Only an explicit `closed` triggers removal.

**Concurrency scoping.** The two writers (brain sweep, interactive claim guard) can
run concurrently against the un-locked ledger. This is bounded, not eliminated, by
design:
- The sweep touches only `pending` entries; the claim guard is the authoritative
  actor for the specific entry being claimed. A `pending` entry the guard is about
  to claim and the sweep may also inspect converge on the same action (drop a
  closed one) — `forget` is idempotent, so a double-forget is a no-op.
- `forget` is convergent: a lost update (last-writer-wins clobber of the whole
  file) at worst re-surfaces a closed entry that the next sweep tick or the next
  claim re-forgets. No durable corruption results from the forget path.
- The residual hazard (sweep forgetting an entry between the guard's claim and its
  `transition('claimed')`) is registered as a risk and handled in the plan by
  scoping the sweep to `pending` and having the claim path tolerate an
  already-absent entry. Introducing ledger locking is explicitly **out of scope**
  (pre-existing property; would be its own ADR).

## Alternatives considered

- **Single surface (guard only, or sweep only).** Guard-only leaves the ledger/
  inbox accumulating closed-issue cruft that is never pruned until someone tries to
  claim it, and pays a live `gh` probe on the head candidate every claim.
  Sweep-only leaves a race window: an issue closed between two ticks can still be
  claimed. Rejected — the operator requires both, and they are genuinely
  complementary (synchronous guarantee + asynchronous hygiene).
- **New terminal `abandoned-upstream` status instead of forget.** Preserves an
  audit row, but `ledger.known` then blocks re-ingestion when the issue reopens
  unless dedicated reopen handling is added. Rejected — more surface, more edge
  cases, and it breaks the natural reopen path for no operational gain here.
- **Move the `--state open` guarantee to dequeue by re-polling on every claim.**
  Re-running the full poll at claim time is heavier and still would not clean
  quiescent backlog. Rejected in favor of the targeted per-candidate probe.

## Consequences

- `claim` never delivers a closed issue; the ledger/inbox self-heal between claims.
- Every claim of a `github-issues` `pending` head candidate now costs one live `gh
  issue view` (bounded; only until an open candidate is found). Acceptable for an
  interactive command.
- Reopened issues re-enter intake naturally via poll.
- No schema change, no new `LedgerStatus`, no CLI-breaking change.

## Wiring Surface (design-time)

- **Claim-guard issue probe** — added inside `createDeliveryGuardedQueue`
  (`delivery-guard.ts`), already wired into the `engineer claim` path via
  `engineer-cli.ts:1015`. No new call site; extends an existing decorator branch.
- **Brain reconciliation sweep** — a new function (e.g.
  `reconcileClosedIssues(deps, { dryRun })`), invoked from `intakeTick`
  (`intake-loop.ts`) which the brain singleton runs each tick
  (`brain-supervisor-cli.ts` → `conduct-ts intake-loop --continuous`). Its `gh`
  issue-state capability is supplied through the intake deps, mirroring how
  `halt-issues/sweep.ts` receives `GhAbstraction`.
