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
