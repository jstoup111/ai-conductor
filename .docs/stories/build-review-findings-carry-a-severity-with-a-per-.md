**Status:** Accepted

# Stories: build_review findings carry a severity with a per-rubric advisory threshold

Source: jstoup111/ai-conductor#3298. Technical track — acceptance criteria derive from the technical
intent and the approved architecture
(`.docs/decisions/adr-2026-10-19-build-review-finding-severity-advisory-threshold.md` decisions
D1-D7, and the amendments it records on
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D4.2/D5.1 and
`adr-2026-09-10-portable-build-review-policy` D7.1) rather than from a PRD.

## Story 1: A built-in reviewer states each finding's severity and the engine validates it

**Requirement:** ADR D1, D2

As an operator, I want every built-in rubric finding to state how much it matters so that the engine has an impact level to compare against my threshold.

### Acceptance Criteria

#### Happy Path
- Given a fresh built-in rubric result declaring contract version v4 whose finding carries `"severity": "minor"`, when the engine parses the result, then the finding is accepted and its severity is retained as minor.
- Given a fresh v4 result with findings at each of critical, major, minor and nit, when the engine parses the result, then every finding is accepted with its stated severity unchanged.
- Given a fresh v4 result whose finding carries severity major and confidence 40, when the engine parses the result, then both values are retained independently and neither is derived from the other.
- Given a persisted v3 aggregate written before this change, when the operator CLI or recovery reads it back, then it parses as before and its findings carry no severity.
- Given the rubric result contract rendered into a built-in reviewer's prompt, when it is inspected, then it lists severity as a required field with exactly the values critical, major, minor and nit.

#### Negative Paths
- Given a fresh v4 result whose finding omits severity, when the engine parses the result, then the whole rubric result is malformed and is handled exactly as a result with any other invalid finding field.
- Given a fresh v4 result whose finding carries `"severity": "blocker"`, when the engine parses the result, then the whole rubric result is malformed, because only the four closed values are accepted.
- Given a fresh v4 result whose finding carries `"severity": "Major"`, when the engine parses the result, then the whole rubric result is malformed, because values are case-sensitive.
- Given a fresh v4 result whose finding carries `"severity": 2`, when the engine parses the result, then the whole rubric result is malformed, because a number is not accepted.
- Given a fresh built-in result declaring contract version v3, when the engine parses it as a current-lap result, then it is rejected with a diagnosis naming contractVersion must be v4.
- Given a cached built-in rubric result produced under contract v3, when the next lap looks it up, then the cache entry is not reused and the reviewer re-runs under v4.

### Done When
- [ ] The built-in finding parser accepts exactly critical, major, minor and nit as severity and retains the value unchanged on the parsed finding.
- [ ] A fresh built-in result missing severity or carrying any other value is malformed through the existing invalid-field path, and its rejection diagnosis names the severity field.
- [ ] The current built-in contract version is v4 and fresh results declaring an older version are rejected; persisted v1-v3 results still parse for reads.
- [ ] No engine code path assigns, defaults, or adjusts a severity value.
- [ ] Each built-in rubric skill (testQuality, security, implementationQuality) states the required severity field and what critical, major, minor and nit mean for its concern kinds, naming impact rather than consequence.

## Story 2: A custom reviewer states each finding's severity under the custom v2 contract

**Requirement:** ADR D1, D2

As an operator running a custom rubric, I want custom findings to carry the same severity so that my custom rubric gets the same advisory lever as the built-in ones.

### Acceptance Criteria

#### Happy Path
- Given a fresh custom-findings result declaring version v2 whose finding carries `"severity": "nit"`, when the engine parses it, then the finding is accepted and its severity is retained as nit.
- Given a persisted custom-findings v1 result, when it is read back for history or the CLI, then it parses as before and its findings carry no severity.
- Given the custom-review contract rendered into a custom reviewer's prompt, when it is inspected, then it lists severity as a required field with exactly the values critical, major, minor and nit and states what each level means.

#### Negative Paths
- Given a fresh custom v2 result whose finding omits severity, when the engine parses it, then the whole custom result is malformed and its diagnosis names the severity field.
- Given a fresh custom v2 result whose finding carries an unknown severity value, when the engine parses it, then the whole custom result is malformed.
- Given a fresh custom result declaring version v1, when the engine parses it as a current-lap result, then it is rejected with a diagnosis naming version must be v2.
- Given a custom finding carrying any key other than the contract's exact key set, when the engine parses it, then it is still rejected exactly as today, because adding severity does not relax exact-key parsing.

### Done When
- [ ] The custom finding parser and schema require severity from the closed set and the custom contract version is v2.
- [ ] Persisted custom v1 results still parse for reads with no severity.
- [ ] The custom-review contract text shown to custom reviewers states the severity field and its four levels.

## Story 3: Severity never changes a finding's identity, and the built-in contract bump re-keys built-in ids once

**Requirement:** ADR D1, D2

As an operator, I want a finding's identity independent of its severity so that my dispositions keep binding when a reviewer re-grades a finding's severity.

### Acceptance Criteria

#### Happy Path
- Given two v4 findings identical in rubric, contract version, concern kind and anchor but carrying severity minor and critical, when their identities are computed, then both produce the same finding id.
- Given an operator disposition accepting a v4 finding graded major, when the next lap re-grades the same finding as nit, then the disposition still binds and the finding is recorded as accepted.
- Given two custom v2 findings identical except for severity, when their identities are computed, then both produce the same custom finding id.

#### Negative Paths
- Given the canonical identity payload for a v4 finding, when it is inspected, then it contains no severity field.
- Given a v3 finding and a v4 finding identical in rubric, concern kind and anchor, when their identities are computed, then the ids differ, because contract version is part of identity.
- Given a stored operator disposition recorded against a v3 finding, when the effective verdict is derived for a v4 lap, then the disposition is reported invalidated through the existing build_review_disposition_version_invalidated event and does not bind.
- Given a v3 operator disposition invalidated at upgrade, when the operator re-accepts the re-keyed v4 finding with build-review accept, then the new disposition binds and the finding is recorded as accepted on the next lap.

### Done When
- [ ] Two findings differing only in severity share one identity id, for both built-in and custom findings.
- [ ] The canonical identity payloads contain no severity field.
- [ ] A v3 disposition against a v4 lap emits build_review_disposition_version_invalidated and does not bind.

## Story 4: The operator declares a per-rubric severity threshold

**Requirement:** ADR D3

As an operator, I want to set `min_severity` per rubric so that I decide which impact levels cost a kickback.

### Acceptance Criteria

#### Happy Path
- Given `build_review.rubrics.implementationQuality.min_severity: major` in config, when config resolves, then the implementationQuality rubric policy carries the threshold major.
- Given `build_review.custom_rubrics.eventSpine.min_severity: minor` in config, when config resolves, then the eventSpine custom rubric policy carries the threshold minor.
- Given a rubric with no min_severity key, when config resolves, then its policy carries no threshold, not a defaulted value.
- Given a custom rubric with min_confidence 70 and min_severity major, when the build_review gate-completion predicate evaluates a lap, then it applies the same floor and threshold for that custom rubric as the effective verdict does.

#### Negative Paths
- Given `min_severity: blocker` on a built-in rubric, when config is validated, then validation fails naming the key and the allowed values critical, major, minor and nit.
- Given `min_severity: 2` on a custom rubric, when config is validated, then validation fails naming the key, because a number is not accepted.
- Given `min_severity: Major` on a built-in rubric, when config is validated, then validation fails, because values are case-sensitive.
- Given a change to min_severity between two laps with identical inputs, when the second lap looks up its rubric cache, then the cached rubric result is reused, because the threshold is applied after judgement and never enters the cache fingerprint.

### Done When
- [ ] Config validation accepts min_severity only from the four closed values on both built-in and custom rubric entries.
- [ ] Resolved rubric policy exposes an optional threshold with no default.
- [ ] One shared helper resolves confidence floors and severity thresholds for built-in and custom rubrics, and the gate-completion path uses it instead of its own built-in-only map.
- [ ] The config-consumer registry declares min_severity for both rubric families.

## Story 5: A below-threshold finding is advisory and never kicks back

**Requirement:** ADR D4

As an operator, I want findings below my threshold recorded as advisory instead of failing build_review so that cosmetic findings never cost a remediate run, a repair BUILD or kickback budget.

### Acceptance Criteria

#### Happy Path
- Given implementationQuality min_severity major and a lap whose only finding is minor with confidence 96, when the effective verdict is derived, then the finding is placed in the advisory set, the unresolved set is empty, and the effective verdict is PASS.
- Given min_severity major and a finding at severity major, when the effective verdict is derived, then the finding is unresolved, because the threshold is a minimum and not an exclusive bound.
- Given min_severity major and a lap with one nit finding and one critical finding, when the effective verdict is derived, then only the nit is advisory and the verdict is FAIL on the critical finding.
- Given a lap whose every finding is advisory, when the conductor evaluates the build_review gate, then it records the step done without dispatching remediate, without a kickback event, and without charging the kickback ledger.
- Given a mixed lap with one advisory and one unresolved finding, when the coordinator builds its live sources, then only the unresolved finding is a live source and the remediate judgement does not demand an outcome for the advisory one.
- Given a custom rubric with min_severity major and a minor custom finding, when the custom effective verdict is derived, then the finding is advisory exactly as for a built-in rubric.
- Given an open action case with a failed effect whose only source is advisory this lap, when a mechanically healthy lap settles, then the case is resolved by absence, because an advisory source is not raised.

#### Negative Paths
- Given no min_severity declared and a finding at severity nit, when the effective verdict is derived, then the finding is unresolved and blocks, exactly as today.
- Given min_severity nit and a finding at severity nit, when the effective verdict is derived, then the finding is unresolved, because nothing is strictly below nit.
- Given min_confidence 70 and min_severity major and a finding at confidence 40 and severity minor, when the effective verdict is derived, then the finding is suppressed and not advisory, because the confidence floor is checked first.
- Given min_confidence 70 and min_severity major and a finding at confidence 40 and severity critical, when the effective verdict is derived, then the finding is suppressed, because a low-confidence severe finding is still suppressed by the confidence floor.
- Given min_severity major and a finding at confidence 95 and severity critical, when the effective verdict is derived, then the finding is unresolved, because high confidence never makes a finding advisory.
- Given an operator disposition accepting a finding that is also below min_severity, when the effective verdict is derived, then the finding is recorded as accepted and not advisory, because operator resolution is checked first.
- Given a persisted v3 finding with no severity re-evaluated under a declared threshold, when the effective verdict is derived, then the finding is never advisory.
- Given an advisory finding, when operator dispositions are listed, then no accepted-risk disposition exists for it, because advisory is never written as operator accepted risk.
- Given an open action case with a failed effect whose only source is advisory this lap, when a lap that is not mechanically healthy settles, then the case stays open and is not retired by absence.

### Done When
- [ ] Both effective reducers classify in the order accepted, settled, declared replication, suppressed, advisory, unresolved, with advisory as its own bucket.
- [ ] Only unresolved findings block; a lap of only resolved, suppressed and advisory findings is an effective PASS that dispatches no remediate.
- [ ] Advisory findings are absent from the coordinator's live sources and never produce a BUILD route, kickback event, or kickback-ledger charge.
- [ ] An undeclared threshold leaves the advisory set empty on every lap.

## Story 6: Advisory findings are durable and visible on the event spine and to the judge

**Requirement:** ADR D5

As an operator, I want every advisory finding recorded durably and on the event spine so that nothing below my threshold is silently forgotten.

### Acceptance Criteria

#### Happy Path
- Given a lap with an advisory finding, when the outer verdict is emitted, then build_review_outer_verdict carries advisoryFindings with the finding id, rubric, severity and threshold.
- Given a lap with an advisory finding, when the effective verdict path runs, then a severity-kind entry with the finding id, rubric, summary, severity, threshold and lap is written to the remediation case store before the pass/fail fork.
- Given a lap whose every finding is advisory, when it completes as PASS, then the advisory entries are still persisted, because persistence runs on PASS laps too.
- Given the same advisory finding recurring on a later lap, when it is persisted, then its existing entry is refreshed in place with the new lap and no duplicate entry is created.
- Given a mixed lap that dispatches remediate, when the adjudication context is built, then advisory entries appear in the non-blocking history section and not among the current sources.
- Given a lap with no advisory findings, when the outer verdict is emitted, then the event carries no advisoryFindings field or an empty list and is otherwise unchanged.

#### Negative Paths
- Given a remediation case store written before this change whose suppression entries carry no kind, when it is read, then each entry is read as a confidence-kind entry with its confidence and floor intact.
- Given a stored entry whose kind is severity but which carries a floor instead of a threshold, when the store is read, then the store read fails closed as malformed rather than guessing a kind.
- Given an advisory finding that stops recurring, when later laps run, then its entry is retained and never pruned.
- Given a lap with both a suppressed and an advisory finding, when the outer verdict is emitted, then the suppressed finding appears only in suppressedFindings and the advisory finding appears only in advisoryFindings.

### Done When
- [ ] build_review_outer_verdict carries an additive optional advisoryFindings list rendered by the existing daemon-log projection.
- [ ] Remediation case store suppression entries are a discriminated union of confidence and severity kinds, and legacy entries without a kind read as confidence.
- [ ] The existing suppression-persistence seam writes severity-kind entries on PASS and FAIL laps, idempotently by finding id.
- [ ] The adjudication context's non-blocking history includes advisory entries.

## Story 7: Advisory findings appear in the findings CLI and on the PR

**Requirement:** ADR D5

As an operator and PR reviewer, I want advisory findings listed where I already look so that minor concerns remain visible after the feature ships.

### Acceptance Criteria

#### Happy Path
- Given a feature with an advisory finding, when the operator runs build-review findings with JSON output, then the output lists the advisory finding id, rubric, severity, threshold and origin threshold.
- Given a feature with an advisory finding, when the operator runs build-review findings with human output, then an advisory section lists each advisory finding's id, rubric, severity and summary.
- Given a feature that finishes with an advisory finding, when the PR body is published, then it contains a section headed Advisory build-review findings listing the finding id, rubric, severity, origin and reviewer summary.
- Given a feature with a finding the adjudicator downgraded, when the PR body is published, then the advisory section lists it with origin adjudicated.

#### Negative Paths
- Given a feature with no advisory findings, when the PR body is published, then no Advisory build-review findings section appears.
- Given a worker-authored PR body containing a forged Advisory build-review findings section, when the engine publishes, then the engine's own region replaces it and the forged content is not published.
- Given a downgraded finding with an adjudicator rationale, when the PR body is published, then the rationale does not appear in the PR body and remains available in the CLI.

### Done When
- [ ] build-review findings lists advisory findings in both JSON and human output with origin threshold or adjudicated.
- [ ] Finish publication renders an engine-owned Advisory build-review findings region only when advisory findings exist.
- [ ] The region is registered with the engine-owned PR-body regions so worker edits to it are masked.

## Story 8: The adjudicator may downgrade a finding to advisory below a declared threshold

**Requirement:** ADR D6

As an operator, I want the adjudicator to mark a finding advisory when the plan or prior cases show its substance is settled and minor, so that a mis-graded finding does not force a repair BUILD.

### Acceptance Criteria

#### Happy Path
- Given implementationQuality min_severity major and a live major finding, when the remediate judgement returns an advisory case for it with adjudicated severity minor, a non-empty rationale and effect none, then the case is accepted, the lap routes no BUILD and charges no kickback.
- Given a lap whose only live source is downgraded to advisory, when the adjudication reduces, then the route is PASS.
- Given a downgraded finding, when the raw aggregate is read afterwards, then the finding's reviewer-assigned severity is unchanged.
- Given a lap whose context declares a threshold, when the remediate dispatch is prepared under either case-v1 or case-v2 mode, then the judgement contract offers the advisory disposition and the context names each rubric's threshold.

#### Negative Paths
- Given no rubric in the lap declares min_severity, when the remediate judgement returns an advisory case, then the judgement is rejected as invalid through the existing rejection path.
- Given a context that declares no threshold, when the remediate dispatch is prepared, then the advisory disposition is not offered in the judgement contract.
- Given an advisory case whose source belongs to a rubric without a declared threshold while another rubric declares one, when the judgement is validated, then it is rejected as invalid.
- Given min_severity major, when the remediate judgement returns an advisory case with adjudicated severity major, then it is rejected, because the downgrade must be strictly below the threshold.
- Given an advisory case with an empty rationale, when the judgement is validated, then it is rejected as invalid.
- Given an advisory case carrying an action effect, when the judgement is validated, then it is rejected, because an advisory case's effect must be none.
- Given a case whose adjudicated severity is higher than the reviewer's severity, when the judgement is validated, then it is rejected, because the adjudicator cannot raise severity.
- Given min_severity major and a live major finding that the remediate judgement binds to a case holding an operator-accepted source while proposing an otherwise valid advisory case, when the lap is adjudicated, then the finding resolves as carried operator acceptance, the bound case's disposition is unchanged, and the finding is not listed among advisory findings.

### Done When
- [ ] The remediate judgement parser and validator admit an advisory disposition only when the context declares a threshold for every source's rubric, with an adjudicated severity strictly below each threshold and not above the reviewer's severity, a non-empty rationale and effect none.
- [ ] An advisory case reduces to a non-action outcome: no BUILD route, no kickback event, no ledger charge.
- [ ] The adjudication context carries each rubric's declared threshold.
- [ ] The remediate skill states when an advisory downgrade is appropriate and that it requires a rationale grounded in the plan or prior cases.
- [ ] A finding bound to a case holding an operator-accepted source resolves as carried acceptance even when the judgement proposes advisory.

## Story 9: A downgraded finding stays advisory only while its threshold admits it

**Requirement:** ADR D7

As an operator, I want a downgraded finding not re-judged every lap, but reopened if I tighten my threshold, so that the downgrade converges without outliving my policy.

### Acceptance Criteria

#### Happy Path
- Given a finalized advisory case for a finding at adjudicated severity minor under min_severity major, when the same finding recurs by exact id on the next lap, then it is removed from the live sources without dispatching remediate.
- Given a lap emptied of live sources by a settled advisory case, when it finalizes, then remediation_adjudication_completed is emitted with the settled case id and no new effect ids.

#### Negative Paths
- Given a finalized advisory case at adjudicated severity minor, when the operator lowers implementationQuality min_severity to minor and the same finding recurs, then the case does not settle and the finding is a live source again.
- Given a finalized advisory case, when the operator removes min_severity and the same finding recurs, then the finding is a live source and blocks as unresolved.
- Given a finalized advisory case, when the recurring finding's id has drifted, then the case does not bind and the finding is judged as a live source.
- Given the settled-recurrence predicate evaluating an advisory case, when it runs, then it neither writes, prunes nor resolves the case.

### Done When
- [ ] The settled-recurrence predicate treats an advisory case with effect none as finalized only while every source rubric's current threshold is strictly above the case's adjudicated severity.
- [ ] A lowered or removed threshold reopens the case's sources as live on the next lap.
- [ ] A settled advisory recurrence emits remediation_adjudication_completed with no new effects.
