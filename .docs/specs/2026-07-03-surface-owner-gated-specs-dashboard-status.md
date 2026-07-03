# PRD: Surface Owner-Gated (Un-Owned) Specs in the Daemon Dashboard and Status Output

**Date:** 2026-07-03
**Status:** Approved

## Problem / Background

The daemon's ownership gate protects multi-operator repos by declining to build specs it
cannot attribute to this daemon's operator. Today, when the gate skips a spec, the only
trace is a single warn-once line in the daemon's log file. The startup dashboard buckets
work into HALTED / IN-PROGRESS / WAITING / ELIGIBLE / PROCESSED — gated specs appear in
**none** of them, and the daemon status command shows nothing about them either.

The result is invisible stalls. On 2026-07-02, two merged Fable-rollout specs (#189, #190)
were silently skipped by the ownership gate for hours; nothing in the dashboard, the status
output, or the spec PRs indicated they were blocked or why. The operator had to grep the
daemon log to discover the skip.

Gated work must be a first-class visible state: every spec the daemon discovers on the
default branch should appear in exactly one dashboard bucket, and a blocked spec should
say why it is blocked and what would unblock it.

## Goals & Non-Goals

**Goals**

- An operator can see every ownership-gated spec, with its gate reason and a remedy hint,
  from the startup dashboard and from the daemon status command — without reading log files.
- A phone-level status check is sufficient to notice that work is gated and why.
- The blockage is also visible where the work lives: on the spec's pull request and, when
  the idea came from intake, on the originating issue.
- Gated visibility is self-correcting: once a spec becomes buildable (or is built), it stops
  appearing as gated without operator cleanup.

**Non-Goals**

- Changing the ownership gate's decision policy (who may build what stays exactly as is).
- Auto-claiming or auto-assigning ownership of un-owned specs.
- Building gated specs, or adding any override/bypass of the gate.
- A historical audit trail of past gate decisions (only the current state is surfaced).

## Users / Personas

- **The daemon operator** (solo dev, often checking from a phone): needs to notice stalled
  work quickly and know the one action that unblocks it.
- **A collaborating operator on a multi-operator repo**: needs to see that a spec is waiting
  on a *different* owner (or on ownership being declared) rather than assuming the daemon
  is broken.

## Functional Requirements

- **FR-1:** The daemon startup dashboard includes a gated-work section, alongside the
  existing buckets, listing every spec the ownership gate skipped in the most recent scan.
- **FR-2:** Each gated entry states its gate reason, distinguishing at minimum: owned by a
  different operator (naming that owner), un-owned and merged after the ownership cutover,
  and un-owned with an indeterminate merge time.
- **FR-3:** Each gated entry includes a remedy hint appropriate to its reason — e.g. declare
  an owner for the spec, or adjust the repo's ownership cutover — so the operator knows the
  unblocking action without consulting documentation.
- **FR-4:** Every spec discovered on the default branch appears in exactly one dashboard
  bucket; a gated spec appears in the gated section and in no other section.
- **FR-5:** The daemon status command shows, per repo, the same gated-work information
  (slugs, reasons, remedy hints) so gated work is visible without daemon startup output.
- **FR-6:** Gated-work information in the status command is labeled with its freshness (when
  the daemon last evaluated it); if the daemon has never produced gated-work information for
  a repo, the status output says so explicitly rather than showing nothing.
- **FR-7:** Gated-work state reflects the most recent scan only: a spec that becomes
  buildable, is built, or disappears from the default branch no longer appears as gated
  after the next scan, with no manual cleanup.
- **FR-8:** When a spec is skipped by the ownership gate, the daemon announces the block on
  that spec's pull request (a visible note and a distinguishing label), including the gate
  reason and remedy hint.
- **FR-9:** When a gated spec originated from intake (it carries a source reference to an
  issue), the daemon also announces the block on that originating issue.
- **FR-10:** Gate announcements on PRs and issues are idempotent: repeated scans of a
  still-gated spec update the existing announcement in place rather than posting duplicates.
- **FR-11:** Repo-wide gate conditions — the daemon's own operator identity being
  unresolvable, or an un-owned spec encountered with no ownership cutover configured — are
  surfaced in the dashboard and status output as repo-level warnings, not silently logged.
- **FR-12:** Write-back failures (PR/issue announcements that cannot be delivered) are
  advisory: they are reported in the daemon's log but never block, delay, or fail the scan
  or any build.
- **FR-13:** When no specs are gated, the dashboard and status output make that state
  unambiguous (an explicit empty gated section or its clean omission — consistent between
  the two surfaces).
- **FR-14:** If the stored gated-work information is missing or unreadable, the status
  command degrades gracefully with an explicit "unknown" indication, never a crash or a
  silently absent section.

## Non-Functional Requirements

- The daemon status command must remain cheap: surfacing gated work must not require
  re-scanning repos or querying remote services at status time.
- Gate announcements must not spam: one living announcement per spec PR / issue, updated
  in place.
- Visibility additions must not change gate outcomes: with this feature on, the set of
  specs built is byte-identical to today's behavior.

## Acceptance Criteria / Success Metrics

- With a repo containing at least one spec per gate reason, the startup dashboard shows each
  in the gated section with the correct reason and remedy hint, and none of them appear in
  any other bucket.
- The daemon status command shows the same gated entries with a freshness label, without
  the daemon needing to be restarted.
- A gated spec's PR carries the announcement and label after one scan, and still carries
  exactly one announcement after ten scans.
- Declaring an owner for a gated spec (or adjusting the cutover) removes it from the gated
  section on the next scan and it proceeds to build eligibility as today.
- The 2026-07-02 incident scenario — a merged spec skipped due to an ownership stamp
  mismatch — is diagnosable from the phone via the status command alone.

## Scope

### In Scope

- The gated-work section in the startup dashboard and the daemon status command.
- Per-spec gate reasons and remedy hints on both surfaces.
- Warn-once PR and originating-issue announcements (note + label) for gated specs.
- Repo-level warnings for unresolved daemon identity / missing cutover.

### Out of Scope

- Any change to gate decision rules, ownership stamping, or cutover semantics.
- Notifications through other channels (email, chat, push).
- Surfacing gate state for repos the daemon does not manage.
- Retroactive announcements for specs gated before this feature ships.

## Key Decisions & Rationale

- **Gated work is a first-class dashboard state, not a log line** — invisible stalls cost
  hours (2026-07-02 incident); logs are not a monitoring surface.
- **Announcements live where the work lives** — a blocked spec's PR/issue is where a
  collaborator will look first; mirroring the existing blocked-work announcement behavior
  keeps the experience consistent.
- **Current-state only, self-healing** — showing only the latest scan's result avoids stale
  "gated" claims that erode trust in the dashboard.

## Dependencies

- The existing daemon ownership gate (gate reasons and skip behavior) — this feature
  surfaces its decisions and must not alter them.
- GitHub access already used by the daemon for PR/issue operations — announcements ride the
  same access and degrade advisorily when it is unavailable.

## Open Questions

- Freshness source for the status command: the status surface must stay cheap (no re-scan),
  which implies reading state the daemon persisted at scan time — the exact persistence and
  atomicity/staleness handling is an architecture-review trade-off.
- Whether the repo-level warnings (identity unresolved / no cutover) should also write back
  to any GitHub surface, or remain dashboard/status-only.
