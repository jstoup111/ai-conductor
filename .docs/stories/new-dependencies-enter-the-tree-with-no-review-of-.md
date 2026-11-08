**Status:** Accepted

# Stories: New dependencies enter the tree with no review of necessity, pinning, or license (#2045)

Technical track. These acceptance criteria come from the confirmed approach and the approved
architecture review (`architecture-review-2026-11-07-new-dependencies-enter-the-tree-with-no-review-of-`).
A `build_review.custom_rubrics` declaration may carry an optional `paths` glob list. A path-triggered
member is withheld from a lap, at zero judgement cost, when no changed path in the feature diff
matches. A shipped `build-review-dependency-hygiene` review policy judges necessity, version pinning,
and license compatibility of dependency changes. This repository declares it with a manifest and
lockfile path set.

Scope boundary (Balanced): the judgement is ecosystem-agnostic, and license is judged from on-disk
evidence only. Excluded: vulnerability or CVE scanning, configurable license allow/deny policy,
maintenance or abandonment signals, a new built-in registry rubric, and per-ecosystem mechanical
parsers.

## Story 1: A custom rubric declaration accepts an optional paths trigger

As a project operator, I want to declare which changed paths make a custom build_review rubric
relevant, so that the rubric only runs when a diff touches what it reviews.

### Acceptance Criteria

#### Happy Path
- Given a `build_review.custom_rubrics.<id>` declaration with `paths: ["**/package.json", "**/package-lock.json"]`, when the configuration is loaded and resolved, then the resolved custom catalog entry for `<id>` carries exactly those two globs in declared order
- Given a `build_review.custom_rubrics.<id>` declaration with no `paths` key, when the configuration is loaded and resolved, then the resolved entry carries no paths trigger and the member participates in every lap exactly as it did before this change

#### Negative Paths
- Given a declaration with `paths: []`, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and stating it must be a non-empty array
- Given a declaration whose `paths` contains an empty string or a non-string element, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and the offending element index
- Given a declaration whose `paths` is a string rather than an array, when the configuration is loaded, then loading fails with a validation error naming `build_review.custom_rubrics.<id>.paths` and no custom catalog is produced
- Given a built-in rubric block `build_review.rubrics.security` that sets `paths`, when the configuration is loaded, then loading rejects `paths` as an unknown key for that built-in rubric, as it rejects any other unknown built-in key

### Done When
- [ ] Engine config loading accepts `paths` as an allowed `build_review.custom_rubrics` key and exposes it on `ResolvedBuildReviewCustomCatalogEntry`, asserted by tests that fail before the key exists
- [ ] Each rejection case above produces a config validation error whose message names the full key path, asserted by tests

## Story 2: A path-triggered custom rubric is withheld when no changed path matches

As a project operator, I want a path-triggered rubric to cost nothing on a diff that does not touch
its paths, so that dependency-free features pay no judgement for dependency review.

### Acceptance Criteria

#### Happy Path
- Given an enabled custom member with `paths: ["**/package.json"]` and a feature diff whose changed files are only `src/a.ts` and `test/a.test.ts`, when a build_review lap runs, then the member is withheld, exactly one `build_review_rubric_skipped` event is emitted for it with reason `paths-unmatched`, and no provider is invoked for it
- Given the only enabled custom member is withheld and built-in rubrics are enabled, when the lap runs, then the lap runs as a built-in-only lap with no frozen custom source view, no custom lap gate, no custom input digest, and no custom member in its settlement
- Given an enabled custom member with `paths: ["**/package.json"]` and a feature diff that modifies `src/conductor/package.json`, when a build_review lap runs, then the member participates and is dispatched like any other enabled custom member
- Given a feature diff that renames `package.json` from `old/package.json` to `new/manifest.json`, when a lap runs for a member with `paths: ["old/package.json"]`, then the member participates because the renamed file's previous path matches
- Given a feature diff that deletes `tools/package.json`, when a lap runs for a member with `paths: ["**/package.json"]`, then the member participates because the deleted path matches

#### Negative Paths
- Given an enabled path-triggered member whose skill is not installed for any provider candidate and a feature diff that matches none of its paths, when the lap runs, then the build_review step settles without an infrastructure failure for that member and no installation discovery or policy capture is attempted for it
- Given the same uninstalled path-triggered member and a feature diff that does match one of its paths, when the lap runs, then the member settles the existing infrastructure failure with resolution code `absent` naming its skill and the build_review step does not succeed
- Given a lap in which the feature's earlier commits changed `package.json` and a later commit restored it so the merge-base-to-head diff no longer changes it, when the lap runs for a member with `paths: ["**/package.json"]`, then the member is withheld because matching uses the whole-feature diff, not individual commits
- Given a member with `paths: ["package.json"]` and a diff that changes only `src/conductor/package.json`, when the lap runs, then the member is withheld because a glob without a directory wildcard matches only the repository-root path
- Given all built-in rubrics disabled and the only enabled custom member withheld, when the lap runs, then build_review reports its existing no-rubrics pass and emits the `paths-unmatched` skip event, rather than failing or dispatching any reviewer

### Done When
- [ ] A test with a mocked provider boundary proves a withheld member reaches neither the provider invocation nor policy installation discovery, and fails against the pre-change runner
- [ ] A test asserts the emitted event is `{ type: 'build_review_rubric_skipped', rubric: '<id>', reason: 'paths-unmatched' }` exactly once per withheld member per lap
- [ ] Tests cover the rename-previous-path and deletion matches and the root-only glob withholding

## Story 3: The paths trigger never changes judgement identity, and a withheld member never blocks

As a project operator, I want adding or tuning `paths` to leave cached judgements and decisions
intact, and a no-longer-relevant rubric to stop gating, so that the trigger never causes re-review
churn or a stuck lap.

### Acceptance Criteria

#### Happy Path
- Given a custom member judged on lap 1 without `paths`, when `paths` matching the diff is added to its declaration and lap 2 runs on the same frozen input, then the member's declaration identity and policy fingerprint are unchanged and its lap 1 judged result is reused as a cache hit
- Given a custom member that returned a blocking finding on lap 1 because the diff changed `package.json`, when a later commit restores `package.json` and lap 2 withholds the member, then lap 2's verdict does not count that member's lap 1 finding as unresolved and build_review does not halt on it

#### Negative Paths
- Given a custom member with `paths`, when its `question` text is changed, then its declaration identity changes and its prior judged result is not reused, proving `paths` alone is excluded from identity rather than all declaration fields
- Given a custom member withheld on lap 2 after a blocking lap 1 finding, when lap 3 runs on a diff that changes `package.json` again, then the member participates and judges lap 3 afresh rather than silently inheriting a pass from the withheld lap

### Done When
- [ ] A test asserts the custom declaration identity and execution-policy fingerprint are byte-identical with and without `paths`, and differ when `question` changes
- [ ] A test asserts a lap that withholds a member with prior blocking findings settles without that member in its unresolved findings and without a halt

## Story 4: The dependency-hygiene policy judges necessity, pinning, and license

As a project operator, I want dependency additions and upgrades judged for whether they are needed,
pinned, and license-compatible, so that an unjustifiable dependency fails build_review with a finding.

The policy text is the reviewer's criteria: the engine sends it verbatim to the reviewer
(`adr-2026-09-10-portable-build-review-policy` D3), so these criteria are stated at the policy layer.
Live judgement on real diffs is exercised by the SHIP-phase audit and manual test.

### Acceptance Criteria

#### Happy Path
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose purpose is already served by an existing declared dependency or an existing in-repo module, then it directs a `necessity` finding of at least `major` severity that names the added dependency and the existing equivalent with its path
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds or upgrades a dependency with a floating specifier such as `*`, `latest`, or an unbounded `>=` range, or with a manifest change and no matching committed lockfile update, then it directs a `pinning` finding of at least `major` severity that names the dependency and the manifest location
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose on-disk license metadata declares a license incompatible with the project's declared license, then it directs a `license` finding of at least `major` severity naming both licenses and the evidence location
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency whose license cannot be determined from any on-disk evidence, then it directs a `license` finding of severity `nit` that states the license is unverifiable

#### Negative Paths
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that adds a dependency with no existing equivalent, a bounded specifier, a matching committed lockfile update, and a license compatible with the project's, then it directs no finding
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a diff that changes only a lockfile's integrity or resolution metadata with no added, removed, or version-changed dependency, then it directs no finding
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses any dependency diff, then it states that vulnerability, CVE, and maintenance-activity claims are outside its vocabulary and are never reported
- Given the dependency-hygiene review policy the engine delivers verbatim to the reviewer, when it addresses a library manifest that declares a caret range for a peer or runtime dependency where that ecosystem's library convention requires no lockfile change, then it directs no `pinning` finding for that range
- Given a copy of `skills/build-review-dependency-hygiene/SKILL.md` that adds a `## Result contract` heading, a fenced findings payload example, or a sentence prescribing the result payload, when `test/test_provider_skill_contracts.sh` runs, then its build_review rule fails naming that file, because the engine owns the result contract

### Done When
- [ ] `skills/build-review-dependency-hygiene/SKILL.md` exists in the shipped catalog, is provider-neutral, and states the necessity, pinning, and license criteria, the non-finding cases above, the severity each finding carries, and a recommended manifest and lockfile `paths` set for npm, Yarn, pnpm, Bundler, pip, Poetry, uv, Go modules, Cargo, Maven, and Gradle
- [ ] The skill resolves as a review policy through the existing custom-rubric installation discovery once installed by `bin/install`
- [ ] `test/test_provider_skill_contracts.sh` includes `build-review-dependency-hygiene` in its build_review forbidden-pattern audit and passes on the shipped skill

## Story 5: This repository reviews its own dependency changes

As the harness maintainer, I want this repository's builds to run the dependency-hygiene policy on
manifest and lockfile changes, so that its own dependency additions are reviewed.

### Acceptance Criteria

#### Happy Path
- Given this repository's `.ai-conductor/config.yml`, when the build_review configuration is resolved, then the custom catalog contains a member `dependencyHygiene` that is enabled, names skill `build-review-dependency-hygiene` with source `global`, sets `min_severity: minor`, and carries a `paths` list that includes `**/package.json` and `**/package-lock.json`
- Given a feature in this repository whose diff changes `src/conductor/package.json`, when build_review runs, then `dependencyHygiene` participates and its unresolved findings join the shared adjudication path with the other rubrics

#### Negative Paths
- Given a feature in this repository whose diff changes no file matching the `dependencyHygiene` paths, when build_review runs, then `dependencyHygiene` is withheld with reason `paths-unmatched` and no provider is invoked for it
- Given a `dependencyHygiene` license finding of severity `nit`, when the lap's effective verdict is reduced, then the finding is advisory under `min_severity: minor` and does not fail build_review

### Done When
- [ ] Resolving `.ai-conductor/config.yml` through the engine's build_review config resolver yields the `dependencyHygiene` member with the fields above, asserted by a test that fails before the declaration exists
- [ ] The existing `eventSpine` declaration resolves unchanged
