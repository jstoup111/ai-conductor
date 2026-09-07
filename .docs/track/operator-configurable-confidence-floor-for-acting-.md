# Track: Operator-configurable confidence floor for acting on build_review findings

Track: technical

Scope boundary: As filed in jstoup111/ai-conductor#2383 — (1) the adjudicator's per-case
`confidence` becomes an engine-validated integer 0-100, replacing the unreleased
`high | medium | low` enum; (2) a new config key `build_review.adjudication.act_min_confidence`
(integer 0-100, default 0) demotes a sub-floor `act` disposition to `defer`, filed once through
the existing deferral effect. Plus an operator-visible report of demoted findings, delivered on
the event spine and in the per-lap adjudication trace. Excluded: per-priority floors, a general
finding-confidence field on rubric results, and any change to `reject` or `defer` handling.

Chosen approach: engine-side demotion. The floor is deterministic bookkeeping applied to the
LLM's judgement, not a request carried in the adjudicator prompt — a prompt-level floor cannot
be enforced and leaves nothing auditable to report. The engine synthesizes the demoted case's
deferral text from its `caseRef`, `rationale`, and confidence rather than widening the contract
with a `fallbackDeferral` block on every act case.

Design constraints carried into stories:
- A fully-demoted lap must pass, not deadlock. `reduceBuildReviewAdjudication` already returns
  `pass` when no build-eligible action case survives and mechanical is healthy
  (`src/conductor/src/engine/build-review-adjudication.ts:85`), so demotion must occur before the
  case record is persisted as an action case. The property is inherited, not added.
- The floor is inert when deferrals cannot be filed. A deferral that never finalizes routes to
  `halt` via `hasUnfinishedEffect` (`build-review-adjudication.ts:57`), and the tracker
  dependencies are conditional in `conductor.ts`. With no tracker configured the `act` proceeds
  unchanged, so the floor can never convert a passing or actionable lap into a halt.

Technical track: no user-facing product capability. The change is an internal adjudicator
contract, an operator config key, and routing bookkeeping; acceptance criteria live in stories.
