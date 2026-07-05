---
status: APPROVED
date: 2026-07-04
approved: 2026-07-04
supersedes: none
amends: adr-012-durable-intake-ledger-sole-dedup-authority
deciders: James Stoup
issue: jstoup111/ai-conductor#243
---

# ADR: Claim-Time Delivery-Evidence Guard (intake re-dispatch protection)

## Status
APPROVED (2026-07-04). Amends adr-012-durable-intake-ledger-sole-dedup-authority.

## Context

`engineer claim` serves envelopes purely from the file inbox; it never consults the
ledger before serving. ADR-012 made the ledger the *sole dedup authority*, but that
authority is only enforced at **poll** (capture) time — a duplicate or leftover inbox
envelope for an idea whose lifecycle already advanced sails straight into a fresh
session, which then authors a duplicate spec. Observed live (2026-07-03):
`jstoup111/ai-conductor#200` was re-served while stranded at `status: claimed` with
`branch` + `prUrl` (spec PR #234) already recorded.

Two independent defects compound:

1. **Read side:** claim trusts the inbox unconditionally; the ledger's lifecycle and
   delivery evidence are ignored at the last gate before authoring. Duplicate envelopes
   exist in practice (poll's `known()`→`record()` check-then-act is racy across
   concurrent polls — launcher pre-poll vs background intake loop).
2. **Write side:** the ledger advance to `done` (with `prUrl`) happens only in
   `reportDone`, which runs only on the `pr-opened` handoff path. When `openSpecPr`
   throws (the #290 gh-ENOENT family), handoff falls to the local-commit path and
   **no ledger write happens at all** — the entry strands at `claimed` even after the
   operator finishes the PR by hand. Recovery today is hand-editing `ledger.json`.

A stale-`claimed` TTL was explicitly rejected (issue #243): a TTL *re-dispatches*,
which is precisely the failure mode.

## Decision

1. **Claim-time delivery guard.** The claim walk consults the ledger for every
   candidate envelope before serving:
   - Entry has **`prUrl` recorded** → verify PR state via `gh pr view`:
     - **OPEN or MERGED** → the idea is delivered: auto-heal the entry to `done`
       (preserving evidence), `ack` the envelope (drop the duplicate), continue the
       walk. Never served.
     - **CLOSED unmerged** → defer to the existing FR-39/40 re-eligibility semantics
       (reopen + churn cap) — no new bypass around the cap.
     - **Lookup failure** → fail safe: skip the candidate (leave it pending), never
       serve on uncertainty. A duplicate spec is worse than a delayed claim.
   - Entry status is **beyond `pending` with no `prUrl`** (in-flight elsewhere) → the
     envelope is a duplicate of in-flight work: drop it (`ack`) without touching the
     entry's status, and log the drop with the sanctioned re-open path
     (`engineer forget`). Statuses at/before `pending` (or no entry — non-recording
     sources) serve normally.
   - Seam: the guard wraps the queue handed to `claimUnblocked` (a guarding decorator
     implementing the same claim/release surface), so the dependency-ordered walk
     (adr-2026-07-03-*) is unchanged.
2. **Delivery evidence is recorded on every handoff outcome.**
   - `pr-opened` → unchanged (`reportDone`: `done` + `prUrl` + `branch`).
   - **local-commit fallback** → record `branch` evidence on the entry (status
     unchanged) so the strand is visible and diagnosable; the operator completes
     delivery with `engineer resolve` (below). A gh write-back failure can no longer
     produce an evidence-free strand.
3. **`engineer resolve <sourceRef> --pr-url <url>` recovery primitive.** Marks an
   entry `done` with the given `prUrl` (plus optional `--branch`) — the sanctioned
   replacement for manual JSON surgery after a manual PR fix-up. Idempotent; reports
   `found: false` for an unknown ref without error (parity with `forget`).

## Consequences

- **Positive:** the ledger becomes the enforced (not just declared) dedup authority at
  the last gate before authoring; every strand flavor — write-back crash, manual
  surgery, duplicate envelope from the poll race — is neutralized at claim time; the
  #290 failure family degrades to a visible, recoverable state instead of a silent
  re-dispatch.
- **Trade-offs:**
  - Claim now makes gh calls for prUrl-carrying candidates (bounded: only stranded/
    duplicate entries carry evidence; the healthy path adds one ledger read per
    candidate).
  - A `claimed` entry with **no** evidence and **no** surviving envelope (session
    crashed pre-land) remains stuck until an operator runs `engineer forget` — out of
    scope here by design (a TTL auto-reopen is the rejected re-dispatch hazard).
  - The guard's `ack` of a duplicate can race a concurrent claim's own `ack`
    (ENOENT on unlink) — the implementation must tolerate ENOENT as success.
- ADR-012's lifecycle table gains no new statuses; `done` remains the only terminal
  delivered state.

## Alternatives Rejected

- **Stale-`claimed` TTL / auto-reopen** — re-dispatches by construction; rejected in
  issue #243.
- **Write-side hardening only** — leaves already-stranded entries and racy duplicate
  envelopes serveable; the #200 incident would recur.
- **Fixing only the poll TOCTOU (lock around known/record)** — narrows one duplicate
  source but leaves claim trusting the inbox; any other strand (crash, manual state)
  still re-dispatches. The claim-time guard subsumes it.
- **Branch-existence heuristic for evidence-less entries** (treat a pushed
  `spec/<slug>` branch as delivery) — fuzzy matching on slugs re-introduces the
  slug-rename dedup gap (#204 family); only explicit `prUrl` evidence gates.
