# Coherence: Stale manual_test discovered at FINISH is unroutable

**Date:** 2026-08-16
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `stale-manual-test-discovered-at-finish-is-unroutab`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1613`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | "A stale manual_test (or other stale SHIP validator) discovered at FINISH re-runs that validator and retries FINISH without operator intervention." Story 1 restores the fence that catches the stale validator before FINISH dispatches; Story 2 requires the redirected run to re-run it and resume unattended. Both observed occurrences are named cases in Story 2. |
| outcome | outcome-2 | story-3, story-4, story-5 | covered | "Genuinely failed or absent validators still halt (staleness ≠ failure)." Story 3 keeps an unreadable or indeterminate verdict non-green and a genuinely failing validator on the existing cap; Story 4 keeps the evidence conditions halting with an honest reason; Story 5 stops the fence being silently disabled again. |
| adr | adr-2026-08-16-restore-the-current-head-publication-fence | story-1, story-2, story-3, story-4, story-5 | covered | D1→story-1 (remove the disjunct), D2→story-2 (redirect target is the validator, not BUILD), D3→story-3 (recompute, never force-invalidate), D4→story-4 (retire the placeholder, total mapping), D5→story-2 and story-3 (bounding inherited, no new counter). Story 5 pins D1 against regression. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-6 | covered | Task 1 discharges the disjunct's rationale; 2-3 restore the fence; 4-6 pin redirect behavior, FAIL rows, and the surviving exemptions. |
| story | story-2 | task-12 | covered | The end-to-end seam covering both observed occurrences and the genuine-failure halt. |
| story | story-3 | task-7, task-8 | covered | Preservation across a docs-only lap, and non-oscillation across repeated laps. |
| story | story-4 | task-9, task-10 | covered | Placeholder retirement and the total condition mapping. |
| story | story-5 | task-11 | covered | The anti-regression pin. |
| task | task-1 | story-1 | covered | `infrastructure`, `Verify-only: yes` — supporting purpose is to establish whether the disjunct has a real rationale before Task 3 removes it. |
| task | task-2 | story-1 | covered | RED for fence activation. |
| task | task-3 | story-1 | covered | GREEN removing the coordinator disjunct. |
| task | task-4 | story-1 | covered | Redirect behavior and earliest-member targeting. |
| task | task-5 | story-1 | covered | manual_test FAIL rows are non-green. |
| task | task-6 | story-1 | covered | Mocked-dispatch exemption, skip membership, `--from finish`. |
| task | task-7 | story-3 | covered | Unchanged surface preserved across a docs-only lap. |
| task | task-8 | story-3 | covered | Repeated laps do not re-stale; no unconditional invalidation. |
| task | task-9 | story-4 | covered | RED retiring the placeholder string. |
| task | task-10 | story-4 | covered | GREEN making condition routing total. |
| task | task-11 | story-5 | covered | Pins the fence active under the coordinator. |
| task | task-12 | story-2 | covered | Acceptance at the SHIP-tail production seam. |

## Consistency pass (§4d)

Cross-layer pairs were checked in both directions. Same-layer story-vs-story pairs are
`/conflict-check`'s sweep and are reported in
`.docs/conflicts/2026-08-16-stale-manual-test-discovered-at-finish-is-unroutab.md`, not here.

- **outcome-1 ↔ task-3 (remove the disjunct)** — consistent, and this is the pair the whole feature
  turns on. Restoring the fence is what makes "re-runs that validator and retries FINISH without
  operator intervention" true; nothing in Task 3 works against it.
- **outcome-1 ↔ task-8 (non-oscillation)** — consistent in both directions, and the pair that broke
  under the withdrawn design. Preserving an unchanged verdict is what lets the run converge; the
  earlier design's unconditional invalidation would have satisfied neither direction.
- **outcome-2 ↔ task-10 (total mapping)** — consistent: the mapping keeps the evidence conditions
  halting, which is what outcome-2 requires.
- **adr D2 ↔ story-2** — consistent after the redesign. D2 deliberately declines
  `adr-2026-08-01` D5's "route to BUILD" for the SHIP half, and story-2 asks only that the run
  resume unattended, which the validator redirect delivers without a BUILD kickback.
- **adr D3 ↔ story-3** — consistent, and mutually reinforcing: D3 requires recomputation and
  story-3 is the test that proves it, including the negative that no unconditional
  `satisfied: false` write appears.
- **adr D1 ↔ story-5** — consistent. D1 removes the disjunct and story-5 makes its return a test
  failure, so the decision cannot decay the way it did on 2026-08-04.

## Assumption surfaced (per `/verify-claims`)

**The disjunct may have been added for a real, unrecorded reason** — 70%, inferred. Commit
`9a6005e61` added `this.finishPublication ||` with no comment and no ADR, alongside the placeholder
halt, which reads as expedience; absence of a recorded rationale is not proof there was none.

Impact if wrong: the whole feature's direction changes — restoring the fence would be unsafe and
the design would have to return to a coordinator-side remedy, which conflict-check showed is
opposed by three APPROVED ADRs. That is a genuine design fork, so plan Task 1 discharges it before
any dependent task and is instructed to halt for the operator rather than work around a real
incompatibility. How to confirm: read `9a6005e61` and PR #1295, and search for any test asserting
the fence inactive under the coordinator.
