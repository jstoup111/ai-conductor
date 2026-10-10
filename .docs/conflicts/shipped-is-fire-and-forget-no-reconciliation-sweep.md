# Conflict Check: Shipped PRs get a re-examined readiness verdict (#438)

**Date:** 2026-10-09
**Stories checked:** `.docs/stories/shipped-is-fire-and-forget-no-reconciliation-sweep.md` (Stories 1–6)
against every existing story touching the mergeable sweep, its labels, autoresolve, ship-ci, and
halt-PR presentation: `daemon-pr-labels`, `ship-ci-feedback-loop`, `auto-resolve-open-pr-conflicts`,
`mergeable-autoresolve-tier-2-escalates-every-conte`, `mergeable-watch-registry-size-cap`,
`halt-pr-presentation-reliability`, `auto-opened-needs-remediation-pr-occupies-the-bran`,
`finish-should-rewrite-stale-needs-remediation-titl`, `daemon-false-ship-guard`,
`pr-labels-structured-gh-not-found-detection`, `reclaim-merged-feature-worktrees-without-depending`.
**ADR corpus:** `change_set` (default) — `adr-2026-10-09-shipped-pr-readiness-verdict`.
**Result:** 1 blocking conflict found and resolved; re-check clean.

## Conflict: A readiness `needs-remediation` label would stick forever

**Stories involved:** Story 3 / Story 4 (this spec) vs Story 1 (this spec) and "Never label a needs-remediation PR as mergeable" (FR-12)
**Files:** `.docs/stories/shipped-is-fire-and-forget-no-reconciliation-sweep.md` vs `.docs/stories/daemon-pr-labels.md`, `.docs/stories/ship-ci-feedback-loop.md`
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-10-09-shipped-pr-readiness-verdict
**Story ID:** Story 1
**ADR opposing sentence (verbatim, as first drafted):** "`no-checks` and `draft` → the existing `needs-remediation` label path, applied once (label-absent→present transition), the same sweep-side precedent as ship-ci exhaustion."
**Story opposing sentence (verbatim):** "Given an open watched PR that is not a draft, reads `MERGEABLE` with `mergeStateStatus` `CLEAN`, base `main`, and all checks on its head commit succeeded, when a sweep tick runs, then its verdict is `ready` and it receives the `mergeable` label exactly as before this change."

**Description:** The existing label path is sticky. FR-12 never adds `mergeable` while
`needs-remediation` is present, and ship-ci treats the label as a dispatch suppressor until a human
clears it. The sweep only auto-clears it when the recorded cause is conflict resolution. A PR
labelled for `no-checks` whose CI later passed would classify `ready` but never get `mergeable`,
and if its CI later failed it would never reach ci-fix. Root: the design (ADR D3), so routed to
architecture in amendment mode.

**Resolution Options:**
1. Self-clearing attributed label: record `escalationCause: 'shipped-readiness'` and remove the
   label when the verdict leaves `no-checks`/`draft` (bounded retry, like the conflict-resolution clear).
2. Keep it sticky and amend Stories 1 and 5 so the PR stays un-mergeable until a human clears it.
3. Do not label; surface `no-checks`/`draft` only via the event and `daemon status`.

**Recommendation / operator selection:** Option 1 (operator-selected 2026-10-09). ADR D3 revised
in place (unlanded artifact of this spec); Stories 3 and 4 gained the clearing and
foreign-label-preserved paths; diagram updated.

## Re-check (after resolution)

Pairs examined in both directions ("if A is fully satisfied, does B still hold?"):

- **Self-clearing vs halt-PR reconciliation** (`halt-pr-presentation-reliability`): reconciliation
  acts only on PRs carrying the halt body marker; the readiness clear never fires while that
  marker is present (Story 4). Both hold. Clean.
- **Self-clearing vs conflict-resolution clear** (`auto-resolve-open-pr-conflicts`,
  `mergeable-autoresolve-tier-2…`): one `escalationCause` field. If autoresolve escalation fires
  on a PR already labelled for readiness, it records `conflict-resolution` and its own clear rule
  governs. Each rule removes only a label it attributed. Converges; clean.
- **Self-clearing vs ship-ci exhaustion sticky** (`ship-ci-feedback-loop`): exhaustion's label is
  not attributed to readiness, so it is never removed by this rule (Story 3 negative path). Clean.
- **Draft verdict vs FR-16 clear-on-success at `done` enrollment** (`daemon-pr-labels`): clear-on-
  success runs before the PR is watched; the readiness rule applies only after. No overlap.
- **Draft exclusion** (ship-ci, autoresolve): preserved by Story 4. Clean.
- **`mergeable-watch-registry-size-cap`:** new optional `WatchEntry` fields do not change the
  100-entry cap or trim order. Clean.
- **`daemon-false-ship-guard`, `pr-labels-structured-gh-not-found-detection`,
  `reclaim-merged-feature-worktrees…`:** MERGED/CLOSED/NOTFOUND handling is unchanged (Story 1
  negative path). Clean.

No oscillating conflict: every label mutation is gated on an attributed cause and a state
transition, so no two rules add and remove the same label on the same state.
