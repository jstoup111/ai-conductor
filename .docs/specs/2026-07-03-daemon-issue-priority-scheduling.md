# PRD: Daemon Issue-Priority Scheduling

**Status:** Approved
**Date:** 2026-07-03
**Source:** jstoup111/ai-conductor#200 (intake)
**Track:** product

## Problem / Background

When several merged, build-ready specs are pending, the daemon works through them in
chronological order (oldest first). The operator has no lever to say "build this one next."
The most valuable pending work waits behind whatever happened to merge earlier.

Most specs originate from GitHub intake issues, and those issues already carry the repo's
priority vocabulary (`priority: high` / `priority: medium` / `priority: low` labels). That
existing signal should drive build order, and the operator should be able to re-prioritize
from anywhere (including a phone) by relabeling the issue — without touching the repo.

## Goals

- The daemon builds the most valuable pending spec next, not merely the oldest.
- The operator can re-prioritize pending work at any time with a single label change on the
  originating issue, taking effect without restarting the daemon or modifying the repo.
- Specs the operator commissioned directly (no originating issue) are treated as the most
  deliberate asks and build ahead of issue-sourced work.

## Non-Goals

- Changing **what qualifies** as buildable. Eligibility gates (merged spec, accepted stories,
  well-formed plan, ownership) are untouched.
- Preempting or reordering work already in flight — priority affects only which pending spec
  is picked next.
- Introducing a new place to record priority. The existing issue priority labels are the
  single priority source; no parallel ranking artifact.

## Users / Personas

- **Operator** — ranks pending work by labeling intake issues; expects the daemon to honor it.
- **Daemon** (autonomous builder) — consumes the ranking when choosing its next feature.

## Functional Requirements

- **FR-1** — When more than one pending spec is eligible to build, the daemon selects the next
  one by priority ordering rather than solely by age.
- **FR-2** — Specs with **no originating issue** form the highest-priority band and build
  before all issue-linked specs.
- **FR-3** — Issue-linked specs are banded by the linked issue's priority label:
  `priority: high`, then `priority: medium`, then `priority: low`.
- **FR-4** — Issue-linked specs whose issue carries **no priority label** form the lowest band
  and build after all labeled specs.
- **FR-5** — Within every band, today's chronological (oldest-first) order is preserved as the
  tie-break, so introducing priority never scrambles equal-priority work.
- **FR-6** — Priority is re-read as part of the daemon's normal scanning, so relabeling an
  issue changes the build order on a subsequent scan with no daemon restart and no repo change.
- **FR-7** — If the priority source is unreachable (offline, API failure), the daemon falls
  back to today's pure chronological order for that scan, surfaces a warning once per outage,
  and never blocks or fails a build because priority could not be read.
- **FR-8** — Priority influences ordering only: an ineligible higher-priority spec never
  blocks an eligible lower-priority spec from being picked (no head-of-line blocking), and a
  spec's priority never changes any eligibility decision.
- **FR-9** — If an issue carries more than one priority label, the highest one wins;
  non-priority labels are ignored.
- **FR-10** — The daemon's status output shows the effective build order (and the priority
  band each pending spec landed in), so the operator can verify the ranking took effect.

## Non-Functional Requirements

- **Scan latency:** reading priorities must not materially slow the daemon's poll loop, even
  with many pending specs.
- **Offline operation preserved:** the daemon must remain fully functional with no network —
  degraded only to today's chronological ordering (FR-7).
- **Cross-repo issues:** a spec whose originating issue lives in a different repository is
  ranked by that issue's labels the same way.

## Acceptance Criteria / Success Metrics

- With three pending specs — one unlinked, one linked to a `priority: low` issue, one linked
  to a `priority: high` issue — the daemon builds them unlinked → high → low.
- Relabeling a pending spec's issue from `low` to `high` moves it ahead on a subsequent scan
  without restarting the daemon.
- With the network down, the daemon builds the pending backlog in today's chronological order
  and logs exactly one priority-unavailable warning.
- README, relevant daemon/skill docs, and the CHANGELOG `[Unreleased]` section are updated in
  the same PR (per issue #200's acceptance criteria).

## Scope

**In:** ordering of the daemon's pending-backlog selection; priority visibility in daemon
status output; fail-soft behavior when priority is unreadable.

**Out:** eligibility/qualification gates; in-flight work; authoring-time priority capture;
any new committed ranking artifact; changes to how specs record their originating issue.

## Key Decisions & Rationale (product)

- **Issue labels are the priority source** — the operator already triages intake issues with
  priority labels; reusing that signal means one place to manage priority and instant,
  repo-untouched reordering (chosen over a committed ranking file or authoring-time stamps —
  see the 2026-07-03 decision record).
- **Unlinked specs outrank everything** — a spec the operator commissioned directly is a
  deliberate, high-intent ask; intake issues flow through triage instead.
- **Unlabeled issues rank last** — forces triage: work the operator never prioritized should
  not jump labeled work (operator-confirmed).
- **Outage falls back to chronological order** — predictable, matches today's behavior, and
  never lets a stale ranking block progress.

## Dependencies

- **GitHub issues and their priority labels** (`priority: high|medium|low`) — the
  pre-existing external priority vocabulary this feature reads.
- **Existing spec↔issue linkage** — intake-originated specs already record their originating
  issue; this feature consumes that existing linkage and does not alter it.

## Open Questions (for architecture-review)

- How often the priority source is consulted vs cached between scans (freshness vs API-rate
  trade-off), given the scan-latency NFR.
- Whether a mid-outage scan should reuse the last successfully read priorities instead of
  pure chronological fallback (product default: pure fallback, per FR-7).
- Where the once-per-outage warning dedup state lives, aligned with existing warn-once
  behavior.
