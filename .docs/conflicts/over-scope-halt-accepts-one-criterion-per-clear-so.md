# Conflict Check: OVER_SCOPE multi-finding decision block (#1846)

**Date:** 2026-08-25
**Stories:** `.docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md` (Stories 1–7)
**Design authority:** `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (APPROVED)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:96-97`)

**Result: PASS — 0 blocking conflicts, 1 degrading conflict (operator-accepted).**

## Corpus and narrowing record

301 ADRs under `.docs/decisions/` carry `APPROVED`. The corpus was narrowed by subject overlap
with the seven stories' subjects: the halt-marker write/clear seam, operator decision authority,
durable `.pipeline/` decision state, `prd_audit` scope routing, the event spine and its sink
registry, and the convergence/kickback bounds.

**Examined in full (18):**

| ADR stem | Why it overlaps |
|---|---|
| `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` | This feature's design authority (D1–D8) |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` | Owns the OVER_SCOPE grade and its halt; already amended 2026-08-24 by #1846 |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | D1/D4/D5 — halt body writes only through `writeHaltMarker`, class sidecar lifecycle |
| `adr-2026-08-23-committed-halt-record` | The halt body this feature reshapes is also committed as a record |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | Story 7's event must ride the existing spine |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` | The decision block IS the lever for this halt |
| `adr-2026-08-05-build-settle-outcome-stamp` | D7 — engine-written sidecar for machine data (the pattern D2 deliberately inverts) |
| `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` | D5 no-parallel-channel, D6 anti-laundering; rewind is a machine clear in Story 3 |
| `adr-2026-08-09-operator-only-scoped-artifact-reseal` | `reseal --clear-halt` is a machine clear in Story 3 |
| `adr-2026-08-12-operator-reseal-as-second-scope-justification` | Nearest neighbour: when an operator reseal does confer scope authority |
| `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` | Clear-path ordering the harvest reads from |
| `adr-2026-07-04-event-driven-halt-clear-wake` | The wake that triggers the harvest; duplicate-wake idempotence |
| `adr-2026-08-01-conduct-state-mutation-port` | Any state write the harvest performs |
| `adr-2026-08-13-stable-build-review-finding-dispositions` | The typed-transactional-operator-state precedent this record follows |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | Story 4's durable-refusal termination |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | Same — an unresolvable refusal must still terminate |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` | Story 6 deletes a format; amendments must land in DECIDE |
| `adr-2026-08-24-refused-step-status` | Halt/refusal vocabulary landing on the same seam in the same week |

**Narrowed out (283):** every remaining APPROVED ADR, on the ground that its subject touches no
behavior, entity, field, or gate named by Stories 1–7. The largest excluded families are provider
dispatch and session scope, intake/claim/backlog ordering, rebase and seal rotation mechanics,
release and migration gates, worktree lifecycle, memory/plugin platform decisions, and the
build_review rubric container. Six ADRs carrying an unambiguous full-supersession status were
excluded; no ADR with a partial or ambiguous supersession was excluded (`adr-2026-07-27`'s
decision 3, partially extended by `adr-2026-08-12`, was retained and examined).

## Story-versus-story scan

All 21 story pairs were tested in both directions ("if A is fully satisfied, does B still hold?").
The four pairs that share a gate, field, or entity are recorded below; the rest touch disjoint
behavior.

| Pair | Shared surface | A→B | B→A | Verdict |
|---|---|---|---|---|
| S1 × S4 | The blocking set rendered into the decision block | holds | holds | No conflict — S1's blocking predicate is "no durable decision", so a refused criterion is blocking-but-decided: it blocks the gate, is excluded from the block, and appears in S4's refused prose. Both read from one predicate (S4 Done-When). |
| S2 × S3 | `HALT.cleared` parsing | holds | holds | No conflict — the discriminator is content, not provenance: only an explicit `accept`/`refuse` with non-empty rationale records. A machine clear leaves `pending`, which is inert. |
| S2 × S5 | Harvest of a partly-defective block | holds | holds | No conflict — validity is per-entry, so recording valid entries and refusing defective ones are the same pass. |
| S2 × S7 | Failure posture of the decision path | holds | holds | No conflict — S2's never-throw applies to the decisions-store write, S7's completion block to the verdict-artifact projection. Distinct objects; a decision that was never recorded has nothing to project. |

## ADR-versus-story scan

No ADR contradicts a story. The three closest pairs are recorded because each is one reading away
from a contradiction and BUILD should not have to re-derive why they are compatible.

**1. Machine data in the operator-owned halt body (`adr-2026-08-05-build-settle-outcome-stamp` D7 × Story 1).**
D7 places machine data in an engine-written sidecar. This feature does the opposite: the decision
array rides inside the halt body. Not a conflict — D7's subject is `build-outcome.json` versus
`kickback-ledger.json`, an argument about coupling two independent lifecycles, not a general rule
about where machine data lives. The over-scope ADR D2 names the inversion and gives the reason the
sidecar form cannot work here: the operator must *author* the decisions, and no engine-written
sidecar affords that.

**2. When a reseal confers scope authority (`adr-2026-08-12-operator-reseal-as-second-scope-justification` × Story 3).**
That ADR makes an operator reseal admissible evidence, and `adr-2026-08-22` D4 routes the
reseal-rationale judgement into this very step. Story 3 nevertheless requires `reseal --clear-halt`
to mint no decision. Both hold, because they act on different objects: the reseal's *recorded
rationale* is evidence a grader may judge, while the *halt clear it performs* is a machine clear
that authors no `accept`/`refuse` entry. The distinction to preserve in BUILD is
rationale-as-evidence versus clear-as-authorization.

**3. Anti-laundering (`adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D6 × Stories 2, 3).**
D6: "a harness process that could rewind its own gates could launder any failure into a fresh
start." Story 3 is the same rule applied to scope decisions and strengthens it — `pending` is inert
by construction, so no harness-authored clear can mint acceptance. Aligned, not conflicting.

**Note carried into BUILD (not a conflict).** Story 7 adds a `ConductorEvent` variant with
render/persist/audit sink declarations. Under `adr-2026-07-26-event-sink-registry-exhaustiveness`,
`audit: true` means a record is actually written to `.pipeline/audit-trail/events.jsonl`. A sink
declaring `audit: true` with no `AuditTrailWriter` case is an ADR violation, not merely a gap — the
as-built gate blocked `a-gate-halt-marks-a-completed-build-failed-and-the` on exactly that on
2026-08-25. Declare `audit: false` or write the mapping; do not declare one and implement the other.

## Conflict: A pre-v1 format break drops acceptances already recorded for in-flight features

**Stories involved:** Story 6 (Old formats are removed and read as absent) vs Story 1 / Story 4
(a criterion with a recorded decision is excluded from the halt)
**Files:** `.docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md` (Story 6) vs the same file (Stories 1, 4)
**Type:** state-conflict
**Severity:** degrading

**Description:**
Story 6 requires an `.pipeline/accepted-widenings.json` in the old `entries` shape to read as
absent. Stories 1 and 4 require a criterion carrying a recorded decision to be excluded from the
blocking set. For a feature that recorded an acceptance under the old shape and is still in flight
when this lands, both cannot hold: the store reads as absent, so the previously accepted criterion
returns to the blocking set and the operator is asked to decide it again. Nothing is silently
approved — the failure direction is a re-halt, not a fabricated acceptance — but a decision the
operator already made is discarded.

**Resolution Options:**
1. Accept the re-halt. The operator re-decides in the new block; one extra round trip per affected
   in-flight feature, and only for features holding an old-shape store.
2. Read the old `entries` shape once and translate its accepted criteria into the new `decisions`
   array, then never read it again. Preserves the decisions at the cost of the compatibility path
   Story 6 exists to delete.
3. Sweep every worktree's store ahead of the cutover. Removes the loss without a compatibility path
   in production code, but adds an operational step nothing else needs.

**Recommendation:** Option 1 — already the operator's recorded decision, and as of 2026-08-25 no
worktree holds an `accepted-widenings.json` at all, so the loss is currently empty. The track boundary states
"No legacy single-line marker path — pre-v1, breaking format change accepted by the operator"
(`.docs/track/over-scope-halt-accepts-one-criterion-per-clear-so.md:5-10`), and the old shape's
reach is small: `.pipeline/` is gitignored and per-worktree, so only features mid-flight at cutover
with a recorded widening are affected at all.

## Assumptions (verify-claims)

| Assumption | Confidence | Basis | Impact if wrong | How to confirm |
|---|---|---|---|---|
| The 283 narrowed-out ADRs govern no behavior these stories touch | 85% | inferred — narrowed by title/subject over the full APPROVED list, with the 18 highest-overlap ADRs read in full | A missed ADR contradicts a story and surfaces at the as-built gate instead of here | Re-run the sweep against the decision text of the narrowed-out set, not their titles |
| No feature currently in flight holds an old-shape `accepted-widenings.json` | 95% | verified 2026-08-25 — zero `.worktrees/*/.pipeline/accepted-widenings.json` files exist across all 89 worktrees; confidence is short of 100% only because a store can appear between now and the cutover merge | The degrading conflict above becomes concrete for those features at cutover | Re-run `ls .worktrees/*/.pipeline/accepted-widenings.json` immediately before the cutover merge |
| `pending` cannot be authored by any machine clear path | 90% | inferred from Story 3's enumerated paths (rekick rename, rewind, reseal `--clear-halt`) | A machine path that rewrites the body could mint a decision | Story 3's Done-When tests cover all three paths; add any fourth clear path found in BUILD |
