# Conflict Check: Move conductor.ts module-level code into topical engine modules (#1481, feature 1)

**Date:** 2026-10-07
**Stories checked:** `.docs/stories/decompose-conductor-ts-god-class-target-architectu.md` (Stories 1–7) against all 554 files in `.docs/stories/`, and against in-flight spec and feature branches from the last 14 days.
**ADR corpus:** `repo_wide`. 669 decision files examined. 9 fully superseded ADRs excluded; the 2 partially superseded ADRs retained. About 643 narrowed out, because they mention `conductor.ts` only as line-number citations or overlap-scan notes. 17 narrowed in:
- adr-2026-10-07-conductor-decomposition-target-architecture
- adr-2026-10-01-daemon-session-command-contracts
- adr-2026-07-05-engine-owned-task-status
- adr-2026-07-11-verdict-aware-resume-entry
- adr-2026-07-11-finish-step-engine-completion-machinery
- adr-2026-08-01-engine-owned-resumable-finish-publication
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route
- adr-2026-07-22-phase-scoped-docs-write-guard
- adr-2026-07-26-cross-dispatch-kickback-livelock-bound
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-09-06-engine-owned-test-quality-scope
- adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded
- adr-2026-07-03-generated-model-table-single-source
- 002-plugin-manifest-and-discovery
- adr-2026-07-22-canonical-tagged-source-ref
- adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts

**Result:** passed. There are 0 blocking conflicts. 2 degrading conflicts were resolved by operator choice.

## Conflict: In-flight remediation-dispositions build edits conductor.ts module-level code

**Stories involved:** Story 1 and Story 2 (this spec) vs the in-flight build of `remediation-dispositions-honor-the-engine-owned-in`
**Files:** `.docs/stories/decompose-conductor-ts-god-class-target-architectu.md` vs `.docs/plans/remediation-dispositions-honor-the-engine-owned-in.md`, plus its branch `feat/daemon-remediation-dispositions-honor-the-engine-owned-in`
**Type:** sequencing / resource-contention
**Severity:** degrading

**Description:** The in-flight branch changes `conductor.ts` by +277/-62 lines. It adds the
top-level functions `remediationProjectionSource`, `remediationGapsFromTypedPlan` and
`remediationDispositionRejectionsFromDispatchOutput`, and it deletes `formatRejectedDispositions`.
The two orders fail differently:
- If this spec merges first, the rebased in-flight branch fails the conductor-shape guard.
- If the in-flight branch merges first, a declaration or export inventory frozen at authoring time
  goes stale.

The stories themselves do not contradict each other: no existing story pins code to
`conductor.ts`.

**Resolution Options:**
1. Re-derive the inventory at BUILD from the rebased base, so either merge order works.
2. Option 1, plus holding this spec until the other build ships.
3. Freeze the inventory now and accept rework.

**Recommendation and operator decision:** Option 1. Stories 1 and 2 now say that the declaration
inventory and the committed export-name list are derived at BUILD from the base being rebased onto.
Whichever lane lands second adapts:
- If this one lands second, it moves whatever module-level code exists at its base.
- If the other lands second, the guard tells it to place its new helpers in a topical module.

## Conflict: Historical Done-When greps scoped to conductor.ts narrow silently

**Stories involved:** Story 5 (this spec) vs the following historical checks:
- `.docs/stories/conductor-test-suite-leaks-a-real-pipeline-halt-in.md:41` (`grep -n "process.cwd()" src/engine/conductor.ts`)
- `.docs/stories/wave-c-telemetry-event-log.md:86` (`grep -r "EventPersister" …/conductor.ts`)
- `.docs/stories/audit-trail-write-completeness-for-retro-under-fre.md:58`

**Type:** overlap
**Severity:** degrading

**Description:** These checks still hold after the move, because moved text is verbatim. They no
longer cover the moved code, and Story 5 governs tests, not shipped Done-When greps.

**Resolution Options:**
1. Note in the plan that these checks now span `conductor.ts` and the destination modules.
2. Ignore them as shipped history.

**Recommendation and operator decision:** Option 1, a plan note. The shipped stories are not changed.

## Advisory (not a conflict)

- adr-2026-08-22, adr-2026-08-25 and adr-2026-07-22 name `appendRemediationTasks` as a seam. They
  stay true because the shim keeps the name. Roadmap slice 8, which removes the shim, must re-check
  them.
- Stories that name moved symbols behaviorally, and the roughly 40 shipped stories that cite
  `conductor.ts:NNN` line numbers, are descriptive. Story 7's unchanged-behavior criterion keeps
  them satisfied.
