# Conflict Report: per-project-work-tracker-backend-selection-in-regi (#845)

**Date:** 2026-09-28
**Stories checked:** Stories 1–4 of `.docs/stories/per-project-work-tracker-backend-selection-in-regi.md`
vs all files in `.docs/stories/`. A keyword scan covered `buildIntake`, composition root, unknown
top-level key, `reportRouted`, `reportDone`, advisory write-back, `engineer:handled`, and `tracker`.
The candidates it found were read in full.
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml` `conflict_check.adr_corpus`). All 322 ADR
titles and statuses were skimmed, and about 30 were read in depth.
**Result:** ZERO blocking conflicts. Five degrading conflicts were found. Four were resolved by story
or review edits (applied). One was resolved by citing the governing amendment, with no edit.

## Resolved by story edits (stories updated in place)

### 1. Story 4 vs `generalize-source-ref-parsing-formatting-to-suppor` (behavioral overlap)
**Type:** overlap. **Severity:** degrading.
That story requires a Jira-ref land to still commit the marker and advance the ledger on the
skipped write-back branch. Story 4 originally named only the skipped `gh` call and the event.
**Resolution:** Story 4 negative paths now require the ledger advance (`routed`; `done` with PR URL
and branch) on every excluded write-back.

### 2. Story 1 vs ADR `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (obligation gap)
**Type:** sequencing. **Severity:** degrading.
**ADR filename stem:** adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "New keys fail the test until they declare a consumer or a reasoned `none`"
**Story opposing sentence (verbatim):** "`tracker` is an accepted top-level key in project config, and each of its nested keys is enumerated in the config key sets"
**Resolution:** a Story 1 Done-When now requires consumer-registry declarations for `tracker` and
each nested key, with the tracker selection resolver as consumer, and the totality test passing.

### 3. Story 3 vs ADRs `adr-2026-07-26-event-sink-registry-exhaustiveness` / `adr-2026-08-11-halt-events-ride-the-persisted-spine` (obligation gap)
**Type:** sequencing. **Severity:** degrading.
**ADR filename stem:** adr-2026-07-26-event-sink-registry-exhaustiveness
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Adding a member to `ConductorEvent` therefore fails compilation until that member declares where it goes."
**Story opposing sentence (verbatim):** "`tracker_backend_unavailable` is a member of the `ConductorEvent` union, and production intake emits it on the event spine passed to the engineer dispatch"
**Resolution:** Story 3 Done-When now requires an event-sink registry entry that persists and
renders the event.
- The event is emitted once per exclusion episode per process, so a ticking intake loop does not
  flood the spine. This follows the `missingRegistrationEpisodes` precedent.
- Architecture-review Condition 2 is updated to match.
- The narrow `GithubOperationEventEmitter` parameter type must widen; that is plan work.

### 4. Story 4 vs ADRs `adr-2026-07-04-claim-time-delivery-evidence-guard` / `adr-012` (state conflict)
**Type:** state-conflict. **Severity:** degrading.
**ADR filename stem:** adr-2026-07-04-claim-time-delivery-evidence-guard
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "Delivery evidence is recorded on every handoff outcome."
**Story opposing sentence (verbatim):** "no `gh` write is made for it, the event is emitted, and `handoff` still reports the PR as opened"
The failure modes this guards against:
- An excluded write-back that left the ledger `claimed` would be requeued by the stale-claim reaper.
- One that returned `ok:false` would set a spurious `writebackPending`.

**Resolution:** Story 4 now requires the ledger transition with PR URL and branch, and requires
that no write-back be marked pending. Architecture-review Condition 5 is added.

## Resolved by citation (no edit)

### 5. Design vs ADRs `adr-011-async-intake-queue-and-github-source` / `adr-2026-06-30-background-intake-brain-loop` (narrowing overlap)
**Type:** overlap. **Severity:** degrading.
**ADR filename stem:** adr-011-async-intake-queue-and-github-source
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "polls `gh issue list --assignee @me --state open` across all 9.2-registry repos"
**Story opposing sentence (verbatim):** "then envelopes come from project A only and the GitHub backend receives no `gh` call for project B."
**Resolution:** the later, APPROVED adr-2026-07-22-canonical-tracker-client-seam D4 (amended by this
spec) explicitly excludes Jira-selected projects from intake. It governs the narrowing, so no
further amendment to ADR-011 or the brain-loop ADR is made. That avoids editing two ADRs whose
decisions this feature does not otherwise change.

## Accepted scope notes (not conflicts)

- Claim-time `gh` checks on envelopes queued before a project switches backend are unchanged. The
  stories intro records this as the scope boundary.
- `adr-2026-06-29-per-project-memory-provider-selection` falls back to `local` when the key is
  malformed. `tracker` fails closed instead, which the seam ADR D4 makes explicit, so it is not cited
  as precedent for handling invalid config.
- `canonical-tracker-client-seam-with-per-backend-tra` TR-6 documented the key as reserved and not
  read. That story was scoped to #846, and D3 hands the reading to #845, so the two do not
  conflict. The #846 story is not edited.
