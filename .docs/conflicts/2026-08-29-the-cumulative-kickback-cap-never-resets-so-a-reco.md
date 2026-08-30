# Conflict Check: cumulative kickback budget recovery

**Date:** 2026-08-29
**New stories:** `.docs/stories/the-cumulative-kickback-cap-never-resets-so-a-reco.md`
**ADR corpus:** `repo_wide`, read from `.ai-conductor/config.yml`
**Result:** PASSED — two blocking conflicts found and operator-resolved; zero blocking or degrading
conflicts remain.

## Inventory and corpus narrowing

The scan inventoried all 382 story files, 53 active-spec files, 534 decision/review files, and 236
prior conflict reports. It enumerated 230 ADRs carrying an approved status. Subject narrowing kept
the approved decisions governing cumulative and per-tree kickbacks, rebase invalidation/credit,
mechanical review faults, build-review dispositions, operator identity and intervention, park
ownership and dispatch exclusion, halt classification and canonical clear, committed halt records,
and event/audit persistence:

- `adr-2026-07-04-kickback-event-emission-and-log-prominence`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
- `adr-2026-07-28-total-halt-classification-legacy-boundary`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine`
- `adr-2026-08-12-cumulative-build-review-convergence-bound`
- `adr-2026-08-13-stable-build-review-finding-dispositions`
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`
- `adr-2026-08-23-committed-halt-record`
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`

The other 214 approved ADRs were examined by title/status and narrowed out because their subjects
do not address the behavior, entity, field, resource, or gate in these stories. Their domains are
intake and issue routing, provider/auth/model selection, test execution unrelated to review budget,
release/publication, Git/rebase mechanics outside invalidation credit, DECIDE artifact ownership,
UI/dashboard rendering unrelated to this inspection view, and other step-specific gates. Fully
superseded `adr-2026-07-04-operator-park-marker` was excluded at repo-wide scope; its preserved
marker decisions were checked through approved superseding
`adr-2026-07-29-operator-park-scheduling-unit-boundary`.

Focused story comparison retained every existing story mentioning cumulative kickbacks,
`build_review` convergence, mechanical review faults, operator parks, needs-human halt retention,
halt clearing/resume, committed halt records, or operator adjustment events. All six conflict types
were applied, including both directions of the oscillation test for every shared behavior.

## Conflict: A PASS cannot both clear and preserve cumulative convergence laps

**Stories involved:** Existing Story 2, “A passing build_review clears the cumulative count,” vs new
Story 8, “Existing convergence accounting remains bounded after recovery”
**Files:** `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md` vs
`.docs/stories/the-cumulative-kickback-cap-never-resets-so-a-reco.md`
**Type:** contradiction
**Severity:** blocking — resolved
**Confidence:** 99%, verified from the exact accepted-story and approved-ADR text.

**Opposing existing sentence (before resolution):** “Given a `build_review` ledger entry with
`cumulative: 4`, when `build_review` returns a PASS verdict, then the entry's `cumulative` is `0`."

**Opposing new sentence:** “Given a semantic `build_review` PASS occurs after recovery without a
qualifying invalidation, when the feature is inspected, then the cumulative count is not
automatically reset or credited."

**Description:** Both assertions govern the same ordinary PASS with no qualifying rebase. Fully
satisfying either makes the other false. Approved
`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D1 explicitly superseded the
older PASS-reset decision, so the contradiction was obsolete story text rather than a conflict in
the new PRD or architecture.

**Resolution Options:**

1. Replace the obsolete existing story assertions in place with the approved PASS-preserves and
   qualifying-rebase-credits behavior.
2. Introduce a new story-supersession mechanism and teach every consumer to ignore the old block.
3. Supersede the current convergence ADR and restore the unconditional PASS reset.

**Recommendation and resolution:** Option 1, operator-approved 2026-08-29. The existing Story 2 was
replaced in place, without an amendment block, so it now says PASS preserves convergence laps and a
qualifying invalidating rebase credits them exactly once. This is a story-level correction; no PRD
or architecture kickback and no superseding ADR are required.

## Conflict: A new kickback-cap halt class contradicts the two-class engine halt contract

**Stories involved:** ADR: Operator-authorized kickback budget recovery vs existing Story 1,
“Every new engine-owned HALT has an explicit retry disposition”
**Files:** `.docs/decisions/adr-2026-08-29-operator-authorized-kickback-budget-recovery.md` vs
`.docs/stories/most-conductor-halts-carry-no-class-sidecar-so-the.md`
**Type:** contradiction / state-conflict
**Severity:** blocking — resolved
**Confidence:** 99%, verified against the accepted story, current `HaltClass` union, and committed
halt-record classifier.
**ADR filename stem:** adr-2026-08-29-operator-authorized-kickback-budget-recovery
**Story ID:** 1
**ADR opposing sentence (verbatim):** “Recovery requires that evidence, the current ledger values,
and `HALT.class = kickback-cap` to agree; prose matching never authorizes mutation.”
**Story opposing sentence (verbatim):** “Given any production path that creates a conductor HALT,
when that path stops a feature, then the resulting marker has a readable class of exactly
`needs-human` or `mechanical` and the class matches the reviewed disposition for that reason.”

**Description:** The same new cap halt cannot carry `kickback-cap` while every new engine halt is
restricted to exactly `needs-human` or `mechanical`. The new class would also fall outside the
existing operator-action classifier and recordable-halt classifier, contradicting the ADR's own
requirement that daemon resume preserve canonical halt and committed-record handling.

**Resolution Options:**

1. Supersede the recovery ADR with a correction that keeps `HALT.class = needs-human` and proves the
   exact cap/generation through the typed ledger evidence and resume authorization already designed.
2. Widen the repository-wide halt-class contract, every exhaustive classifier, migration rule,
   committed-record rule, and test to admit `kickback-cap` as a third class.
3. Keep `needs-human` but infer cap identity from halt prose, discarding the typed-evidence rule.

**Recommendation and resolution:** Option 1, operator-approved 2026-08-29. New approved
`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` supersedes the conflicting
recovery ADR. The architecture diagram and review carry additive amendments: the cap halt remains
`needs-human`, typed ledger evidence/generation proves its exact identity, and the daemon consumes a
matching authorization before generic needs-human retention. No story change was required.

## Re-check interaction matrix

| Pair | A satisfied → B still holds? | B satisfied → A still holds? | Verdict |
|---|---|---|---|
| Reset/raise stories vs PASS-preservation and rebase-credit stories | Yes; explicit operator adjustment and qualifying rebase are disjoint authorities from PASS | Yes; PASS preservation does not prevent an exact operator adjustment | Clean, 99% |
| Temporary recovery park vs existing explicit operator park | Yes; only a park created and owned by the transaction auto-releases | Yes; a pre-existing park remains absolute until explicit unpark | Clean, 98% |
| Authorized daemon resume vs needs-human sweep retention | Yes; exact human authorization is not an autonomous sweep or expiry | Yes; without authorization every needs-human halt remains untouched | Clean, 98% |
| Matching halt clear vs committed halt record | Yes; the canonical clear resolves the record in place | Yes; record resolution does not broaden which halt may clear | Clean, 99% |
| Semantic adjustment vs mechanical-fault lane | Yes; reset/raise leave mechanical state unchanged | Yes; mechanical laps never charge or alter semantic count/limit | Clean, 99% |
| Adjustment history vs standard event occurrence | Yes; durable control history remains authoritative and the occurrence is emitted once | Yes; event observability does not become a control-state derivation | Clean, 99% |
| Typed cap identity vs two-class halt taxonomy | Yes; needs-human supplies scheduling disposition while ledger evidence supplies domain identity | Yes; retaining needs-human does not prevent exact authorized recovery | Clean, 99% |

The full two-directional scan was re-run after both resolutions. No contradiction, incompatible
behavioral overlap, impossible state, resource contention, sequencing cycle, or oscillation remains.
No degrading compromise was accepted.
