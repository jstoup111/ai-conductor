# Architecture Review: Task dependency gate is a presence check; unorderable plans pass it (#1393)
**Date:** 2026-11-05
**Inputs reviewed:** explore output and track marker (`.docs/track/task-dependency-gate-is-a-presence-check-unorderab.md`, technical track, scope "new plans only", approach A); complexity (Tier M); `.docs/architecture/task-dependency-gate-is-a-presence-check-unorderab.md`
**Mode:** Lightweight (Medium): feasibility and alignment only
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Intent item | Assessment | Basis |
|---|---|---|
| Reject a cycle, naming every task id in it | Feasible. `parsePlanDependencyGraph` (`plan-dependencies.ts`) already yields `dependenciesByTaskId`; a Kahn/DFS pass over it finds the unorderable set. No new dependency. | verified (read source) |
| Reject a dangling id, naming citing task and missing id | Already produced: the `unknown-dependency` violation message is "Task «missing» cited by Task «citing»'s Dependencies is an unknown task id". Only the callers are missing for unsliced plans. | verified |
| Section presence alone no longer suffices | Feasible. The strict check requires a parseable line per non-exempt task, so a `## Task Dependency Graph` section with no lines fails at the strict points. | verified |
| Rejection visible at authoring time | Feasible. Land (composer path) and the conduct `plan` gate (interactive and daemon DECIDE) are both authoring time; neither is inside BUILD. | verified |
| Merged and in-flight plans unaffected | Feasible. Daemon backlog keeps `planHasDependencyTree`. The plan gate is recomputed after each step (`computeAndWriteVerdict`, many `conductor.ts` callers and restack), so it must not turn strict for a plan already on the default branch. The scoping rule is "plan file absent at the merge-base". A plan that is merged and later amended by engine remediation exists at the merge-base and so stays on the presence check. | verified (corpus scan: 130 of 240 merged plans fail strict parse; 0 cycles) |
| Ambiguous forms surfaced, not guessed | At strict points an unparseable line is a `malformed-dependencies` rejection that names the task and lists the accepted forms. Off the strict points nothing changes. An unresolved merge-base falls back to the presence check and states that reason (operator-confirmed 2026-11-05). | verified / operator decision |

Prerequisites: none. No migration, config, schema, CLI or hook change. Worktree isolation: pure functions plus read-only `git merge-base`/`git cat-file` on the feature worktree; no shared state.

## Alignment

- **Governing ADR:** `adr-2026-09-29-plan-slice-manifest`. Decision 4 limited strict Dependencies parsing to sliced plans, and decision 2 kept `planHasDependencyTree` presence-only. This change extends strict validation to every plan at the two authoring points and leaves the grammar unchanged. Both decisions carry an amendment note committed on this branch. Decision 2's daemon-discovery clause still holds. No new ADR is needed: no system boundary, decomposition, integration pattern, persisted state or foundational technology changes. This is gate scoping on an existing owner (§7 structural prerequisite not met).
- **`adr-2026-08-30-shared-plan-task-reference-resolver` D1** (no consumer re-derives task-id validity): honored. Ids resolve only through `parsePlanDependencyGraph` → `resolvePlanTaskReference`.
- **`adr-2026-07-05-engine-owned-task-status`** (H9 id grammar): honored. Ranges stay refused because an id may contain a hyphen.
- **Engine-appended remediation exemption:** follows the `plan-slices.ts` precedent (`isEngineAppendedRemediationTaskId`). Remediation tasks are appended after land by the one-appender authority, so they are not authoring output.
- **Merge-base resolution:** focused local pattern basis. Precedent role: `adr-assumption-ledger-scope.ts` `resolveMergeBase` decides which artifacts are this feature's own. Traits to preserve: compare with `origin/«default»` when that ref exists, otherwise the local default branch; return a typed `resolved | unresolved` result rather than throwing. Why it applies: same question ("is this artifact authored by this feature?") on the same worktree. Allowed variation: the plan gate falls back to the presence check on `unresolved` instead of failing closed (operator decision). Rediscovery hints: `adr-assumption-ledger-scope.ts`, `resolveMergeBase`, `originDefaultBranch` in `rebase.ts`. Reuse the helper (export or lift it); do not add a second merge-base resolver.
- **Event spine:** no new observation channel. Rejections travel through the existing land error (`landGateError`) and gate-verdict `reason`.
- **Overlap scan (advisory):** `skills/plan/SKILL.md` is also touched by `spec/plan-and-composer-skills-surface-the-stacked-deliv`. Expect a text-level rebase only.

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| Strict validation entry in `plan-dependencies.ts` (parse violations minus remediation-exempt ids, plus cycle violations) | Called by the new land rung in `engineer/land-spec.ts` `landSpec`, beside `validatePlanSlices`; and by `GATE_ONLY_PREDICATES.plan` in `artifacts.ts` |
| Cycle detection over `dependenciesByTaskId` | Called only by the strict validation entry above |
| `LandGateIdentifier` member for the new rung (`src/conductor/src/types/land.ts`) | Thrown by `landSpec` via `landGateError` |
| "Plan new in feature diff" check (reuses the merge-base resolver) | Called by `GATE_ONLY_PREDICATES.plan` before choosing strict versus presence |
| `skills/plan/SKILL.md` dependency rules and checklist (lines stating that a `## Task Dependency Graph` section alone suffices) | Read by the `/plan` authoring step; must state that every task needs one parseable line in an acyclic graph |

`planHasDependencyTree` stays the daemon-backlog caller's check (`daemon-backlog.ts`) and the plan gate's fallback.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A daemon DECIDE feature mid-flight with a just-authored range-form plan flips its plan gate after upgrade | Technical | Low | Low | Intended behavior: kickback to `plan` at authoring time, where the fix takes seconds |
| Plan gate wrongly treats a merged plan as new (wrong comparison base) and kicks back an in-flight BUILD | Technical | Low | Medium | Reuse the proven resolver; test a merged plan amended with remediation tasks stays on the presence check |
| Sliced plan reports dependency violations from both `plan-slices` and the new rung | Technical | Medium | Low | Order the new rung after `plan-slices`; land stops at the first failing rung |
| Composer re-spec amending a legacy plan must also rewrite its non-conforming lines at land | Knowledge | Low | Low | Rejection lists accepted forms; within scope ("new plans" means anything landed from now) |

## ADRs Created

None. `adr-2026-09-29-plan-slice-manifest` decisions 2 and 4 are amended in place (additive notes).

## Conditions

1. **C1.** Engine-appended remediation task ids are exempt both as citing tasks and from the missing-line rule, at both strict points.
2. **C2.** The plan gate never applies the strict check to a plan that exists at the merge-base. An unresolved merge-base falls back to the presence check, and the gate reason names the fallback.
3. **C3.** Daemon backlog eligibility (`daemon-backlog.ts`) is not changed.
4. **C4.** The dependency grammar is not widened. Ranges and prose remain refused, as decision 4 states.
5. **C5.** `skills/plan/SKILL.md` stops presenting a `## Task Dependency Graph` section as sufficient on its own.
