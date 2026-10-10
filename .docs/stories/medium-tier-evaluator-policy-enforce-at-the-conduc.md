**Status:** Accepted

# Stories: build_review implementation-quality rubric (#475)

Technical track. These stories come from the track scope boundary, the approved architecture review
`.docs/decisions/architecture-review-2026-10-09-medium-tier-evaluator-policy-enforce-at-the-conduc.md`
(conditions 1–5), and the amended ADRs `adr-2026-08-22-build-review-opt-in-rubric-container`
(decisions 1 and 4) and `adr-2026-08-22-one-owner-per-review-question` (D1). The rubric judges code
quality and domain modelling only. Acceptance-criteria compliance stays with `prd_audit`, and ADR
conformance stays with the as-built review. Retiring the `/pipeline` batch evaluators is #3056 and is
out of scope.

## Story 1: Register the implementation-quality rubric as a default-on built-in member

As a project operator, I want `implementationQuality` to be a registered build_review rubric that is
on unless I turn it off, so that every build gets a code-quality and domain-modelling review without
configuration, and I can opt out through the same policy keys as the other rubrics.

### Acceptance Criteria

#### Happy Path

- Given a project config that never mentions `implementationQuality`, when configuration is resolved, then `implementationQuality` resolves to `enabled: true` with default effort `medium`, and the build_review step classifies it as a dispatchable branch.
- Given a project config with `build_review.rubrics.implementationQuality` set to an explicit `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence`, when its branch is classified, then the branch carries exactly those resolved values.
- Given a project config that never mentions any rubric, when configuration is resolved, then `testQuality` and `security` still resolve to `enabled: false` and only `implementationQuality` is dispatched.

#### Negative Paths

- Given `build_review.rubrics.implementationQuality.enabled: false`, with `testQuality` and `security` left at their defaults, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched.
- Given `build_review.rubrics.implementationQuality.enabled: "yes"`, when configuration is validated, then validation fails naming `build_review.rubrics.implementationQuality.enabled` and its expected boolean type, and no lap is dispatched.
- Given `build_review.rubrics.implementationQuality.effort: extreme`, when configuration is validated, then validation fails naming the key and the allowed effort values.
- Given `build_review.enabled: false`, when the build reaches build_review, then no implementation-quality judgement runs, even though the rubric defaults to enabled.

### Done When

- [ ] The registry descriptor for `implementationQuality` exists with skill name `build-review-implementation-quality`, projection version `v3`, and a content-addressed cache policy, and `isRegisteredRubric('implementationQuality')` is true.
- [ ] Resolved configuration for a project that omits `implementationQuality` reports `enabled: true` and `effort: medium`, while `testQuality` and `security` still report `enabled: false`.
- [ ] Classification with `implementationQuality` disabled and the other rubrics at their defaults yields the `build_review_no_rubrics` PASS with zero dispatches.
- [ ] Validation rejects a non-boolean `enabled` and an out-of-set `effort` for `implementationQuality`, with messages that name the key.

## Story 2: Freeze a diff-only projection and cache the judgement by content

As a feature owner, I want the implementation-quality grader to see only the changed code, and to
re-judge only when its inputs change, so that it cannot drift into questions other gates own and
does not re-pay for an unchanged review.

### Acceptance Criteria

#### Happy Path

- Given an enabled `implementationQuality` and a feature diff, when its projection is built, then it contains the lap id, digests, `mergeBase`, `headSha`, and the changed files by reference, and nothing else.
- Given a lap whose projection digest, engine identity, policy fingerprint, and skill digest all match a cached judged result, when the branch runs, then the cached result is reused and no provider dispatch occurs.
- Given per-child build regions are implemented (#2942) and a stacked feature is built child by child, when build_review runs for a non-leaf child and for the leaf, then `implementationQuality` grades each child's own diff against its parent tip and is never skipped with reason `leaf-only`.
- Given a feature with no children, when build_review runs, then `implementationQuality` grades the same snapshot as every other enabled rubric.

#### Negative Paths

- Given a plan body, accepted stories, and approved ADRs in the worktree, when the implementation-quality projection is built, then none of their content or paths appear in it.
- Given a cached result for the same projection, when `skills/build-review-implementation-quality/SKILL.md` has changed since that result was cached, then the cache misses and the diff is re-judged.
- Given a cached result for the same projection, when the resolved policy (provider, model, or effort) changes, then the cache misses and the diff is re-judged.
- Given the rubric skill file is missing or unreadable, when the branch is prepared, then the branch settles as an infrastructure failure naming the skill path, and it records no PASS.

### Done When

- [ ] The implementation-quality projection type carries only the common projection fields. A test with a plan, stories, and an ADR present asserts that none of them are in the serialized projection.
- [ ] Cache identity for the rubric includes the rubric id, projection digest, policy fingerprint, engine identity, and the `SKILL.md` digest. A changed skill digest or policy produces a miss.
- [ ] Projection derivation returns a single shared snapshot for `implementationQuality` when there are no children. If per-child projection derivation (#2942) exists in the worktree when this feature builds, it also returns a child-diff projection for `implementationQuality` on every child with no `leaf-only` skip. Otherwise this proof belongs to #2942, which builds second and covers every registered non-security member.
- [ ] A missing skill file produces an infrastructure-failure branch outcome, not a PASS.

## Story 3: Validate implementation-quality findings against a closed vocabulary and content-region anchors

As a feature owner, I want every implementation-quality finding to name a known defect class and the
changed code it is about, so that malformed or unanchored judgements never fail my build.

### Acceptance Criteria

#### Happy Path

- Given a provider payload whose findings each use a `concernKind` from the closed set `duplication`, `excess-complexity`, `obscured-intent`, `primitive-obsession`, `representable-invalid-state`, `non-exhaustive-domain-match`, and `non-semantic-name`, each anchored by a content-region `locus` that matches a changed content region, when the result is validated, then it is accepted as an engine-stamped judged result with verdict `FAIL`.
- Given a provider payload with an empty findings array, when the result is validated, then it is accepted as a judged result with verdict `PASS`.
- Given the same defect reported in two laps with different summary wording but the same `concernKind` and `locus`, when identity is computed, then both findings resolve to the same stable finding identity.

#### Negative Paths

- Given a finding with `concernKind: unmet-acceptance-criterion` or any other value outside the closed set, when the result is validated, then the payload is rejected as invalid, naming the offending kind.
- Given a finding whose `locus` content hash matches no changed content region, when the result is validated, then the payload is rejected as invalid, naming the unmatched anchor.
- Given a finding anchored by line number instead of a content-region reference, when the result is validated, then the payload is rejected as invalid.
- Given a finding that carries `scopeResolutions`, `counterfactualSensitivity`, or test-quality evidence fields, when the result is validated, then the payload is rejected as invalid.
- Given an invalid payload, when the single repair turn also returns an invalid payload, then the branch settles in the mechanical-fault lane and records no PASS and no content finding.

### Done When

- [ ] `BUILD_REVIEW_FINDING_VOCABULARIES` has an `implementationQuality` entry equal to the seven-kind set, and its judged-v3 schema admits only those kinds.
- [ ] Validation fixtures cover the accepted FAIL, accepted PASS, out-of-vocabulary kind, unmatched anchor, line-number anchor, forbidden evidence field, and exhausted repair turn cases, each with the stated outcome.
- [ ] Two fixtures that differ only in summary wording produce equal finding identities.

## Story 4: Fail the lap on an implementation-quality finding and route it through the adjudicator

As a feature owner, I want an implementation-quality finding to fail the lap and be settled by the
shared adjudicator under the existing caps, so that real defects are repaired within the approved
plan and subjective findings cannot cycle my build forever.

### Acceptance Criteria

#### Happy Path

- Given a lap where `implementationQuality` returns one finding at or above `min_confidence`, when the lap is aggregated, then the outer verdict is FAIL and the finding is passed to the adjudicator as a raw source.
- Given the adjudicator acts on the finding with a repair task that cites an admitted plan task id and an admission rationale, when routing is decided, then the build is kicked back with that bounded work order, and the kickback is counted against `build_review`'s per-gate and cumulative caps.
- Given a lap where `implementationQuality` fails and `testQuality` and `security` pass, when the lap is aggregated, then the outer verdict is FAIL and the passing rubrics' results are preserved unchanged.

#### Negative Paths

- Given a finding below the rubric's `min_confidence`, when the lap is aggregated, then the finding is recorded as suppressed and does not fail the lap.
- Given the adjudicator proposes a repair task that cites no admitted plan task id, when the case is validated, then it is rejected as `missing-admission-task`, and the finding is deferred to intake or escalated, not sent to BUILD.
- Given an implementation-quality finding of any kind, when it is adjudicated, then no plan task is appended and the route is never `plan`.
- Given the cumulative build_review kickback cap is already reached, when another lap fails on an implementation-quality finding, then the feature halts for a human instead of kicking back again.
- Given a finding the operator has accepted or refuted in a prior lap, when the same finding identity recurs on unchanged code, then it does not fail the new lap.

### Done When

- [ ] Aggregation tests show a FAIL outer verdict for a single above-threshold implementation-quality finding, and suppression for a below-threshold one.
- [ ] Adjudication tests show the admitted-task `act` route to BUILD, the `missing-admission-task` rejection, and the absence of any plan-append or `plan` route for this rubric's findings.
- [ ] A kickback-ledger test shows an implementation-quality failure at the cumulative cap producing a halt.
- [ ] A disposition test shows an accepted or refuted identity not failing a later lap on unchanged code.

## Story 5: Bind the skill contract to the engine and keep each review question with one owner

As a harness maintainer, I want the implementation-quality skill text, the engine vocabulary, the
provider agent definitions, and the model table to agree, and the rubric to own only its own
questions, so that drift is caught in CI and no two gates judge the same substance.

### Acceptance Criteria

#### Happy Path

- Given `skills/build-review-implementation-quality/SKILL.md` declares exactly the engine's seven concern kinds and anchor grammar, when `test/check_build_review_rubric_skill_vocabularies.sh` runs, then it passes for the new rubric alongside `testQuality` and `security`.
- Given the shipped skill catalog, when a Codex-selected build dispatches the rubric, then the skill resolves with its `agents/openai.yaml` definition, as `build-review-security` does.
- Given the generated model table, when it is regenerated from the model-table metadata, then it lists the implementation-quality rubric role with its default model and effort.

#### Negative Paths

- Given the skill declares a concern kind the engine does not define, or omits one the engine defines, when the vocabulary check runs, then it fails naming the rubric and the mismatched kind.
- Given the skill text instructs the grader to judge acceptance-criteria compliance, plan conformance, or ADR conformance, when the skill contract test runs, then it fails naming the forbidden question.
- Given the generated model table is stale after the metadata change, when the integrity check runs, then it fails, reporting that the table must be regenerated.

### Done When

- [ ] `skills/build-review-implementation-quality/SKILL.md` and `skills/build-review-implementation-quality/agents/openai.yaml` exist in the shipped catalog.
- [ ] The vocabulary check covers `implementationQuality` in both directions and fails on a seeded mismatch.
- [ ] A skill contract test asserts that the skill excludes acceptance-criteria, plan, and ADR conformance questions.
- [ ] `model-table-metadata.ts` has the rubric row and the generated model table matches it.

## Story 6: Judge the diff for concrete, anchorable quality and domain-modelling defects only

As a feature owner, I want the grader to raise a finding only when it can point at the changed code
that introduces a concrete defect, so that real duplication, complexity, and domain-modelling
problems are named precisely and style preferences or other gates' questions never block my build.

### Acceptance Criteria

#### Happy Path

- Given a diff that adds a block of logic duplicating an existing block in a changed file, when the rubric judges it, then it returns one `duplication` finding anchored to the added hunk, with the existing block named in `evidenceLocations`.
- Given a diff that adds a function nesting four or more conditional levels where a flat structure expresses the same logic, when the rubric judges it, then it returns one `excess-complexity` finding anchored to that function's hunk.
- Given a diff that stores a fixed set of domain states as raw strings compared by literal across call sites, when the rubric judges it, then it returns one `primitive-obsession` finding anchored to the introducing hunk.
- Given a diff that models one state with two independent booleans whose combination allows an impossible state, when the rubric judges it, then it returns one `representable-invalid-state` finding anchored to the introducing hunk.
- Given a diff that adds a switch over a closed domain union with a catch-all default that hides unhandled members, when the rubric judges it, then it returns one `non-exhaustive-domain-match` finding anchored to that switch's hunk.

#### Negative Paths

- Given a diff that only renames variables, reformats, or reorders imports, when the rubric judges it, then it returns zero findings.
- Given a diff that implements only part of a story's acceptance criteria, but whose added code is clean, when the rubric judges it, then it returns zero findings, because acceptance-criteria compliance belongs to `prd_audit`.
- Given a diff that violates an approved ADR's decision but has clean code, when the rubric judges it, then it returns zero findings, because ADR conformance belongs to the as-built review.
- Given a diff whose only issue is a style preference (quote style, brace placement, or line length), when the rubric judges it, then it returns zero findings.
- Given a diff whose duplicated logic exists only between two unchanged files, when the rubric judges it, then it returns zero findings, because no changed hunk introduces the defect.
- Given an active plan whose resolved `Pattern-source:`/`Rename-map:` declaration names a source and target, when the rubric returns a `duplication` finding anchored in the declared target whose evidence names only the declared source, then the engine suppresses that finding before aggregation, records the suppression, and the finding does not fail the lap.
- Given the same declared plan, when the rubric returns a `duplication` finding anchored in a file outside the declared target set, or whose evidence names a file other than the declared source, then the finding is not suppressed and fails the lap as usual.

### Done When

- [ ] `skills/build-review-implementation-quality/SKILL.md` instructs one finding per independent defect, requires the introducing changed hunk as the anchor, defines each of the seven concern kinds with an explicit non-finding example, and excludes style preferences and other gates' questions.
- [ ] Fixture provider payloads for the five happy-path diffs validate as judged `FAIL` results with the named concern kinds, and fixture payloads for the five negative diffs validate as judged results with zero blocking findings.
- [ ] The skill contract returns `findings` only, with no `scopeResolutions`, `counterfactualSensitivity`, or test-quality evidence fields.
- [ ] Engine tests show a declared-pair `duplication` finding suppressed and recorded, with the projection still carrying no plan content, while an undeclared or out-of-set `duplication` finding still fails the lap, and a plan with no declaration suppresses nothing.

## Negative-category review

- **Invalid input:** the malformed config values in Story 1 and the malformed provider payloads in Story 3.
- **Dependency unavailability:** the missing skill file in Story 2 and the exhausted repair turn in Story 3.
- **Partial failure:** the mixed-rubric lap in Story 4.
- **Data integrity:** identity stability across summary rewording in Story 3, and the accepted or refuted dispositions in Story 4.
- **Dedup and idempotency:** the cache hit, skill-digest, and policy-fingerprint criteria in Story 2, and recurrence of a disposed identity in Story 4. The dedup key is the projection digest plus the skill and policy identity, so an edit that does not change the changed content regions correctly reuses the result, and any change to the grader or its inputs re-judges.
- **Invariant side-effect on alternate branches:** Story 1's `build_review.enabled: false` and all-disabled criteria, and Story 4's below-threshold and cap-reached criteria. Each asserts that an alternate path neither silently passes a finding through to BUILD nor records a false PASS.
- **Architecture-induced negatives:**
  - default-on, with its opt-out and no-rubrics PASS (Story 1)
  - the diff-only projection boundary (Story 2)
  - per-child placement with no leaf-only skip (Story 2)
  - the admission rule that keeps repairs inside the approved plan (Story 4)
  - the one-owner exclusions (Stories 5 and 6)
- **Not applicable:**
  - Resource exhaustion, timeouts, and concurrent access belong to the existing auxiliary dispatch path (fallback ladder, `max_retries`, per-branch settlement), so they are not re-specified here.
  - Auth failures, cascade deletion, and model-level immutability don't apply: the rubric introduces no protected resource, no entity lifecycle, and no mutable record of its own.
