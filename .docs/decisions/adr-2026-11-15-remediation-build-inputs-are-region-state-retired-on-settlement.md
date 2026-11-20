# ADR: Remediation BUILD inputs are region state, retired when nothing open depends on them

**Date:** 2026-11-15
**Status:** APPROVED
**Deciders:** operator (James Stoup)

## Context

A stacked feature runs every child's BUILD on one shared worktree. The `build_review` remediation
case store is region state: each child has its own under `.pipeline/children/<k>/`
(`adr-2026-10-03-stacked-child-plans-identity-and-state` decision 8,
`adr-2026-10-07-per-child-build-region` decision 4). Four artifacts that describe the same
remediation work are not. They sit at the feature level, and nothing ever removes them:

- `.pipeline/build-review-work-order.json`, the durable BUILD work order;
- `.pipeline/remediation.json`, the case judgement the remediate session writes;
- `.pipeline/remediation-plan.json`, the typed gap plan;
- `.pipeline/build-stall-question.md`, the captured stall question.

Neither ADR above lists them, as region stores or as whole-feature state. The work order's feature
identity carries no child, so one child's order cannot be told apart from another's.

In jstoup111/ai-conductor#3658 a child 3 BUILD halted needs-human on a case that belonged to
child 4 and had been resolved hours earlier. The engine's own injection is gated on the active
child's open cases, so the stale order did not reach BUILD through the prompt. The files were still
on disk, and the BUILD skills tell a session it may read `.pipeline/remediation.json`. The session
cited the settled case in `.pipeline/halt-user-input-required`; the engine ran stall remediation on
it and escalated. `ai-conductor build-review resolve-case` refuses a case that is already resolved,
so no supported command cleared the cause.

The layout also has a second failure the issue did not hit. When the active child has an open
action case and the flat order belongs to another child, the order reads as `foreign-effect`, which
the durable recovery treats as invalid state and halts needs-human.

## Options Considered

### Option A: Filter at the readers
- **Pros:** Smallest change. No artifact moves.
- **Cons:** The stale files stay readable. Keeping a BUILD session away from them is prompt
  discipline, which is what failed.

### Option B: Region-scope the artifacts, retire them on settlement, and check citations at the stall seam
- **Pros:** Stale state is absent from the live path. Recovery from a stale citation is autonomous
  and bounded. The foreign-effect halt disappears with the shared path.
- **Cons:** Touches three stores and the stall path. Needs a one-time adoption of files an older
  engine left behind.

### Option C: Check citations at the stall seam only
- **Pros:** Autonomous recovery with a moderate change.
- **Cons:** Every affected BUILD still spends a session on the stale file first, and the
  foreign-effect halt remains.

## Decision

Option B. The operator set the scope: all four outcomes of the intake, autonomous recovery as the
requirement, and no new operator command.

1. **The four artifacts are region state.** In a stacked feature each one lives under the active
   child's `.pipeline/children/<k>/` directory, formed by `pipelinePathFor`, with the same schema
   and parser as today. A feature with no children keeps the flat `.pipeline/` path through the same
   seam. This adds to the region stores of the two ADRs cited above; it moves nothing they name.

2. **The engine relocates the case judgement; the remediate session's write path is unchanged.**
   The session keeps writing `.pipeline/remediation.json`. After the engine has parsed a fresh
   judgement it moves the file into the active child's region. The BUILD prompt names the paths of
   the judgement and the gap plan a session may read; the BUILD skills point at those named paths
   instead of a fixed one. Keeping the session's write path fixed means a self-host build, whose engine and skill copy
   can differ by one version, never disagrees about where the judgement is written.

3. **An artifact leaves the live path when nothing open depends on it.** The engine deletes:
   - the work order and the judgement of a region once that region's case store holds no open
     case, after any settlement that reads the order's attempt evidence has read it;
   - the typed gap plan once the BUILD it routed to passes its gate, or when a newer attempt
     replaces it, or when the stall it was planned for halts;
   - the stall question once the stall it records has been routed or halted.

   The case records and the event log are the durable record. No archive copy is kept, because an
   archive on the worktree is as readable as the original.

4. **A flat artifact in a stacked feature is adopted or retired, once.** Before a child's BUILD is
   dispatched, a flat work order is moved into the region whose case store records one of its
   effect ids on an open case; if no region does, it is deleted. A flat judgement, gap plan or stall
   question found at that point is deleted. This is the only compatibility read; region reads never
   fall back to the flat path.

5. **The stall seam checks a cited case before it dispatches remediation.** When a BUILD stall
   carries a question, the engine looks for the id of any case recorded in any child's case store
   of this feature. The match is on ids the stores already hold, never on the shape of the prose.
   - A cited case that is open in the active child's store takes today's path unchanged.
   - So does a question that cites no known case.
   - A cited case that is resolved, or that is open only in another child's store, is a **stale
     citation**. The engine dispatches no remediation for it.

6. **A stale citation re-dispatches BUILD under a bound counted on the event spine.** Each stale
   citation is recorded as a `ConductorEvent`, carrying the case id, the owning child, whether the
   case is resolved or foreign, and the attempt number. The attempt number is the count of
   consecutive stale citations of the same case in the feature's event log with no completed task
   between them, so it survives a restart and a daemon re-kick.
   - Attempts 1 and 2: the engine clears the marker and re-dispatches BUILD in the same run, telling
     the session that the case is settled or belongs to another child and is not its work. This
     charges no remediation round.
   - Attempt 3: the engine writes a `mechanical` HALT, which the daemon re-kicks.
   - Attempt 4 and later: the engine writes a `needs-human` HALT naming the case and its owner. The
     existing `halt clear` clears it.
   - Either HALT carries the session's question verbatim, so the question is never dropped.

   If the event cannot be persisted the engine writes the `needs-human` HALT, because a retryable
   halt whose attempt is not on the spine could retry without end. This follows the bounded
   routing-stall recorder (`adr-2026-10-12-routed-whole-feature-repair`, #3445 amendment).

7. **This amends `adr-2026-07-10-daemon-stall-remediation` decisions 1 and 2.** Decision 1 there
   fixes the stall-question evidence at `.pipeline/build-stall-question.md`; in a stacked feature
   it is now in the active child's region. Decision 2 there routes every `halt_marker` stall
   through `/remediate` before any HALT; a stale citation is now decided first and dispatches no
   remediation. A stale citation is therefore not a stall remediation and does not draw on the
   shared per-run round budget of decision 6 there. Decisions 3 to 7 of that ADR hold, and every
   stall that is not a stale citation follows it as written.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | In #3658 the child 3 BUILD session found the settled case by reading the feature-level files itself, not through the engine's prompt | inferred | 80% | no | The cause of that one halt would differ; decisions 1 to 4 still remove the files and decisions 5 to 7 still catch any citation of a settled or foreign case, whatever its source | n/a |
| A2 | No engine reader needs the work order, judgement, gap plan or stall question after the point decision 3 deletes it | verified | 90% | yes | A later reader would see a missing file and halt or lose evidence | n/a |
| A3 | A case id is unique across every child's case store of one feature, so a cited id names one case and one owner | verified | 90% | yes | A citation could be attributed to the wrong child | n/a |
| A4 | Deleting a region's work order only when its case store holds no open case never removes attempt evidence a later settlement needs | verified | 85% | yes | An applied case could fail to retire when its finding disappears | n/a |

## Consequences

### Positive
- A child's BUILD has no settled or foreign remediation artifact on its live path.
- A stale citation costs at most two extra BUILD dispatches before the feature stops, and stops
  mechanical first.
- The foreign-effect needs-human halt cannot occur between children.

### Negative
- A settled work order and judgement are no longer on disk for inspection; the case store and the
  event log are the only record.
- One more event variant and one more bounded counter to reason about.
- Tests that pin the mixed layout (child case store, flat order) must change.

### Follow-up Actions
- [ ] Scope the three stores and the stall-question evidence through `pipelinePathFor`.
- [ ] Add retirement and one-time adoption.
- [ ] Add the stale-citation check and its event at both BUILD stall seams.
- [ ] Point the BUILD skills at the judgement path named in the prompt.
