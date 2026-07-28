# Coherence: rebaseline the protected-artifact seal on proven base inheritance (#976)

**Plan:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
**Track:** Technical
**Tier:** M

Intake-origin specification (`jstoup111/ai-conductor#976`) with four committed desired-outcome
bullets, so the outcome row class is required. The technical track has no PRD, so there is no FR
row class.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-ST-976-1, story-ST-976-2 | covered | A rebased feature's next resumed attempt no longer fails on a pre-rebase baseline: ST-976-1 rotates proactively inside the rebase step, ST-976-2 recovers a seal already stranded by a rewrite. |
| outcome | outcome-2 | story-ST-976-3 | covered | A real mutation after the applicable baseline still blocks: rotation is refused when a differing path is not byte-identical to the base tip, and the reason names the path. |
| outcome | outcome-3 | story-ST-976-4 | covered | Rotation and refusal telemetry plus an explicit protected-artifact halt class let the daemon log distinguish a stale seal from a real mutation. |
| outcome | outcome-4 | story-ST-976-2 | covered | Recovery happens at verification time with no operator deleting or rewriting generated seal state. |
| story | story-ST-976-1 | task-1, task-4, task-7, task-9 | covered | RED specs, the atomic rotation entry point, the clean-rebase rotation with its noop/conflict_halt exclusions, and the rebase fixture reconciliation. |
| story | story-ST-976-2 | task-1, task-3, task-4, task-5, task-9 | covered | RED specs, the rotation predicate, atomic replacement, the defensive verification-time path, and fixture reconciliation. |
| story | story-ST-976-3 | task-1, task-3, task-5 | covered | RED specs plus the two-clause permission predicate and its refusal wiring in verification. |
| story | story-ST-976-4 | task-1, task-2, task-6, task-8, task-10 | covered | RED specs, the v2 lineage record, the classified HALT, rotation/refusal telemetry, and the operator documentation. |
| task | task-1 | story-ST-976-1, story-ST-976-2, story-ST-976-3, story-ST-976-4 | covered | Authors the failing acceptance specs for every story, including the #254 canary fixture. |
| task | task-2 | story-ST-976-4 | covered | Seal schema v2 with append-only rotation lineage and v1 upgrade-in-place. |
| task | task-3 | story-ST-976-2, story-ST-976-3 | covered | The ancestry trigger and the two-clause permission predicate with its fail-closed branches. |
| task | task-4 | story-ST-976-1, story-ST-976-2 | covered | Single exported rotation entry point with atomic replacement. |
| task | task-5 | story-ST-976-2, story-ST-976-3 | covered | Defensive rotation inside `verifyProtectedArtifactSeal`, leaving same-history mismatches unchanged. |
| task | task-6 | story-ST-976-4 | covered | Replaces the `unclassified` HALT with an explicit protected-artifact violation class. |
| task | task-7 | story-ST-976-1 | covered | Verify-before-rebase and rotate-after-clean-rebase, sequenced after the existing `.pipeline` translation. |
| task | task-8 | story-ST-976-4 | covered | Emits rotation and refusal events and surfaces them in the daemon log. |
| task | task-9 | story-ST-976-1, story-ST-976-2 | covered | Narrows the pinned immutability fixtures and updates the rebase fixtures that now legitimately rotate. |
| task | task-10 | story-ST-976-4 | covered | Documents the lifecycle and halt class, removes the manual-deletion workaround, adds the changelog entry. |
