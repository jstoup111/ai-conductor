# Conflict Check: Backend-neutral priority/size/dependency reads (#851)

**Date:** 2026-10-10
**New stories:** `.docs/stories/backend-neutral-priority-size-dependency-reads-for.md` (Stories 1-6)
**Result:** PASS. 0 blocking conflicts; 1 degrading conflict, resolved by the operator.

## Inventory

Every story file under `.docs/stories/` was searched for the shared subjects: priority bands,
`unlabeled`, not-found, `indeterminate`, blocker resolution, `tracker_backend_unavailable`, Jira,
size, and the label-reader and blocker-resolver construction. The pairs examined in both
directions were:

- `2026-07-03-daemon-issue-priority-scheduling.md`: a not-found issue bands unlabeled and is not
  an outage; the vocabulary is closed. Compatible with Stories 1, 3, and 6.
- `prime-priority-labels-when-the-resolver-cache-is-c.md`: a missing reference bands unlabeled
  with no repeat reads. Compatible with Stories 1 and 3, since a Jira reference makes zero reads.
- `2026-07-10-priority-banded-intake-claim.md`: claim-time banding, FIFO within a band, and
  fail-open. Compatible with Story 5.
- `dependency-ordered-intake-and-dispatch.md`: a malformed or unparseable origin reference
  resolves to `indeterminate`, so the spec is WAITING and never dispatched, and an indeterminate
  claim entry is deferred. Compatible with Stories 4 and 5. A Jira-linked spec stays WAITING, as
  it does today; it only gains an explicit no-adapter reason.
- `dependency-edges-are-hand-maintained-intake-and-de.md` Story 13: an undeterminable dependency
  is never reported as clean. Compatible with Stories 2 and 4.
- `spec-authoring-is-blind-to-unmerged-dependent-work.md` and
  `scan-overlap-against-each-branch-s-own-merge-base-.md`: overlap-scan `indeterminate` stays
  visible. Compatible with Story 5.
- `per-project-work-tracker-backend-selection-in-regi.md` Story 3: the intake-poll event is
  deduplicated per exclusion episode for a project. Its subject is a different emitter, keyed by
  project rather than reference, so it is compatible with Stories 3 and 4.
- `generalize-source-ref-parsing-formatting-to-suppor.md`: `parseWorkRef` returns kind `jira`
  for `PROJ-123`, and `parseSourceRef` returns null for it. Stories 3 and 4 depend on exactly this.
- `canonical-tracker-client-seam-with-per-backend-tra.md` TR-3: see the conflict below.

ADRs examined: adr-2026-07-22-canonical-tracker-client-seam (with the #845 and #158 amendments),
adr-2026-07-03-priority-from-linked-issue-labels (with the #2158 amendment),
adr-2026-07-03-priority-fetch-fail-soft, adr-2026-07-10-intake-claim-priority-banding, and
adr-2026-10-10-backend-neutral-ordering-source. None conflict with the new stories; the
alignment analysis is in architecture-review-2026-10-10-backend-neutral-priority-size-dependency-reads-for.
ADRs narrowed out: every other ADR under `.docs/decisions/`. None addresses backlog ordering,
issue labels, or dependency reads.

## Conflict: The #846 claim-path criterion names the label reader and runner as direct consumers

**Stories involved:** Story 2 and Story 5 (new) vs canonical-tracker-client-seam TR-3
**Files:** `.docs/stories/backend-neutral-priority-size-dependency-reads-for.md` vs `.docs/stories/canonical-tracker-client-seam-with-per-backend-tra.md`
**Type:** contradiction (wording)
**Severity:** degrading

**Description:** TR-3 said the claim path's "label reader and blocker resolver consume the
injected `TrackerClient`/canonical runner". Story 2's Done When says the blocker resolver
"no longer takes a GitHub runner", and ADR D6 retires the label reader. The intent survives,
because the canonical runner is still the only GitHub transport, one layer down. The literal text
would mislead a later audit.

**Resolution Options:**
1. Reword the TR-3 criterion in place to say the reads reach GitHub only through the canonical
   runner via the ordering source.
2. Leave both texts unchanged and accept the compromise.

**Resolution (operator-selected):** Option 1. The TR-3 criterion was reworded in place.

## Constraints carried into the plan (examined, not conflicts)

- The TR-3 stray-declaration scan forbids any gh-runner-shaped type declaration outside
  `tracker-client.ts`. `ordering-source.ts` must import `GhRunner` rather than declare one.
- TR-3's "`dependency-claim.ts` is not touched at all" scoped #846's own diff and is not a
  standing invariant. Story 5 may change `resolveClaimBands`' input type.

## Oscillation check

For each pair above, both directions were tested: does fully satisfying A still let B hold? No pair
fails in both directions. The parity stories (1, 2, 5) and the Jira stories (3, 4) touch disjoint
reference kinds, and `unavailable` maps onto bands and verdicts that already exist.
