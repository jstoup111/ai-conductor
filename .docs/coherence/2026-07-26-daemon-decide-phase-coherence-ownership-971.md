# Coherence: DECIDE-phase coherence ownership at the daemon boundary (#971)

**Plan:** `2026-07-26-daemon-decide-phase-coherence-ownership-971`
**Track:** Technical
**Tier:** M

No staged or committed intake-outcome artifact exists for this specification, so the outcome row
class is not required. The technical track has no PRD, so the FR row class does not apply; the
issue's four desired outcomes are carried as story acceptance criteria instead and their mapping
is recorded in the narrative below the table.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-4, task-6 | covered | Deriving the preseed set stops the daemon executing the step; the inverted contract test proves it for fresh and resume dispatch. |
| story | story-2 | task-4, task-6 | covered | The derivation plus its contract test make omission of a future DECIDE step impossible; task-6 removes the hand-copied duplicate list. |
| story | story-3 | task-2, task-3, task-5 | covered | Consumer audit de-risks the status change, the hoist supplies a resolved tier, and task-5 implements the tier-correct stamp with the unresolved-tier negative path. |
| story | story-4 | task-1, task-7, task-8 | covered | Blast-radius survey precedes the change, the hoist supplies the tier at the vetting block, and task-8 adds the warn-skip with all invalid-artifact negative paths. |
| story | story-5 | task-5, task-8 | covered | Tier-correct stamping preserves the Small exemption in state, and task-8 asserts S-tier specs are dispatched with or without an artifact and that an unresolved tier fails closed. |
| story | story-6 | task-9 | covered | The daemon-operations guide documents all three discovery rejections and the phase-ownership invariant. |
| task | task-1 | story-4 | covered | Surveys merged specs the new rejection would warn-skip, before any behavior changes. |
| task | task-2 | story-3 | covered | Audits literal done-status consumers so the status change cannot silently break a downstream reader. |
| task | task-3 | story-3 | covered | Hoists tier resolution above the stamping loop so the tier-correct stamp has a resolved input. |
| task | task-4 | story-1, story-2 | covered | Replaces the hand-maintained constant with a derivation over ALL_STEPS and adds the drift contract test. |
| task | task-5 | story-3, story-5 | covered | Stamps skipped for tier-skippable steps and done otherwise, including the unresolved-tier path. |
| task | task-6 | story-1, story-2 | covered | Inverts the integration assertion in both directions and replaces the duplicated list with an import. |
| task | task-7 | story-4 | covered | Hoists the tier parse above the vetting checks so the discovery rejection has a resolved tier. |
| task | task-8 | story-4, story-5 | covered | Adds the presence-and-shape coherence rejection to the discovery vetting loop with the Small exemption intact. |
| task | task-9 | story-6 | covered | Documents the rejection, its remedy, and the phase-ownership invariant in the daemon operations guide. |
| task | task-10 | story-1, story-4 | covered | Infrastructure — records the reader-visible behavior changes introduced by story-1 and story-4 in the changelog and settles the release-gate question. |
| task | task-11 | story-1, story-2, story-3, story-4, story-5, story-6 | covered | Infrastructure — aggregate verification that every story's behavior holds, including the pinned tier-invariant test. |

## Desired-outcome mapping

The issue's four desired outcomes are not a committed outcome artifact, so they are not a
required row class here. Their coverage is recorded explicitly for traceability, as prose rather
than a second table — the coherence parser flattens every table row in this file into one
five-column list, so a second table of any other shape would make the artifact unparseable:

- **"A completed spec enters daemon processing with its required coherence artifact already
  present when that artifact is applicable"** — covered by story-4 (discovery refuses to dispatch
  a spec that lacks one) and story-5 (applicability stays tier-scoped).
- **"A daemon-dispatched run never executes the coherence-check authoring step"** — covered by
  story-1 directly, and reinforced structurally by story-2 so the guarantee cannot regress by
  drift.
- **"A missing or invalid required coherence artifact is rejected before BUILD begins rather than
  authored autonomously by the daemon"** — covered by story-4; rejection happens at discovery,
  before dispatch and before any build worktree exists.
- **"Existing tier applicability remains explicit and testable, including the current Small-tier
  exemption"** — covered by story-3 (the recorded status becomes tier-correct and therefore
  assertable) and story-5 (the exemption is preserved and tested in both directions, including
  the fail-closed unresolved-tier case).

## Orphan-task justification

Every plan task cites at least one real story id on its `**Story:**` line except task-10 and
task-11, which declare `**Type:** infrastructure` with a non-empty supporting purpose naming the
stories they serve. Both are release/verification bookkeeping that supports the whole story set
rather than implementing any single story's behavior.
