# Conflict Check: Mechanical prerequisite HALT loops the daemon in resume-and-refuse (#3601)

**Date:** 2026-11-07
**New stories:** `.docs/stories/mechanical-prerequisite-halt-loops-the-daemon-in-r.md` (Stories 1–4)
**Result:** PASSED. Two blocking conflicts were resolved and one degrading interaction was accepted by the operator. No blocking conflicts remain. The second blocking conflict (the over-scope decision carrier) surfaced during `land`'s dependency review of #3551. It was resolved by amending the ADR and stories in place, and this report was re-run over the revised stories.

## Inventory

All story files in `.docs/stories/` were scanned with keywords covering the shared subject: HALT classes, `HALT.cleared`, `clearMarker`, the progress-gated re-kick, `lastResolvedCount`, `dispatch_ceiling`, resume authorization, and mechanical re-dispatch. The pairs reasoned through in both directions were:

- `daemon-halts-a-build-that-is-making-forward-progre` (S2 progress re-kick, ceiling)
- `markerless-no-verdict-daemon-exit-is-always-classi` (the mechanical prerequisite HALT and the re-kick ceiling)
- `main-advance-re-kick-sweep-wipes-needs-human-decid`, `a-halted-feature-only-re-runs-when-a-human-clears-`, `refuse-daemon-auto-resume-of-an-operator-action-ha`, `most-conductor-halts-carry-no-class-sidecar-so-the` (retention by class)
- `stack-preflight-refusals-end-the-run-with-no-halt-` (live-HALT refusal and the live journal owner's mechanical HALT)
- `routed-repair-opens-a-new-round-while-an-earlier-r` Story 4 (stuck stops escalate after 3)
- `unpark-resumes-a-halted-feature-on-stable-main` (unpark output for a live mechanical HALT)
- `audit-trail-write-completeness-for-retro-under-fre` (`halt_cleared` seams)
- `a-halt-leaves-no-committed-pushed-record-for-the-o` (record supersede on clear)
- `kickback-to-build-no-op-when-target-evidence-stamped` (zero net progress)
- `operator-park-a-human-placed-halt-must-survive-the` and `park-all-dispatch-paths` (park precedence)

In-flight spec #3620 (`refused-over-scope-rework-can-t-start-while-a-rout`) was also checked. Its fence refusals write a `mechanical` HALT and escalate on the 3rd identical stop, and they are compatible with this spec.

**ADRs examined:** `adr-2026-07-12-progress-aware-build-halt`, `adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`, `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`, `adr-2026-08-23-committed-halt-record`, `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`, `adr-2026-10-12-routed-whole-feature-repair` (D7 as amended by #3445), and `adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary`.
**ADRs narrowed out:** all others in `.docs/decisions/`. Their subjects (provider execution, build review, release gates, publication, intake, skills) do not touch HALT retention, re-dispatch eligibility, or the progress baseline. None was excluded as superseded.

## Conflict: `halt_cleared` recording seam for a dispatch-boundary clear (resolved)

**Stories involved:** Story 1 (#3601) vs "HALT lifecycle is recorded — intervention on write, halt_cleared on clear"
**Files:** `.docs/stories/mechanical-prerequisite-halt-loops-the-daemon-in-r.md` vs `.docs/stories/audit-trail-write-completeness-for-retro-under-fre.md`
**Type:** overlap
**Severity:** blocking
**ADR filename stem:** adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Each clear in decision 1 emits the existing `halt_cleared` event with `cause: 'rekick'` on the feature's emitter, and the daemon logs one line naming the slug and the cleared HALT class."
**Story opposing sentence (verbatim):** "Given the autonomous rekick path renames `HALT` → `HALT.cleared`, when the watcher fires, then the `halt_cleared` record carries `cause: 'rekick'` — the presence of the `HALT.cleared` sibling distinguishes an autonomous rename from an operator unlink, so retro never misattributes an autonomous clear as an operator intervention (conflict resolution 2026-07-07 vs daemon-event-driven-wake)."

**Description:** The parent daemon's dispatch boundary has no feature event emitter, because that emitter is created inside the executor. `dispatch` disposes the slug's HALT-cleared watcher before re-dispatching, so the documented rekick seam never fires for a clear made there. As drafted, the clear would leave no `halt_cleared` record and no committed-record supersede. Emitting on a new path would add a second recording seam.

**Resolution Options:**
1. The dispatch boundary calls the existing halt-clear append seam (`appendHaltClearedRecord`, cause `rekick`) after disposing the watcher. Exactly one record is written, and the committed halt record is superseded.
2. Clear before disposing the watcher and let the watcher record it. This races fs-watch timing against the dispatch.
3. Add a feature emitter to the parent dispatch boundary. That is a second spine path and violates the event-spine principle.

**Recommendation and operator decision:** Option 1. The ADR's decision 5 and A6 were revised in place (the ADR is new on this branch). Story 1's third happy criterion and its Done When now name `.pipeline/audit-trail/events.jsonl` and the record supersede. The architecture diagram and review were updated to match.

## Conflict: the dispatch-boundary clear vs the prd_audit over-scope decision carrier (resolved)

**Stories involved:** Story 1 (#3601) vs the over-scope decision-block stories governed by `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`
**Files:** `.docs/stories/mechanical-prerequisite-halt-loops-the-daemon-in-r.md` vs `.docs/decisions/adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md`
**Type:** state-conflict
**Severity:** blocking

**Description:** As first drafted, the dispatch-boundary clear used `clearMarker`, which renames the live HALT over `.pipeline/HALT.cleared`, and decision 2 compared HALT bodies against that same file. `.pipeline/HALT.cleared` also carries the operator's prd_audit over-scope decision until `preparePrdWideningBeforeAudit` (`engine/conductor.ts`) harvests it at the next prd_audit entry. Take a resume after an over-scope clear that first meets a mechanical prerequisite block: the prompt clear would destroy the operator's decision before prd_audit read it. This was found while reviewing #3551 at land.

**Resolution Options:**
1. Give the dispatch boundary its own identity marker, `.pipeline/HALT.rekicked`. The clear writes the cleared body there and never touches `HALT.cleared`; the sweeps are unchanged.
2. Keep `clearMarker`, but skip archiving when `HALT.cleared` parses as an over-scope decision carrier. This couples the daemon to the widening parser.
3. Make #3551 a prerequisite and leave the design as is.

**Recommendation and operator decision:** Option 1 (2026-11-07). ADR decisions 1, 2 and 5 and assumption A7 were revised in place. Story 1 gained a negative path asserting that `HALT.cleared` is byte-identical across the clear, and Story 2's identity criteria now name `HALT.rekicked`. The re-check below found no new conflict: the audit-trail story's rekick attribution is still met by the direct append seam, and the unpark story's "HALT.cleared bytes unchanged" criterion is about unpark only.

## Conflict: unpark's mechanical-HALT message vs the automatic prompt retry (accepted, degrading)

**Stories involved:** Story 2 (#3601) vs unpark Story 1 (#822)
**Files:** `.docs/stories/mechanical-prerequisite-halt-loops-the-daemon-in-r.md` vs `.docs/stories/unpark-resumes-a-halted-feature-on-stable-main.md`
**Type:** overlap
**Severity:** degrading

**Description:** After unparking a slug with a live `mechanical` HALT, unpark prints that the feature "will not resume until its HALT is cleared" and names removing `HALT` and `HALT.class` as the recovery. With Story 2, the daemon itself clears a distinct mechanical HALT and re-dispatches once. Both stories still hold: the sentence stays literally true because the daemon clears the HALT before resuming, and manual removal is still a valid recovery. The message just no longer mentions the automatic retry.

**Resolution Options:**
1. Accept as degrading and leave the unpark output unchanged.
2. Amend the unpark story so mechanical and legacy output says the daemon will retry once automatically. This expands scope into unpark output code.

**Recommendation and operator decision:** Option 1 (accepted 2026-11-07). It stays inside the Balanced scope boundary.

## Pairs examined and found compatible

- **Progress re-kick S2 (`daemon-halts-…`):** S2's rule, "ending resolved count exceeds its starting resolved count", is what Story 3 stamps and checks. Satisfying either one leaves the other holding.
- **Markerless mechanical prerequisite HALT:** its criteria that progress re-kick does not refuse `mechanical` and that the ceiling stops re-kicks are kept. Prompt re-dispatches count against the same ceiling.
- **Retention stories:** `needs-human`, `plan-gap`, `over-scope`, `kickback-cap`, and `unclassified` remain retained on every automatic path (Stories 1, 2 and 4 restate this).
- **Stack-preflight refusals:** the live-HALT refusal text and the authorized-crossing behavior are untouched (Story 4). The live-journal-owner mechanical HALT is "recoverable by the daemon's existing automatic re-kick", and that is now true with one prompt retry.
- **Routed-repair stuck-stop escalation (#3445) and #3620 fence escalation:** before this change, a second stop on a stacked feature could not run, because the preflight refused the live HALT. Now stop 1 gets a prompt retry, and the identical stop 2 waits for a sweep before stop 3 escalates to `needs-human`. Escalation still terminates; it is paced by sweeps. In both directions, satisfying one story leaves the other holding.
- **`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` §4:** that decision covers errored outcomes, which leave a `needs-human` marker. Its statement that it "does not introduce automatic retry" is about itself. Mechanical HALTs were already auto-cleared by the sweeps, and this spec is event-driven, not clock-driven.
- **Kickback no-op:** its "zero net progress" precondition is about counts within a dispatch. No conductor code reads `lastResolvedCount` (ADR A2), so removing the conductor stamps does not change it.
- **Operator park:** park precedence is kept, because Story 1 does not clear an operator-parked feature's HALT.
- **Over-scope decision carrier (after resolution):** the dispatch boundary never writes `HALT.cleared`, so every over-scope decision story's harvest-at-prd_audit precondition holds. Satisfying either side leaves the other holding.

No oscillating, sequencing, or state conflicts were found.
