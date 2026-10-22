# Conflict Check: Operator acceptance survives a build_review re-raise (respec of #3271)

**Date:** 2026-10-21
**New stories:** `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md` (Stories 1–12)
**Design:** `adr-2026-10-20-operator-acceptance-is-durable-case-state` (APPROVED), on the #3292 baseline
**Result:** PASSED after resolution. 3 blocking and 8 degrading conflicts were resolved in place. 1
pre-existing degrading conflict was accepted.

## Scope

All 606 files in `.docs/stories/` were scanned. Before the scan, superseded assertions in five files
were corrected in place: `build-review-rubric-dispositions-and-fan-out`,
`equivalent-re-worded-findings-escape-their-accepte`, `build-review-rubrics-need-a-post-join-adjudicator-`,
`projects-cannot-add-portable-non-competing-build-r` and `build-review-halts-when-a-judgement-re-raises-a-so`.
For the last, its plan and coherence rows were synced too.

**ADRs examined:**
- `adr-2026-10-20-operator-acceptance-is-durable-case-state`
- `adr-2026-08-29-build-review-remediate-case-adjudication`
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, including #3292's D5.4–D5.7
- `adr-2026-08-13-stable-build-review-finding-dispositions`
- `adr-2026-09-10-portable-build-review-policy`
- `adr-2026-10-14-commander-program-is-the-cli-catalog`
- `adr-2026-09-24-project-owned-pr-body-regions`
- `adr-2026-07-26-event-sink-registry-exhaustiveness`
- `adr-2026-08-12-cumulative-build-review-convergence-bound`
- `adr-2026-08-16-closed-build-review-finding-vocabularies`
- `adr-2026-07-01-machine-scoped-operator-identity`

None conflicts with the new stories. `resolve-case` is a `build-review` subcommand, so it must be
declared in `createProgram()`. Accepted risk stays an engine-owned PR section. Both new events must
declare sinks. A carry charges no kickback, so it never consumes the cumulative bound.

**ADRs narrowed out:** the other approved ADRs under `.docs/decisions/`. Their subjects — daemon
scheduling, tracker, provider, self-host, stacking and DECIDE gates — share no behavior, entity,
field or gate with these stories.

## Conflict: PR accepted-risk content

**Stories involved:** fan-out Story 19 vs new Story 7
**Files:** `.docs/stories/build-review-rubric-dispositions-and-fan-out.md` vs `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md`
**Type:** contradiction
**Severity:** blocking

**Description:** Story 19 required the PR and shipped record to carry rationale, operator and
acceptance time. The renderer has published only ids and rubrics since #1614. New Story 7 forbids
operator, rationale, summary and time.

**Resolution:** Story 19 now lists accepted ids and rubrics, carried rows and operator-resolved
rows, with no rationale, operator, summary or time.

## Conflict: Failed effects always block PASS

**Stories involved:** post-join Story 9 vs new Story 9
**Files:** `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md` vs `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md`
**Type:** contradiction
**Severity:** blocking

**Description:** A reserved or failed effect could never PASS. The #3303 retirement resolves exactly
those cases.

**Resolution:** Post-join Story 9 now excepts an action case retired by the shared settlement
predicate (ADR D5).

## Conflict: Refute bound to a defer or reject case

**Stories involved:** refuted Story 2 vs new Story 2
**Files:** `.docs/stories/refuted-build-review-finding-cycles-to-a-needs-hum.md` vs `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The illegal-transition rejection would fire before carry for a carry-eligible defer
or reject case.

**Resolution:** The refuted criterion now applies to a case that is not carry-eligible.

## Degrading conflicts resolved

| # | Files | Type | Resolution |
| --- | --- | --- | --- |
| 4 | `grade-the-diff-for-security-defects-before-ship-vi` | contradiction | A security `defer` files intake unless the finding is bound to a carry-eligible case |
| 5 | `build-post-task-tail-telemetry` Story 2 | overlap | Names `resolve-case` as the outbox-drained exception (ADR D6, D7) |
| 6 | fan-out Story 19 negative | overlap | An unreadable case store renders direct rows and reports itself; unreadable disposition records still block |
| 7 | `operator-configurable-confidence-floor-for-acting-` Story 6 | resource-contention (term) | Its read-only predicate is renamed the settled-source predicate |
| 8 | new Story 4 | overlap | An unreadable disposition store takes today's path instead of asserting fail-closed |
| 9 | new Story 9 | state-conflict | The deferral and decision-stop block applies to cases no operator resolved |
| 10 | new Terms | resource-contention (term) | Distinguishes an operator-resolved case from an operator-resolved finding |
| 11 | `remediation-dispositions-honor-the-engine-owned-in` Story 9, with plan and coherence | overlap | Its "sections unchanged" criterion is scoped to that change |

## Accepted degrading conflict

- **`equivalent-re-worded-findings-escape-their-accepte` Story 4 vs post-join Story 5.** The first
  says an unreadable disposition store "never blocks routing"; the second says the gate fails
  closed. This disagreement is pre-existing and does not involve this feature. After resolution 8,
  no new story depends on either reading. The operator accepted it on 2026-10-21.

## Oscillation check

Each pair sharing a gate was checked in both directions:

- carry vs regression halt;
- carry vs decision stop;
- carry vs the unbound new case;
- retirement vs the failed-effect block;
- outbox drain vs the external ledger.

After resolution, fully satisfying one side keeps the other true. No oscillation remains.

## Re-check

After the edits, the changed criteria were re-read against the new stories and the examined ADRs.
Every resolution narrows an existing assertion or names an explicit exception. **Zero blocking
conflicts remain.**
