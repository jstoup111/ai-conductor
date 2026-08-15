# PRD: Build-review rubric dispositions and independent evaluation

**Date:** 2026-08-13
**Status:** Approved

## Problem / Background

`build_review` findings are often valid, but a fresh review re-evaluates the entire change without
remembering an operator's accepted risk. A feature can therefore cycle through repeated build and
review laps until a cumulative bound halts it, even when the operator would knowingly accept one
specific finding. The current combined review also prevents operators from selecting different
execution policies for rubric items with different judgement needs.

The affected user is the operator responsible for an unattended feature. They need to accept one
identified risk without weakening other findings, retain an attributable record of that decision,
and measure whether repeated failures reflect maker quality or overly strict grading.

## Goals & Non-Goals

**Goals**

- Make every rubric judgement independently executable and independently configurable while
  preserving one authoritative `build_review` gate.
- Let an operator accept one current finding with a mandatory rationale at any failed review lap.
- Ensure an accepted finding cannot block a later lap of the same feature while new findings remain
  fully blocking.
- Keep accepted risk visible through review, publication, and post-ship evidence.
- Make review convergence and rubric failure rates reportable from the standard operational record.

**Non-Goals**

- Adding dispositions to gates other than `build_review`.
- Accepting a whole rubric, all current findings, or all future findings with one action.
- Receiving disposition instructions from GitHub or another remote control surface.
- Weakening the default blocking behavior for any undispositioned finding.
- Changing what Tautology, Scope, Root Cause, Completeness, or Wiring means.
- Defining the planned claim/bypass mechanism for Tautology or Scope findings; that separate work
  may consume this feature's stable raw finding identities through a later approved contract.

## Users / Personas

- **Feature operator:** monitors unattended builds, evaluates review findings, accepts an explicit
  risk when justified, and needs the feature to resume without parking it.
- **Maintainer:** tunes rubric-specific review policies and uses aggregate results to improve maker
  quality or grading policy.
- **Reviewer or shipped-record reader:** needs to see which risks were accepted, by whom, and why.

## Functional Requirements

- **FR-1:** An enabled `build_review` evaluates Tautology, Scope, Root Cause, Completeness, and
  Wiring as separately attributable rubric results.

> **Amended 2026-08-14 by PR #1577:** the Wiring rubric is retired by
> `adr-2026-08-14-retire-build-review-wiring-rubric`; FR-1 reads as the remaining FOUR rubrics.
- **FR-2:** Eligible rubric evaluations run concurrently, subject to a configurable maximum whose
  default is five simultaneous evaluations.
- **FR-3:** Each rubric is enabled by default and may be disabled independently; a disabled rubric
  is reported as skipped rather than passed.
- **FR-4:** Enabling `build_review` while disabling every rubric is rejected with an actionable
  explanation; disabling the entire gate remains a separate supported choice.
- **FR-5:** Each rubric supports an independent choice of provider, model, reasoning effort,
  availability fallback order, retry budget, and retry-escalation behavior.
- **FR-6:** Every rubric in one review lap judges the same immutable feature change and approved
  plan context.
- **FR-7:** The authoritative gate passes only when every enabled rubric passes after accepted
  findings are applied; skipped rubrics do not count as passes or failures.

> **Amended 2026-08-13 by #1542 conflict resolution:** Wiring's existing not-judged state when
> `config.wiring.entry_points` is absent or empty is rendered as
> `skipped: missing-entry-points`. It is visible as reduced coverage, excluded from judged-rate
> denominators, and never represented as a pass. A lap with no valid judged rubric cannot pass.
>
> **Amended 2026-08-14 by PR #1577:** retired with the Wiring rubric — no
> `missing-entry-points` skip exists in the four-rubric fan-out. The no-judged-rubric-cannot-pass
> rule is unchanged.
- **FR-8:** A rubric execution or provider failure blocks the gate and is distinguished from a
  content finding; infrastructure failure never becomes a rubric pass.
- **FR-9:** Every failed rubric reports every independent finding it observed, and each finding
  exposes a stable identifier, its rubric, an actionable summary, and the relevant evidence anchors.
- **FR-10:** An operator can inspect the current review lap and enumerate its unresolved findings
  before choosing a disposition.
- **FR-11:** While a current failed review exists, an operator can accept one identified finding
  through a local command-line action by supplying a non-empty rationale, without parking the
  feature or waiting for the cumulative bound.
- **FR-12:** Once accepted, that identified concern does not block any later review lap of the same
  feature, even when the grader's wording changes.
- **FR-13:** A new finding, an undispositioned finding, or a materially different concern under the
  same rubric continues to block exactly as it does without this feature.
- **FR-14:** A disposition request with a missing rationale, unknown finding, stale review lap,
  already-dispositioned finding, or mismatched feature is refused without changing review state.
- **FR-15:** Every accepted disposition is attributable to the verified operator; maker,
  remediation, grader, and unattended daemon activity cannot create or assert operator acceptance.
- **FR-16:** Dispositions are scoped to one feature, survive its later review laps and daemon
  re-dispatches, and never affect another feature.
- **FR-17:** If a review lap changes while an operator is acting, the action either binds to the
  exact inspected lap or is refused as stale; it never attaches silently to a replacement finding.
- **FR-18:** Rubric starts, passes, failures, skips, disposition acceptances or refusals, and the
  effective outer verdict are visible through the existing operational event stream.
- **FR-19:** The implementation pull request and final shipped record list every accepted finding's
  identifier, rubric, rationale, operator attribution, and acceptance time.
- **FR-20:** Standard reporting exposes laps-to-pass for `build_review` and failure rate for each
  rubric without requiring manual worktree-ledger scans.
- **FR-21:** Rubric failure-rate denominators include only enabled rubric judgements; skipped
  rubrics are reported as coverage but excluded from pass/fail rates.
- **FR-22:** A project with no rubric-specific settings retains the existing five-rubric outer gate,
  with every rubric enabled and a default maximum of five concurrent sessions.
- **FR-23:** When the entire `build_review` gate is disabled, no rubric evaluation runs and no empty
  result is presented as a successful review.
- **FR-24:** `build_review` reuses the immediately preceding, code-valid `test_suite` PASS as its
  proof that the current HEAD is green and does not rerun the same scoped tests on HEAD. Before a
  Tautology judgement, an engine-owned preflight keeps the changed tests while substituting the
  changed production code's merge-base form in an isolated checkout and records whether the scoped
  tests fail there. Failure to materialize, execute, or restore that isolated experiment is an
  infrastructure failure, never evidence that the tests are mutation-sensitive. The deterministic
  preflight itself is content-addressably reusable when its merge base, changed-test selectors and
  content, reverted-production patch, scoped-run configuration, and current green proof are
  unchanged; infrastructure failures are never reusable.
- **FR-25:** Every rubric has an engine-owned content-addressed short circuit. A valid prior judged
  result is reused without a model call only when the rubric contract version, deterministic
  rubric input-projection digest, and resolved execution-policy fingerprint are unchanged. The
  engine materializes a current-lap branch result with cache provenance before the normal join;
  deterministic skips consume no model, infrastructure failures are never cached, and disposition
  changes do not invalidate raw judgement results.

> **Amended 2026-08-13 by #1542 conflict resolution:** Existing tolerant parsing remains for legacy
> `build_review.enabled` and `perTaskFloor` keys. Invalid values in the new `maxParallel` or `rubrics`
> subtree, including invalid rubric execution policies, reject configuration before dispatch; the
> explicitly forbidden enabled-gate/zero-enabled-rubric combination remains a hard error.

## Non-Functional Requirements

- Authorization, finding identity, disposition application, concurrency limits, result joining,
  and metric calculation must be deterministic; model judgement is limited to rubric evaluation.
- Concurrent operator and daemon activity must not corrupt or misattribute disposition state.
- Provider-specific execution differences must preserve the same rubric, finding, disposition, and
  outer-verdict behavior.
- Legacy review evidence must degrade safely: an unreadable or unsupported prior result must never
  produce a false pass or silently acquire a disposition.
- Operational consumers must continue to read one event schema and reader path; the feature must
  not introduce a separate telemetry channel.
- Rubric cache reuse must be conservative and mechanically decidable. Unknown projection versions,
  malformed entries, changed permitted inputs, or changed execution policy are cache misses, and
  no prior aggregate verdict may be reused as the current verdict.
- The Tautology preflight must never modify the live feature worktree or the self-host root checkout,
  and its temporary checkout and subprocesses must be bounded and cleaned up on every outcome.
- Raw finding identity, raw judgement caching, and effective-verdict reduction must remain separate
  enough that a later Tautology/Scope claim-or-bypass spec can add an explicitly governed
  post-judgement resolution input without changing rubric skill output or masquerading as raw PASS.

## Acceptance Criteria / Success Metrics

- In a feature with several failed findings, accepting one finding leaves every other finding
  blocking and prevents only the accepted concern from blocking the next lap.
- The same accepted concern remains non-blocking after a later grader describes it differently.
- A new concern under the same rubric still blocks.
- Five enabled rubrics can execute simultaneously under the default limit, and lowering the limit
  bounds simultaneous work without changing results.
- A current HEAD with a code-valid `test_suite` PASS incurs no duplicate HEAD-green test run during
  review; the Tautology preflight instead proves or refutes RED with changed tests against
  merge-base production code in isolation.
- Re-dispatching an unchanged review lap, or accepting a disposition without changing a rubric's
  versioned input projection, produces attributable cache hits and no provider calls for those
  rubrics; changing one rubric's permitted input or policy invalidates that rubric without trusting
  a stale aggregate verdict.
- Two rubrics can select different models and fallback orders in the same review lap, and the
  resulting execution is attributable to the correct rubric.
- Disabling one rubric records a skip; disabling all rubrics while leaving the gate enabled is
  refused.
- An autonomous session cannot create an operator disposition, and every refused attempt leaves
  disposition state unchanged.
- Accepted risk appears in both the implementation PR and the shipped record.
- Laps-to-pass and per-rubric failure rates can be produced from normal reporting, with skipped
  judgements disclosed and excluded from failure-rate denominators.

## Scope

### In Scope

- The five existing `build_review` rubric items.
- Independent rubric execution policies and default-five concurrency.
- Engine-owned Tautology RED preflight that reuses `test_suite` green evidence.
- Per-rubric content-addressed judgement caching and deterministic no-model skips.
- Per-rubric enablement with explicit skipped behavior.
- Stable, individual finding identity and operator-only local disposition.
- Effective outer-verdict calculation, event visibility, aggregate reporting, and shipment evidence.
- Compatibility with whole-gate enablement and legacy review evidence.

### Out of Scope

- Disposition or fan-out behavior for other lifecycle gates.
- GitHub comments, labels, or other remote inputs as disposition commands.
- Rubric-wide or feature-wide blanket waivers.
- Tautology/Scope claim authoring, authorization, matching, expiry, or bypass semantics owned by a
  future specification.
- Changes to rubric definitions or review quality policy.
- Build implementation, merging, or daemon lifecycle ownership by the engineer workflow.

## Key Decisions & Rationale

- **One public gate, independent rubric results.** Operators retain one clear ship-blocking decision
  while gaining rubric-specific policies and evidence.
- **Individual acceptance only.** The incident requires accepting a known risk, not suppressing a
  class of future findings.
- **Local operator input, remote output only.** This provides immediate, attributable control without
  introducing a remote polling or authorization dependency.
- **Default-on rubrics and default-five concurrency.** Existing review coverage remains present, and
  the complete five-rubric review can use all available parallel lanes by default.
- **Skipped is distinct from passed.** Operators and metrics must never mistake reduced coverage for
  successful judgement.
- **Reuse green evidence; measure only the missing counterfactual.** The upstream `test_suite` gate
  already proves current HEAD. Tautology needs changed tests against merge-base production code,
  not another execution of the green side.
- **Cache semantic branch results, never verdict freshness.** A rubric cache entry is reusable only
  through a versioned input and policy match; the coordinator still emits current-lap branch and
  aggregate evidence before completion can pass.

## Dependencies

- The existing five-rubric `build_review` contract and its whole-gate enablement behavior.
- A verifiable local operator identity distinct from unattended build and review activity.
- The existing operational event and shipment surfaces that already span feature re-dispatches.
- The preceding code-valid `test_suite` evidence and the existing engine-owned scoped-test runner.
- A future, not-yet-landed Tautology/Scope claim-or-bypass specification identified by the operator;
  this PRD supplies stable raw finding anchors and a post-judgement composition seam only.

## Open Questions

- What evidence-anchor contract gives a concern stable identity across wording changes without
  treating a materially different concern as already accepted?
- How should every rubric receive the same isolated input snapshot while retaining independent
  provider and model policies?
- How should rubric-specific availability and retry ladders compose with existing provider-native
  defaults and cross-provider fallback rules?
- What authorization boundary proves a disposition came from the local human operator while making
  the same action unavailable to unattended sessions?
- How should accepted-risk evidence flow into publication surfaces without creating a second source
  of truth?

## Verify-Claims Ledger

### Claims

- [verified] Current review evidence separates findings by rubric but gives findings no stable
  identity; verified from the current verdict contract and live failed feature evidence.
- [verified] Current review execution is one isolated grader session with one combined rubric;
  verified from the accepted judgement-gate decision and current runner.
- [verified] The existing parallel executor provides capped branch execution and a single-writer
  join, while existing branch policy does not yet expose independent fallback and retry ladders.
- [verified] The provider layer does not expose grader-created child-agent lifecycle to engine
  event or cost accounting, so grader-owned fan-out cannot satisfy the required observability.

### Assumptions

- [approved by operator 2026-08-13] Product scope is `build_review` only, with extension seams for
  later rubric decomposition.
- [approved by operator 2026-08-13] Fan-out is engine-managed and defaults to at most five concurrent
  rubric sessions.
- [approved by operator 2026-08-13] Each rubric is default-enabled and independently disableable,
  with skipped distinct from passed and all-disabled rejected while the gate is enabled.
- [approved by operator 2026-08-13] A local command-line action is the only disposition input;
  GitHub remains an output surface.
- [approved by operator 2026-08-13] Track is product and complexity is Large.
- [operator-provided future dependency 2026-08-13] A separate specification will govern claims or
  bypasses on Tautology/Scope findings; #1542 must preserve a composition seam but must not design it.

### Verdict

CLEAR — no unconfirmed load-bearing product assumptions remain.
