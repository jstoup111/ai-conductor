**Status:** Accepted

# Stories: FINISH publication burns its retry budget on an unreachable transition

**Feature:** ai-conductor#1487 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-13-finish-publication-burns-its-retry-budget-on-an-un.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates required by review condition 4 are deliberately **not** stories — they
accompany functional work and belong to the plan, not to acceptance criteria.

---

## Story 1: A publication transition advances only when it moves the dimension it owns

**Requirement:** outcome-1

As the FINISH publication coordinator, I want a completed transition to count as an advance only
when the snapshot dimension it owns actually changed, so that progress is a fact derived from
observation rather than a claim an effect makes about itself.

### Acceptance Criteria

#### Happy Path
- Given a publication snapshot where `pr.prose` is `placeholder`, when the `author_pr_prose`
  effect completes and the re-observation reports `pr.prose` as `accepted`, then the coordinator
  reports `advanced` for `author_pr_prose`.
- Given a publication snapshot where `shippedRecord` is not `valid`, when the
  `write_shipped_record` effect completes and the re-observation reports `shippedRecord` as
  `valid`, then the coordinator reports `advanced` for `write_shipped_record`.
- Given a publication snapshot where `pr.ready` is false, when the `ready_pr` effect completes and
  the re-observation reports `pr.ready` as true, then the coordinator reports `advanced` for
  `ready_pr`.
- Given any member of `PublicationTransition`, when the dimension map is consulted for it, then a
  dimension is returned — the map is total over the union, and adding a transition without a
  dimension entry fails to compile.

#### Negative Paths
- Given a publication snapshot where `pr.prose` is `halt`, when the `judge_pr_prose` effect
  completes and the re-observation still reports `pr.prose` as `halt`, then the coordinator does
  NOT report `advanced`.
- Given a publication snapshot where `pr.prose` is `halt`, when the `judge_pr_prose` effect
  completes and an unrelated dimension changed (`shippedRecord` moved from missing to `valid`)
  while `pr.prose` is still `halt`, then the coordinator does NOT report `advanced` — a foreign
  dimension moving cannot mask a stalled stage.
- Given a publication snapshot where `branchPushed` is not `valid`, when the `establish_pr` effect
  completes and the re-observation reports `pr.identity` as `one` but `branchPushed` still not
  `valid`, then the coordinator does NOT report `advanced` — a transition owning two dimensions
  requires the pair to be satisfied, not either one.

### Done When
- [ ] A dimension map over `PublicationTransition` exists and is exhaustive: omitting a member is a
      TypeScript compile error, demonstrated by a type-level test or a deliberate compile check.
- [ ] `advancedPublicationTransition` (`finish-publication.ts:1202-1210`) returns `advanced` only
      when the owned dimension differs between the pre-effect snapshot and the re-observation.
- [ ] `test/engine/finish-publication.test.ts` covers each of the 7 transitions with one
      dimension-moved case and one dimension-unmoved case.
- [ ] No transition arm in `advanceFinishPublication` can report `advanced` while bypassing the
      guard — verified by the guard living in the single shared helper, not in per-arm code.

---

## Story 2: A non-advancing transition resolves human-required on its first occurrence

**Requirement:** outcome-1, outcome-4

As an operator, I want a transition that cannot move its own dimension to stop the run immediately,
so that a stuck publication never burns a six-attempt retry budget or fourteen refunded progress
laps before I hear about it.

### Acceptance Criteria

#### Happy Path
- Given a PR whose prose observes as `halt`, when `judge_pr_prose` completes with an `accepted`
  verdict and the re-observation still reports `halt`, then the coordinator returns
  `human_required` on that first occurrence, the FINISH attempt counter is unchanged, and the
  publication progress counter is unchanged.
- Given the same conditions, when the conductor routes the disposition, then a `needs-human` halt
  marker is written and a `loop_halt` event is emitted, with no `step_retry` event for the FINISH
  step.

#### Negative Paths
- Given the Cycle A regression: a `needs-remediation` PR classified `halt` and a judge returning
  `revision_required` with reason `placeholder`, when FINISH runs, then the run halts on the first
  non-advance rather than reaching the historical
  `FINISH publication retry exhausted: authoring_required_after_judgment`, and at most one provider
  judgment session is dispatched.

  > **Amended 2026-08-13 by #1487:** this scenario is exercised at the
  > `advanceFinishPublication` seam with an injected snapshot whose `pr.prose` is a non-`accepted`,
  > non-halt value, so the judgment path is genuinely reached and the fixed-point guard is what
  > stops the run. Driving it end to end through the production observer would be tautological:
  > Story 4's deterministic halt short-circuit resolves a `needs-remediation` PR to
  > `human_required` before judgment is ever dispatched, so the historical end-to-end path is
  > unreachable by construction once this feature lands. Story 4 keeps its own acceptance test
  > through the production classifier. See
  > `.docs/conflicts/finish-publication-burns-its-retry-budget-on-an-un.md`, Conflict 1.
- Given the Cycle B regression: the same PR with a judge returning `accepted`, when FINISH runs,
  then the run halts on the first non-advance rather than accumulating 14 refunded laps toward
  `FINISH publication progress allowance exhausted`.
- Given a non-advancing transition, when the disposition is routed, then it is NOT converted into a
  `publication_retry` — no reason string from `PUBLICATION_RETRY_REASONS` is emitted for it.
- Given a genuinely transient failure (the judgment dispatcher throws), when FINISH runs, then the
  existing `judgment_dispatch_failed` retry path is taken unchanged — the guard does not
  reclassify a dispatch failure as a non-advance.

### Done When
- [ ] A non-advance produces a `human_required` disposition, not a `publication_retry`.
- [ ] `test/engine/conductor-finish-publication.test.ts` asserts the FINISH attempt counter and the
      publication progress counter are both unchanged across a non-advancing transition.
- [ ] `test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts` drives the
      Cycle A scenario end to end through the real coordinator with faked `gh` and judgment
      boundaries, and asserts exactly one judgment dispatch.
- [ ] The same acceptance file drives the Cycle B scenario and asserts zero progress-allowance
      accumulation.

---

## Story 3: The halt an operator reads names the stage that ran and the dimension that did not move

**Requirement:** outcome-3

As an operator triaging a halted feature, I want the halt reason to tell me which publication stage
ran and what it failed to change, so that I can act without reading engine source.

### Acceptance Criteria

#### Happy Path
- Given a non-advancing `judge_pr_prose` transition, when the halt marker is written, then its
  reason names the transition `judge_pr_prose`, names the dimension `pr.prose`, and states the
  observed value that did not change.
- Given the new `HumanRequiredReason` member, when `renderHumanRequiredHaltReason`
  (`finish-publication.ts:619-631`) renders it, then the rendered text includes a concrete next
  action an operator can perform.
- Given a non-advancing transition, when its `human_required` disposition is constructed, then the
  transition name and the unmoved dimension travel in the disposition's existing optional `detail`
  field, and `renderHumanRequiredHaltReason` includes that detail in the rendered halt text.

  > **Amended 2026-08-13 by #1487:** added to close a specification gap. The `human_required`
  > disposition shape carries only `reason` and an optional `detail`; it has no `transition` field,
  > unlike `publication_retry`. Story 3's requirement that the halt name the stage that ran is
  > therefore satisfied through `detail` — which `adr-2026-08-08-finish-human-required-halt-rendering`
  > already establishes as the rendered carrier — rather than by widening the disposition shape.
  > See `.docs/conflicts/finish-publication-burns-its-retry-budget-on-an-un.md`, Conflict 3.

#### Negative Paths
- Given the new `HumanRequiredReason` member added without a guidance-table entry
  (`finish-publication.ts:469-510`), when the project is compiled, then compilation fails — the
  union's exhaustiveness makes an unrendered reason impossible to ship.
- Given a non-advancing transition, when the halt reason is rendered, then it does NOT name a
  transition that never ran — specifically it never reproduces the
  `authoring_required_after_judgment` shape that named `author_pr_prose` for a pass that was never
  dispatched.
- Given a halt reason rendered for an operator, when it is read, then it contains no bare
  identifier without context — the dimension is named in terms an operator can locate on the PR
  (for example the PR's prose state), not only as an internal field path.

### Done When
- [ ] A new `HumanRequiredReason` member exists with a guidance-table row.
- [ ] The rendered halt text for a non-advancing transition names the transition, the dimension,
      and a next action, asserted in `test/engine/finish-publication.test.ts` alongside the
      existing `HUMAN_REQUIRED_REASONS` guidance assertions.
- [ ] `docs/runbooks/stalled-or-stuck-feature.md` §"FINISH publication halts" documents the new
      halt shape and its recovery (delivered by the plan, verified here as reader-visible).

---

## Story 4: A halt-state PR resolves human-required before any judgment is dispatched

**Requirement:** outcome-2

As an operator, I want a PR that is in the HALT state to be recognized deterministically at FINISH,
so that the engine never pays a provider session to have an LLM judge a condition it can read
directly.

### Acceptance Criteria

#### Happy Path
- Given a PR carrying the `needs-remediation` label, when FINISH observes it, then the coordinator
  returns `human_required` and dispatches zero judgment sessions.
- Given a PR whose body carries the `<!-- conductor:needs-remediation -->` marker but whose title
  was manually rewritten to a normal `feat:` title, when FINISH observes it, then it is still
  classified as halt state and resolves `human_required`.
- Given a PR carrying the halt banner sentinel in its body, when FINISH observes it, then it
  resolves `human_required`.
- Given a halt-state PR, when FINISH resolves it, then the FINISH attempt counter and the
  publication progress counter are both unchanged.

#### Negative Paths
- Given a PR with ordinary authored prose and no halt label, marker, banner, or title prefix, when
  FINISH observes it, then it is NOT classified as halt state and the normal judgment path runs.
- Given a PR with ordinary authored prose that still carries a residual `needs-remediation` label
  or body marker, when FINISH observes it, then it IS classified as halt state and resolves
  `human_required` — a residual halt signal means the halt state was never cleared, and
  `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` makes clearing marker and label
  atomic, so authored prose alongside a live halt signal is a genuine operator condition.

  > **Amended 2026-08-13 by #1487:** added to specify an interaction the widened classification
  > introduces. Under the current two-signal test this PR observes `accepted` and publishes; under
  > the four-signal test it halts. That change is intended, not incidental, so it is pinned here
  > rather than discovered in BUILD. See
  > `.docs/conflicts/finish-publication-burns-its-retry-budget-on-an-un.md`, Conflict 4.
- Given a PR whose reader-facing body legitimately quotes the phrase used in the halt banner inside
  a fenced code block while carrying no label, marker, or title prefix, when FINISH observes it,
  then the classification matches the behavior of the existing `hasHaltSignal` predicate — the
  feature introduces no halt signal that predicate does not already recognize.
- Given the `gh pr view` call failing entirely, when FINISH observes the PR, then the existing
  degraded-observation path is taken and no halt-state claim is made from absent data.
- Given a PR observed with an empty label list, when FINISH classifies it, then the absence of
  labels is not treated as a halt signal.

### Done When
- [ ] `observePullRequest` (`finish-publication-production.ts:233`) requests `labels` in its
      `gh pr view --json` field list.
- [ ] Halt classification routes through the existing `hasHaltSignal` predicate
      (`halt-pr-rehabilitation.ts:500-505`); no second halt predicate is introduced, verified by
      there being exactly one implementation of the four-signal test in `src/`.
- [ ] A halt-state PR resolves `human_required` before the `isPrProseJudgmentNeeded` branch is
      reached, asserted by a test in which the judgment effect is a spy that must never be called.
- [ ] `test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts` covers the
      label-only and marker-only halt shapes with a faked `gh` boundary.

---

## Story 5: Legitimate publication runs converge with no extra attempts

**Requirement:** outcome-5

As a feature completing normally, I want the guard to be invisible on healthy publication paths, so
that adding a convergence check costs no additional attempts and halts no run that is genuinely
making progress.

### Acceptance Criteria

#### Happy Path
- Given a SHIP-entry draft PR with placeholder prose, when FINISH runs the full sequence — author,
  judge, accept, write shipped record, ready, record outcome — then publication completes with the
  same number of transitions as before this change and no `human_required` disposition.
- Given the `establish_pr`-after-`write_shipped_record` revisit documented in
  `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` — where committing the shipped
  record leaves the branch unpushed so `establish_pr` legitimately re-runs — when the revisit
  occurs, then `branchPushed` moves to `valid`, the transition reports `advanced`, and the run
  continues.
- Given each of the 7 transitions, when its legitimate repeat occurs, then it reports `advanced`.

#### Negative Paths
- Given a healthy multi-transition run, when it completes, then the publication progress counter
  never reaches `FINISH_PUBLICATION_PROGRESS_ALLOWANCE` and no allowance-exhausted halt is written.
- Given a healthy run, when it completes, then the FINISH retry budget is not consumed by any
  transition that advanced.
- Given a PR whose prose was already `accepted` on entry, when FINISH runs, then no judgment
  session is dispatched and no non-advance is reported for a stage that had nothing to do.
- Given a `keep` outcome with no PR identity, when FINISH runs, then `record_outcome` is selected
  and the guard evaluates `outcomeRecord` only — the absent PR dimensions do not produce a
  non-advance.

### Done When
- [ ] The existing suites `test/acceptance/unattended-finish-publication.acceptance.test.ts` and
      `test/acceptance/finish-publication-progress-budget.acceptance.test.ts` pass unchanged, or
      their changes are limited to accommodating the new disposition without weakening an
      assertion.
- [ ] A legitimate-revisit test exists for each of the 7 transitions (review condition 2), with the
      `establish_pr`-after-`write_shipped_record` case among them.
- [ ] A full happy-path publication run asserts zero `human_required` dispositions and an unchanged
      transition count.

---

## Story 6: An indeterminate dimension retries rather than halting

**Requirement:** outcome-1

As a feature running against a temporarily degraded GitHub or filesystem observation, I want an
undeterminable dimension to be treated as "cannot tell" rather than "did not move", so that a
transient failure never escalates to a human-required halt.

### Acceptance Criteria

#### Happy Path
- Given a transition whose owned dimension observes as `indeterminate` after the effect, when the
  guard evaluates it, then the coordinator returns a `publication_retry` on the existing retry
  path, not `human_required`.
- Given a transition whose owned dimension was `indeterminate` before the effect and determinate
  after it, when the guard evaluates it, then the comparison is treated as undeterminable and the
  existing retry path is taken rather than a spurious `advanced`.

  > **Amended 2026-08-13 by #1487:** this now reports `advanced`, not a retry. Only a
  > **post-effect** `indeterminate` value routes to the retry path; the guard's three-way split is
  > evaluated on the post-effect observation. An `indeterminate` value moving to a determinate one
  > is a real change in the owned dimension, and classifying it as undeterminable would spend a
  > FINISH attempt on a transition that genuinely advanced — contradicting Story 5's requirement
  > that the retry budget is not consumed by any transition that advanced. See
  > `.docs/conflicts/finish-publication-burns-its-retry-budget-on-an-un.md`, Conflict 2.
- Given a retry issued for an indeterminate dimension, when the observation recovers on the next
  attempt, then the run proceeds normally.

#### Negative Paths
- Given a determinate dimension with an unchanged value, when the guard evaluates it, then
  `human_required` is returned — an unchanged determinate value is never softened into a retry.
- Given repeated indeterminate observations, when the retry path is taken each time, then the run
  is still bounded by the existing `stepMaxRetries` budget and halts with the existing exhaustion
  reason — the carve-out introduces no unbounded loop.
- Given `safelyObserve` (`finish-publication.ts:211`) degrading a port to `indeterminate` because
  its adapter threw, when FINISH runs, then the fail-open behavior that helper exists to provide is
  preserved.

### Done When
- [ ] The guard distinguishes three cases — changed, determinately unchanged, undeterminable — and
      only the middle one produces `human_required`.
- [ ] `test/engine/finish-publication.test.ts` covers all three cases for at least one transition
      per owned dimension kind.
- [ ] A bounded-retry test asserts repeated indeterminate observations terminate via the existing
      `stepMaxRetries` exhaustion rather than looping.
