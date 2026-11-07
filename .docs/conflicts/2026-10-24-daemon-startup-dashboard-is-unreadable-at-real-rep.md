# Conflict Check: Daemon startup dashboard readable at real repo scale (#1332)

**Date:** 2026-10-24
**Stories checked:** `.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md`
(Stories 1–7) against every `.docs/stories/` file that mentions the dashboard (47 files), checking
in both directions.
**Result:** PASSED. Two blocking conflicts and three degrading conflicts were found and resolved
with operator approval. None remain.

## ADR corpus

**Examined:** `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`,
`adr-2026-08-05-blocked-classification-after-dedup`,
`adr-2026-07-03-dependency-gate-backlog-waiting-channel`,
`adr-2026-07-03-owner-gate-gated-channel` (amended 2026-10-24 by #1332, D3),
`adr-2026-07-04-operator-park-marker` (amended 2026-10-24 by #1332, D5),
`adr-2026-07-03-gated-snapshot-status-read-model`,
`adr-2026-07-29-operator-park-scheduling-unit-boundary`,
`adr-2026-08-05-worktree-classification-evidence-derived-reasons`.

**Narrowed out:** every other ADR whose filename or body mentions the dashboard (listed by
`grep -l dashboard .docs/decisions/*.md`). They govern halt classification, priority, writeback,
pause, kickback, task status, provenance, and event emission, and make no claim about group display
order, render sinks, or row width. No stated dashboard rule in them conflicts with Stories 1–7.

No ADR-versus-story conflict remains. The two ADR clauses that tied display order to group
identity were amended during architecture review.

## Conflict: Startup dashboard sinks must receive identical content

**Stories involved:** Render the inherited-state dashboard at startup vs Story 7: Full detail stays reachable
**Files:** [.docs/stories/daemon-halt-reconciliation.md] vs [.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criterion required the identical dashboard text on stdout and
`daemon.log`. Story 7 sends the full render to the log and the compact render to the console.

**Resolution Options:**
1. Rewrite the existing criterion: the log gets the full render; stdout gets the compact render,
   or the full render under `--all`/`--completed`.
2. Keep identical content and compact both sinks, losing full detail in the log.
3. Add a third sink.

**Recommendation and resolution:** Option 1, applied in place (operator-approved 2026-10-24).

## Conflict: PARKED story fixes the other groups' relative order

**Stories involved:** operator-park dashboard precedence story vs Story 2: Actionable groups render first, inert groups last
**Files:** [.docs/stories/operator-park-a-human-placed-halt-must-survive-the.md] vs [.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criteria required the other groups' relative order, and their
output, to stay unchanged. Story 2 reorders groups for display.

**Resolution Options:**
1. Keep the bucket-precedence rule and drop the order and unchanged-output clauses, consistent
   with the D5 amendment.
2. Keep the original order and drop Story 2.

**Recommendation and resolution:** Option 1, applied in place.

## Conflict: GATED empty form and failure fallback "same as ELIGIBLE"

**Stories involved:** owner-gated GATED story vs Story 5 and Story 2
**Files:** [.docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md] vs [.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md]
**Type:** overlap
**Severity:** degrading

**Description:** The existing story requires GATED to render an explicit empty form, and the same
discovery-failure fallback as ELIGIBLE. Story 5 gave GATED an `unknown` line and left ELIGIBLE
unspecified.

**Resolution:** Story 5 now renders ELIGIBLE with the same `unknown — discovery did not complete`
line. Story 2 states that GATED renders `GATED (0)` (and ELIGIBLE `ELIGIBLE (0)`) when discovery
completed with no entries.

## Conflict: Each retained worktree is listed in status/dashboard

**Stories involved:** retained-worktree category story vs Story 3: Inert groups collapse on the console
**Files:** [.docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md] vs [.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md]
**Type:** overlap
**Severity:** degrading

**Description:** The compact console collapses retained rows that carry no remedy.

**Resolution:** The existing criterion is rewritten in place to name the full render
(`daemon.log`, or the console with `--all`), which still lists every retained row.

## Conflict: Golden suite pins the dashboard rendering

**Stories involved:** single-branch-step golden suite vs Stories 1–2
**Files:** [.docs/stories/engine-cannot-represent-more-than-one-branch-step-.md] vs [.docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md]
**Type:** sequencing
**Severity:** degrading

**Description:** `test/engine/n1-golden-renderings.test.ts` compares `renderDashboard` output with a
recorded fixture. The new attention line and display order change those bytes by design.

**Resolution:** The plan carries an explicit task to regenerate the dashboard golden fixture from
the new full render. The golden suite's purpose (detecting unintended changes) is unchanged.

## Pairs examined, no conflict

- Auto-park provenance (`prd-audit-kickback-preserves-task-status.md`): provenance still shows in
  the full render; the compact render never mislabels it.
- Six retained slugs, exactly one awaiting main (`worktree-with-no-conduct-state-is-retained-as-pr-o.md`):
  holds in the full render; the compact render lists only remedy-bearing rows.
- WAITING only in WAITING (`dependency-ordered-intake-and-dispatch.md`): preserved by Story 6.
- Startup dashboard uses the startup discovery result with no refetch
  (`daemon-reconciliation-delays-first-feature-dispatc.md`): reinforced by Story 5.
- Halted row shows reason and remedy (`let-an-operator-park-settle-without-a-needs-human-.md`):
  satisfied by Story 4's detail line.
