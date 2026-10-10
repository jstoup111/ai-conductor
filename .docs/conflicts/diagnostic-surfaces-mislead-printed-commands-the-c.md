# Conflict Check: Accepted remediation commands and durable episode-HALT recovery (#1023)

**Date:** 2026-10-10
**Stories checked:** `.docs/stories/diagnostic-surfaces-mislead-printed-commands-the-c.md` (Stories 1–6) against all 584 files in `.docs/stories/` and the narrowed APPROVED ADR corpus.
**Result:** PASSED — zero blocking conflicts. One degrading conflict resolved by an in-place story correction; two compatible overlaps recorded.

## Inventory

**Stories examined as relevant (full read):** `daemon-api-rate-limit-episode-cascades-into-mass-h`, `refuse-daemon-auto-resume-of-an-operator-action-ha`, `operator-park-a-human-placed-halt-must-survive-the`, `unpark-resumes-a-halted-feature-on-stable-main`, `main-advance-re-kick-sweep-wipes-needs-human-decid`, `persist-the-once-per-sha-re-kick-guard-across-daem`, `daemon-halts-a-build-that-is-making-forward-progre`, `daemon-event-driven-wake-for-parked-halted-feature`, `needs-human-halt-auto-resumed-at-dispatch-rewind-c`, `a-halt-leaves-no-committed-pushed-record-for-the-o`, `loop-halt-never-reaches-events-jsonl-so-a-halt-is-`, `bin-conduct-unknown-subcommand-guard`, `v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai`, `a-kickback-restages-a-skipped-manual-test-as-stale`, `conduct-state-json-lost-update-conductor-s-whole-o`, `custom-steps-crash-the-conductor-with-step-artifac`, `parked-feature-reconciliation-1060`, `halt-pr-presentation-reliability`, `2026-07-03-daemon-auto-restart-stale-engine`, `2026-07-10-stale-engine-residuals-369`. All other story files were narrowed out by a keyword sweep (episode, HALT.class, clearMarker, writeHaltMarker, rekick, sweep, orphan, `--diagnose`, `--reset`, `--fresh`, bare-form, unknown-subcommand, operator park, idle/startup tick).

**ADRs examined (narrowed in):** `adr-2026-07-05-daemon-rate-limit-episode-coordinator`, `adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-08-23-committed-halt-record`, `adr-2026-08-06-honest-park-termination-boundary`, `adr-2026-07-04-operator-park-marker`, `adr-2026-07-29-operator-park-scheduling-unit-boundary`, `adr-2026-07-13-park-all-dispatch-paths`, `adr-2026-07-27-ancestry-proven-park-reconciliation`, `adr-2026-07-04-park-unpark-cli-verbs`, `adr-2026-07-04-durable-pause-marker`, `adr-2026-07-04-event-driven-halt-clear-wake`, `adr-2026-09-20-halt-resolution-queue-derived-from-markers`, `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`, `adr-2026-08-27-daemon-dispatcher-executor-seam`, `adr-2026-07-04-auth-failure-park-and-poll`, `adr-2026-08-09-seal-rotation-authorship-predicate`, `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`, `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`, `adr-2026-08-08-finish-human-required-halt-rendering`, `adr-2026-07-03-daemon-auto-restart-stale-engine`, `adr-2026-07-06-stale-engine-respawn-in-place`, `adr-2026-07-07-single-generation-stale-respawn`, and the new `adr-2026-10-10-durable-episode-halt-stamp`. ADR-013's re-kick rules were read through `adr-2026-07-28` D7, which carries them forward.

**ADRs narrowed out:** build-review/rubric/kickback-cap; rebase/restack/seal (their only HALT-sidecar mention is `HALT.class`); provider/Codex/OTel/cost; intake/ledger; watch-registry/worktree-reap/shipped-record; ADRs using "episode" only for build-stall or auth-recovery episodes. No examined ADR is fully superseded.

## Conflict: Missing or unreadable HALT class — recover vs retain (RESOLVED)

**Stories involved:** Story 5 vs `refuse-daemon-auto-resume-of-an-operator-action-ha` Story 2
**Files:** `.docs/stories/diagnostic-surfaces-mislead-printed-commands-the-c.md` vs `.docs/stories/refuse-daemon-auto-resume-of-an-operator-action-ha.md`
**Type:** contradiction (by omission)
**Severity:** degrading

**Description:** The existing story requires: "Given a feature stamped as halted during a rate-limit episode whose halt class is missing or unreadable, when the episode ends and the recovery sweep runs, then its marker is left in place." Story 5's happy path recovered any stamped HALT "neither operator-parked nor carrying an operator-action HALT class", which would have recovered a missing/unreadable class. Verified against `recoverEpisodeHalts` in `src/conductor/src/engine/daemon-rekick.ts`, which delegates to the shared `resolveHaltRetention` predicate (confidence 95%).

**Resolution Options:**
1. Restate Story 5 in terms of the shared halt-retention rule and add a missing/unreadable negative path.
2. Enumerate the recoverable classes in Story 5.
3. Change the existing story.

**Recommendation and applied resolution:** Option 1 — preserves the existing predicate as the single authority. Story 5 was corrected in place: its happy path now recovers only when "the shared halt-retention rule does not retain" the disposition; a new negative path leaves a missing or unreadable class in place; logs name "the disposition that blocked the clear", matching the existing story.

## Compatible overlaps (recorded, no change)

- **"No new marker family" (episode story) vs `HALT.episode` (Story 6).** The existing story allows the stamp to be a "reason suffix or sidecar timestamp". Today's stamp is neither — it is an in-memory `Set` — so `HALT.episode` is the sidecar form that story already allows, and it replaces the in-memory store instead of running alongside it.
- **Episode-end sweep through "EXISTING sweep machinery … no parallel mechanism" vs Story 3.** Story 3 recovers through the existing rekick path (`HALT.cleared` + `REKICK`). ADR decision 4 makes the startup/idle recovery replace the in-process edge trigger instead of adding a second sweep.
- **`adr-2026-07-28` D5 (no direct production writes to `HALT` outside `halt-marker.ts`) vs Story 6.** This is compatible provided the stamp path constant and its write/remove helpers live in `halt-marker.ts`, as the ADR's follow-up actions already state. The plan must keep them there.
- **`adr-2026-07-05` "Episode state is lost on daemon restart"** remains true for the episode itself. Only the HALT stamp becomes durable, and the new ADR records that refinement, so the earlier ADR needs no amendment.
- **Operator-park precedence, needs-human retention, `HALT.class` lifecycle, halt-record and halt-resolution-queue marker reads, event-driven wake, and auth-park remediation:** all preserved; the new sidecar is additive and absent from every closed file list.
- **CLI guidance (Stories 1–2):** no existing story or ADR asserts the text of the orphaned-state, SHIP-evidence-gap, or recovery-declined guidance, and no ADR defines the bare-form guard grammar.

## Re-check

After the Story 5 correction, all pairs above were re-checked in both directions. No blocking conflict and no oscillation remains.
