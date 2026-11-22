# Architecture Review: Remediation history handed off by file
**Date:** 2026-11-15
**Inputs reviewed:**
- the explore output and technical intent for jstoup111/ai-conductor#3677 (technical track);
- `.docs/track/prd-audit-halts-needs-human-when-as-built-case-his.md` (binding scope boundary);
- the approved diagram `.docs/architecture/prd-audit-halts-needs-human-when-as-built-case-his.md`;
- the governing ADRs listed under Alignment.

**Mode:** lightweight (tier M): Feasibility and Alignment only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | TypeScript engine changes plus one skill edit. No new package, service, or provider capability. The `remediate` gap-plan dispatch already runs in the feature worktree with file access, and the skill already writes `.pipeline/remediation.json` there (`step-runners.ts` remediate `gap-plan` branch), so reading a file under `.pipeline/` needs nothing new on any provider. |
| Prerequisites | None outstanding. Hotfix #3678 (dedupe of prior cases against pending findings, 256 KiB floor) is merged and is superseded in effect by this design: the history caps it raised are removed. |
| Integration surface | Three engine modules and one skill: `remediation-projection.ts` (builder, limits, new snapshot writer), `conductor.ts` (the one `buildRemediationProjection` caller and its halt classing), `step-runners.ts` (gap-plan prompt rendering), and `skills/remediate/SKILL.md`. `remediation-plan-contract.ts` is read-only context: `validateRemediationPlan` keeps receiving the full in-memory projection. |
| Data implications | Two new transient artifacts per remediation attempt under `.pipeline/remediation-history/`: the active snapshot and the resolved archive. They are engine-written input, not authority: no reader other than the dispatched agent, no schema consumers, no migration. The remediation case store, kickback ledger, and plan are unchanged. |
| Performance risk | The history bytes move from the prompt to one file read. The engine no longer bounds how much history the agent loads; see the risk register. No extra dispatch. |
| Worktree isolation | The snapshot lives under the per-worktree `.pipeline/`, which the self-host live boundary already excludes. Nothing is shared across worktrees. |

## Alignment

- **`adr-2026-09-07-durable-prd-widening-decision-reconciliation` D7 / D7.3: amended (D7.4).**
  D7.3 applies the named-bound rule to the whole remediation gap-plan projection. This design
  removes that rule for the four history dimensions and keeps it for required references,
  tasks, untyped evidence, and the total inlined payload. D7's intent, "bounded inputs never
  erase obligations", is preserved: history is delivered in full by file rather than faulted
  or truncated. D7, D7.1, and D7.2 are unchanged.
- **`architecture-review-2026-10-06-remediation-dispositions-honor-the-engine-owned-in`
  Decision 1: amended.** Its "over-limit required input names the dimension" rule no longer
  covers pending as-built findings, prior laps, or refusals.
- **`architecture-review-2026-10-28-as-built-review-re-raises-reworded-findings-as-new`:
  amended.** Its performance row and risk row say prior as-built cases overflow as a
  named-dimension fault. They no longer can.
- **`adr-2026-10-28-as-built-finding-reconciliation` decision 2: amended.** Its Bound clause
  says prior cases are bounded under the projection's byte limits and that overflow halts
  `needs-human`. Both are removed by D7.4. Its Contents clause, the missing-repair-task fault,
  and decisions 1 and 3-7 are unchanged; the cases reach the planner through the history files.
- **`adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: applied, not amended.**
  D7.1 (the projection reads pending findings through the seam's read-only accessor) is
  unchanged; only where the read result is delivered changes. D3.1 structural planner
  accounting is what makes the file handoff safe: the validator rejects a plan that leaves a
  pending finding or prior case unaccounted, so an agent that skips the file cannot pass.
- **`adr-2026-07-10-daemon-stall-remediation`: applied, not amended.** Open spec PRs #3691 and
  #3712 amend it; this design does not touch it, so there is no ADR overlap with either.
- **Event spine (`.agents/skills/event-spine/SKILL.md`): compliant, exception C.** The snapshot
  is a sidecar file, so the check applies. It is durable state, not an occurrence: it answers
  "what history does this attempt judge", is read by name, and is never polled or read to
  learn when something happened. No component observes it. The existing remediation events
  are unchanged and no new event is needed, because nothing new happens in time.
- **Machinery over prompt discipline.** The engine, not the skill, decides delivery: the prompt
  no longer contains the history, so the agent cannot judge from a stale inline copy. The
  validator keeps reading the in-memory projection, so the agent's read is never trusted as
  validation input.
- **Seam conformance.** No new external system is reached. The design adds a filesystem write
  inside the engine's own `.pipeline/` state, alongside the existing stores.
- **State management.** A projection fault gains an explicit cause for the two operator-owned
  faults (prior repair task missing from the plan; case store unreadable). Halt class is
  decided from that cause, not from a dimension name that a size overflow also used.
- **Diagram accuracy.** The approved diagram matches this design.
- **Production DI defaults.** The snapshot writer's default is the real filesystem.

### Design decisions settled by this review

1. **Always by file.** Every gap-plan dispatch writes the snapshot, including when all four
   history dimensions are empty. There is no inline fallback and no size threshold.
2. **Two files, split by the engine.** The history is written exactly as the in-memory
   projection holds it, with nothing summarized or truncated, into two files:
   - the **active snapshot**, which the agent always reads: `pendingAsBuiltFindings`,
     `priorLaps`, `refusals`, and every prior as-built case that is `open` or `needs-human`,
     plus any `resolved` case one of whose sources carries the id of a current pending
     finding;
   - the **resolved archive**, which the agent reads on demand: every other `resolved` prior
     as-built case, in full.
   The split is computed by the engine from case status and finding ids. Every prior case
   appears in exactly one of the two files.
3. **Path and lifetime.** `.pipeline/remediation-history/«attemptId».active.json` and
   `.pipeline/remediation-history/«attemptId».resolved.json`, each written by atomic replace
   before dispatch. A retry inside the same attempt reuses the same files. Earlier attempts'
   files are left in place as a record of what each attempt judged.
4. **Prompt index.** In place of the four dimensions the prompt carries, per dimension, the
   entry ids and the count, plus each file's path and SHA-256 digest. Each archived resolved
   case is listed by its case id and its source finding ids only. The projection version
   increments.
4a. **When the archive is read is a judgement.** The skill directs the agent to read the
   active snapshot in full and to open the resolved archive only when a current finding may be
   a recurrence of a resolved case. The engine cannot compute that for a reworded finding
   (that equivalence is the judgement #3127 gave the agent), so it is left to the agent;
   the exact-id case is handled mechanically by the split above.
5. **Limits.** `projectionLimitFault` stops measuring the four history dimensions. The total
   bound measures the inlined payload (index included, history excluded) and is recomputed
   from the remaining component limits. The history byte constants and their corpus maxima
   are deleted, not left as dead configuration.
6. **Faults.** A snapshot write failure is a named mechanical projection fault. A size
   overflow on a remaining dimension stays mechanical. `needs-human` is raised only for the
   two operator-owned causes above.
7. **Validation unchanged.** `validateRemediationPlan` receives the full in-memory projection.

## Wiring Surface

| New or changed production surface | Called from in production |
|---|---|
| History snapshot writer (active snapshot and resolved archive) | `buildRemediationProjection`, which the conductor's remediation validator route already calls once per remediation attempt |
| Projection result carrying the history index and snapshot path | Returned to that same conductor call site and passed on as the existing `gap-plan` `remediationRequest` |
| Prompt rendering of the projection without history | The existing remediate `gap-plan` branch in `step-runners.ts`, replacing its direct serialization of the projection |
| Projection fault cause for operator-owned faults | Read by the conductor's existing projection-fault halt classing |
| `skills/remediate/SKILL.md` active-snapshot and resolved-archive read instructions | Loaded by the existing `remediate` gap-plan dispatch |

Advisory overlap scan: the only overlap is `conductor.ts`, shared with eight open spec
branches. None touches the remediation projection call site, the remediation projection
module, the gap-plan prompt, or the `remediate` skill.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The agent judges without reading the snapshot | Technical | Low | Medium | The prompt holds no history to judge from. Structural accounting in `validateRemediationPlan` rejects a plan that leaves any pending finding or prior case unaccounted; the rejection uses the existing bounded remediate retry. |
| The agent skips the resolved archive when a current finding is a reworded recurrence of a resolved case | Technical | Medium | Low | The finding is planned as `new` repair work instead of bound to its prior case. `validateRemediationPlan` cannot detect this, because it is a judgement. The work is still done, the fresh as-built verdict still decides completion, and the tier lap cap bounds repeats. An exact-id recurrence is placed in the active snapshot by the engine. |
| A very large history fills the agent's context (the #2377 concern the caps addressed) | Performance | Low | Medium | Operator-accepted, and reduced by the resolved archive: only active history is always loaded. After #3678 a case costs roughly 100-400 B, so 256 KiB of history is several hundred open cases, far past the tier lap cap. The engine no longer faults on it; the provider's own context limit is the backstop and surfaces as an ordinary mechanical dispatch failure. |
| Snapshot and in-memory projection diverge | Data | Low | High | One writer, one serialization of the same in-memory object, atomic replace, digest recorded in the prompt index. The validator never reads the file. |
| Snapshots accumulate under `.pipeline/` | Technical | Low | Low | One small file per remediation attempt, bounded by the kickback and lap caps, removed with the worktree. |
| A consumer project's provider cannot read worktree files | Integration | Low | Medium | The dispatch already requires file access for `.pipeline/remediation.json`; no new capability is assumed. |

## ADRs Created

None. The structural decision (bounded engine-owned input projections) is already governed by
`adr-2026-09-07-durable-prd-widening-decision-reconciliation` D7; this review amends it with
D7.4 rather than duplicating it.

## Conditions

1. No inline fallback and no history byte cap survives: BUILD deletes the four history limit
   constants and their corpus maxima rather than raising them.
2. `validateRemediationPlan` must not read either history file, and must keep accepting a
   `priorCaseId` that names an archived resolved case.
3. Halt class for a projection fault is decided from an explicit fault cause, and no size
   overflow maps to `needs-human`.
4. The `build_review` case-context payload (#3565) and the PRD-widening reconciliation
   dispatch are untouched.
