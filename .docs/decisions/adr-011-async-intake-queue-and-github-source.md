---
status: APPROVED
date: 2026-06-27
approved: 2026-06-27
supersedes: none
extends: adr-009-intake-adapter-port
deciders: James Stoup
phase: 9.3b
---

# ADR-011: Async Intake Queue + GitHub-Issues Source

## Status
APPROVED (2026-06-27). Authoritative on 9.3b implementation.

## Context
ADR-009 locked an intake **port + Envelope** contract and wired only the synchronous
`claude-session` adapter. Phase 9.3b adds the first **async** source (GitHub issues). Async
sources arrive with no operator present, but routing/DECIDE are interactive and human-gated, so
capture must be split from processing with a durable buffer between them — a need the synchronous
chat path never had.

The operator also flagged that a future **distributed worker pool** (which will change FR-20's
single-winner model) would require robust pull+queue semantics (leases, visibility timeout,
multi-worker claim). 9.3b must not build that now, but must not foreclose it either.

## Decision
1. **Add an `IntakeSource` capture interface** (`poll(): Promise<Envelope[]>`) distinct from
   `IntakePort.report()`. The engineer core depends only on the interface (extends ADR-009's
   loose-coupling rule). The `claude-session` adapter stays synchronous and is **not** an
   `IntakeSource`.
2. **github-issues adapter**: polls `gh issue list --assignee @me --state open` across all
   9.2-registry repos, producing Envelopes with `source="github-issues"`,
   `sourceRef="<owner>/<repo>#<n>"`, `text=title+body`, `hintRepo=<repo>`.
3. **Introduce an `IntakeQueue` interface** (`enqueue/claim/ack/release`) with a **file-backed
   implementation now** (`.engineer/inbox/`). A distributed-pool backend is a future drop-in
   implementation of the same interface — **zero** adapter/loop changes when it lands.
4. **The queue's atomic claim uses its own primitive** (`O_EXCL`/atomic-rename on `.engineer/`)
   and **never imports `daemon-lock.ts`**. FR-20 / ADR-010's `O_EXCL` pidfile lock stays
   byte-for-byte untouched. A static no-import guard enforces this.
5. **Poll-on-launch + standalone `engineer poll` subcommand.** The harness supervises no
   always-on process; the operator may cron `engineer poll` if they want background capture.

## Rationale
- Processing is human-gated, so for **re-queryable pull sources** capture latency is irrelevant —
  a background poller buys no throughput at solo scale and adds a supervised process + concurrency
  surface. Poll-on-launch is sufficient; the `poll` subcommand keeps the cron door open.
- Putting the buffer behind `IntakeQueue` is the same additivity play ADR-009 used for sources:
  the expensive future change (distributed pool) becomes a contained backend swap.

## Consequences
- **Positive:** github source is one adapter + config; the daemon lock is provably untouched; the
  distributed pool is pre-seamed; `.engineer/` and `.daemon/` are disjoint.
- **Negative / trade-off:** an issue filed while the operator is away isn't *captured* until the
  next launch (it also couldn't be *processed* sooner). The file-backed queue is single-host only
  — acceptable until the pool phase swaps the backend.
- **Constraint on implementers:** do not import or modify `daemon-lock.ts`; the claim is independent.

## Alternatives Rejected
- **Always-on background poller now** — supervised process + its own concurrency surface for zero
  throughput gain at solo scale.
- **No queue interface (plain ledger/inbox)** — would force a rewrite of the intake/claim path when
  the distributed pool lands.
