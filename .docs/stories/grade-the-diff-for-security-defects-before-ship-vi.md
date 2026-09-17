**Status:** Accepted

# Stories: Grade the diff for security defects before ship via a build_review security rubric (#2034)

Track: technical

Tier: M

Approved by the operator on 2026-09-14.

Scope: a second built-in `build_review` rubric, `security`, default-off, that judges the whole feature diff since the merge base for ten closed defect classes and whose findings always block through the shared adjudicator. Governing decisions: adr-2026-08-22-build-review-opt-in-rubric-container D1/D4, adr-2026-08-22-one-owner-per-review-question D1, adr-2026-08-21-review-bound-by-plan-done-when-criteria D3/D6, adr-2026-08-16-closed-build-review-finding-vocabularies D1, and adr-2026-08-18-content-anchored-finding-reference-schema, each as amended 2026-09-14 by #2034.

## Story 1: Register the security rubric as an opt-in built-in member

As a project operator, I want `security` to be a registered build_review rubric that stays off until I enable it, so that existing projects keep today's gate behaviour and a project that opts in gets security grading through the same policy keys as test quality.

### Acceptance Criteria

#### Happy Path

- Given a project config with `build_review.rubrics.security.enabled: true`, when the build_review step classifies its branches, then `security` is a dispatchable branch alongside any other enabled member and carries its resolved `llm_provider`, `model`, `effort`, `model_fallback_ladder`, `max_retries`, `escalate`, and `min_confidence`.
- Given a project config that never mentions `security`, when configuration is resolved, then `security` resolves to `enabled: false` with default effort `high` and the branch settles as skipped with reason `disabled` without any provider, cache, or preflight work.
- Given `build_review.rubrics.security.enabled: true` and every other member disabled, when the lap runs, then only `security` is dispatched and the outer verdict is derived from its judged result alone.

#### Negative Paths

- Given a project config with `build_review.rubrics.security.enabled: "yes"`, when configuration is validated, then validation fails naming `build_review.rubrics.security.enabled` and its expected boolean type, and no lap is dispatched.
- Given a project config with `build_review.rubrics.security.effort: extreme`, when configuration is validated, then validation fails naming the key and the allowed effort values.
- Given an enabled gate with `security` and `testQuality` both disabled, when the lap runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched.

### Done When

- [ ] The registry descriptor for `security` exists with skill name `build-review-security`, projection version `v3`, and a content-addressed cache policy, and `isRegisteredRubric('security')` is true.
- [ ] Resolved configuration for a project that omits `security` reports `enabled: false` and `effort: high` for it.
- [ ] Classification of an enabled `security` yields a dispatchable branch; classification of an absent or disabled `security` yields a skipped branch with reason `disabled`.
- [ ] Validation rejects a non-boolean `enabled` and an out-of-set `effort` for `security` with messages that name the key.

## Story 2: Freeze a whole-diff projection and cache the security judgement by content

As a daemon operator, I want the security rubric to see the entire feature diff by reference and to reuse a prior judgement whenever the judged content, policy, and skill are unchanged, so that a large feature is graded as one unit and warm laps do not re-bill.

### Acceptance Criteria

#### Happy Path

- Given a frozen snapshot whose diff touches three files across two prior batches, when the security projection is derived, then it lists all three files with their change kinds and hunk ranges, carries `mergeBase`, `headSha`, `lapId`, `snapshotDigest`, and `contentDigest`, and contains no test-scope, preflight, or counterfactual field.
- Given a prior judged security result cached for a projection digest, when a later lap derives an identical projection under the same policy fingerprint and skill digest, then the branch is served from cache with no dispatch and a `build_review_cache_hit` occurrence for `security`.
- Given a rebase that changes commit identities but leaves every hunk's content unchanged, when the projection is derived, then its digest equals the pre-rebase digest and the cached judgement is reused.

#### Negative Paths

- Given a cached security result, when `skills/build-review-security/SKILL.md` changes by one byte, then the cache lookup misses and the rubric is re-dispatched.
- Given a cached security result, when the resolved `security` policy changes its model, then the cache lookup misses and the rubric is re-dispatched.
- Given a snapshot whose diff is empty after machinery-authored path exclusion, when the security projection is derived, then `changedFiles` is empty, the rubric judges no findings, and the branch settles PASS without inventing a scope.
- Given `skills/build-review-security/SKILL.md` cannot be read at dispatch, when the branch runs, then it settles as an infrastructure failure with reason `cache-read-failed` and is never recorded as a cache hit or a PASS.

### Done When

- [ ] Deriving projections for an enabled `security` returns a `security` projection whose `changedFiles` equals the by-reference parse of the frozen diff and whose field set is exactly the common projection fields.
- [ ] Two snapshots with equal hunk content and different `headSha` values produce equal `security` projection digests.
- [ ] A skill-digest change or a policy-fingerprint change produces a cache miss for an otherwise identical projection.
- [ ] An unreadable skill file produces an infrastructure-failure branch, not a judged or cached result.

## Story 3: Validate security findings against a closed vocabulary and content-region anchors

As the build_review engine, I want every security finding to name one of ten closed concern kinds and anchor to the changed hunk that introduces it, so that finding identity is stable across laps and the adjudicator can dedupe and dispose of it deterministically.

### Acceptance Criteria

#### Happy Path

- Given a provider payload with one finding whose `concernKind` is `injection` and whose `anchor` is `{rubric: "security", locus: {path, contentHash: "sha256:…", display}}` over a projected hunk, when the result is validated, then the engine stamps a judged envelope for `security` with `kind`, `rubric`, `contractVersion`, `lapId`, and `snapshotDigest` taken from the projection and a `FAIL` verdict.
- Given two findings that differ only in `summary` and `evidenceLocations`, when finding identities are canonicalized, then they yield the same finding id.
- Given a finding with integer `confidence` 40 and a resolved `security.min_confidence` of 60, when the effective verdict is derived, then the finding is suppressed as below the floor and does not fail the lap on its own.

#### Negative Paths

- Given a provider payload whose finding has `concernKind: "other"`, when the result is validated, then the payload is rejected naming the closed vocabulary, one repair turn is offered, and a byte-identical repair settles the branch as a dispatch failure rather than a PASS.
- Given a provider payload whose anchor carries `line: 42` instead of a `contentHash`, when the result is validated, then the payload is rejected naming the content-region grammar and no finding identity is minted.
- Given a provider payload that includes `verdict: "PASS"` or `rubric: "testQuality"` at the top level, when the result is validated, then the reviewer-supplied envelope fields are ignored and the engine stamps its own authoritative identity and derives the verdict from validated findings, per adr-2026-08-19 D4.
- Given a provider payload whose anchor path is not in the projection's `changedFiles`, when the result is validated, then the finding is rejected as outside the frozen input.
- Given a provider reply stating it cannot perform a security review, when the result is validated, then the branch settles as an infrastructure failure, never as an empty-findings PASS.

### Done When

- [ ] `BUILD_REVIEW_FINDING_VOCABULARIES.security.concernKinds` equals exactly the ten members listed in adr-2026-08-16 D1 as amended by #2034, and `parseBuildReviewFindingAnchor` accepts a `security` content-region locus and rejects a coordinate-bearing one.
- [ ] A valid security payload produces a judged result whose envelope identity fields come from the projection and whose verdict is `FAIL` when findings are non-empty and `PASS` when empty.
- [ ] An out-of-vocabulary `concernKind`, a coordinate anchor, test-quality-only evidence, and an out-of-projection path each produce a rejection whose diagnosis names the violated rule. Reviewer-supplied envelope fields are ignored; engine-owned metadata remains authoritative.
- [ ] Canonical identity for a `security` finding is a hash over rubric, contract version, concern kind, and anchor only.

## Story 4: Fail the lap on a security finding and route it through the adjudicator

As a feature owner, I want a diff that introduces a security defect to fail build_review before the SHIP tail with a finding that names the defect and its location, and I want a clean diff to pass without security noise, so that vulnerable code never ships silently and safe code is not blocked.

### Acceptance Criteria

#### Happy Path

- Given `security` enabled and a judged result with one `committed-secret` finding anchored to the hunk that adds the credential, when the lap is joined, then the aggregate verdict is `FAIL`, the finding is a raw source for the adjudicator with `sourceId` `security:<findingId>`, and the outer verdict event reports the failure before any SHIP step runs.
- Given `security` enabled and a judged result with zero findings, when the lap is joined, then the aggregate verdict is `PASS` and the outer verdict event carries no security reason.
- Given a security finding whose location no plan task's `Done when:` names, when the lap is joined, then the finding is treated as bound and blocking, no `beyond` bucket or intake filing is produced, and the adjudicator receives it as an ordinary source.
- Given the adjudicator returns an `act` case for a security finding, when the route is reduced, then BUILD receives a bounded retry work order under the existing cumulative bound and no plan task is appended.

#### Negative Paths

- Given `security` and `testQuality` both enabled and `testQuality` settles as an infrastructure failure while `security` returns a valid judged result, when the lap is joined, then the security judged result and its findings are preserved and the lap's coverage records the test-quality failure separately.
- Given the adjudicator returns `defer` for a security finding, when the route is reduced, then the finding is filed as an intake issue with the deferral justification and the lap does not silently PASS on that finding.
- Given the adjudicator returns `refute` with evidence for a security finding, when the route is reduced, then the finding settles as refuted without charging the kickback ledger.
- Given the security branch ends in an infrastructure failure, when the lap is joined, then the aggregate verdict is not `PASS`, the mechanical-fault lane is charged rather than the kickback budget, and the outer verdict names the failed rubric.
- Given a security finding that the disposition store already carries as an operator-accepted risk under the current contract version, when the effective verdict is derived, then that finding is excluded and an otherwise clean lap passes.

### Done When

- [ ] Joining a lap with one judged security finding yields `verdict: FAIL` with `security` among the failed rubrics, and projecting aggregate sources yields that finding with `rubric: security`.
- [ ] Joining a lap with a zero-finding security result yields `verdict: PASS`.
- [ ] No code path grades a `security` finding as `beyond`; the join and the effective-verdict derivation contain no rubric-conditional exemption that could drop it.
- [ ] An infrastructure failure on `security` yields a non-PASS aggregate charged to the mechanical-fault lane, and a valid sibling judged result is preserved in the same aggregate.

## Story 5: Bind the security skill contract to the engine and give security one owner

As a harness maintainer, I want the security skill's closed vocabulary and anchor grammar mechanically bound to the engine, and I want security to stop being an incidental code-review bullet, so that the skill and engine cannot drift and no two judges compete over the same finding.

### Acceptance Criteria

#### Happy Path

- Given `skills/build-review-security/SKILL.md` declares the ten-member `**Closed vocabulary:**` line and the `**Reference grammar:**` line for `anchor.locus`, when the rubric vocabulary integrity check runs, then it iterates `security` alongside `testQuality`, executes the engine parser against each declared member, and passes.
- Given `skills/build-review-security/SKILL.md` exists with `name`, `description`, `enforcement: gating`, `phase: build`, and `disable-model-invocation: true`, when the harness integrity suite runs, then the frontmatter, invocation-policy, and model-table checks pass with a generated `build-review-security` row.
- Given the per-batch code-review evaluator prompt, when it is rendered, then it contains no instruction to grade security, and its calibration text no longer names security vulnerabilities as an evaluator target.

#### Negative Paths

- Given the skill text lists an eleventh vocabulary member the engine does not know, when the rubric vocabulary integrity check runs, then it fails naming `security` and the unknown member.
- Given the engine vocabulary gains a member the skill text does not list, when the rubric vocabulary integrity check runs, then it fails naming `security` and the missing member.
- Given `ARCHITECTURE.md`'s model table is hand-edited to add the security row without the metadata entry, when the model-table drift check runs, then it fails.

### Done When

- [ ] `test/check_build_review_rubric_skill_vocabularies.sh` covers `security` in its rubric table and both per-rubric loops, and fails on a one-member drift in either direction.
- [ ] `AUXILIARY_MODEL_TABLE_ROWS` carries a `build-review-security` row and `bin/generate-model-table` output matches the committed `ARCHITECTURE.md` table.
- [ ] `skills/code-review/SKILL.md` contains no security-grading instruction in its checklist or calibration sections.
- [ ] `skills/build-review-security/SKILL.md` passes the skill invocation-policy check and the provider skill contract audit.

## Story 6: Judge the diff for concrete, evidenced security defects only

As a feature owner, I want the security grader to raise a finding only when it can cite the changed hunk that introduces a defect and the evidence that makes it exploitable, so that real defects are named precisely and stylistic or speculative concerns do not block my build.

### Acceptance Criteria

#### Happy Path

- Given a diff that adds a string literal matching a live-credential shape to a committed source file, when the security rubric judges it, then it returns one `committed-secret` finding anchored to that hunk with the file path in `evidenceLocations` and a calibrated integer `confidence`.
- Given a diff that builds a shell or SQL command by concatenating request-derived input, when the security rubric judges it, then it returns one `injection` finding per independent sink anchored to the hunk that introduces the concatenation.
- Given a diff that removes an authorization check from a request handler, when the security rubric judges it, then it returns one `broken-access-control` finding anchored to the hunk that removes the check and cites the now-unprotected handler in `evidenceLocations`.
- Given a diff that makes an outbound request to a URL taken from request input without an allow-list, when the security rubric judges it, then it returns one `ssrf` finding anchored to the introducing hunk.

#### Negative Paths

- Given a diff that only renames variables and reorders imports in a request handler, when the security rubric judges it, then it returns zero findings.
- Given a diff that adds a test fixture containing an obviously fake credential under a test directory, when the security rubric judges it, then it returns zero `committed-secret` findings or a finding whose `confidence` is below 50.
- Given a diff that touches a dependency manifest version without changing any code path, when the security rubric judges it, then it returns zero findings, because vulnerable-component judgement is out of this rubric's vocabulary.
- Given a diff whose defect is an architectural design choice with no single introducing hunk, when the security rubric judges it, then it returns zero findings rather than anchoring an `insecure-design` concern the vocabulary does not admit.
- Given a diff that introduces an exposure whose exploitable sink is on an unchanged line, when the security rubric judges it, then the finding anchors to the changed hunk that creates the exposure and names the unchanged line only in `evidenceLocations`.

### Done When

_Amended 2026-09-17: `confidence` optional per ADR D4.2; the unchanged-sink fixture proves anchoring, not zero findings._

- [ ] `skills/build-review-security/SKILL.md` instructs one finding per independent defect, requires the introducing hunk as the anchor and concrete evidence locations, defines each of the ten concern kinds with an explicit non-finding for each, and accepts an optional integer `confidence` on a finding (absent means blocking, per ADR D4.2).
- [ ] Fixture provider payloads for the four happy-path diffs validate as judged `FAIL` results with the named concern kinds, and fixture payloads for the four zero-finding negative diffs validate as judged results with zero blocking findings, and the unchanged-sink fixture validates as one finding anchored to the changed hunk with the unchanged line named only in `evidenceLocations`.
- [ ] The skill contract returns `findings` only, with no `scopeResolutions`, `counterfactualSensitivity`, or `boundTo` field.

## Negative-category review

Invalid input is covered by the malformed config values in Story 1 and the malformed provider payloads in Story 3. Dependency unavailability is covered by the unreadable skill file in Story 2 and the provider refusal in Story 3. Partial failure is covered by the mixed judged-plus-infrastructure lap in Story 4 and the single-repair-turn exhaustion in Story 3. Data integrity is covered by identity stability under summary changes in Story 3 and by the accepted-risk exclusion in Story 4. Dedup and idempotency are covered by the cache hit, rebase, skill-digest, and policy-fingerprint criteria in Story 2 and by the refute terminal in Story 4. Invariant side-effect on alternate branches is covered by the "never `beyond`" criterion in Story 4, which asserts no rubric-conditional path can drop a security finding before the adjudicator. Resource exhaustion, timeouts, and concurrent access are owned by the existing auxiliary dispatch path (fallback ladder, `max_retries`, per-branch settlement) and are not re-specified. Auth failures, cascade deletion, and model-level immutability are inapplicable: the rubric introduces no protected resource, no entity lifecycle, and no mutable record of its own.
