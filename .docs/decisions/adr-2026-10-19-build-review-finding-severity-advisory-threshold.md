# ADR: build_review findings carry a severity and a per-rubric threshold makes minor findings advisory

**Date:** 2026-10-19
**Status:** APPROVED
**Approved:** operator, 2026-10-19
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#3298
**Amends:** `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D4.2 and D5.1;
`adr-2026-09-10-portable-build-review-policy` D7.1
**Conforms to:** `adr-2026-08-13-stable-build-review-finding-dispositions`,
`adr-2026-08-12-cumulative-build-review-convergence-bound`

## Context

A build_review finding carries a concern kind, a summary, evidence, an anchor and an optional
`confidence`. Confidence measures how sure the reviewer is that a defect exists. It says nothing
about how much the defect matters.

- **The floor suppresses nothing.** Across three large self-host features on 2026-10-18 there were
  174 distinct implementationQuality findings, with confidence between 82 and 100 (median 96). The
  `min_confidence: 40` floor therefore suppressed none of them.
- **Every finding costs the same.** Each surviving finding is a live adjudication source. An `act`
  case routes BUILD and charges the cumulative kickback bound. A naming nit costs a remediate run, a
  repair BUILD and a review lap, exactly as a path-escape bug does.
- **The operator has no lever.** The features ran 27–31 review laps. implementationQuality is
  currently disabled in this repository's own config (#3302) because of this non-convergence
  (#3294).

Relevant code facts, verified against `spec/` HEAD 8daf31609f:

- Built-in finding identity hashes `{rubric, contractVersion, concernKind, anchor}`
  (`build-review-finding-identity.ts`). Custom identity hashes its own grammar, which includes
  `version`.
- Confidence floors are applied in `deriveEffectiveBuildReviewVerdict`
  (`build-review-aggregate.ts`) and in the custom path of `build-review-effective.ts`, through
  `buildReviewConfidenceFloors`. `artifacts.ts` builds its own built-in-only floor map for
  gate-completion, so custom floors are not applied there.
- Suppressed findings are recorded, never dropped. They appear on `build_review_outer_verdict`,
  persist in `RemediationCaseStore.suppressions` through `persistBuildReviewSuppressions` before the
  pass/fail fork, and are excluded from the coordinator's live sources.
- The remediate judgement has dispositions `act | defer | reject | refute | escalate`, and the case
  mode (`case-v1` / `case-v2`) is selected by the engine per lap
  (`build-review-adjudication-context.ts`).

## Options Considered

### Option A: Reviewer-assigned severity, an engine threshold, and an adjudicator downgrade
- **Pros:**
  - Delivers severity per finding, independent of the finding's kind.
  - Gating stays deterministic, and judgement is used only where impact is the question.
  - Reuses the suppression bucket, store, event and settled-recurrence predicate.
- **Cons:**
  - Depends on reviewer calibration.
  - The required field forces a built-in contract bump that re-keys built-in finding ids once.

### Option B: Operator config maps each concern kind to a severity
- **Pros:** Fully deterministic and needs no contract change.
- **Cons:**
  - Kind is not impact. #3298's evidence has a high-impact `primitive-obsession` finding, so a
    mapping misclassifies findings within one kind.

### Option C: The adjudicator assigns severity to each case
- **Pros:** A single judge with full context, and the rubric contract is unchanged.
- **Cons:**
  - Every raw-FAIL lap still pays a remediate dispatch.
  - Severity is invisible per finding, and custom rubrics are untouched.

## Decision

Option A. Each decision below states how it extends the existing suppression architecture.

### D1 — Severity is a closed, reviewer-owned, required finding attribute

- **Values.** Every built-in and custom finding carries `severity`, one of `critical`, `major`,
  `minor` or `nit`, ordered from highest to lowest in that sequence.
- **Who sets it.** The reviewer assigns it. The engine validates membership in the closed set and
  never computes, defaults or adjusts it. A missing or unknown value makes the result malformed
  through the existing invalid-field path.
- **Identity.** Severity is evidence about a finding, not part of its identity. It never enters
  the identity hash, so a re-graded severity keeps the finding id and every disposition bound to it.
- **Independence from confidence.** Severity says how much the finding matters if real; confidence
  says how sure the reviewer is that it is real.
- **Reviewer guidance.** Each built-in rubric skill and the custom-review contract state what each
  level means for their concern kinds. The guidance names impact, not consequence:
  - `critical`: security exposure, data loss, or wrong results;
  - `major`: a real defect or broken invariant;
  - `minor`: a real, low-impact quality issue;
  - `nit`: cosmetic, such as naming or style.

### D2 — The contracts bump to built-in v4 and custom v2, and built-in finding ids re-key once

- **Fresh results.** A fresh built-in rubric result must declare `contractVersion: v4`. A fresh
  custom result must declare `version: v2`.
- **Persisted results.** v1–v3 built-in results and v1 custom results still parse when read back,
  for history, the CLI and recovery. Their findings carry no severity and can never be advisory.
- **Re-keying.** Built-in contract version is part of built-in finding identity, so every built-in
  finding id changes once when this upgrade ships. Custom finding ids do not change: the custom
  identity grammar carries its own `version: 'v1'`, independent of the custom result contract
  version, and this decision leaves that grammar unchanged. The operator accepted that cost on 2026-10-19:
  - stored v3 operator dispositions invalidate through the existing
    `build_review_disposition_version_invalidated` path and never match a v4 finding by exact
    identity. Where adjudication is enabled and remediate binds the re-keyed finding to the case
    holding the accepted v3 source, #3271's carry lane applies it with no re-accept
    (`adr-2026-10-20-operator-acceptance-is-durable-case-state` decisions 3 and 4). Every other
    operator-accepted finding on an in-flight feature must be re-accepted with `build-review accept`;
  - an in-flight feature's settled cases stop binding their re-keyed findings, which costs at most
    one fresh remediate judgement per feature.
- **What this amends.**
  - Stable-dispositions ADR Decision 1: a contract version changes only when identity semantics
    change. Severity is outside identity, but contract version is an identity input, so this bump
    re-keys built-in ids although identity semantics are unchanged. The operator accepted that on
    2026-10-19 over keeping a dual v3/v4 parse path with stable ids.
  - Mixed-laps ADR D4.2: it kept the contract at v3 only because `confidence` was optional.
  - Portable-policy ADR D7.1: it fixed the custom-review result contract at `custom-findings` v1.
    The `custom-v1` identity grammar it held unchanged stays unchanged.

### D3 — `min_severity` is a per-rubric operator threshold, resolved through one helper

- **Config keys.**
  - `build_review.rubrics.<id>.min_severity`
  - `build_review.custom_rubrics.<id>.min_severity`

  Each takes one of the four severity values.
- **Validation.** Config validation rejects any other value.
- **Defaults.** An undeclared threshold is absent, not defaulted: the advisory bucket is then always
  empty and behavior is identical to today. Declaring `nit` is equivalent to undeclared: the threshold helper resolves `nit` to no threshold, so no advisory classification and no advisory disposition is ever offered for it.
- **One helper.** Confidence floors and severity thresholds resolve through one shared effective
  helper (generalizing `buildReviewConfidenceFloors`). The gate-completion path in `artifacts.ts`
  uses that helper instead of its own built-in-only map, so built-in and custom rubrics get
  identical thresholds on every path.
- **Cache.** Neither key enters the rubric cache fingerprint. Both are applied after judgement.

### D4 — A below-threshold finding is advisory at the effective verdict and never reaches remediate

- **Order.** Both effective reducers, built-in and custom, classify each finding in this order:
  - operator-accepted, by exact disposition;
  - settled, including a source whose authoritative link is `carried`
    (`adr-2026-10-20-operator-acceptance-is-durable-case-state` decision 4);
  - declared replication;
  - `suppressed` (confidence below the floor);
  - `advisory` (severity strictly below the rubric's declared `min_severity`);
  - `unresolved`.
- **Below both thresholds.** Such a finding is `suppressed`. It is not established as real, and
  advisory means real but below the operator's impact bar.
- **What blocks.** Only `unresolved` blocks. A lap whose every finding is resolved, suppressed or
  advisory is an effective PASS and does not enter post-join judgement.
- **Never judged or charged.** Advisory findings are excluded from the coordinator's live sources,
  so they are never judged, never route BUILD, never emit `kickback`, and never charge the kickback
  ledger.
- **Authority.** Advisory, like suppressed, is engine bookkeeping on a reviewer judgement. It is
  never recorded as operator accepted risk.
- **Absence retirement.** An advisory source is not raised for the absence rule of
  `adr-2026-10-20-operator-acceptance-is-durable-case-state` decision 5, because it is outside the
  live sources. On a mechanically healthy lap, an open `failed` or `reserved` action case whose
  every source is advisory, covered or absent therefore retires by absence. On a lap that is not
  mechanically healthy it stays open. If the threshold later stops admitting the finding, the
  finding is live again and is judged as an unbound re-raise
  (`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.6). Operator approved
  2026-10-23.

### D5 — Every advisory finding is durable and visible

- **Durable store.** Each `RemediationCaseStore` suppression entry becomes a discriminated union:
  - a `confidence` kind with the confidence and the floor;
  - a `severity` kind with the severity and the threshold.

  An entry persisted without a kind reads as `confidence`. The existing seam writes both kinds
  before the pass/fail fork, and they are never pruned.
- **Adjudication context.** The context carries advisory entries in its existing non-blocking
  history section.
- **Event.** `build_review_outer_verdict` gains an additive optional `advisoryFindings` list of
  `{findingId, rubric, severity, threshold}`, rendered by the existing daemon log projection. It
  follows the additive-field pattern of `adr-2026-08-11-halt-events-ride-the-persisted-spine`.
- **CLI.** `build-review findings` lists advisory findings in both its JSON and human output.
- **PR body.**
  - A new engine-owned region, `## Advisory build-review findings`, lists for each finding: the
    finding id, rubric, severity, origin (`threshold` or `adjudicated`) and reviewer summary.
  - The region is registered with the existing engine-owned PR-body regions, so a worker cannot
    edit or forge it.
  - The adjudicator's rationale stays in local state, consistent with #1614.

### D6 — The adjudicator may downgrade a finding to advisory, but only below a declared threshold

- **Who may use it.** When the lap's adjudication context declares at least one severity threshold,
  the remediate judgement may return disposition `advisory` for a case.
- **Validity.** The case is valid only when all of the following hold:
  - every source belongs to a rubric with a declared `min_severity`;
  - the case names an adjudicated severity strictly below each source rubric's threshold;
  - the case carries a non-empty rationale;
  - its effect is `none`.

  Anything else is an invalid judgement through the existing rejection path.
- **Mode independence.** The disposition is admitted in both `case-v1` and `case-v2`, gated by the
  context's declared thresholds rather than by mode. With no threshold declared it is never offered
  or accepted, which keeps undeclared behavior unchanged.
- **Raw finding untouched.** The downgrade never mutates the raw aggregate or the reviewer's
  severity. The adjudicator cannot raise a severity.
- **Effects.** An advisory case routes no BUILD and charges nothing.
- **Older engines.** An older engine that reads a persisted `advisory` disposition fails closed as
  an unknown disposition.
- **Carry first.** An `advisory` proposal that binds an `existingCaseId` is classified by
  `classifyRemediationCaseReuse` like every other proposed disposition, before any advisory
  reduction (`adr-2026-10-20-operator-acceptance-is-durable-case-state` decision 3). When the bound
  case is carry-eligible the result is `carry`: the carry lane links the source as `carried`, the
  case keeps its disposition, and the finding is shown as carried (decision 8), never as advisory.
- **What this amends.**
  - Decision 4 of `adr-2026-08-29-build-review-remediate-case-adjudication`: its case disposition
    vocabulary gains `advisory`, carrying `adjudicatedSeverity`.
  - Decision 3 of `adr-2026-10-20-operator-acceptance-is-durable-case-state`: the proposals it
    classifies include `advisory`.

### D7 — A finalized advisory case settles recurrence only while its threshold still admits it

- **Settled.** The D5.1 settled-recurrence predicate treats an `advisory` case with effect `none` as
  finalized for exact-id recurrence, but only while each source rubric's current `min_severity`
  remains strictly above the case's adjudicated severity.
- **Where.** The predicate is `finalizedBuildReviewSourceIds`, read through the D5.5 authoritative
  link (`currentBuildReviewSourceLinks`). Resolved thresholds become its required parameter, so
  every caller passes them. The `advisory` branch is decided before the generic "non-`act` with no
  effect is finalized" branch, so an advisory case never settles unconditionally. Operator
  resolution and `carried` links keep their earlier branches.
- **Threshold changes.** If the operator lowers or removes the threshold, the case no longer
  settles and its source is live again on the next lap. The predicate stays read-only and never
  writes, prunes or resolves the case.
- **What this amends.**
  - The mixed-laps ADR's D5.1 list of finalized dispositions.
  - Decision 4 of `adr-2026-10-20-operator-acceptance-is-durable-case-state`: the same function also
    settles advisory sources, conditioned on the thresholds it now requires.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Reviewers assign severity with enough spread that a `major` threshold separates real defects from nits; confidence clustered at 82-100 is a warning sign | inferred | 70% | yes | Thresholds make few findings advisory and laps do not shorten; recalibrate through skill guidance or the D6 downgrade | APPROVED by operator 2026-10-19 |
| A2 | Contract version is in built-in finding identity (`build-review-finding-identity.ts` canonical payload), so the v4 bump re-keys every built-in id once; the custom identity grammar pins its own `version: 'v1'` independent of the custom result version, so custom ids do not re-key | verified | 100% | yes | None: verified; consequence accepted in D2 | APPROVED by operator 2026-10-19 |
| A3 | The native result grammar admits a closed string `enum` for a required field (`build-review-domain.ts` native-grammar constraint allows enum, pattern, minItems 0/1) | verified | 95% | yes | Severity could not be schema-enforced at the provider; would fall back to parser-only validation | APPROVED by operator 2026-10-19 |
| A4 | The remediate judgement parser can admit the `advisory` disposition gated by the context's declared thresholds rather than by case mode, following how case-v2 gated `escalate` | inferred | 80% | yes | D6 needs a new case mode (case-v3) instead of a context-gated disposition; plan grows by about one task | APPROVED by operator 2026-10-19 |
| A5 | The settled-recurrence predicate has access to resolved per-rubric thresholds at the coordinator, as it already does for confidence floors | inferred | 85% | yes | D7 needs thresholds threaded into the coordinator input; no design change | APPROVED by operator 2026-10-19 |

## Consequences

### Positive
- Operators get a per-rubric impact lever. Minor findings stop costing remediate runs, BUILD laps
  and kickback budget.
- implementationQuality can be re-enabled with a threshold (a separate operator change).
- Advisory findings stay visible in history, the CLI and the PR. Nothing is silently dropped.
- Custom-rubric floors become effective on the gate-completion path, because there is one threshold
  helper.

### Negative
- One-time built-in re-keying at upgrade: in-flight features pay one fresh judgement, and a v3
  built-in operator acceptance must be re-recorded with `build-review accept` unless that judgement
  binds its re-keyed finding to the accepted case, where #3271 carries it.
- A required field means a reviewer that omits severity makes its whole result malformed, which
  costs a mechanical retry.
- The plan is about 20 tasks. The operator chose one spec with a scope exception over splitting the
  D6/D7 downgrade out.

### Follow-up Actions
- [ ] Measure the severity distribution over the first large features after ship, to confirm A1.
- [ ] Operator decides whether to re-enable implementationQuality with `min_severity` (out of scope).
- [ ] #2878's post-ship inbox may later consume advisory findings (out of scope).
