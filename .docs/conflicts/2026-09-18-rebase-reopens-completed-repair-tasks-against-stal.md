# Conflict Check: rebase-reopens-completed-repair-tasks-against-stal

**Date:** 2026-09-18
**Stories:** `.docs/stories/rebase-reopens-completed-repair-tasks-against-stal.md` (Stories 1–5)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** Conflict check passed. 0 blocking, 0 degrading.

## Story-vs-story pairs examined

| Pair | Shared surface | A→B holds | B→A holds | Verdict |
|---|---|---|---|---|
| S1 vs S2 | `baseline.head` rewrite rule | yes (direct hit precedes residue) | yes | clean |
| S2 vs S5 | residue handling | yes (S5 read path does no successor search; S2 does it at rebase time) | yes | clean |
| S3 vs S1/S2 | engine-state write | yes (both write through the seam) | yes | clean |
| S4 vs S2 | unchanged residue reporting | yes | yes | clean |
| S5 vs S1 | direct-hit resolution | yes (read-path fallback only for unrewritten stores) | yes | clean |
| New S2 vs `rebase-orphans-every-sha-anchored-evidence-citatio` Story 7 | residue commits | yes: S7 forbids *silent* repointing of *citations*; S2 repoints a *boundary*, on-branch only, with an event and a residue entry | yes | clean (overlap, compatible) |
| New S2 vs same file Story 8 | off-branch shas | yes: S2 never substitutes a sha outside `onto..origHead` | yes | clean |
| New S1–S3 vs `remediation-halts-when-the-owning-plan-task-is-alr` | repair-obligation store | yes (no field but `baseline.head` changes; settlement and per-task status untouched) | yes | clean |
| New S1–S5 vs `post-rebase-invalidation-re-runs-every-judged-gate`, `trailer-union-build-completion` | post-rebase flow, trailer routing | yes (translation runs inside `translateAfterRebase`, before verdict application; trailer semantics unchanged) | yes | clean |

## ADR-vs-story sweep (repo_wide)

Examined in full (subject overlap): adr-2026-07-12-rebase-evidence-stamp-translation (governing, amended D6–D9);
adr-2026-09-06-reopened-task-resolution (governing, D3/D5); adr-2026-07-10-evidence-range-anchor-resolution;
adr-2026-07-23-trailer-union-build-step-routing; adr-2026-07-21-demote-task-stamping-to-telemetry;
adr-2026-07-21-no-diff-task-evidence-stamp; adr-2026-07-11-pipeline-state-durability;
adr-2026-08-03-build-repair-member-reuse-validity; adr-2026-07-26-event-sink-registry-exhaustiveness;
adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence; adr-2026-07-20-post-rebase-delta-aware-invalidation;
adr-2026-09-11-selective-post-rebase-verification (D1 names #2462 a separate owner);
adr-2026-07-08-post-rebase-gate-first-mechanical-reverify; adr-2026-07-03-post-rebase-force-with-lease;
adr-2026-08-01-rebase-full-replay-intent-validation; adr-2026-06-29-rebase-conflict-resolution-dispatch;
adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep; adr-2026-07-26-rebase-tail-current-branch-before-publication;
adr-2026-07-26-protected-artifact-seal-rebaseline; adr-2026-08-09-seal-rotation-authorship-predicate;
adr-2026-08-09-operator-only-scoped-artifact-reseal; adr-2026-07-09-deterministic-evidence-attribution-enforcement;
adr-2026-07-22-gate-evidence-code-validity-on-redispatch; adr-2026-08-22-done-when-evidence-at-task-close;
adr-2026-07-05-engine-owned-task-status.

Narrowed out: the remaining ~290 approved ADRs, by title/Context scan for rebase, rewrite map, repair
obligations, task resolution, engine-state writers, evidence ranges, event spine, or seals. No ADR was
excluded on supersession grounds.

**Grounded conflicts: none.** Each examined ADR governs a distinct mechanism or is the governing
decision the stories restate. One terminology note, not a conflict (confidence 90%): Story 1 says a
`Task:` trailer "resolves the task"; adr-2026-07-23 D1 defines trailers as non-authoritative routing
telemetry, and its 2026-09-06 amendment already anticipates the pre-reopen boundary. "Resolves" in
Story 1 means routing resolution in `task-progress.ts`, consistent with that ADR.

## Not covered

Non-ADR contract prose (`skills/pipeline/SKILL.md`, `docs/daemon-operations.md`) was not cross-checked.
