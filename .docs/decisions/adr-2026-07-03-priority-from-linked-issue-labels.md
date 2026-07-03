# ADR: Backlog priority resolved from linked-issue labels via a post-discovery ordering seam

**Date:** 2026-07-03
**Status:** APPROVED
**Feature:** daemon issue-priority scheduling (jstoup111/ai-conductor#200)
**PRD:** `.docs/specs/2026-07-03-daemon-issue-priority-scheduling.md`

## Context

`discoverBacklog` returns build-ready items in lexicographic plan-stem order (date order) and
the daemon's `pickEligible` takes the first eligible item — so backlog order IS build priority.
The PRD requires banded ordering (no-issue → high → medium → low → unlabeled, FR-2..FR-5)
driven by the linked issue's `priority: *` label, re-read without daemon restart (FR-6), with
zero impact on eligibility (FR-8). Discovery is deliberately offline-capable today (committed
base-branch tree is the only source for spec content), and the poll loop's scan latency must
not grow materially.

## Decision

1. **Ordering is a pure, separate seam — discovery is untouched.** A new pure function
   (banded stable sort) reorders the `BacklogItem[]` *after* `discoverBacklog` produces it,
   using a `sourceRef → priority` map. Eligibility filtering stays entirely inside
   `discoverBacklog`/`pickEligible`; the sort only permutes already-eligible items (FR-8 by
   construction). Stable sort over the existing date-ordered input gives the within-band
   chronological tie-break (FR-5) for free.
2. **Priority source = the linked issue's labels, read via the GitHub REST API (`gh api
   repos/«owner»/«repo»/issues/«n»`)** — a read-only call, unaffected by the
   Projects-classic label-mutation breakage (evidence: PR #172 moved mutations to REST;
   reads via `--json labels` verified working in this repo). `sourceRef` already reaches the
   item from the committed intake marker (`daemon-backlog.ts` `parseIntakeSourceRef`), so
   cross-repo refs resolve naturally per-ref. Multiple `priority: *` labels → highest wins
   (FR-9); no label → `unlabeled` band; no `sourceRef` → top band without any network call.
3. **Fetch cadence = refresh scans only, cached in memory for local scans.** Labels are
   (re)fetched on `refresh: true` discovery passes — the same idle-only cadence that already
   fetches origin — and cached per `sourceRef` for the frequent `refresh: false` scans. The
   hot poll path therefore gains zero network calls; a relabel takes effect on the next
   refresh scan (satisfies FR-6's "a subsequent scan"). The first scan of a daemon run primes
   the cache (startup scan may fetch).

## Alternatives rejected

- **Sort inside `discoverBacklog`** — entangles a network concern with the offline-capable
  discovery keystone and complicates its tests; a pure post-discovery sort is independently
  testable and leaves discovery byte-identical.
- **Fetch labels on every local scan** — network on the hot poll path; violates the scan
  latency NFR and hammers the API for information that changes rarely.
- **Committed priority file / authoring-time stamp** — rejected at explore (see
  `.memory/decisions/2026-07-03-daemon-issue-priority-scheduling.md`): reordering must not
  require landing a commit.

## Consequences

- The daemon gains its first network read influencing scheduling; it is advisory-only by
  design (see companion ADR `adr-2026-07-03-priority-fetch-fail-soft`).
- Dashboard/status output (FR-10) can reuse the same ordering seam + priority map to show
  bands, keeping display and dispatch in lockstep.
- Priority freshness is bounded by refresh-scan cadence; an operator wanting instant effect
  can restart the daemon (cache is process-local, no durable state).
