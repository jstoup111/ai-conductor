# Architecture Review: A recurring concern at a resolved anchor escapes its prior case's retry limits

**Date:** 2026-10-23
**Inputs reviewed:** the explore decision (Approach D) and the scope boundary in
`.docs/track/a-recurring-concern-at-a-resolved-anchor-escapes-i.md`. This is the lightweight Medium
pre-stories pass (Sections 2 and 4), so no stories exist yet.
**Verdict:** APPROVED WITH CONDITIONS

Source: jstoup111/ai-conductor#3124. It follows #3292, which shipped as PR #3336 and is governed by
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D5.4–D5.7.

## Feasibility

- **Stack compatibility.** The change is TypeScript inside existing engine modules plus one skill
  contract. It adds no dependency, service or infrastructure.
- **Prerequisites.** None outstanding. The design relies on these, each verified by reading
  current `main`:
  - the D5.5 selector `currentBuildReviewSourceLinks` in `remediation-case-store.ts`, which returns
    a source's open link, or else its latest link;
  - the unbound mint path in `reconcileState` in `remediation-case-reconciler.ts`. For each
    proposal without `existingCaseId`, it either converges through `convergedCaseFor` or stamps a
    new case and effect;
  - the coordinator's pre-reconcile reuse-halt loop in `build-review-adjudication-coordinator.ts`,
    which halts before reconciliation reserves sibling effects, and its `recordHaltingBinding` and
    `failUnlessAccepted` helpers;
  - the single remediate contract. `skill-invocation.ts` maps `remediate` to one skill name, which
    each provider renders with its own prefix, so Claude and Codex read the same
    `skills/remediate/SKILL.md` and the same frozen context (90%, verified mapping; per-provider
    rendering inferred from `renderSkillInvocation`).
- **Integration surface.** Production files: `remediation-case-artifact.ts` (parse
  `distinctFrom`), `remediation-case-store.ts` (record fields and lineage helper),
  `remediation-case-reconciler.ts` (stamping), `build-review-adjudication-coordinator.ts`
  (pre-reconcile limit check and event fields), `build-review-adjudication-context.ts` (prior-case
  projection), `types/events.ts` (additive fields and reason), and `build-review-cli.ts` (findings
  display). Also `skills/remediate/SKILL.md`. All are in one module family,
  with no external API.
- **Data implications.** Two optional keys are added to a build_review case record. `parseCase`
  enforces exact key sets (verified), so the current parser must admit them. Every store the
  current engine wrote still parses, because the change admits a strict superset. The reverse is
  the one risk: an older engine reading a record with the new keys reports `malformed-state`. That
  is the same forward-only stance #3292 took for resolved-shared sources (see Risks). There is no
  backfill and no store version change. Existing cases simply have no lineage.
- **Attempt evidence (75%, inferred).** The work order's `attemptedCaseIds` describes only the
  current published order (`build-review-work-order.ts`), so it cannot count attempts across a
  lineage that spans several orders. The lineage count therefore reads durable store evidence: a
  lineage `act` case whose action effect is `applied`. This can overcount a case whose order
  published but whose BUILD never ran. Overcounting is the conservative direction. The operator
  approved this basis on 2026-10-23.
- **Performance.** Lineage traversal is a bounded walk over at most `MAX_CASES` rows with a visited
  set, so cycles are impossible to loop on, and they are unrepresentable anyway because ids are
  stamped only at creation.
- **Worktree isolation.** The state stays in per-worktree `.pipeline/remediation-cases.json`.

### Which re-raises reach this path (verified)

D5.1's settled predicate already removes exact-id re-raises of resolved `defer`, `reject`, `refute`
and `advisory` cases, and of a resolved applied action case's `merged` link
(`finalizedBuildReviewSourceIds`), before the judge sees them. An exact-id re-raise therefore
reaches the judge with a resolved owner only when that owner is a resolved `act` case whose link is
`acted`. This is why scoping D5.8–D5.10 to unbound `act` proposals over resolved `act` owners
covers the reset-budget loop without touching other dispositions.

### Convergence and replay (verified)

A replayed undeclared recurrence converges through `convergedCaseFor` on the open new case
(disposition and exact source set). It stamps no second case, effect, `recurrenceOf` or charge.
Once that case is open, it is the authoritative owner of its sources. A later re-raise is then
governed by D5.4's single-open-owner rule, not by this path.

## Alignment

- **Governing ADR reused, not duplicated.** The recurrence lineage is durable state-transition
  design, so it meets the structural prerequisite. It is already governed by
  adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D5.6, so this review
  **amends** that ADR (D5.8–D5.11) and adds notes beside the predecessor
  adr-2026-08-29-build-review-remediate-case-adjudication D4 (artifact field), D5 (store fields) and
  D7 (recurrence limit). This is the same pattern #2409 and #3292 used. No new ADR.
- **Design Principle.** Whether a re-raise is the same defect is a judgement, so it stays with the
  judge as an explicit, reasoned, schema-constrained `distinctFrom` declaration. The engine does
  the bookkeeping: it validates referents, stamps lineage, counts durable attempts, and bounds
  retries. The judge's prose never decides identity.
- **Fewer halts.** The safe default is a bounded autonomous repair. An undeclared recurrence still
  gets BUILD until its lineage has used three attempts. An invalid declaration entry is dropped
  instead of rejecting the judgement. A recurrence-limit halt links the halting sources to the
  owner, so a later operator acceptance can carry them through the existing #3271 lane.
- **Pattern consistency.** The lineage helper is a pure exported function in the store module,
  next to `currentBuildReviewSourceLinks` and `finalizedBuildReviewSourceIds`. The limit check sits
  in the existing pre-reconcile halt loop, for the reason recorded there: halting after reservation
  strands reserved effects. Halt text follows the existing `semantic remediation case …` family.
- **Invalid states.** `recurrenceOf` and `distinctFrom` are written only on a new case at creation,
  so resolved rows can never gain a lineage after the fact. A case cannot name itself, and the
  parser rejects an empty list or an empty reason.
- **Event spine.** No new event type. Additive optional fields go on `remediation_case_reconciled`,
  and a new reason value goes on `remediation_semantic_repeat_halt`. Both members are already
  registered in `event-sinks.ts`.
- **Security / DI.** No new endpoints or DI defaults. `distinctFrom.reason` is provider prose
  bounded like `rationale`, and it is never interpreted.
- **Diagrams.** `.docs/architecture/a-recurring-concern-at-a-resolved-anchor-escapes-i.md` and its
  sequence diagram match this review and are operator-approved.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| `distinctFrom` on remediate case rows (`remediation-case-artifact.ts`) | the existing artifact parse in the coordinator's adjudication path |
| `recurrenceOf` / `distinctFrom` record fields (`remediation-case-store.ts` `parseCase`) | existing `RemediationCaseStore.read` / `mutate`, through every current reader |
| Lineage helper and attempt limit (new pure export, `remediation-case-store.ts`) | the coordinator's pre-reconcile reuse-halt loop, and `freezePriorCase` in `build-review-adjudication-context.ts` |
| Stamping in `reconcileState` | existing `reconcileRemediationCases`, called by the coordinator |
| `remediation_case_reconciled` fields; `recurrence-limit` reason and `lineageCaseIds` | the coordinator's existing emits, persisted by the existing sink entries |
| Findings display of lineage and declarations | the existing `build-review findings` command (`dispatchBuildReviewFindings`) |
| `skills/remediate/SKILL.md` declaration contract | the remediate dispatch for every provider |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The judge declares `distinctFrom` on every re-raise and resets lineages | Knowledge | Medium | Medium | Each declaration is persisted with its reason and shown next to its referent, and every action is still charged against the cumulative kickback cap |
| An older engine reads a record with the new keys and halts `malformed-state` | Data | Low | High | Forward-only, as #3292. No store on `main` holds the keys until this engine writes one |
| Attempt count overcounts an applied but un-run BUILD | Technical | Low | Low | The conservative direction (an earlier halt, never an unbounded loop); operator-approved basis |
| Textual conflicts with in-flight implementation PRs #3374 (#3298) and #3310 (#3271), which edit the same reconciler, coordinator, store, artifact and skill files | Integration | High | Medium | Sequence this spec's build after #3298 with a dependency edge at land. #2878's ADR note sits at a different anchor |
| Scope creep repeats #2464's 13-lap non-convergence | Knowledge | Medium | High | Track-marker exclusions are binding. The plan estimate is about 7–8 tasks |

## ADRs Created

None. Amended (additive notes, all already on `main`):

- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication: D5.8–D5.11, narrowing D5.6.
- adr-2026-08-29-build-review-remediate-case-adjudication: notes beside D4, D5 and D7.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | Status |
|---|---|---|---|---|
| Lineage attempts are counted from applied action effects, not work-order attempted ids | 75% | inferred | The limit would count the wrong thing | APPROVED by operator 2026-10-23 |
| A non-qualifying `distinctFrom` entry is dropped (the row becomes a recurrence) | 100% | verified | More halts if it were rejected instead | APPROVED by operator 2026-10-23 |
| The lineage limit is 3 applied attempts, a fixed constant | 100% | verified | More or fewer halts | APPROVED by operator 2026-10-23 |
| Claude and Codex read the same remediate contract | 90% | inferred | The two providers would diverge | APPROVED by operator 2026-10-23 |

## Conditions

1. A test replays the #2423 shape through the real store, reconciler and coordinator: resolved act
   R with an applied effect, and an undeclared unbound act re-raise of R's source. It asserts a new
   case with `recurrenceOf: [R]`, R byte-identical, one kickback charge, and no halt.
2. A test drives one lineage through three applied attempts and asserts the fourth undeclared
   re-raise halts `semantic remediation case recurrence limit` with every lineage id, before any
   effect is reserved and with no new case persisted.
3. A declared `distinctFrom` naming R starts a fresh lineage, persists the reason, and is visible on
   the event and in `build-review findings`. A declaration naming any other case is dropped and the
   row is a recurrence.
4. An explicit `existingCaseId` rebind of a resolved action case still halts `semantic remediation
   case regression <id>`, and non-act dispositions and decision stops behave exactly as before.
5. Nothing in the track marker's excluded list is implemented.
