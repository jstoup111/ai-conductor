# Conflict Report: Surface Owner-Gated Specs in Dashboard and Status

**Date:** 2026-07-03
**New stories:** `.docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md` (7 stories, #208)
**Scanned:** all 40 story files in `.docs/stories/`, 27 prior reports in `.docs/conflicts/`,
plus unmerged `spec/*` branches touching daemon surfaces (harness-daemon-profile,
build-push-pr-timing, priority-list).
**Result:** 0 blocking, 4 degrading (all accepted as shared-surface reconciliation)

## Degrading 1: `discoverBacklog` return-shape contention

**Stories:** new "Discovery emits structured gated entries" vs dependency-ordered intake
(WAITING channel, #246), priority scheduling (#234), content-aware dedup.
**Type:** resource-contention + sequencing. **Severity:** degrading.
Four features touch the discovery return shape / selection path. Semantics compose cleanly
(dedup/content filters → owner gate (`gated`) → dependency gate (`waiting`) → priority
orders surviving `items`); the new stories' own negative paths ratify this ordering.
**Status of the sequencing risk:** the `{ items, waiting }` shape and WAITING dashboard
group are already on `main` (#246 merged; `waiting` reserved) — the presumed baseline
exists. Whoever merges later reconciles signatures/tests, the same pattern accepted in
`2026-07-03-dependency-ordering-vs-priority-scheduling.md`.
**Resolution:** accepted (operator, 2026-07-03). Additionally, the operator requires
dependency ordering in play: issue #208 gets native GitHub blocked-by relations behind the
priority-scheduling and content-aware-dedup issues so the daemon builds the three
discovery-touching specs serially (#246's dependency-ordered dispatch enforces it). Links
added at handoff.

## Degrading 2: Dashboard group set + precedence chain

**Stories:** new "Dashboard renders a GATED group" vs daemon-halt-reconciliation
("four groups", precedence), dependency-ordered (WAITING), priority scheduling ("four-group
structure preserved").
**Type:** resource-contention on `renderDashboard` + bucket precedence. **Severity:** degrading.
Older stories' "four-group" wording is a snapshot of their era, additively extended since
(WAITING landed in #246). The new GATED group extends the same chain; the plan must pin the
full precedence explicitly: `HALTED > PROCESSED > IN-PROGRESS > GATED > WAITING > ELIGIBLE`
(a gated spec never reaches the dependency gate, so GATED-vs-WAITING never co-occurs for one
slug by construction; the chain ordering is documentation of that invariant).
**Resolution:** accepted; precedence pinned in the plan, one-bucket invariant tested.

## Degrading 3: Historical fail-open story superseded (verify legacy distinction)

**Stories:** new "Repo-level gate warnings … fail-closed identity" vs `daemon-owner-gate.md`
"Gate is inactive when no owner can be resolved" (fail-open, historical).
**Type:** contradiction with superseded text. **Severity:** degrading (already resolved).
The fail-open→fail-closed reversal was ratified by `multi-operator-ownership-hardening.md`
Story 3 (D3). The new stories match current posture. Verified in code: the two states are
genuinely distinct today — `opts.daemonOwner` ABSENT = gate unwired (legacy silent), present
but `resolved:false` = fail-closed with warning (daemon-backlog.ts:325-328). The new stories
preserve exactly that distinction.
**Resolution:** none needed; `daemon-owner-gate.md`'s fail-open story must not be cited as
authority (superseded by hardening D3).

## Degrading 4: `daemon status` output contention

**Stories:** new "daemon status shows per-repo gated state" vs priority scheduling FR-10
(pending order/bands) vs supervised-hosting (liveness rows).
**Type:** resource-contention on `runDaemonStatus` rendering/tests. **Severity:** degrading.
Each feature appends a scoped section; no contradictory assertions. Last-to-merge reconciles
snapshot/argv tests.
**Resolution:** accepted; no story change.

## Clean areas verified

- Write-back label/marker namespaces: new `owner-gated` label + new hidden marker are
  distinct from `needs-remediation`/`mergeable`; upsert semantics mirror (not compete with)
  the existing contract.
- Priority scheduling explicitly defers to the owner gate ("ownership skip stands
  unchanged"; priority resolution strictly post-gate).
- Content-aware dedup precedes the gate ("skipped as SHIPPED (not owner-gated)") —
  consistent with the new "content filters run first" invariant.
- `issue-ref.ts` remains the single Source-Ref parse source (mandated by the new stories).
- `.daemon/gated.json` path is unique — no other story reads/writes it.
- Unmerged spec branches (harness-daemon-profile, build-push-pr-timing) add no stories
  touching discovery/dashboard/status surfaces.

## Verdict

Conflict check passed: zero blocking conflicts; four degrading overlaps accepted as
standard shared-surface reconciliation (same pattern as the #229/#234 stack).
