# ADR: Coverage claims bind to `Done when`; a default-off pre-BUILD judge confirms the binding

**Date:** 2026-08-31
**Status:** APPROVED (operator-approved 2026-08-31, composer session for #2088)
**Deciders:** operator (jstoup111), DECIDE architecture review for #2088

<!-- Filename convention: adr-{{DATE}}-<kebab-slug>.md (no sequential numbers).
     The ADR's identifier is its filename stem — cite that when superseding or referencing. -->

## Context

A criterion→task coverage claim is the only pre-BUILD statement that a story criterion will be
delivered. Two carriers exist: the coherence artifact's `criterion` rows (tier M/L) and the plan's
own coverage table (the only carrier at tier S, where the coherence gate is disengaged by
`adr-2026-07-22-coherence-gate-placement-and-validation-split` FR-12).

Today the land gate proves only that the row's quote occurs somewhere in the cited task's body
(`checkCriterionCoverage`, `coherence-validator.ts`; ruled a bound-not-a-proof by
`adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`). A task whose Steps mention the
criterion's subject but whose `Done when` never asserts it therefore grounds the claim. The plan's
S-tier coverage table is not parsed at all when it carries criterion text (the validator's
`parseCoverageCheckTableRows` reads story→task pairs only). Issue #2088 records two features on
2026-08-30 — one per carrier — that built exactly what `Done when` said, were graded `PLAN_GAP` by
`prd_audit` after BUILD, `test_suite`, and `build_review` had all run, and halted `needs-human`.

Two facts fix the design space:

- `Done when` is already the per-task completion contract (`adr-2026-08-21-review-bound-by-plan-done-when-criteria`
  D1 requires the block at land on every tier; `adr-2026-08-22-done-when-evidence-at-task-close`
  closes tasks against it). A criterion a `Done when` does not assert is, by construction, work no
  task is obliged to finish.
- "Does this `Done when` assert this criterion?" is judgement-shaped. `adr-2026-07-22` keeps
  judgement off `land` (no model dependency there) and `AGENT_INSTRUCTIONS.md`'s design principle
  says to give such a question to an LLM with schema-constrained output, machinery scoping the
  inputs and persisting the verdict.

## Options Considered

### Option A: Mechanical `Done when` scoping only
- **Pros:** No model dependency; instant; fits every existing ADR without amendment beyond the
  quote source.
- **Cons:** A topically adjacent `Done when` check still passes a substring test (instance 1 could
  quote "Every named occurrence type is accepted by `ConductorEvent`"). The judgement stays with the
  author context that produced the bad claim.

### Option B: Fresh-context judge only, as a pre-BUILD step
- **Pros:** Independent judgement; no anchoring.
- **Cons:** Obvious "no asserting text at all" cases cost model tokens and are caught only at
  dispatch; tier S has no parsed claim surface to feed the judge.

### Option C: Judge inside `land`
- Rejected already by `adr-2026-07-22` Option B (model dependency breaks land's offline fallback;
  verdict would be gitignored run evidence).

### Option D (chosen): A + B — mechanical contract at land, config-gated judge before BUILD

## Decision

**D1 — One criterion-claim contract, two carriers.** A criterion coverage claim is the tuple
`(criterion text, cited task id(s), verbatim quote, disposition?)`. At M/L it is carried by the
coherence artifact's 6-cell `criterion` row (unchanged shape). At S it is carried by the plan's
`## Coverage Check` table in a criterion-level row form (`criterion | task id(s) | quote |
disposition`), parsed by the shared coherence parser into the same `CriterionCoherenceRow` shape,
disposition included (`adr-2026-08-23-diff-locality-is-an-authored-disposition` applies to every
criterion claim on either carrier). Legacy two-cell
story→task rows in that table keep their existing meaning and existing `claim-<row>` reconciliation;
the parser distinguishes the forms by cell count, never by heading text. Task ids in either carrier
resolve by the rule `adr-2026-08-30-shared-plan-task-reference-resolver` prescribes — strip a
trailing parenthesized annotation, then require membership in the plan's actual task-id set — via
that ADR's shared resolver once its feature ships, and until then via the validator's existing
citation normalization extended with the annotation strip (that ADR's resolver adopts this call
site when it lands).

> **Amended 2026-10-07 by #2941:** (adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility
> decision 6) For a sliced, flag-on plan, `coverage_binding` stays feature-scoped. It holds one
> whole-feature baseline, runs before the first child, and re-runs only on the D16 and D19
> triggers. Recorded story ownership is an envelope field that never enters the judge prompt, and a
> child projection never resets the baseline.

**D2 — The quote is drawn from the cited task's `Done when` block.** `checkCriterionCoverage`
scopes its whitespace-normalized substring match to the union of the cited tasks' `Done when`
checks (`parsePlanTaskDoneWhen`), not the whole task body. A quote found in the body but not in
`Done when` is a new coverage gap, `criterion:quote-not-done-when:<n>`, whose rejection names the
criterion, the cited task(s), and each cited task's actual `Done when` checks verbatim. It joins the
waivable coverage-gap set (`adr-2026-08-24-evidentiary-defects-are-not-waivable` — this is a
coverage gap the validator read correctly, not an evidentiary defect). Existing gap ids are not
renamed.

**D3 — Tier S engages the criterion contract at land.** `runCoherenceGate`'s tier-S disengagement
is narrowed: at S the gate runs exactly the `criterion` layer over the plan's criterion-level
coverage rows — omitted/duplicate/invented criterion, verdict, task existence, empty quote, the
diff-locality disposition (present and non-negative, exactly as at M/L), and the D2 `Done when`
grounding — and nothing else (no coherence artifact, no outcome/fr/story/adr layers). A tier-S plan with no criterion-level rows is rejected at land as
`criterion:omitted:<n>` for every extracted criterion; a stories file with no extractable criteria
remains the non-waivable `criterion:stories-unparseable` refusal. This applies at `landSpec` only.
Discovery and every BUILD/SHIP consumer keep accepting merged S plans with no such table.

**D4 — `coverage_binding` is a new engine-native, BUILD-phase, gating step.** It sits in
`ALL_STEPS` after `coherence_check` and before `acceptance_specs`, prerequisite `plan`, no tier or
track skip. It is declared `phase: 'BUILD'` so the daemon executes it rather than preseeding it
(`adr-2026-07-26-daemon-decide-preseed-ownership` D1). Its inputs are exactly the claims D1 parses
from the spec's carrier (coherence artifact at M/L, plan table at S) joined to each cited task's
`Done when` checks. Nothing else — no diff, no transcript, no stories prose beyond the criterion
text — reaches the judge.

**D5 — The judge is a fresh one-shot dispatch with a closed, engine-stamped verdict.** For each
claim the engine dispatches one fresh session (the `build_review` grader pattern: fresh id, no
resume, model fallback ladder, `executeAuxiliaryProviderCandidates`) whose judgement policy lives
in `skills/coverage-binding/SKILL.md`. The provider returns only
`{ verdict: 'asserts' | 'does-not-assert', missingAssertion?: string }` per claim; the engine stamps
the envelope (feature, run identity, claim digest, criterion, task ids, the `Done when` checks
judged) and persists `.pipeline/coverage-binding.json`, which is the step's completion artifact. A
payload outside the closed vocabulary is a typed infrastructure failure of the step — handled by
the ordinary step retry ladder (`adr-2026-07-05-retry-as-escalation-ladder`), never recorded as a
verdict and never a `needs-human` halt; the `build_review`-specific mechanical-fault lane
(`adr-2026-08-18`, keyed on `BuildReviewRubricResult`) is not reused. Verdicts are keyed by the
digest of `(criterion, Done when checks)`; an unchanged pair is a cache hit and is not
re-dispatched, but the envelope is rewritten on every run so the completion artifact is always
session-fresh (`adr-2026-07-13-session-fresh-verdict-artifacts`).

**D6 — A `does-not-assert` verdict halts `needs-human` before any build lap.** The step stamps
`refused` with kind `needs-human` (`adr-2026-08-24-refused-step-status`), writes the committed halt
record through `writeHaltMarker` with the existing `needs-human` class, and renders, per failing
claim: the criterion, the task it was bound to, the task's actual `Done when` checks, and the judge's
`missingAssertion`. The step never appends a plan task and never routes to `plan`
(`adr-2026-08-22-one-owner-per-review-question`: only `prd_audit` appends; a daemon never routes
back to plan). Recovery is the existing amend → reseal → rewind recipe.

**D7 — Default off, with a named exit.** The step is gated by `coverage_binding.judge.enabled`
(boolean, default `false`; registered in the config-key consumer registry per
`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`). Disabled, the step
completes with output `coverage_binding judge disabled` and persists an envelope recording
`disabled`, so no existing build path changes behavior when this ships. The exit condition is a
follow-up PR, opened after this spec lands, that flips the default to `true`; that PR is the
operator's stated intent at approval, not a discretionary later decision. Mirrors
`adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`.

**D8 — Legacy tolerance.** A cited task with no `Done when` block (a pre-08-21 merged plan) yields
no judgeable pair: the claim is recorded `not-applicable` in the envelope and neither passes nor
halts on it. This preserves `adr-2026-08-21` D1's "300 of 301 merged plans must keep building".

**D9 — Occurrences ride the spine.** Two step-specific occurrences join the `ConductorEvent`
union with render/persist/audit/otel declarations in the exhaustive sink registry:
`coverage_binding_judged` (per claim: verdict ∈ `asserts | does-not-assert | not-applicable`,
claim digest, task ids) and `coverage_binding_disabled` (once per run when D7's key is off). Step
start, completion, refusal, and the halt itself ride the existing `step_started`, `step_completed`,
`step_refused` (`adr-2026-08-24`), and centrally stamped `loop_halt` (`adr-2026-08-11`) events —
no `coverage_binding_started`/`_halted` duplicates of a concern the spine already carries. No
sidecar log.

> **Amended 2026-09-07 by #2419:** D1's "6-cell `criterion` row (unchanged shape)" is widened, not
> replaced. The M/L coherence-artifact carrier accepts an optional seventh cell; every existing
> six-cell row keeps its meaning and its gap ids. The tier-S plan carrier is unchanged.
>
> **D10 — A `fail` criterion row may carry an authored correction cell.** The seventh cell is the
> correction reference: exactly `plan`, or `architecture:<adr-stem>#D<n>`. It records the author's
> judgement that the cited task's stated mechanism cannot deliver the criterion, and which layer must
> correct it. The shared parser accepts a `criterion` row of six or seven cells; a seventh cell whose
> value is outside that grammar, or a seventh cell on a row whose verdict is not `fail`, is
> `unparseable-criterion-row` — an evidentiary defect, never waivable
> (`adr-2026-08-24-evidentiary-defects-are-not-waivable`). At land, a `fail` row with a correction
> cell is reported as `criterion:cannot-deliver-plan:<n>` or
> `criterion:cannot-deliver-architecture:<n>`, whose detail names the criterion, the cited task
> id(s), the quoted `Done when` text, the constraint reference, and the correction layer. A `fail` or
> `gap` row with no seventh cell keeps today's `criterion:verdict:<n>` — no existing gap id is renamed
> (`adr-2026-07-22-coherence-waiver-and-duplicate-claim`). Both new ids are waivable coverage gaps.
> Discovery reads the row through the same shared parser and requires nothing of the cell
> (`adr-2026-08-26-shared-coherence-parser-at-discovery`).
>
> **D11 — An `architecture` correction must cite an enumerable decision, and no correction routes.**
> `runCoherenceGate` resolves an `architecture:<adr-stem>#D<n>` reference against the decision-id set
> it already enumerates for the ADR layer — `parseAdrDecisions` over the change set's non-deleted
> ADRs, formatted by `formatArchitectureDecisionId` (`adr-2026-09-02-adr-decision-citability-contract`
> D1; no second ADR parser). A reference outside that set is the waivable coverage gap
> `criterion:correction-unknown-decision:<n>`. The correction layer is a label rendered in the land
> rejection and the spec PR diff; the engine never appends a task, never re-dispatches `plan` or
> `architecture_review`, and no BUILD or SHIP consumer reads the cell
> (`adr-2026-08-22-one-owner-per-review-question`; D6 above). `prd_audit`'s `PLAN_GAP` halt is
> unchanged.

> **Amended 2026-09-18 by #2493:** D5's "one fresh session per claim" is replaced by "one fresh
> session per bounded batch of claims"; verdict identity, the closed vocabulary, the digest cache,
> and the infrastructure-failure lane are unchanged. The envelope is additionally checkpointed after
> every batch so an interrupted run resumes from judged digests instead of re-purchasing them.
>
> **D12 — The judge is dispatched per bounded batch, not per claim.** The engine partitions the
> spec's claims into cached (digest already carries `asserts` or `does-not-assert` in the previous
> envelope, whatever that envelope's status), `not-applicable` (D8), and pending; pending claims are
> chunked in claim order into batches of at most `coverage_binding.judge.batch_size`. Each batch is
> one fresh session under D5's dispatch shape (fresh id, no resume, model fallback ladder,
> `executeAuxiliaryProviderCandidates`). The prompt carries, per claim, the engine-stamped digest,
> the criterion, the cited task ids, and the `Done when` checks — nothing else. Batches run
> sequentially; no concurrent fan-out is introduced.
>
> **D13 — A batch verdict is valid only when its digest set equals the batch's digest set.** The
> provider returns `{ verdicts: [{ digest, verdict, missingAssertion? }] }`. The engine accepts the
> payload only when every returned digest is one it issued in that batch, each appears exactly
> once, none is missing, and each verdict parses under D5's closed vocabulary. A missing,
> duplicate, foreign, or malformed entry rejects the whole batch as the existing typed
> infrastructure failure (`CoverageBindingPayloadError`, ordinary retry ladder); no entry of a
> rejected batch is recorded as a verdict, and no verdict from an earlier accepted batch is
> discarded.
>
> **D14 — The envelope is checkpointed atomically after every batch.** A new envelope status
> `partial` is written (through the existing sibling-temp-file-and-rename writer) after the cache
> and `not-applicable` pass and again after each accepted batch, carrying every entry judged so
> far. `partial` is not a completion status: `COVERAGE_BINDING_COMPLETION_STATUSES` stays
> `disabled | done`, so an interrupted run never satisfies the gate. On the next run the cache
> pass reads the `partial` envelope like any other and re-dispatches only digests it does not
> carry — resume is derived from digest cache hits, never from a trusted status stamp
> (`adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D7). `failed`, `refused`,
> `done`, and `disabled` keep their meaning and remain the only terminal statuses.
>
> **D15 — `coverage_binding.judge.batch_size` is a registered config key.** Positive integer,
> default 8, validated fail-closed beside `coverage_binding.judge.enabled` and registered in the
> config-key consumer registry per
> `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4. A value of 1 reproduces the pre-amendment one-claim-per-session shape. No new event type
> joins the spine: `coverage_binding_judged` is still emitted once per claim (D9).

> **Amended 2026-09-23 by #1700:** A DECIDE amendment made after the plan was approved must reach
> this step before any further build lap. D4's "inputs are exactly the claims D1 parses" is widened
> by the ADR-obligation layer and amendment claims below; D5's verdict identity, digest cache, batch
> shape (D12-D14), and infrastructure-failure lane are unchanged for criterion claims. D7's "no
> existing build path changes behavior" no longer holds for D16, D17, and D19: the void, the
> ADR-obligation refusal, and the criterion-digest reopen all act with the judge off. The step stays non-tree-attesting
> (`adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 7), and an advanced
> base that changes DECIDE inputs is still owned by the post-rebase refresh
> (`adr-2026-09-11-selective-post-rebase-verification` decision 4), which D19 never reaches.
>
> **D16 — An operator reseal that changes DECIDE content voids this step's completion.** The
> feature's DECIDE set is: the plan, its `**Stories:**` path, the feature's architecture review, its
> PRD when present, and every ADR the plan's `## Architecture Obligation Coverage` table cites or
> that the branch adds or modifies since its merge-base. The step's completion is voided when
> `resealProtectedArtifactSeal` rebaselines a DECIDE-set path whose new fingerprint differs from its
> prior fingerprint. A seal-reported self-amendment without a reseal voids nothing; it stays the
> non-fatal advisory of `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`. A void
> sets the envelope status to `invalidated` — which joins D14's statuses as non-terminal and
> non-completing, like `partial` — and marks the
> step's persisted status and gate verdict unsatisfied through the conduct-state mutation port, with
> a typed `decide-change` origin that is distinct from, and never routed through, the rebase-only
> kickback path. The next dispatch, resume, or rewind that reaches BUILD re-runs this step before any
> build task. A byte-identical reseal, a path outside the DECIDE set, or a refused reseal voids
> nothing. The void is persisted on the event spine as `coverage_binding_invalidated` naming the
> changed paths and the origin.
>
> **D17 — The ADR-obligation layer runs before the judge, whatever D7's key says.** With no model
> call, the step runs `validateArchitectureObligationCoverage` over the plan against the current
> `parseAdrDecisions` decision-id set of the DECIDE set's ADRs (the land gate's validator; no second
> parser). Any violation stamps `refused` / `needs-human` exactly as D6, and the halt and
> `step_refused` name, per violation, the ADR path, the decision id, and the missing plan coverage.
> A plan with no `## Architecture Obligation Coverage` section, and an ADR with no citable decision
> (`adr-2026-09-02-adr-decision-citability-contract`), are recorded `not-applicable` (D8's legacy
> tolerance), and at tier S the layer is `not-applicable`, matching the land gate's reduced S
> surface. Story criteria are not re-validated here; the criterion layer stays at land
> (`adr-2026-08-23-criterion-layer-is-structural-at-land`).
>
> **D18 — Amendment clauses are a separately typed claim kind.** Each `> **Amended YYYY-MM-DD by
> #N:**` block in the DECIDE set, excluding the plan's own amendments, becomes an amendment claim
> carrying the artifact path, the amendment text, and every plan task id with its `Done when`
> checks. Amendment claims are batched apart from criterion claims under their own result schema:
> the judge returns, per claim, exactly one of `carried` (non-empty issued task ids), `not-carried`
> (non-empty `missingObligation`), or `no-plan-obligation`; on a run following a D16 void it may
> also return `contradictsCompleted` (D19). `not-carried` refuses as D6, rendering
> the artifact, the amendment text, and `missingObligation`; `carried` and `no-plan-obligation`
> pass with no operator action. Amendment claims use D5's digest cache and D13's exact-digest-set
> validation. With D7's key off they are recorded `unjudged` and do not block. Criterion-claim
> prompts, verdicts, and events are unchanged.
>
> **D19 — On a D16 re-run, completed work the change contradicts is reopened, never re-planned.**
> Only a run following a D16 void reopens. Then, (a) a criterion claim whose digest is absent from
> the previous envelope's recorded digests and that cites a completed task, and (b) a completed task
> the judge lists in an amendment claim's `contradictsCompleted` (a subset of the completed task ids
> issued in that batch; any other id rejects the batch under D13), are reopened through the
> repair-obligation admission and restage path (`adr-2026-09-06-reopened-task-resolution`,
> amended decision 10). The envelope records every criterion and amendment digest on every run,
> including with D7's key off, so a disabled or legacy prior envelope with no digests is a baseline
> and reopens nothing. The step never appends a plan task and never routes to `plan` (D6).
>
> **D20 — Occurrences ride the spine.** Two occurrences join the `ConductorEvent` union with
> render/persist/audit/otel declarations: `coverage_binding_invalidated` (D16) and
> `coverage_binding_task_reopened` (per reopened task: task id, cause claim digest). Amendment
> claims emit `coverage_binding_amendment_judged` (verdict in D18's values plus `unjudged`) so
> `coverage_binding_judged`'s criterion vocabulary is untouched. Refusals ride the existing
> `step_refused` and `loop_halt` events. No sidecar log.

> **Amended 2026-10-04 by #2750:** Operator DECIDE resolves the S2.12 halt: D18 includes
> ADR amendment inputs at every complexity tier, including S. Only amendment blocks added by
> this branch relative to its merge base become claims; inherited blocks remain excluded.
> D17's structural ADR-obligation layer remains `not-applicable` at S. A new decision introduced
> inside a branch amendment receives only its D18 amendment claim, never a D21 conflict claim.
> D7 still controls dispatch: with the judge disabled the amendment is `unjudged`, with no
> provider call or refusal. Task 14 owns the tier-S input correction and runner proof.
> This correction was explicitly approved by the operator during daemon-triage recovery.

> **Amended 2026-10-03 by #2750:** A plan whose tasks cannot be satisfied together with a sealed
> story criterion, or with an approved ADR decision the plan is subject to, must refuse here before
> any build task. A coverage claim shows the judge only the tasks its row cites, so an uncited task
> requiring the opposite outcome was invisible (three 2026-09-25 SHIP halts passed this step with the
> judge on). D4's "inputs are exactly the claims D1 parses" is widened again by the conflict claims
> below. Criterion claims (D1–D14), the ADR-obligation layer (D17), and amendment claims (D18–D19)
> are unchanged. D17's "story criteria are not re-validated here" still holds: conflict claims judge
> joint satisfiability, they never require or re-check a criterion row
> (`adr-2026-08-23-criterion-layer-is-structural-at-land`).
>
> **D21 — Conflict claims cover every sealed criterion and every subject ADR decision, at every tier.**
> One conflict claim is assembled per story criterion extracted from the plan's `**Stories:**` file
> through the shared readability owner (`extractAuthoritativeStoryCriteria`,
> `adr-2026-09-23-one-owner-for-accepted-story-readability`; the file resolved by the existing
> `**Stories:**` normalizer), and one per decision of each subject ADR. The subject ADRs are the D16
> DECIDE-set ADRs plus every ADR in `.docs/decisions/` whose filename stem the plan text cites,
> keeping only ADRs that `adrApprovalStatus` finds approved and that are not fully superseded: DRAFT
> ADRs and ADRs whose status is an unambiguous full supersession are excluded, while a partial
> supersession (for example `SUPERSEDED in part by …`) stays in, as
> `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` constraint 2 rules for the same
> question. `parseAdrDecisions` is extended to return each citable decision's text beside its id; it
> remains the only interpreter of a `## Decision` section
> (`adr-2026-09-02-adr-decision-citability-contract` item 1). When one id labels several passages,
> its claim carries all of them. A subject ADR that has a `## Decision` section but no citable
> decision yields one claim carrying that whole section, identified as `<stem>#Decision`. An ADR
> with no `## Decision` section, or one the parser reports structurally broken, has its conflict
> claims recorded `not-applicable` and never fails the step (that contract's item 4: no BUILD
> consumer may require citability). Decisions that an amendment block claimed by D18 introduces are
> excluded from conflict claims: D18 alone owns whether the plan carries, or contradicts, a branch
> amendment. Every conflict claim is judged against the plan's full task table: every task id
> (remediation ids included), its title, and its `Done when` checks. Slice membership is never part
> of the table (`adr-2026-09-29-plan-slice-manifest` D6). A task with no `Done when` block
> contributes its title only. A stories file with no extractable criteria, or a plan with no
> `Done when` block in any task, records its conflict claims `not-applicable` (D8). This applies at
> tier S, where D17's ADR-obligation layer stays `not-applicable`; "ADR layer" in D17 and in its
> stories means that obligation layer only.
>
> **Amended 2026-10-04 (operator DECIDE on the AB-3 design halt):** the input-join clause below is
> restricted to *cited* subject ADRs, per the 2026-10-03 hotfix amendment to
> `adr-2026-07-20-post-rebase-delta-aware-invalidation` D1 ("An ADR the feature does not cite is
> not an input") and the `citedDecisionStems` resolution that `rebase.ts` already implements;
> binding DECIDE-set-only ADRs to the reopen inputs would have re-opened these gates on nearly
> every rebase, the churn that hotfix removed.
>
> Cited subject-ADR paths join this step's declared document inputs for post-rebase invalidation
> (`adr-2026-07-20-post-rebase-delta-aware-invalidation` D1 as amended) and for finish
> mergeability (`adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D3), so a base
> that changes a textually cited subject ADR re-runs the step. A subject ADR that is in the
> DECIDE set but not textually cited remains a conflict-claim subject; it is not a re-run input
> (D1 as amended).
>
> **D22 — The conflict verdict is closed and batch-validated.** Conflict claims are batched apart
> from criterion and amendment claims under their own result schema. Each batch prompt carries the
> plan task table once, then per claim the issued id, the kind (`criterion` or `adr-decision`), and
> the claim text. Per claim, the judge returns exactly one of `consistent`, or `conflicts` with a
> non-empty `taskIds` (a subset of the plan's task ids) and a non-empty `conflict` that states the
> incompatible requirement. A claim that is merely uncovered is `consistent`; coverage stays D5's
> question. Verdict identity is the digest of the claim text plus the digest of the full task table,
> so any plan task change re-judges every conflict claim. D5's cache, D13's exact-id-set validation
> (an unknown claim or task id rejects the whole batch as `CoverageBindingPayloadError`), and D14's
> checkpointing apply; task ids are validated through the shared plan task reference resolver
> (`adr-2026-08-30-shared-plan-task-reference-resolver` D1). Batches are bounded by
> `coverage_binding.judge.batch_size` claims and by a fixed prompt byte budget; a claim whose text
> alone exceeds the budget is dispatched in a batch of its own and is never truncated. The result
> closed shape is requested in the prompt and parsed strictly, exactly as D18 amendment claims are;
> no second schema option is added. With D7's key off, conflict claims are
> recorded `unjudged`, emit their event, and do not block. "Claims" in D1–D14, and the zero-claim
> outcome those decisions describe, mean criterion coverage claims: a spec with zero coverage claims
> still completes `done` unless a conflict claim returns `conflicts`.
> This narrows the #2088 note in `adr-2026-08-23-criterion-layer-is-structural-at-land` that this
> step "requires nothing" of a spec with zero `criterion` rows: it still requires no row, but with
> the judge enabled such a spec can refuse on a conflict. It also adds a pass that neither half of
> `adr-2026-08-09-adr-contradiction-detection-in-two-halves` covers: those halves judge ADRs
> against stories at DECIDE and never see plan tasks.
>
> **D23 — A `conflicts` verdict refuses `needs-human`, first; it never reopens, appends, or routes.**
> The refusal is D6's (`refused` with kind `needs-human`, written through `writeHaltMarker`; no new
> halt class), rendering per conflicting claim the criterion text or `<stem>#D<n>` /
> `<stem>#Decision`, the conflicting task ids with their `Done when` checks, and the judge's
> `conflict` text. A conflict means the approved plan is self-contradictory, so it takes precedence
> over D19: when any conflict claim in a run returns `conflicts`, the run refuses and performs no D19
> reopen, including on a D16 re-run or a post-rebase refresh. Conflict entries are never D19 inputs;
> D19's digest-absent rule reads criterion coverage claims and amendment claims only. It halts as
> `needs-human` rather than BUILD's `plan-gap`
> (`adr-2026-08-22-done-when-evidence-at-task-close` D3) because it is found before any task runs,
> and a daemon never routes to a DECIDE step (D6). Recovery is the existing amend → reseal → rewind
> recipe through the operator-only reseal.
>
> **D24 — Occurrences ride the spine.** `coverage_binding_conflict_judged` joins the `ConductorEvent`
> union with an explicit sink row matching its `coverage_binding_*` siblings (persist on, audit and
> otel off). It is emitted once per conflict claim with the
> claim kind, the verdict (`consistent | conflicts | not-applicable | unjudged`), and the conflicting
> task ids. `coverage_binding_judged` and `coverage_binding_amendment_judged` keep their vocabularies.
> Refusals ride the existing `step_refused` and `loop_halt` events. No sidecar log.

## Consequences

### Positive
- Both observed instances are rejected before BUILD: instance 1 at the judge (task-14's `Done when`
  never mentions emission), instance 2 at land (its plan table's cited Task 1 `Done when` quotes
  the pure builder, not the runtime seam) — or at the judge if a `Done when`-sourced quote is
  adjacent but not asserting.
- The halt costs seconds and names the exact `Done when` text to fix, instead of a full build lap
  plus a `PLAN_GAP` after `test_suite` and `build_review`.
- Coverage amendments are re-judged whenever the step re-runs (rewind or first dispatch) because
  verdicts are digest-keyed; no manual edit can go silently stale through the step.

### Negative
- One more required table on tier-S plans; S authors now pay the criterion mapping cost that M/L
  authors already pay.
- When enabled, N one-shot dispatches per spec (N = criteria). Bounded by the criteria count and
  the cache; still a new per-spec model cost.
- The step is not in the tree-attesting set (`adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`);
  a persisted `done` is honored on re-dispatch until an operator rewinds to it. Adding it to that
  set is a separate ADR-level act.
- Four governing ADRs carry amendment notes (07-22, both 08-23s, 08-22 one-owner).

### Follow-up Actions
- [ ] Post-land PR flipping `coverage_binding.judge.enabled` default to `true` (D7 exit).
- [ ] Consider tree-attesting eligibility for `coverage_binding` once the judge is on by default.
