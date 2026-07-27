# Conflict Check: DECIDE-phase coherence ownership at the daemon boundary (#971)
**Date:** 2026-07-26
**New stories:** `.docs/stories/2026-07-26-daemon-decide-phase-coherence-ownership-971.md` (6 stories)
**Scanned against:** all `.docs/stories/` (204 files), narrowed by three targeted sweeps —
preseed/pre-stamp semantics (`rekick-resume-runs-finish-while-the-build-gate-ver`,
`fresh-session-per-step`, `audit-trail-write-completeness-for-retro-under-fre`,
`auto-park-markers-written-to-the-worktree-s-daemon`), daemon discovery vetting
(`phase-9.3-engineer-redesign`, `port-test-conduct-worktree-sh-coverage-to-the-ts-s`,
`owner-stamped-at-authoring`, `sidecar-stamp-reachability-guard`), and coherence/tier policy
(`decide-artifact-coherence-check`, `s-tier-pipeline-knobs`)
**Result:** PASSED — 2 overlaps found and resolved in stories; 0 blocking remain

## Overlap 1: Discovery eligibility criteria are defined in two specs

**Stories involved:** new Story 4 ("A missing or invalid required coherence artifact is rejected
before BUILD begins") vs `phase-9.3-engineer-redesign.md:668` — *"plan has a dependency tree +
slug not in `.daemon/processed/`"*, which enumerates the daemon's spec-eligibility criteria.
**Type:** additive overlap on a shared decision point (the discovery vetting loop,
`daemon-backlog.ts:655-673`)
**Severity:** non-blocking (extension, not contradiction)

**Description:** `phase-9.3-engineer-redesign` states the eligibility list that governs whether a
merged spec is dispatched. New Story 4 adds a criterion to that same list. Neither artifact says
the list is closed, but two specs now describe the same gate, so a future reader could take the
9.3 enumeration as exhaustive and treat the coherence check as unsanctioned.

**Resolution applied (story-level):** Story 4 is written as an explicit *third* check
alongside the two named existing ones (stories-not-approved, plan-has-no-dependency-tree) and
reuses their exact mechanism (`warnOnce`, `.daemon/warned/<slug>`, once-per-slug, spec never
enters the backlog) rather than introducing a parallel path. Story 6 additionally requires
`docs/daemon-operations.md` to document the three rejections together, so the operator-facing
enumeration has a single home. No change needed to `phase-9.3-engineer-redesign` — its list
was never declared closed, and the ADR (D3) records the extension.

## Overlap 2: `'done'` vs `'skipped'` semantics for tier-skippable DECIDE steps

**Stories involved:** new Story 3 ("A preseeded step carries a tier-correct status") vs
`decide-artifact-coherence-check.md` Story 13 — which carries an **operator ruling of
2026-07-22**: *"coherence is not needed for S — the step is skipped for S-tier exactly like
architecture-diagram/review and conflict-check"* — and vs
`audit-trail-write-completeness-for-retro-under-fre.md:218`, which asserts *"daemon mode where
front-half steps are pre-stamped done (never executed) ... no front-half records exist ... the
completeness invariant still holds (it is scoped to executed steps)"*.
**Type:** potential contradiction on state semantics
**Severity:** would have been blocking if unresolved — it touches a standing operator ruling

**Description:** New Story 3 changes the daemon's preseed stamp from unconditional `'done'` to a
tier-correct `'skipped'`/`'done'`. Two existing artifacts speak to this:

1. The 2026-07-22 operator ruling says coherence must behave *"exactly like"*
   architecture-diagram/review and conflict-check at S tier. Read naively, Story 3 appears to
   *change* those three steps and so to move the reference point the ruling was pinned to.
2. The audit-trail story's wording ("pre-stamped **done**") could be read as a requirement that
   the preseed stamp is literally `'done'`.

**Reasoned resolution (verified, not assumed):**

1. **No contradiction with the operator ruling — Story 3 makes the daemon *conform* to it.** The
   conductor already computes `'skipped'` for all four steps at S tier
   (`conductor.ts:2549-2557`, emitting a `tier_skip` event). Only the daemon's preseed path
   stamps `'done'` unconditionally, which is precisely where the four steps *stop* behaving
   alike in a tier-aware way. Story 3 brings the daemon path into agreement with the conductor
   path, so after the change the four steps behave identically at S on **both** paths — which is
   what the ruling asks for. The ruling is honored more completely after this change than before.
2. **No contradiction with the audit-trail invariant.** That story's invariant is explicitly
   *"scoped to executed steps"* — it requires that pre-stamped steps produce no audit records.
   A step stamped `'skipped'` is equally not executed and equally produces no records, so the
   invariant is untouched. The word "done" there is descriptive of the then-current
   implementation, not a normative requirement on the literal status value.
3. **No conflict with the pinned tier test.** `s-tier-pipeline-knobs.md:54` pins
   `getSkippableSteps('S')` to an exact set. Story 3 changes only the *status stamped* by the
   daemon, never `skippableForTiers` on any step definition, so the pinned set is unchanged.

**Story-level adjustment made:** Story 3's happy path was written to state the effect on all
four tier-skippable DECIDE steps explicitly, rather than mentioning only `coherence_check` and
leaving the other three as an unstated side effect. Story 3 also gained a negative path pinning
the unresolved-tier case (fallback applied *before* stamping; unresolved tier is never treated
as S), which is the actual hazard the ordering constraint in the architecture review identified.

## Verified-clean pairs (reasoned, not assumed)

- **Re-dispatch / re-kick semantics** — `rekick-resume-runs-finish-while-the-build-gate-ver.md`
  governs where a re-dispatched feature resumes. New Story 1's third negative path asserts
  preseeding also applies on the resume path. These agree: the daemon already stamps
  `PRESEEDED_DONE` on both fresh start and resume (`daemon-cli.ts:882-886` runs unconditionally),
  so adding one name to a derived set changes nothing about *where* resume lands, only about
  which steps are already satisfied when it gets there. No contention.
- **Fresh-session-per-step** — `fresh-session-per-step.md` concerns provider session lifecycle
  per executed step. Removing a step from the executed set strictly reduces sessions created; no
  rule in that spec depends on `coherence_check` being among them. Same meaning, fewer
  invocations.
- **Auto-park markers** — `auto-park-markers-written-to-the-worktree-s-daemon.md` governs park
  marker location and reconciliation. Story 4 deliberately uses warn-skip, **not** park, so it
  creates no marker in `.daemon/parked/` and does not interact with the reconciliation loop. The
  ADR (D3) records why park was rejected on semantics (park acts on already-dispatched
  features). No resource contention on the marker directories — warn-skip writes to
  `.daemon/warned/`, park to `.daemon/parked/`.
- **Owner gate** — `owner-stamped-at-authoring.md` adds a fail-closed owner check in the same
  discovery loop. Story 4's check is independent (artifact presence, not identity) and both use
  `continue` to drop the candidate; the loop already hosts several sequential `continue` guards,
  so ordering between them is not semantically load-bearing. Recorded as a plan note anyway so
  the implementer places the new check deliberately rather than incidentally.
- **S-tier exemption** — `decide-artifact-coherence-check.md` Story 13 and new Story 5 state the
  same policy from two sides (land-time exemption vs discovery-time exemption). New Story 5's
  third negative path (unresolved tier fails closed toward *requiring* the artifact) is
  consistent with the existing land-time behavior, which also does not treat an absent tier as S
  (`coherence-validator.ts` checks `tier === 'S'` explicitly and otherwise falls through). Same
  policy, no divergence.
- **Shipped-record dedup** — the dedup warn-skip precedes the vetting checks in the same loop.
  Story 4 adds no new interaction; an already-shipped spec is dropped before the coherence check
  is ever reached, which is the desired precedence (never warn about a spec that already
  shipped).

## Resource contention

None found. The change writes to no new durable location: it reuses `.daemon/warned/` (existing
`warnOnce` channel) and `conduct-state.json` (existing stamping loop). No new files, no new
locks, no new config keys.

## Conclusion

**PASSED.** Two overlaps identified, both resolved at story level without an ADR change — Overlap
1 by explicitly framing the new check as a third instance of an existing pattern with a single
documented home, Overlap 2 by verifying against the actual conductor implementation that the
change brings the daemon into conformance with the standing operator ruling rather than
departing from it. No blocking conflicts remain. Cleared for `/plan`.
