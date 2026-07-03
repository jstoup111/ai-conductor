# Conflict Check: Daemon Issue-Priority Scheduling

**Date:** 2026-07-03
**New stories:** `.docs/stories/2026-07-03-daemon-issue-priority-scheduling.md`
**Scanned against:** all `.docs/stories/*.md` (daemon-adjacent set read in full:
content-aware-shipped-work-dedup, daemon-halt-reconciliation, daemon-owner-gate,
multi-operator-ownership-hardening, multi-operator-ownership-slice-b,
background-intake-conduct-loop, phase-9.3b-github-intake-writeback,
daemon-supervised-hosting, daemon-pr-labels, harness-self-host-guardrails,
intake-issue-pr-link-autoclose)
**Result:** PASSED — 0 blocking, 2 degrading resolved via story amendment, 2 accepted notes

## Conflict: Priority fetch vs fail-closed identity scan

**Stories involved:** "Priority influences order only — never eligibility" vs
multi-operator-ownership-hardening Story 3 ("Daemon fails closed on unresolved identity")
**Type:** sequencing | **Severity:** degrading | **Status:** RESOLVED

An unresolved-identity scan returns an EMPTY backlog. If priority resolution ran before the
gate it would burn API reads and could log a spurious outage warning for a scan that builds
nothing. **Resolution (applied):** FR-8 story now pins priority resolution to run only over
the post-gate eligible set; a fail-closed scan performs zero lookups. No change to the
hardening stories.

## Conflict: Band annotations vs existing dashboard format

**Stories involved:** "Operator can see the effective build order and why" vs
daemon-halt-reconciliation ("Render the inherited-state dashboard at startup") and
daemon-supervised-hosting ("Check a repo's daemon status")
**Type:** behavioral overlap | **Severity:** degrading | **Status:** RESOLVED

The startup dashboard pins a four-group format (HALTED/IN-PROGRESS/ELIGIBLE/PROCESSED) with
stdout+log parity; the supervisor `daemon status` is a separate surface. **Resolution
(applied):** FR-10 story now requires band annotations to extend the ELIGIBLE listing
additively, preserving the four-group structure and parity, and to leave the supervisor
rows untouched.

## Accepted note: cumulative gh/REST budget on the daemon loop

**Stories involved:** new label reads vs daemon-pr-labels per-tick PR sweep and
background-intake polling (shared token/rate limit)
**Type:** resource contention | **Severity:** degrading | **Status:** ACCEPTED

Mitigation already designed in (ADR `adr-2026-07-03-priority-from-linked-issue-labels`):
label reads happen on refresh scans only, one read per linked pending item, cached for
local scans; stories assert zero hot-path lookups. Cumulative pressure is bounded and
fail-soft. No story change.

## Accepted note: load-bearing dependencies, wording drift

- Banding's "linked issue" detection depends on slice-b's guarantee that owner stamping
  preserves the intake marker's `Source-Ref:` line (multi-operator-ownership-slice-b
  Story 3) — a dependency, not a conflict; already guaranteed there. An unresolvable/raw
  ref degrades to existing parse semantics (covered by the new stories' negative paths).
- harness-self-host-guardrails TR-13 ("non-harness discovery path identical to today")
  is written against a pre-priority baseline; once this feature lands, "today" includes
  the ordering seam for all repos. Wording drift only — TR-13's intent (guardrails add no
  cost) is unaffected. No story change.
- phase-9.3b intake-queue FIFO ("claim oldest") orders the IDEA queue, not the daemon
  build backlog — distinct subsystems; the priority sort must not (and does not) touch
  the intake queue.
- The new once-per-outage warning flag is process-local and MUST NOT share or reset the
  durable `.daemon/warned/` per-slug state (already pinned in ADR
  `adr-2026-07-03-priority-fetch-fail-soft` and the FR-7 story).

## Re-check

After the two amendments, re-scanned the amended stories against the same set: no new
contradictions introduced; 0 blocking remain.
