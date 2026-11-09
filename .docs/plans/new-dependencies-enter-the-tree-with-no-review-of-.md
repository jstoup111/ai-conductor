# Implementation Plan: New dependencies enter the tree with no review of necessity, pinning, or license

**Date:** 2026-11-07
**Design:** .docs/decisions/architecture-review-2026-11-07-new-dependencies-enter-the-tree-with-no-review-of-.md
**Stories:** .docs/stories/new-dependencies-enter-the-tree-with-no-review-of-.md
**Conflict check:** Clean as of 2026-11-07 (.docs/conflicts/2026-11-07-new-dependencies-enter-the-tree-with-no-review-of-.md)

## Summary

This plan adds an optional `paths` glob trigger to `build_review.custom_rubrics` declarations, so a custom
member is withheld from a lap at zero judgement cost when the feature diff touches none of its paths. It
ships the `build-review-dependency-hygiene` review policy and declares it in this repository, in 11 tasks.

## Technical Approach

- **Configuration (Tasks 1–2).**
  - `config.ts` adds `paths` to the `build_review.custom_rubrics` allowed-key table. It is validated as an
    optional non-empty array of non-empty strings, and errors name the full key path and the offending index.
  - `types/config.ts` adds `paths?: string[]` to `BuildReviewCustomRubricConfig`.
  - `resolved-config.ts` carries it onto `ResolvedBuildReviewCustomCatalogEntry` as optional
    `paths: readonly string[]`, in declared order. Absent means the member always participates.
  - Built-in `build_review.rubrics.*` blocks keep rejecting `paths` through their existing unknown-key path.
- **Participation resolver (Task 3).** A pure exported function `resolveBuildReviewLapParticipation(catalog,
  changedFiles)` in `build-review-inputs.ts` returns `{ participating, withheld }`.
  - An entry is withheld only when it is `kind: 'custom'`, declares `paths`, and no changed file's `path` or
    `previousPath` satisfies any glob under `matchesGlob` from `node:path`.
  - `matchesGlob` is already used in production by `self-host/transcript-harvest.ts`. Verified: `**/package.json`
    matches both `package.json` and `src/conductor/package.json`, while `package.json` matches only the root.
  - Built-in entries and path-less custom entries always participate.
- **One participation decision per lap, before materialization (Task 4).** This is Condition 1 of the
  architecture review and `adr-2026-09-10-portable-build-review-policy` D1 (one effective catalog per lap,
  passed explicitly).
  - Today the step runner derives the materialization `lapMembers` from the whole configured catalog before
    `assembleBuildReviewInputs` runs, so a declared custom member always forces a frozen source view.
  - Instead, the step runner passes the resolved catalog into `assembleBuildReviewInputs`. After the snapshot
    diff is computed, it calls the resolver on `deriveChangedFileReferences(diff)` and passes only
    participating members to `materializeBuildReviewLap` (which already returns `undefined` when no member is
    custom). It returns the participation on the frozen inputs.
  - The step runner then derives `customEntries`, `customPolicyLap`, lap-gate members, the custom dispatch
    plan, and `currentCustomRubrics` from `participating` only. For each withheld id it emits
    `{ type: 'build_review_rubric_skipped', rubric, lapId, reason: 'paths-unmatched' }` through `this.events`.
  - Because installation discovery, policy capture, and cache lookup all happen per participating member
    inside candidate preparation, a withheld member reaches none of them.
- **Identity neutrality (Task 6).** The custom declaration identity is built field by field in
  `step-runners.ts` (`version`, `rubricId`, `semanticSkill`, `question`, `source`, `resources`), and
  `fingerprintBuildReviewRubricPolicy` reads only execution-policy fields. Leaving `paths` out of both keeps
  existing caches and dispositions valid. Task 6 pins that with tests.
- **Withheld equals absent (Task 7).** A withheld member is absent from the lap's `currentCustomRubrics`, so
  the aggregate and adjudication coordinator read it like a member absent from the current catalog
  (`adr-2026-09-10-portable-build-review-policy` D7). Task 7 proves an earlier-lap blocking finding no longer
  blocks or halts. It also proves a later matching lap judges afresh. If the coordinator still reads a
  stale case for an absent member, Task 7 fixes that in `build-review-adjudication-coordinator.ts`.
- **Policy skill (Tasks 8–9).** `skills/build-review-dependency-hygiene/SKILL.md` is a provider-neutral review
  policy.
  - It covers the concern ids `necessity`, `pinning`, and `license` with their severities, non-findings, and a
    recommended `paths` set for each listed ecosystem.
  - It carries no result-contract prose: the engine owns the contract (`adr-2026-09-10-portable-build-review-policy`
    D3/D4, and the provider-contract audit).
  - Per D3 the engine sends its exact text to the reviewer, so the reviewer's criteria are the skill's stated
    criteria. Tasks 8–9 pin those statements with a content test.
  - `agents/openai.yaml` sets `allow_implicit_invocation: false` like the other `build-review-*` skills.
    `bin/install`'s existing `skills/*/` loop links it.
- **Repository declaration (Tasks 10–11).** `.ai-conductor/config.yml` declares `dependencyHygiene` with
  `enabled: true`, `skill: build-review-dependency-hygiene`, `source: global`, `min_severity: minor`, and
  `paths` for `**/package.json` and `**/package-lock.json`. The existing `eventSpine` declaration is
  untouched. This feature's own diff touches no `package.json`, so its own build_review withholds the new
  member before any installation lookup.

## Prerequisites

- None. Node `>=26.0.0` (`src/conductor/package.json`) provides `node:path` `matchesGlob`.

## Tasks

### Task 1: Custom rubric declarations accept and resolve `paths`
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests: a declaration with `paths: ["**/package.json", "**/package-lock.json"]` resolves to an entry carrying exactly those globs in order; a declaration without `paths` resolves to an entry with no `paths` property.
2. Verify both fail (RED).
3. Implement: add `paths` to the `build_review.custom_rubrics` allowed-key table in `config.ts`, type it in `types/config.ts`, copy it in declared order onto `ResolvedBuildReviewCustomCatalogEntry` in `resolved-config.ts`, and register `build_review.custom_rubrics.paths` in the test config-consumer registry.
4. Verify GREEN.
5. Commit: "Accept a paths trigger on custom build_review rubrics".

**Done when:**
- [test] A resolved-config test loads a declaration with `paths: ["**/package.json", "**/package-lock.json"]` and asserts `resolveBuildReviewConfig` yields a custom catalog entry whose `paths` equals `["**/package.json", "**/package-lock.json"]` in that order.
- [test] A resolved-config test loads a declaration with no `paths` key and asserts the resolved custom catalog entry has no `paths` property.
- [test] The config-consumer registry test passes with `build_review.custom_rubrics.paths` registered to the resolved-config consumer and `paths` listed in the `build_review.custom_rubrics` allowed-key table of `config.ts`.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — allowed key
- `src/conductor/src/types/config.ts` — `paths?: string[]`
- `src/conductor/src/engine/resolved-config.ts` — carry `paths` onto the entry
- `src/conductor/test/engine/resolved-config.test.ts` — resolution tests
- `src/conductor/test/engine/config-consumer-registry.ts` — key registration

**Dependencies:** none

### Task 2: Malformed `paths` declarations are rejected at load
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests for `paths: []`, an empty-string element, a non-string element, a string value, and `build_review.rubrics.security.paths`.
2. Verify RED for the custom cases.
3. Implement validation in `validateBuildReviewCustomRubrics` (`config.ts`).
4. Verify GREEN.
5. Commit: "Reject malformed custom rubric paths".

**Done when:**
- [test] `loadConfig` with a custom declaration `paths: []` returns a validation error whose message contains `build_review.custom_rubrics.<id>.paths` and `non-empty array`.
- [test] `loadConfig` with `paths: ["**/x", ""]` and, separately, `paths: ["**/x", 3]` returns a validation error whose message contains `build_review.custom_rubrics.<id>.paths` and the element index `1`.
- [test] `loadConfig` with `paths: "**/package.json"` returns a not-ok result whose validation error names `build_review.custom_rubrics.<id>.paths`, so no custom catalog is produced.
- [test] `loadConfig` with `build_review.rubrics.security.paths` returns the existing validation error `Unknown key in build_review.rubrics.security: "paths"`.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — `paths` validation
- `src/conductor/test/config-validation.test.ts` — rejection tests

**Dependencies:** Task 1

### Task 3: Pure lap participation resolver
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests for `resolveBuildReviewLapParticipation(catalog, changedFiles)` covering unmatched, modified, renamed (previous path), deleted, root-only glob, path-less custom, and built-in entries.
2. Verify RED.
3. Implement in `build-review-inputs.ts` using `matchesGlob` from `node:path` over each changed file's `path` and `previousPath`; return `{ participating, withheld }` preserving catalog order.
4. Verify GREEN.
5. Commit: "Resolve custom rubric lap participation from changed paths".

**Done when:**
- [test] Given a custom entry with `paths: ["**/package.json"]` and changed files `src/a.ts` and `test/a.test.ts`, `resolveBuildReviewLapParticipation` returns the entry id in `withheld` and omits the entry from `participating`.
- [test] The resolver returns the entry in `participating` for a modified `src/conductor/package.json`, for a rename from `old/package.json` to `new/manifest.json` under `paths: ["old/package.json"]`, and for a deleted `tools/package.json` under `paths: ["**/package.json"]`.
- [test] The resolver withholds an entry with `paths: ["package.json"]` when the only changed file is `src/conductor/package.json`.
- [test] The resolver returns every built-in entry and every custom entry without `paths` in `participating` for any changed-file set, including an empty one, so a path-less member participates in every lap.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — `resolveBuildReviewLapParticipation`
- `src/conductor/test/engine/build-review-participation.test.ts` — resolver tests

**Dependencies:** Task 1

### Task 4: Withhold unmatched members before materialization and dispatch
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing build_review step tests, with a mocked provider boundary that the production adapter is proven to reach, for: an unmatched member; a matched member; a feature whose intermediate commit changed and later restored `package.json`; and all built-ins disabled with the only custom member withheld.
2. Verify RED against the current runner, which materializes and dispatches every enabled custom member.
3. Implement: the step runner passes the resolved catalog to `assembleBuildReviewInputs`. After the snapshot diff, that function calls `resolveBuildReviewLapParticipation` on `deriveChangedFileReferences(diff)`, materializes only participating members, and returns the participation. The step runner derives `customEntries`, `customPolicyLap`, lap-gate members, the dispatch plan, and `currentCustomRubrics` from `participating`, and emits one `build_review_rubric_skipped` event with reason `paths-unmatched` per withheld id.
4. Verify GREEN.
5. Commit: "Withhold path-unmatched custom rubrics before any custom-lap work".

**Done when:**
- [test] A build_review step test with an enabled custom member `paths: ["**/package.json"]` and a diff changing only `src/a.ts` and `test/a.test.ts` asserts the provider invoke mock is never called for the member and the emitted events contain exactly one `{ type: 'build_review_rubric_skipped', rubric: '<id>', reason: 'paths-unmatched' }` for that lap.
- [test] With built-in rubrics enabled and that member as the only enabled custom member, the withheld-member test asserts every enabled built-in rubric is dispatched and the lap settles a published aggregate, while `materializeBuildReviewLap` creates no frozen custom source view, no `BuildReviewLapGate` begins, no `input-digest.json` is written under the lap evidence root, and the aggregate's `currentCustomRubrics` omits the member.
- [test] A build_review step test with the same member and a diff modifying `src/conductor/package.json` asserts the member is dispatched through the custom review invocation exactly as an enabled custom member without `paths` is.
- [test] A build_review step test whose intermediate commit changes `package.json` and whose later commit restores it asserts the member is withheld with the `paths-unmatched` event, because participation reads the snapshot's merge-base-to-head diff.
- [test] A build_review step test with every built-in rubric disabled and the only custom member withheld asserts the step reports the existing `build_review_no_rubrics` pass, emits the `paths-unmatched` skip event, and invokes no reviewer.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — call the resolver before materialization; return participation
- `src/conductor/src/engine/step-runners.ts` — supply the catalog; derive custom-lap members from `participating`; emit skip events
- `src/conductor/test/engine/build-review-step.test.ts` — step-level withholding tests

**Dependencies:** Task 3

### Task 5: Withheld members never reach policy resolution; matched members keep failing on an absent policy
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing step tests: an uninstalled path-triggered member with an unmatched diff; the same member with a matching diff; rename and deletion matches at step level; a root-only glob against a nested manifest.
2. Verify RED.
3. Implement any residual wiring needed so installation discovery is reached only for participating members.
4. Verify GREEN.
5. Commit: "Prove withheld custom rubrics skip policy resolution".

**Done when:**
- [test] A build_review step test with an enabled path-triggered member whose skill is installed for no provider candidate and a diff matching none of its paths asserts the step settles with no infrastructure failure for that member, the installed-policy discovery mock is never called, and the policy-bundle capture mock is never called for that member.
- [test] A build_review step test with the same uninstalled member and a diff modifying `package.json` asserts the member settles the existing infrastructure failure with resolution code `absent` naming its skill and the build_review step does not succeed.
- [test] A build_review step test dispatches the member for a rename diff from `old/package.json` to `new/manifest.json` under `paths: ["old/package.json"]`, and for a diff deleting `tools/package.json` under `paths: ["**/package.json"]`.
- [test] A build_review step test with `paths: ["package.json"]` and a diff changing only `src/conductor/package.json` withholds the member with exactly one `paths-unmatched` skip event and no provider invocation.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — residual wiring, if any
- `src/conductor/test/engine/build-review-step.test.ts` — negative-path step tests

**Dependencies:** Task 4

### Task 6: `paths` never changes judgement identity
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write tests: identity and policy fingerprint with and without `paths`; a two-lap cache-reuse step test; a question-change step test.
2. Verify RED where the cache-reuse expectations are not yet exercised with `paths`.
3. Implement nothing beyond Task 1 unless a test shows `paths` leaking into identity; if it does, remove it from the identity or fingerprint input.
4. Verify GREEN.
5. Commit: "Pin paths out of custom rubric identity".

**Done when:**
- [test] A test asserts the canonical custom declaration identity built for one entry and its `fingerprintBuildReviewRubricPolicy` result are byte-identical (`toBe` on the serialized strings) with and without `paths: ["**/package.json"]`.
- [test] A two-lap build_review step test on the same frozen input, with lap 1 declaring no `paths` and lap 2 adding matching `paths`, asserts lap 2 emits `build_review_cache_hit` for the member and invokes no provider for it.
- [test] The same two-lap test with lap 2 changing only the member's `question` asserts the declaration identity differs from lap 1's and the provider is invoked again with no `build_review_cache_hit` for the member.

**Files likely touched:**
- `src/conductor/test/engine/build-review-cache.test.ts` — identity and fingerprint tests
- `src/conductor/test/engine/build-review-step.test.ts` — cache-reuse step tests

**Dependencies:** Task 4

### Task 7: A withheld member's earlier findings stop gating; a later match judges afresh
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing multi-lap convergence test: lap 1 blocking finding from the member against `package.json`; lap 2 diff no longer changes it; lap 3 changes it again.
2. Verify RED (or GREEN-on-arrival, recorded).
3. Implement: if the adjudication coordinator or aggregate still treats the absent member's lap 1 case as unresolved, restrict it to `currentCustomRubrics`.
4. Verify GREEN.
5. Commit: "Settle withheld custom rubrics as absent members".

**Done when:**
- [test] A multi-lap build_review test where lap 1 dispatches the member and it returns a blocking finding against `package.json`, and lap 2 runs on a diff that no longer changes `package.json`, asserts lap 2's effective verdict has no unresolved finding sourced from the member, the step result is PASS, and no `.pipeline/HALT` is written.
- [test] A lap 3 on a diff changing `package.json` again asserts the member's provider is invoked, no `build_review_cache_hit` reuses a withheld lap for it, and lap 3's judged result alone decides the member's verdict.

**Files likely touched:**
- `src/conductor/test/engine/build-review-custom-convergence.test.ts` — multi-lap test
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — scope stale cases to current members, if needed

**Dependencies:** Task 4

### Task 8: Ship the dependency-hygiene review policy
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing content test over `skills/build-review-dependency-hygiene/SKILL.md` and a failing discovery test resolving it as a `global` policy.
2. Verify RED.
3. Author the skill: frontmatter `name: build-review-dependency-hygiene`, a provider-neutral description, concern ids `necessity`, `pinning`, `license` with their severities and evidence requirements, and the recommended `paths` set; add `agents/openai.yaml` with `allow_implicit_invocation: false`.
4. Verify GREEN.
5. Commit: "Ship the dependency-hygiene build_review policy".

**Done when:**
- [test] A content test asserts `SKILL.md` has frontmatter `name: build-review-dependency-hygiene` and defines concern ids `necessity`, `pinning`, and `license`, stating severity `major` or higher for necessity, pinning, and incompatible-license findings and severity `nit` for an unverifiable license.
- [test] The content test asserts the necessity criterion applies when the added dependency's purpose is already served by an existing declared dependency or an existing in-repo module and requires naming the added dependency and the existing equivalent's path; the pinning criterion names `*`, `latest`, unbounded `>=`, and a manifest change without a committed lockfile update and requires naming the dependency and manifest location.
- [test] The content test asserts the license criterion compares on-disk dependency license metadata with the project's declared license, requires naming both licenses and the evidence location, and directs an unverifiable license to a `nit` stating it is unverifiable.
- [test] The content test asserts the recommended `paths` set lists manifest and lockfile globs for npm, Yarn, pnpm, Bundler, pip, Poetry, uv, Go modules, Cargo, Maven, and Gradle.
- [test] A discovery test with a Claude candidate whose user skill root links `build-review-dependency-hygiene` asserts `resolveInstalledReviewPolicy({ skill: 'build-review-dependency-hygiene', source: 'global' }, policies)` resolves exactly one installation.

**Files likely touched:**
- `skills/build-review-dependency-hygiene/SKILL.md` — the review policy
- `skills/build-review-dependency-hygiene/agents/openai.yaml` — Codex metadata
- `src/conductor/test/engine/dependency-hygiene-policy.test.ts` — content and discovery tests

**Dependencies:** none

### Task 9: Non-findings and the provider-contract audit cover the policy
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing content assertions for the non-finding cases and the out-of-vocabulary claims; add the skill to the audit loop.
2. Verify RED.
3. Add the non-finding section to `SKILL.md`; add `build-review-dependency-hygiene` to the build_review loop in `test/test_provider_skill_contracts.sh`.
4. Verify GREEN.
5. Commit: "Bound dependency-hygiene non-findings and audit its prose".

**Done when:**
- [test] The content test asserts `SKILL.md`'s non-finding section states no finding for an addition with no existing equivalent, a bounded specifier, a matching committed lockfile update, and a compatible license, and no finding for a lockfile change limited to integrity or resolution metadata.
- [test] The content test asserts `SKILL.md` states no pinning finding for a library manifest's caret range on a peer or runtime dependency when that ecosystem's library convention requires no lockfile change.
- [test] The content test asserts `SKILL.md` states vulnerability, CVE, and maintenance-activity claims are outside its vocabulary and are never reported.
- `test/test_provider_skill_contracts.sh` includes `build-review-dependency-hygiene` in its build_review forbidden-pattern loop, passes on the shipped `SKILL.md`, and applies the same check whose existing result-contract-heading, fenced-findings, and payload-sentence fixtures fail naming the offending file.

**Files likely touched:**
- `skills/build-review-dependency-hygiene/SKILL.md` — non-finding section
- `test/test_provider_skill_contracts.sh` — audit loop
- `src/conductor/test/engine/dependency-hygiene-policy.test.ts` — non-finding assertions

**Dependencies:** Task 8

### Task 10: This repository declares the dependencyHygiene rubric
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing repository-config test and a failing step test using the repository catalog with a `src/conductor/package.json` diff.
2. Verify RED.
3. Add the `dependencyHygiene` declaration to `.ai-conductor/config.yml`.
4. Verify GREEN.
5. Commit: "Review this repository's dependency changes".

**Done when:**
- [test] A test resolving `.ai-conductor/config.yml` through `loadConfig` and `resolveBuildReviewConfig` asserts member `dependencyHygiene` is enabled with skill `build-review-dependency-hygiene`, source `global`, policy `min_severity` `minor`, and `paths` including `**/package.json` and `**/package-lock.json`, and that `eventSpine` still resolves enabled with skill `event-spine` and source `project`.
- [test] A build_review step test using the repository-resolved catalog and a diff modifying `src/conductor/package.json` asserts `dependencyHygiene` is dispatched and its unresolved finding appears in `projectBuildReviewAggregateSources` output alongside the built-in rubrics' sources.

**Files likely touched:**
- `.ai-conductor/config.yml` — `dependencyHygiene` declaration
- `src/conductor/test/engine/dependency-hygiene-rubric-config.test.ts` — repository declaration tests

**Dependencies:** Tasks 1, 4, 8

### Task 11: The repository declaration is free on dependency-free diffs and keeps unverifiable licenses advisory
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a repository-catalog step test with a dependency-free diff; an effective-verdict test with a `nit` dependencyHygiene finding.
2. Verify RED.
3. Implement nothing new unless a test fails; fix the declaration if it does.
4. Verify GREEN.
5. Commit: "Prove the dependencyHygiene declaration's free and advisory paths".

**Done when:**
- [test] A build_review step test using the repository-resolved catalog and a diff changing only `src/conductor/src/engine/config.ts` asserts `dependencyHygiene` emits exactly one `paths-unmatched` skip event and no provider is invoked for it.
- [test] An effective-verdict test using the repository-resolved thresholds and one `dependencyHygiene` finding at severity `nit` asserts the finding is in the advisory set, the unresolved set is empty, and the effective verdict is PASS.

**Files likely touched:**
- `src/conductor/test/engine/dependency-hygiene-rubric-config.test.ts` — negative-path tests

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        ├─ Task 3 ── Task 4 ─┬─ Task 5
        │                    ├─ Task 6
        │                    ├─ Task 7
        │                    └─ Task 10 ── Task 11
Task 8 ── Task 9
Task 8 ─────────────────────── Task 10
```

## Integration Points

- After Task 4: a build_review lap observably withholds a path-unmatched custom member (skip event, no frozen view, no dispatch).
- After Task 10: this repository's own build_review dispatches `dependencyHygiene` on manifest changes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a `build_review.custom_rubrics.<id>` declaration with `paths: ["**/package.json", "**/package-lock.json"]`, when the configuration is loaded and resolved, then the resolved custom catalog entry for `<id>` carries exactly those two globs in declared order | 1 | "yields a custom catalog entry whose `paths` equals" | diff-local |
| Story 1 happy: Given a `build_review.custom_rubrics.<id>` declaration with no `paths` key, when the configuration is loaded and resolved, then the resolved entry carries no paths trigger and the member participates in every lap exactly as it did before this change | 1, 3 | "asserts the resolved custom catalog entry has no `paths` property" | diff-local |
| Story 1 negative: Given a declaration with `paths: []`, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and stating it must be a non-empty array | 2 | "returns a validation error whose message contains `build_review.custom_rubrics.<id>.paths` and `non-empty array`" | diff-local |
| Story 1 negative: Given a declaration whose `paths` contains an empty string or a non-string element, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and the offending element index | 2 | "returns a validation error whose message contains `build_review.custom_rubrics.<id>.paths` and the element index `1`" | diff-local |
| Story 1 negative: Given a declaration whose `paths` is a string rather than an array, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and no custom catalog is produced | 2 | "returns a not-ok result whose validation error names `build_review.custom_rubrics.<id>.paths`, so no custom catalog is produced" | diff-local |
| Story 1 negative: Given a built-in rubric block `build_review.rubrics.security` that sets `paths`, when the configuration is loaded, then loading rejects `paths` as an unknown key for that built-in rubric, as it rejects any other unknown built-in key | 2 | "returns the existing validation error" | diff-local |
| Story 2 happy: Given an enabled custom member with `paths: ["**/package.json"]` and a feature diff whose changed files are only `src/a.ts` and `test/a.test.ts`, when a build_review lap runs, then the member is withheld, exactly one `build_review_rubric_skipped` event is emitted for it with reason `paths-unmatched`, and no provider is invoked for it | 4 | "asserts the provider invoke mock is never called for the member and the emitted events contain exactly one `{ type: 'build_review_rubric_skipped', rubric: '<id>', reason: 'paths-unmatched' }` for that lap" | diff-local |
| Story 2 happy: Given the only enabled custom member is withheld and built-in rubrics are enabled, when the lap runs, then the lap runs as a built-in-only lap with no frozen custom source view, no custom lap gate, no custom input digest, and no custom member in its settlement | 4 | "asserts every enabled built-in rubric is dispatched and the lap settles a published aggregate, while `materializeBuildReviewLap` creates no frozen custom source view, no `BuildReviewLapGate` begins, no `input-digest.json` is written under the lap evidence root, and the aggregate's `currentCustomRubrics` omits the member" | diff-local |
| Story 2 happy: Given an enabled custom member with `paths: ["**/package.json"]` and a feature diff that modifies `src/conductor/package.json`, when a build_review lap runs, then the member participates and is dispatched like any other enabled custom member | 4 | "asserts the member is dispatched through the custom review invocation exactly as an enabled custom member without `paths` is" | diff-local |
| Story 2 happy: Given a feature diff that renames `package.json` from `old/package.json` to `new/manifest.json`, when a lap runs for a member with `paths: ["old/package.json"]`, then the member participates because the renamed file's previous path matches | 5, 3 | "dispatches the member for a rename diff from `old/package.json` to `new/manifest.json`" | diff-local |
| Story 2 happy: Given a feature diff that deletes `tools/package.json`, when a lap runs for a member with `paths: ["**/package.json"]`, then the member participates because the deleted path matches | 5, 3 | "for a diff deleting `tools/package.json`" | diff-local |
| Story 2 negative: Given an enabled path-triggered member whose skill is not installed for any provider candidate and a feature diff that matches none of its paths, when the lap runs, then the build_review step settles without an infrastructure failure for that member and no installation discovery or policy capture is attempted for it | 5 | "asserts the step settles with no infrastructure failure for that member, the installed-policy discovery mock is never called, and the policy-bundle capture mock is never called for that member" | diff-local |
| Story 2 negative: Given the same uninstalled path-triggered member and a feature diff that does match one of its paths, when the lap runs, then the member settles the existing infrastructure failure with resolution code `absent` naming its skill and the build_review step does not succeed | 5 | "asserts the member settles the existing infrastructure failure with resolution code `absent` naming its skill and the build_review step does not succeed" | diff-local |
| Story 2 negative: Given a lap in which the feature's earlier commits changed `package.json` and a later commit restored it so the merge-base-to-head diff no longer changes it, when the lap runs for a member with `paths: ["**/package.json"]`, then the member is withheld because matching uses the whole-feature diff, not individual commits | 4 | "asserts the member is withheld with the `paths-unmatched` event, because participation reads the snapshot's merge-base-to-head diff" | diff-local |
| Story 2 negative: Given a member with `paths: ["package.json"]` and a diff that changes only `src/conductor/package.json`, when the lap runs, then the member is withheld because a glob without a directory wildcard matches only the repository-root path | 5, 3 | "withholds the member with exactly one `paths-unmatched` skip event and no provider invocation" | diff-local |
| Story 2 negative: Given all built-in rubrics disabled and the only enabled custom member withheld, when the lap runs, then build_review reports its existing no-rubrics pass and emits the `paths-unmatched` skip event, rather than failing or dispatching any reviewer | 4 | "asserts the step reports the existing `build_review_no_rubrics` pass, emits the `paths-unmatched` skip event, and invokes no reviewer" | diff-local |
| Story 3 happy: Given a custom member judged on lap 1 without `paths`, when `paths` matching the diff is added to its declaration and lap 2 runs on the same frozen input, then the member's declaration identity and policy fingerprint are unchanged and its lap 1 judged result is reused as a cache hit | 6 | "asserts lap 2 emits `build_review_cache_hit` for the member and invokes no provider for it" | diff-local |
| Story 3 happy: Given a custom member that returned a blocking finding on lap 1 because the diff changed `package.json`, when a later commit restores `package.json` and lap 2 withholds the member, then lap 2's verdict does not count that member's lap 1 finding as unresolved and build_review does not halt on it | 7 | "asserts lap 2's effective verdict has no unresolved finding sourced from the member, the step result is PASS, and no `.pipeline/HALT` is written" | diff-local |
| Story 3 negative: Given a custom member with `paths`, when its `question` text is changed, then its declaration identity changes and its prior judged result is not reused, proving `paths` alone is excluded from identity rather than all declaration fields | 6 | "asserts the declaration identity differs from lap 1's and the provider is invoked again with no `build_review_cache_hit` for the member" | diff-local |
| Story 3 negative: Given a custom member withheld on lap 2 after a blocking lap 1 finding, when lap 3 runs on a diff that changes `package.json` again, then the member participates and judges lap 3 afresh rather than silently inheriting a pass from the withheld lap | 7 | "asserts the member's provider is invoked, no `build_review_cache_hit` reuses a withheld lap for it, and lap 3's judged result alone decides the member's verdict" | diff-local |
| Story 4 happy: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose purpose is already served by an existing declared dependency or an existing in-repo module, then it directs a `necessity` finding of at least `major` severity that names the added dependency and the existing equivalent with its path | 8 | "the necessity criterion applies when the added dependency's purpose is already served by an existing declared dependency or an existing in-repo module and requires naming the added dependency and the existing equivalent's path" | diff-local |
| Story 4 happy: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds or upgrades a dependency with a floating specifier such as `*`, `latest`, or an unbounded `>=` range, or with a manifest change and no matching committed lockfile update, then it directs a `pinning` finding of at least `major` severity that names the dependency and the manifest location | 8 | "the pinning criterion names `*`, `latest`, unbounded `>=`, and a manifest change without a committed lockfile update and requires naming the dependency and manifest location" | diff-local |
| Story 4 happy: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose on-disk license metadata declares a license incompatible with the project's declared license, then it directs a `license` finding of at least `major` severity naming both licenses and the evidence location | 8 | "the license criterion compares on-disk dependency license metadata with the project's declared license, requires naming both licenses and the evidence location" | diff-local |
| Story 4 happy: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose license cannot be determined from any on-disk evidence, then it directs a `license` finding of severity `nit` that states the license is unverifiable | 8 | "directs an unverifiable license to a `nit` stating it is unverifiable" | diff-local |
| Story 4 negative: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency with no existing equivalent, a bounded specifier, a matching committed lockfile update, and a license compatible with the project's, then it directs no finding | 9 | "states no finding for an addition with no existing equivalent, a bounded specifier, a matching committed lockfile update, and a compatible license" | diff-local |
| Story 4 negative: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that changes only a lockfile's integrity or resolution metadata with no added, removed, or version-changed dependency, then it directs no finding | 9 | "no finding for a lockfile change limited to integrity or resolution metadata" | diff-local |
| Story 4 negative: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses any dependency diff, then it states that vulnerability, CVE, and maintenance-activity claims are outside its vocabulary and are never reported | 9 | "states vulnerability, CVE, and maintenance-activity claims are outside its vocabulary and are never reported" | diff-local |
| Story 4 negative: Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a library manifest that declares a caret range for a peer or runtime dependency where that ecosystem's library convention requires no lockfile change, then it directs no `pinning` finding for that range | 9 | "states no pinning finding for a library manifest's caret range on a peer or runtime dependency when that ecosystem's library convention requires no lockfile change" | diff-local |
| Story 4 negative: Given a copy of `skills/build-review-dependency-hygiene/SKILL.md` that adds a `## Result contract` heading, a fenced findings payload example, or a sentence prescribing the result payload, when `test/test_provider_skill_contracts.sh` runs, then its build_review rule fails naming that file, because the engine owns the result contract | 9 | "applies the same check whose existing result-contract-heading, fenced-findings, and payload-sentence fixtures fail naming the offending file" | diff-local |
| Story 5 happy: Given this repository's `.ai-conductor/config.yml`, when the build_review configuration is resolved, then the custom catalog contains a member `dependencyHygiene` that is enabled, names skill `build-review-dependency-hygiene` with source `global`, sets `min_severity: minor`, and carries a `paths` list that includes `**/package.json` and `**/package-lock.json` | 10 | "asserts member `dependencyHygiene` is enabled with skill `build-review-dependency-hygiene`, source `global`, policy `min_severity` `minor`, and `paths` including `**/package.json` and `**/package-lock.json`" | diff-local |
| Story 5 happy: Given a feature in this repository whose diff changes `src/conductor/package.json`, when build_review runs, then `dependencyHygiene` participates and its unresolved findings join the shared adjudication path with the other rubrics | 10 | "asserts `dependencyHygiene` is dispatched and its unresolved finding appears in `projectBuildReviewAggregateSources` output alongside the built-in rubrics' sources" | diff-local |
| Story 5 negative: Given a feature in this repository whose diff changes no file matching the `dependencyHygiene` paths, when build_review runs, then `dependencyHygiene` is withheld with reason `paths-unmatched` and no provider is invoked for it | 11 | "asserts `dependencyHygiene` emits exactly one `paths-unmatched` skip event and no provider is invoked for it" | diff-local |
| Story 5 negative: Given a `dependencyHygiene` license finding of severity `nit`, when the lap's effective verdict is reduced, then the finding is advisory under `min_severity: minor` and does not fail build_review | 11 | "asserts the finding is in the advisory set, the unresolved set is empty, and the effective verdict is PASS" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-7-R1: Drive lap 3 of the withheld-member convergence test through the engine build_review path in src/conductor/test/engine/build-review-custom-convergence.test.ts. Remove the test's direct provider.invoke({ lap: 3 }) call. Assert that the engine invoked the member's provider on lap 3, that no build_review_cache_hit event reuses a withheld lap for that member, and that lap 3's judged result alone decides the member's verdict. Keep the lap-1/lap-2 PASS and no-HALT assertions. If the strengthened test fails, fix stale-case or cache reuse in src/conductor/src/engine/build-review-adjudication-coordinator.ts.
**Gate:** prd-audit
**Rationale:** The test is too weak, and no architecture decision is needed. Task 7's second Done-when criterion requires that, on a lap 3 whose diff changes package.json again, the engine itself invokes the member's provider, no build_review_cache_hit reuses a withheld lap, and lap 3's judged result alone decides the member's verdict. The current test 'settles a withheld dependency finding as absent, then dispatches its later matching lap afresh' (src/conductor/test/engine/build-review-custom-convergence.test.ts:84) calls provider.invoke({ lap: 3 }) directly and counts its own calls, so it proves nothing about engine dispatch. Task 7's Steps, Files list and approved design ('Withheld equals absent') already cover this repair. It is BUILD work under Task 7's RED/GREEN steps: drive lap 3 through the real build_review engine path and assert on engine-made provider calls and emitted events. If that exposes a stale-case or cache-reuse defect, fix it in build-review-adjudication-coordinator.ts, which Task 7 also covers. Task 7's existing lap-1/lap-2 assertions (no unresolved member finding, PASS, no HALT) must be kept.
**Criterion:** S3.4
**Parent task:** 7
**Done when:**
- [test] S3.4 is satisfied by this task.
- The repair for task rem-prd-audit-7-R1 is committed and its targeted tests pass.
