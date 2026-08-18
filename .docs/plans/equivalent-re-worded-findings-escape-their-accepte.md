# Implementation Plan: Equivalent re-worded findings escape their accepted dispositions

**Date:** 2026-08-16
**Design:** .docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md
**Stories:** .docs/stories/equivalent-re-worded-findings-escape-their-accepte.md
**Stories status:** Accepted; Stories 1–6
**Conflict check:** Clean as of 2026-08-16
**Review conditions:** .docs/decisions/architecture-review-2026-08-16-equivalent-re-worded-findings-escape-their-accepte.md

## Summary

Eighteen tasks that implement the enumeration `adr-2026-08-13` already mandated but never received,
so a re-worded build_review finding keeps the identity its substance earned, and that make every exit
from the daemon's build_review FAIL block consult the disposition store instead of the raw aggregate.
Closes ai-conductor#1611.

## Technical Approach

**The contract already promises this and does not deliver it.**
`adr-2026-08-13-stable-build-review-finding-dispositions` (APPROVED) requires "an **enumerated**
concern kind owned by that rubric contract" and guarantees "Pure wording changes retain the version
and identity". All four `skills/build-review-*/SKILL.md` result contracts repeat the promise and
enumerate nothing; `build-review-domain.ts` types `concernKind` as `string`, validates it as "a
non-empty string" (`:137`, `:242`), and `renderBuildReviewJudgedResultShape` tells every grader to
send `"<string>"` (`:210`). That gap is #1611.

**The primary change is Tasks 3–5: every identity input becomes a closed vocabulary member or a
verified reference.** `concernKind` and the classification anchors (`scope.relation`,
`tautology.violationKind`, `rootCause.relation`, completeness's missing kind) close; the subject
anchors stay references; the residual prose subjects (`exercisedBehavior`, `statedDefect`,
`missingOutcome`) leave the canonical payload and stay on the finding for the report, joining
`summary` and `evidenceLocations`, which the ADR already excludes.
`matchesBuildReviewDisposition` is **not** touched — it is correct, and the ADR requires it stay
exact.

**Why not an LLM equivalence matcher.** The first design did that. Conflict-check found it is
`adr-2026-08-13`'s rejected Option B ("aggressive normalization risks collapsing materially different
concerns") and that its determinism clause forbids it, and that
`adr-2026-07-21-demote-task-stamping-to-telemetry` already removed an engine-embedded bounded LLM
judge built for the same problem. That direction is recorded as rejected in the ADR so it is not
re-proposed.

**Arming is the risk, not the enumeration.** `adr-2026-07-07-task-trailer-id-alias` and
`adr-2026-07-21-no-diff-task-evidence-stamp` both record a strict engine bar on a vocabulary the model
was never shown auto-parking daemon builds. Three things answer it, in Tasks 7–9: the vocabulary is
rendered into the dispatch schema, values are normalized before validation, and a rejection that
survives #1605's repair turn classifies `absent` → rerun rather than burning a kickback.

**Sequencing.** Task 1 discharges review condition 1 and the stories' flagged assumption before
anything depends on it: the sets are derived from `.daemon/evals-raw`, not invented, and if a rubric's
observed values cannot be covered by a set small enough to mean anything, that is a design fork for
the operator, not something to work around by widening the set. Tasks 2–6 close the identity; 7–9 arm
it safely; 10 pins narrowness; 11–14 fix the routing surface; 15–16 make non-binding dispositions
visible; 17–18 bind the contracts and the docs.

**Expect no new provider dispatch and no new store.** Either appearing in the diff means the
implementation drifted back toward the withdrawn design.

## Prerequisites

- None. No migration, config key, dependency, or external account. Contract `v1` never went live and
  no live disposition store exists, so there is no data migration to perform.

## Tasks

### Task 1: Derive each rubric's vocabulary from the observed corpus
**Story:** 1
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Extract every `concernKind`, `anchor.relation`, and `anchor.violationKind` value from
   `.daemon/evals-raw`, grouped by rubric, with occurrence counts.
2. Cluster each rubric's values into the smallest member set that covers every observed use after
   lowercase + `_`→`-` normalization.
3. Record the proposed sets and their corpus coverage in the commit message.
4. If any rubric cannot be covered by a set small enough to discriminate, stop and halt for the
   operator rather than widening the set until it means nothing.
5. Commit an empty commit carrying `Evidence: skipped establishes findings only`.

**Files likely touched:**
- none

**Dependencies:** none

---

### Task 2: RED — identity is stable across re-wording and vocabularies do not collide
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the 2026-08-15 pair — same scope path and plan relation,
   `concernKind` `out-of-plan-test-change` then `out-of-plan-change` — canonicalizes to one identity.
2. Add a failing test asserting no two members of any rubric's set collide under normalization.
3. Add a failing test asserting a finding whose only change is `summary`, `evidenceLocations`, or a
   prose subject yields a byte-identical identity.
4. Verify RED.
5. Commit: "test(build-review): finding identity must survive grader re-wording".

**Files likely touched:**
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — stability and collision cases

**Dependencies:** Task 1

---

### Task 3: GREEN — one engine vocabulary source with guarded normalization
**Story:** 1
**Type:** happy-path

**Steps:**
1. Add the per-rubric closed sets from Task 1 as the single engine source, alongside a normalizer
   that lowercases and folds `_` to `-`.
2. Assert at module load that no rubric's members collide under normalization.
3. Verify the collision and normalization tests from Task 2 pass.
4. Commit: "feat(build-review): closed per-rubric finding vocabularies (adr-2026-08-13)".

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — vocabulary source and normalizer

**Dependencies:** Task 2

---

### Task 4: GREEN — the parser validates against the vocabulary after normalization
**Story:** 1
**Type:** happy-path

**Steps:**
1. Replace `nonEmptyString(source.concernKind)` in `parseFindings` with normalize-then-validate
   against the rubric's set.
2. Apply the same treatment to each rubric's classification anchor field in `parseAnchor`.
3. Leave the subject anchor fields and the prose fields validated as they are today.
4. Commit: "feat(build-review): validate finding vocabularies at the trust boundary".

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — `parseFindings`, `parseAnchor`

**Dependencies:** Task 3

---

### Task 5: GREEN — prose subjects leave the identity; completeness gains a verified surface
**Story:** 1
**Type:** happy-path

**Steps:**
1. Remove `exercisedBehavior`, `statedDefect`, and `missingOutcome` from the canonical payload in
   `build-review-finding-identity.ts`, keeping them on `BuildReviewFinding` for the report.
2. Add the completeness missing-surface reference to the anchor and to the identity.
3. Verify the Task 2 re-wording tests pass.
4. Commit: "feat(build-review): identity carries classifications and references, never prose".

**Files likely touched:**
- `src/conductor/src/engine/build-review-finding-identity.ts` — canonical payload
- `src/conductor/src/engine/build-review-domain.ts` — anchor shape

**Dependencies:** Task 4

---

### Task 6: Advance the rubric contract to v2 while still parsing v1
**Story:** 5
**Type:** happy-path

**Steps:**
1. Widen `parseBuildReviewRubricContractVersion` to accept `'v1' | 'v2'`, following
   `build-review-cache.ts:102`'s `projectionVersion` precedent, and emit only `v2`.
2. Widen the cache entry's `contractVersion` literal type; its `contract-version-mismatch` miss at
   `:153` already re-dispatches stale entries.
3. Add a test asserting a store holding one `v1` record still parses and does not read as malformed.
4. Commit: "feat(build-review): rubric result contract v2".

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — version parser
- `src/conductor/src/engine/build-review-cache.ts` — entry version type
- `src/conductor/test/engine/build-review-dispositions.test.ts` — mixed-version store case

**Dependencies:** Task 5

---

### Task 7: The dispatch schema shows every grader its allowed members
**Story:** 3
**Type:** happy-path

**Steps:**
1. Extend `renderBuildReviewJudgedResultShape` to render the rubric's `concernKind` members and its
   classification anchor members from the Task 3 source instead of `"<string>"`.
2. Add a test asserting each rubric's rendered schema contains its full member set.
3. Commit: "feat(build-review): render finding vocabularies into the rubric dispatch schema".

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — `renderBuildReviewJudgedResultShape`
- `src/conductor/test/engine/build-review-domain.test.ts` — schema rendering case

**Dependencies:** Task 3

---

### Task 8: The rejection diagnosis lists the allowed members
**Story:** 3
**Type:** negative-path

**Steps:**
1. Extend `describeBuildReviewJudgedResultRejection` so an out-of-vocabulary value names the field and
   lists that rubric's members, from the same source.
2. Add a test asserting the diagnosis for a prose `violationKind` lists the tautology members.
3. Commit: "feat(build-review): rejection diagnosis names the allowed vocabulary".

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — `describeBuildReviewJudgedResultRejection`
- `src/conductor/test/engine/build-review-domain.test.ts` — diagnosis case

**Dependencies:** Task 4

---

### Task 9: A surviving rejection reruns instead of burning a kickback
**Story:** 3
**Type:** negative-path

**Steps:**
1. Confirm the repair turn added by #1605 carries the Task 8 diagnosis unchanged.
2. Ensure a rejection surviving repair classifies so build_review reruns rather than routing rework,
   per `adr-2026-07-13-retry-classify-rerun-vs-route`'s existing build_review mapping.
3. Add a test asserting no kickback budget is consumed and no cumulative counter advances on a
   surviving vocabulary rejection.
4. Add a test asserting no rubric's set contains an `other`-style catch-all member.
5. Commit: "fix(build-review): a vocabulary rejection reruns and never burns a lap".

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — rejection settlement classification
- `src/conductor/test/engine/step-runners.test.ts` — no-budget-consumed case

**Dependencies:** Task 8

---

### Task 10: Pin that narrowness survives — different concerns keep different ids
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add a per-rubric test asserting two findings sharing a subject reference but differing in
   classification member canonicalize to distinct identities and both stay blocking.
2. Add a test asserting two different missing surfaces under one completeness plan task do not
   collapse.
3. Add a test asserting a reclassified concern yields a new identity.
4. Commit: "test(build-review): accepted risk never widens past one identity".

**Files likely touched:**
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — narrowness cases

**Dependencies:** Task 5

---

### Task 11: Enumerate the build_review FAIL block's exits by grep
**Story:** 4
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Grep the daemon `build_review` raw-FAIL branch in `conductor.ts` for every `return`, `continue`,
   `writeHaltMarker`, and budget-consuming call between the branch open and its close.
2. Record the derived exit list in the commit message and compare it with the six named in the ADR;
   any additional exit is in scope for Task 13.
3. Commit an empty commit carrying `Evidence: skipped establishes findings only`.

**Files likely touched:**
- none

**Dependencies:** none

---

### Task 12: RED — a remediate refusal must not halt over accepted findings
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test reproducing 2026-08-15 23:40: a raw FAIL whose findings are all
   operator-accepted, with the `/remediate` planner returning a refusal.
2. Assert the run re-lands build_review rather than writing a needs-human HALT.
3. Verify RED.
4. Commit: "test(conductor): remediate refusal must consult dispositions before halting".

**Files likely touched:**
- `src/conductor/test/engine/build-review-disposition-race.test.ts` — refusal-path case

**Dependencies:** Task 11

---

### Task 13: GREEN — one pure predicate consulted at every FAIL-block exit
**Story:** 4
**Type:** happy-path

**Steps:**
1. Extract the effective-verdict resolution into one pure predicate, following
   `adr-2026-07-27`'s "extract one pure predicate and consult it at both seams".
2. Consult it adjacent to each exit derived in Task 11, replacing #1605's single guard placement
   without reordering any cap or escalation check.
3. Keep the existing fail-open behavior: a resolver failure or legacy scalar verdict proceeds on the
   raw aggregate.
4. Verify Task 12 passes.
5. Commit: "fix(conductor): every build_review FAIL exit decides on the effective verdict".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — FAIL-block exits

**Dependencies:** Task 12

---

### Task 14: Pin ordering, HALT distinctness, and unchanged behavior for unresolved findings
**Story:** 4
**Type:** negative-path

**Steps:**
1. Add a test asserting a run that trips a cap still reports the cap's reason unmasked, per
   `adr-2026-07-27`.
2. Add a test asserting each of the block's HALT reasons stays distinct and carries its class.
3. Add a test asserting a raw FAIL with any unresolved finding routes, halts, and counts exactly as
   it does today.
4. Add a test that fails when a new uncovered exit is added to the block.
5. Commit: "test(conductor): FAIL-block ordering and halt classes survive the predicate".

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts` — ordering and halt-class cases

**Dependencies:** Task 13

---

### Task 15: Report a disposition that cannot bind
**Story:** 5
**Type:** happy-path

**Steps:**
1. Add the version-invalidated disposition variant to the `ConductorEvent` union beside
   `build_review_disposition_accepted`.
2. Declare it in `EVENT_SINKS` with `audit: true`, per
   `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`.
3. Emit it when a stored record's contract version cannot bind, and assert it does not resurrect the
   record.
4. Commit: "feat(build-review): a non-binding disposition is reported, never silently dropped".

**Files likely touched:**
- `src/conductor/src/types/events.ts` — event variant
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/src/engine/build-review-effective.ts` — emission site

**Dependencies:** Task 6

---

### Task 16: Name the matched disposition in the findings output
**Story:** 5
**Type:** happy-path

**Steps:**
1. Extend the `build-review findings` human and JSON output so each accepted finding names the
   disposition record that matched it, derived from the records already listed.
2. Add a test asserting the matched disposition appears in both output formats.
3. Commit: "feat(build-review): findings output names the matched disposition".

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — `renderHuman` and the JSON payload
- `src/conductor/test/engine/build-review-cli.test.ts` — output case

**Dependencies:** Task 15

---

### Task 17: Enumerate the vocabularies in the four rubric skill contracts
**Story:** 6
**Type:** happy-path

**Steps:**
1. Replace "an enumerated concern kind" in each of the four `skills/build-review-*/SKILL.md` result
   contracts with that rubric's actual members, and enumerate its classification anchor members.
2. Keep the contracts provider-neutral — no host-specific invocation phrasing.
3. Commit: "docs(skills): rubric contracts enumerate their finding vocabularies".

**Files likely touched:**
- `skills/build-review-scope/SKILL.md` — result contract
- `skills/build-review-tautology/SKILL.md` — result contract
- `skills/build-review-root-cause/SKILL.md` — result contract
- `skills/build-review-completeness/SKILL.md` — result contract

**Dependencies:** Task 3

---

### Task 18: Bind the skill contracts to the engine source, and update the docs
**Story:** 6
**Type:** happy-path

**Steps:**
1. Add an integrity check asserting each rubric SKILL.md's enumerated members equal the engine set in
   both directions, and register it in `test/test_harness_integrity.sh`'s enumeration and in
   `docs/contributing/validation.md`.
2. Update `docs/explanation/gates.md:312-317` to state the closed vocabularies, the rerun-on-rejection
   behavior, and that every FAIL-block exit consults the disposition store.
3. Extend `src/conductor/test/engine/build-review-rubric-skills.test.ts` to pin the enumerations.
4. Commit: "test(harness): rubric vocabularies cannot drift from their contracts".

**Files likely touched:**
- `test/test_harness_integrity.sh` — new check
- `docs/contributing/validation.md` — check enumeration
- `docs/explanation/gates.md` — disposition and vocabulary contract
- `src/conductor/test/engine/build-review-rubric-skills.test.ts` — contract pins

**Dependencies:** Task 17

---

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 3 ──┬──> Task 4 ──┬──> Task 5 ──┬──> Task 6 ──┬──> Task 15 ──> Task 16
                               │             │             │             │
                               │             └──> Task 8 ──┴──> Task 9   │
                               │                                         │
                               ├──> Task 7                               │
                               │                                         │
                               └──> Task 17 ──> Task 18                  │
                                                                         │
                                             Task 5 ──> Task 10          │
                                                                         │
Task 11 ──> Task 12 ──> Task 13 ──> Task 14 ─────────────────────────────┘
```

Tasks 1 and 11 are independent and may run in either order. Task 7 and Task 17 need only the
vocabulary source from Task 3. Tasks 10, 14, and 16 are the pins for their respective surfaces and are
independent of one another.

## Integration Points

- **After Task 5** — a re-worded finding keeps its identity; #1611's first surface is closed.
- **After Task 9** — the closure is armed safely; a grader that misses the vocabulary costs a rerun,
  not a parked build.
- **After Task 13** — every FAIL-block exit decides on the effective verdict; #1611's second surface
  is closed.
- **After Task 18** — the vocabulary cannot drift back apart from its four contracts.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] No new provider dispatch and no new durable store introduced
### Task rem-tautology-1: src/conductor/test/engine/build-review-disposition-race.test.ts:239 — replace the source-reading and token-count assertions with bounded Conductor behavioral cases for scope-FAIL halt, kickback-to-build no-op, cumulative cap, completeness needs-human, and per-gate unresolved halt; install an effective-PASS resolver in each case and assert build_review re-entry with no terminal HALT or rework routing
### Task rem-rootcause-1: src/conductor/test/engine/build-review-finding-identity.test.ts:90 — add RED cases proving grader rephrasing or formatting of changedTest, locus, planTask, and missingSurface cannot mint a new identity, while distinct canonical snapshot references still produce distinct identities
### Task rem-rootcause-2: src/conductor/src/engine/build-review-domain.ts:162 and src/conductor/src/engine/build-review-finding-identity.ts:80 — replace arbitrary non-empty identity subjects with mechanically validated canonical references from the immutable build-review projection, and hash only the parser-produced canonical reference tokens
### Task rem-rootcause-3: src/conductor/test/engine/build-review-domain.test.ts:36 — add RED parser cases for each rubric proving only its contract-defined concernKind-to-anchor-classification pairing is accepted, including rejection of scope concernKind=not-authorized-by-plan with relation=out-of-plan-change
### Task rem-rootcause-4: src/conductor/src/engine/build-review-domain.ts:85 and src/conductor/src/engine/build-review-finding-identity.ts:120 — replace the shared rubric-wide member set with role-specific concernKind and anchor-field vocabularies, validating or deriving violationKind, relation, and missingKind so one semantic concern has one canonical classification payload
### Task rem-completeness-1: skills/build-review-completeness/SKILL.md:102 — document the final engine completeness anchor with required missingSurface and the role-specific missingKind rule from the classification repair; update src/conductor/test/engine/build-review-rubric-skills.test.ts:1 to bind the anchor fields as well as the vocabulary
### Task rem-completeness-2: src/conductor/test/engine/step-runners.test.ts:3572 — read the kickback ledger around the surviving-rejection case and assert the build_review count and cumulative value remain zero after the failed run
### Task rem-tautology-2: src/conductor/test/engine/build-review-finding-identity.test.ts:13,110,114 — replace optional vocabulary access with the required BUILD_REVIEW_FINDING_VOCABULARIES export via normalizedVocabularyMembers, assert the normalized member count is non-zero, and retain the per-set collision assertions so missing baseline production fails RED
### Task rem-tautology-3: src/conductor/test/engine/build-review-finding-identity.test.ts:159,168,177 — change the malformed canonical-reference rejection fixtures to contractVersion v1 so each assertion fails specifically on its padded, backticked, or prose-wrapped subject reference under merge-base production
### Task rem-rootcause-5: src/conductor/src/engine/build-review-domain.ts:2,217,224 — build CANONICAL_PLAN_TASK_REFERENCE from plan-task-parse.ts TASK_ID_PATTERN instead of the numeric-only regex so rem-rootcause-1, T0, and 8.1 can form canonical identities while formatted or prose references remain rejected
### Task rem-rootcause-6: src/conductor/test/engine/build-review-finding-identity.test.ts:159 — add regression cases proving rem-rootcause-1, T0, and 8.1 planTask subjects receive stable identities and malformed task references remain rejected
### Task rem-rootcause-7: src/conductor/src/engine/build-review-domain.ts:43-51 — populate tautology changedTests from projection.changedTestSelectors rather than reclassifying projection.changedFiles with the test-directory/.test.* heuristic
### Task rem-rootcause-8: src/conductor/test/engine/build-review-domain.test.ts:1 — add reference-context and parser regressions proving projected changedTestSelectors using *.spec.ts and spec/* are accepted while paths absent from the immutable projection remain invalid
### Task rem-completeness-3: skills/build-review-scope/SKILL.md:44,47, skills/build-review-tautology/SKILL.md:71,74, skills/build-review-root-cause/SKILL.md:38,41, and skills/build-review-completeness/SKILL.md:91,94 — update every Result contract heading and instruction from contract version v1 to v2
### Task rem-completeness-4: src/conductor/test/engine/build-review-rubric-skills.test.ts:70,113 — change all four rubric-skill contract pins from v1 to v2 so the provider-facing contracts remain bound to the engine-required version
