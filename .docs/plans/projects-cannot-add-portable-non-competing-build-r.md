# Implementation Plan: Portable, non-competing build review policy

**Date:** 2026-09-10
**Status:** Approved
**Approved by:** James Stoup, 2026-09-11; coherence clarifications below preserve the approved scope and architecture
**Source:** jstoup111/ai-conductor#1986
**Design:** .docs/specs/2026-09-10-projects-cannot-add-portable-non-competing-build-r.md
**Stories:** .docs/stories/projects-cannot-add-portable-non-competing-build-r.md
**Conflict check:** PASS, 2026-09-10, including the approved separate coverage-identity amendment
**Tier:** L

## Summary

Forty functional implementation tasks deliver installed custom review policies through both providers, effective-candidate caching, one aggregate repair authority, and durable operator/recovery semantics. All 93 accepted criteria have explicit coverage below. Full #1986 and the necessary #1804 correction are included; #1344 general custom-step redesign is excluded.

## Technical Approach

Extend the existing build_review catalog and candidate lifecycle. A candidate resolves its own installed policy, captures the complete package, proves the review access boundary, and only then performs cache lookup or judging. New proposed modules are named explicitly in Files; existing modules remain the production entry points. The custom result envelope is engine-stamped and self-describing. Built-in testQuality keeps its specialized rules and no-custom compatibility path.

Use a read-only Linux/bubblewrap profile for every member of a custom lap, with frozen source, complete policy material, isolated private scratch, and no sibling evidence. The catalog adapters consume the actual prepared host environment: Codex app-server skills/list plus typed installed plugin metadata; Claude project/user skill roots plus enabled installed plugin manifests. The approved review-role adaptation delivers full criteria rather than invoking a bare skill name. Unsupported catalog/capability/material is a coverage failure, never evidence of an informed judgment.

Extend the existing remediate case flow with case-v2 consistency, task admission, and decision-owner escalation. One shared custom-review outcome operation feeds attended and daemon navigation. Existing case/effect/operator stores and kickback ledger retain leasing, atomic replacement, exact source binding, repeated-case limits, and recovery. Custom accepted risk binds to judged content; reduced coverage binds to validated declaration and closed reason without requiring missing content. No second judge, retry ledger, or telemetry channel is introduced.

The local patterns are semantic reuse: executeAuxiliaryProviderCandidates owns prepare/invoke/fallback/cleanup; BuildReviewCacheFilesystem isolates cache I/O; createConductStateLease and the remediation-case store/effects own transactional replay; ConductorEvent and EVENT_SINKS own occurrences. Tasks repeat their relevant subset. There is no exact-copy Pattern-source contract. Existing architecture decisions are the implementation authority; module/helper naming may vary internally only when the named observable boundary and task Files remain corroborated.

## Prerequisites

> **Amended 2026-09-11 by #1986:** Main now carries the approved #2409 refutation contract in the shared case ADRs. Its implementation must land before this feature builds; issue #1986 is ordered after #2409 through the existing GitHub dependency gate. This feature reuses that case primitive rather than reimplementing #2409. An attempted case proposed again as act still stops; an admitted evidence-backed refute/refuted outcome settles through that inherited bounded lane without a repair charge.

- Accepted stories, PASS conflict report, and both approved 2026-09-10 ADRs are in this spec change set before BUILD. DECIDE already owns the adjacent ADR amendments; no implementation task edits a foreign feature artifact.
- Initial runtime support is Linux with two-sided and nested read-only containment probes. Unsupported environments return the approved capability diagnostic; no writable fallback. The private Kotlin package is not an acceptance prerequisite and remains unverified.
- All ordinary automated tests fake every third-party boundary. Metadata and model transports must prove production-to-fake reachability before refused/destructive argument fixtures; private fixture state is mandatory. A separately named opt-in local containment smoke may exercise bubblewrap on disposable files without a third-party call.
- writing-system-tests authors the two accepted multi-step flows at BUILD entry: flow A ends at aggregate repair/decision routing (Task 33); flow B ends at post-repair verification/progression (Task 36). Other criterion permutations stay at the lower layers identified by their task and the accepted story coverage dispositions.

## Tasks

### Task 1: Load valid custom declarations into the effective rubric catalog
**Story:** 2 (S2.1, S2.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/resolved-config.test.ts test/engine/build-review-registry.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the existing build_review configuration and resolved-policy path with custom_rubrics: id maps to skill, question, optional source/resources, and existing member execution fields. Reuse existing execution-policy resolution; keep testQuality in the closed built-in registry. Return immutable tagged built-in/custom descriptors from the effective catalog. Disabled-by-default declarations and the disabled public gate short-circuit before discovery. Extend the existing config-consumer registry so loaded values reach their real consumer; do not create another lifecycle step.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): load valid custom declarations into the effective rubric catalog` after its checks pass.

**Done when:**
- Configuration-to-catalog integration loads a valid custom declaration alongside testQuality and resolves its existing execution-policy fields without editing the registry implementation per policy.
- The effective catalog excludes omitted/disabled custom members and every member of a disabled public gate; instrumented downstream discovery, cache, and judge callbacks receive zero calls for them.

**Files:** `src/conductor/src/types/config.ts`; `src/conductor/src/engine/config.ts`; `src/conductor/src/engine/resolved-config.ts`; `src/conductor/src/engine/build-review-registry.ts`; `src/conductor/test/engine/config-consumer-registry.ts`; `src/conductor/test/engine/resolved-config.test.ts`; `src/conductor/test/engine/build-review-registry.test.ts`

**Dependencies:** none

### Task 2: Reject unsafe declarations before dispatch while preserving legacy keys
**Story:** 2 (S2.3, S2.4)
**Story:** 18 (S18.3)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/config-validation.test.ts test/engine/build-review-registry.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Use the existing YAML parser error path to reject duplicate mapping keys, including custom ids. Validate ASCII letter-leading ids of 1–64 characters, the existing reserved and retired ids, prototype keys, unknown fields, source/resource types, and a maximum of 32 declarations before catalog construction. Reject enabled custom membership with disabled adjudication. Preserve legacy unknown-key rejection and retired-key warning/no-op behavior; do not reinterpret either as a custom declaration.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): reject unsafe declarations before dispatch while preserving legacy keys` after its checks pass.

**Done when:**
- The production configuration loader rejects each invalid-id, reserved/retired/prototype-id, duplicate-key, unknown-field, invalid-source/resource, and 33-member fixture before any rubric callback.
- Configuration integration rejects enabled custom review with adjudication disabled, while legacy unknown keys still error and retired keys still warn and contribute no member.

**Files:** `src/conductor/src/engine/config.ts`; `src/conductor/test/config-validation.test.ts`; `src/conductor/test/engine/build-review-registry.test.ts`

**Dependencies:** Task 1

### Task 3: Select one canonical installed policy from host-neutral descriptors
**Story:** 1 (S1.1, S1.2, S1.3, S1.4, S1.5, S1.6)
**Story:** 3 (S3.1, S3.2, S3.5)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-resolver.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Introduce typed validated declarations, installed descriptors, resolution successes, and load failures. Resolve semantic skill and optional plugin qualification against enabled, locally installed descriptors from the selected candidate only. Deduplicate aliases by canonical origin, never by content digest; source qualification narrows matches. Keep origin, package root, selected definition, plugin/version metadata, and resource selection in the descriptor. Filesystem fixtures plus injected catalog responses cover all three sources; no installation, enabling, downloading, or authored copying exists on this path.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): select one canonical installed policy from host-neutral descriptors` after its checks pass.

**Done when:**
- The installed-policy resolver selects the project, global, and plugin-qualified fixtures with exact canonical source/plugin identity; aliases of one installation collapse and original files remain unchanged.
- The resolver refuses distinct-origin ambiguity even for byte-equal copies, selects the explicitly qualified source, and names absent, unreadable, disabled, marketplace-only, or incomplete installations without substituting another copy.

**Files:** `src/conductor/src/engine/build-review-policy.ts`; `src/conductor/src/engine/build-review-policy-resolver.ts`; `src/conductor/test/engine/build-review-policy-resolver.test.ts`

**Dependencies:** Task 1

### Task 4: Read Codex installed skills through the prepared app-server catalog
**Story:** 1 (S1.1, S1.2, S1.3)
**Story:** 3 (S3.1)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-codex.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Implement the Codex descriptor adapter with a bounded local app-server metadata operation in the actual prepared candidate cwd/home. Use the verified skills/list request with cwds and forceReload and typed SkillMetadata path/scope/enabled/pluginId plus typed plugin descriptors. Admit locally installed enabled components only. Inject the process transport, validate envelopes, and explicitly close the metadata session. The generated Codex 0.154.0 schema was verified during DECIDE; unsupported schema is a typed failure, not a cache-directory fallback.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): read codex installed skills through the prepared app-server catalog` after its checks pass.

**Done when:**
- The Codex catalog adapter reaches its injected app-server transport using the prepared cwd/home and forceReload, then produces source-qualified project/global/plugin descriptors from faithful protocol fixtures.
- The adapter uses the typed plugin relationship and local availability, and its successful request closes the metadata session without launching a model, enabling a plugin, or scanning guessed cache directories.

**Files:** `src/conductor/src/engine/build-review-policy-codex.ts`; `src/conductor/test/engine/build-review-policy-codex.test.ts`

**Dependencies:** Task 3

### Task 5: Read Claude installed skills and enabled plugin manifests
**Story:** 1 (S1.1, S1.2, S1.3)
**Story:** 3 (S3.1)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-claude.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Implement the Claude descriptor adapter from the candidate project/user skill roots and its enabled installed plugin inventory. Use the verified plugin list --json fields enabled, installPath, scope, version and the installed manifest skill components; preserve plugin-qualified names. Inject command/filesystem boundaries; the command runs in the prepared environment. Parse supported manifests explicitly; marketplace entries and unrelated plugin components are not installations or permissions.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): read claude installed skills and enabled plugin manifests` after its checks pass.

**Done when:**
- The Claude catalog adapter reaches its injected metadata command in the prepared cwd/home and maps project/user roots plus enabled installed manifests to canonical source/plugin descriptors.
- Disabled and marketplace-only fixtures supply no eligible installation, unrelated plugin components never activate, and successful metadata discovery terminates without a model invocation.

**Files:** `src/conductor/src/engine/build-review-policy-claude.ts`; `src/conductor/test/engine/build-review-policy-claude.test.ts`

**Dependencies:** Task 3

### Task 6: Terminate failed metadata discovery without candidate fallback
**Story:** 3 (S3.3, S3.4)
**Story:** 5 (S5.4)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-catalog-failures.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. At each injected metadata transport, preserve complete-versus-partial status independently of exit code. Reject partial output, errors embedded in success output, malformed/unsupported schemas, missing source permissions, timeout, and cancellation. Reuse the candidate abort/deadline and process cleanup conventions in provider-execution/provider-lifecycle; no detached discovery survives cleanup. Return policy-load classification rather than provider/model unavailability. Prove both production adapters reach the fake transport with harmless inputs before the refusal matrix; never run real host CLIs in these tests.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): terminate failed metadata discovery without candidate fallback` after its checks pass.

**Done when:**
- Both metadata adapters classify partial-success, error-bearing, malformed, unsupported, unreadable, timeout, and cancellation fixtures as named loading failures rather than confirmed absence or judged coverage.
- Catalog-failure integration observes terminated child/session activity, zero policy judge/cache calls, and no provider-unavailable fallback for an otherwise available candidate.

**Files:** `src/conductor/src/engine/build-review-policy-codex.ts`; `src/conductor/src/engine/build-review-policy-claude.ts`; `src/conductor/src/engine/build-review-policy-resolver.ts`; `src/conductor/test/engine/build-review-policy-catalog-failures.test.ts`

**Dependencies:** Task 4, Task 5

### Task 7: Capture and hash the complete selected policy package
**Story:** 6 (S6.1, S6.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-bundle.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Capture the standalone skill directory or selected plugin root in a fixture-owned runtime material directory. Build a sorted relative-path/raw-byte manifest with admitted metadata, the definition, and every file in the package; supporting files retain their relative locations. Resolve safe in-package symlinks without escaping the admitted root, recording their delivered meaning. Compute a versioned effective bundle digest from exactly those captured bytes and admitted metadata, never temporary absolute paths. Keep installation origin as provenance; installed originals are not rewritten.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): capture and hash the complete selected policy package` after its checks pass.

> **Amended 2026-09-11 by #1986:** D3 requires the complete admitted package, including files not directly linked by SKILL.md; this makes that existing scope explicit in completion evidence.

**Done when:**
- The policy-bundle loader delivers SKILL.md, nested criteria, and admitted in-package link targets at preserved relative locations with bytes equal to the captured manifest.
- Bundle identity changes with every captured package-byte change, agrees with the delivered material, and remains unchanged when only its runtime parent path changes.
- The bundle loader enumerates every admitted file under the standalone skill directory or selected plugin root, including unreferenced files, and hashes sorted relative paths, raw bytes, and admitted metadata of the complete delivered package.

**Files:** `src/conductor/src/engine/build-review-policy-bundle.ts`; `src/conductor/test/engine/build-review-policy-bundle.test.ts`

**Dependencies:** Task 3

### Task 8: Refuse incomplete, escaping, and oversized policy resources
**Story:** 6 (S6.3, S6.4)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-bundle.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Validate explicit resources and local Markdown file references against the package closure. Reject missing/unreadable files, broken local references, symlink escapes/cycles, and special files. Enforce inclusive limits of 4096 files and 64 MiB over the complete admitted package before eligibility; count actual delivered material without recursive-cycle loopholes. Use disposable fixtures and injected I/O faults; do not truncate the definition or supporting content.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): refuse incomplete, escaping, and oversized policy resources` after its checks pass.

**Done when:**
- The bundle loader rejects missing/unreadable resources, broken local references, escaping/cyclic links, and special-file fixtures with the offending resource named and no eligible bundle.
- Boundary fixtures accept 4096 files and 64 MiB but refuse either exceeded limit without a partial manifest, judging call, or cache lookup.

**Files:** `src/conductor/src/engine/build-review-policy-bundle.ts`; `src/conductor/test/engine/build-review-policy-bundle.test.ts`

**Dependencies:** Task 7

### Task 9: Reject changing or partially stored policy captures
**Story:** 6 (S6.5)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-bundle.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Use a capture/check protocol over the admitted tree and bytes: compare the complete source manifest before finalizing immutable material, including additions/removals and link targets. Publish eligibility only after all material writes and consistency checks succeed. Keep incomplete material candidate-owned for existing cleanup; do not add a background cleanup process. Inject changes and write failures at named capture boundaries.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): reject changing or partially stored policy captures` after its checks pass.

**Done when:**
- The bundle capture rejects changed definition/resource bytes, added/removed members, and changed link targets between capture and final consistency check.
- A failed material write never publishes an eligible bundle; candidate cleanup removes only its owned incomplete material and a later attempt performs fresh capture.

**Files:** `src/conductor/src/engine/build-review-policy-bundle.ts`; `src/conductor/test/engine/build-review-policy-bundle.test.ts`

**Dependencies:** Task 7

### Task 10: Adapt ordinary installed skill text into the review contract
**Story:** 4 (S4.1, S4.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-contract.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Create a versioned review-role envelope that embeds the full selected SKILL.md and exposes the complete captured support tree. Engine instructions establish read-only evidence production, the custom result schema, and aggregate-only authority before interpreting policy criteria. Standalone presentation instructions can coexist but cannot replace the envelope. Do not rewrite installed skill text, require special frontmatter, or invoke a bare unresolved semantic token. Include the selected declared question and content identity in engine-owned context.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): adapt ordinary installed skill text into the review contract` after its checks pass.

**Done when:**
- The review-contract renderer delivers unchanged ordinary skill criteria and supporting material with the shared findings schema, without requiring harness-specific frontmatter or installed-file edits.
- A standalone-presentation fixture remains reviewable under the engine envelope and cannot supply the aggregate verdict, repair work order, or another output contract.

**Files:** `src/conductor/src/engine/build-review-policy-contract.ts`; `src/conductor/test/engine/build-review-policy-contract.test.ts`

**Dependencies:** Task 7

### Task 11: Represent declared and runtime policy incompatibility explicitly
**Story:** 3 (S3.6)
**Story:** 4 (S4.3, S4.4)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-policy-contract.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Compare declared host/plugin dependencies and required actions with the admitted review capability profile before judging. Name incompatible editing, install, publishing, unavailable tool, or dependency requirements and recovery. For requirements discoverable only while applying the policy, define a bounded explicit unsupported result distinct from a judged empty finding list. Map it to the existing closed infrastructure reason with typed detail; keep classification tables total and never activate extra plugin components.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): represent declared and runtime policy incompatibility explicitly` after its checks pass.

> **Amended 2026-09-11 by #1986:** The approved closed failure lane remains type-checked; diagnostic prose cannot select recovery or waiver identity.

**Done when:**
- Policy preflight rejects declared unavailable capabilities/actions before judging and reports provider, capability, and recovery without activating unrelated components.
- The custom result boundary maps a runtime unsupported response to visibly unjudged failed coverage; it neither accepts an empty PASS nor grants edits, installation, publishing, or repair authority.
- The branch-to-result classification uses a total typed mapping to existing closed infrastructure reasons, preserves the actual cause in every catalog/preflight/runtime-unsupported fixture, and never routes by diagnostic text.

**Files:** `src/conductor/src/engine/build-review-policy-contract.ts`; `src/conductor/src/engine/build-review-domain.ts`; `src/conductor/test/engine/build-review-policy-contract.test.ts`

**Dependencies:** Task 10

### Task 12: Materialize one source view for every member of a custom lap
**Story:** 10 (S10.1, S10.5)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-inputs.test.ts test/engine/build-review-materialization.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend existing frozen input preparation with a content-bound source materialization for laps containing custom members. Include the existing admitted changed input and source context needed by rubric projections; capture before fan-out and hand every member, including testQuality, the same immutable descriptor. Keep branch contexts separate. Original-checkout edits after capture cannot alter the material or its identity. Built-in-only input preparation retains its current path.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): materialize one source view for every member of a custom lap` after its checks pass.

**Done when:**
- Input-preparation integration gives every custom and built-in peer the same captured source identity, independent of completion order, with no sibling evidence in branch contexts.
- Changing the original checkout after capture leaves later reviewer reads and evidence identity on the captured bytes; a built-in-only fixture creates no custom materialization prerequisite.

**Files:** `src/conductor/src/engine/build-review-inputs.ts`; `src/conductor/src/engine/build-review-materialization.ts`; `src/conductor/test/engine/build-review-inputs.test.ts`; `src/conductor/test/engine/build-review-materialization.test.ts`

**Dependencies:** Task 1

### Task 13: Enforce the Linux read-only review boundary and its probes
**Story:** 10 (S10.2, S10.3, S10.4)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-containment.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Build a review-specific bubblewrap mount profile: admit the frozen source and policy read-only, protect the original checkout and installation, withhold engine evidence and sibling scratch, and expose only candidate-private writable bookkeeping. Reuse provider-scratch leases and self-host protection composition, not the BUILD writable bind set. Require protected-write refusal and private-scratch-write success, including nested sandbox execution, before eligibility. Test argv/access translation through a proved injected process boundary; optional named opt-in Linux smoke uses only disposable fixtures and no third parties.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): enforce the linux read-only review boundary and its probes` after its checks pass.

**Done when:**
- The production containment adapter reaches its fake process boundary and admits scratch writes while refusing protected source/installation/engine-state writes and sibling-evidence reads under the generated mount profile.
- Missing bubblewrap, a successful protected write, failed scratch write, or unsupported nested sandbox yields a named unsupported-capability failure and zero reviewer launches with no writable fallback.

**Files:** `src/conductor/src/engine/build-review-containment.ts`; `src/conductor/src/engine/self-host/provider-scratch.ts`; `src/conductor/test/engine/build-review-containment.test.ts`

**Dependencies:** Task 7, Task 12

### Task 14: Carry the read-only profile through both provider invoke adapters
**Story:** 5 (S5.1)
**Story:** 10 (S10.2, S10.3, S10.4)
**Type:** infrastructure

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/execution/build-review-profile.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Add a typed review access profile to the existing InvokeOptions and consume it in both existing invoke adapters. Compose provider-specific bookkeeping and process arguments with the verified containment wrapper rather than adding another model dispatcher. Preserve ordinary BUILD/general-custom-step invocation options. Mock the real process boundary before exercising refused arguments, and establish harmless production-to-fake reachability so counterfactual restoration cannot run a real command.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): carry the read-only profile through both provider invoke adapters` after its checks pass.

**Done when:**
- Both production invoke adapters deliver the same full review envelope and captured support tree through the enforced read-only profile while retaining provider-specific producing identity and private bookkeeping.
- Adapter integration refuses an unsupported review profile before model launch; ordinary non-review invocation fixtures retain their existing arguments and writable behavior.

**Files:** `src/conductor/src/execution/llm-provider.ts`; `src/conductor/src/execution/codex-provider.ts`; `src/conductor/src/execution/claude-provider.ts`; `src/conductor/test/execution/build-review-profile.test.ts`

**Dependencies:** Task 10, Task 13

### Task 15: Expose a prepared-candidate operation inside the auxiliary lifecycle
**Story:** 5 (S5.5)
**Story:** 9 (S9.5)
**Type:** refactor

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/provider-execution.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Add an optional typed per-candidate operation after actual provider preparation and model/effort resolution, inside the existing auxiliary candidate loop. Supply prepared environment, abort/deadline, identity, and the existing invocation callback; return hit, judged, or classified failure without bypassing session policy, metering, fallback, or teardown. Callers that omit it follow the original flow. Reuse executeAuxiliaryProviderCandidates and its injected runtimes rather than cloning a candidate loop.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): expose a prepared-candidate operation inside the auxiliary lifecycle` after its checks pass.

**Done when:**
- Auxiliary lifecycle tests observe prepare before the candidate operation and exactly one cleanup after hit, invoke success, authentication failure, malformed result, timeout, or cancellation.
- Existing unavailability classification, session policy, attempt accounting, and non-review callers retain their behavior; cancellation/preparation failure cannot emit a claimed judgment or cache hit.

**Files:** `src/conductor/src/engine/provider-execution.ts`; `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** Task 6

### Task 16: Wire installed policy judging through the actual candidate boundary
**Story:** 1 (S1.1, S1.2, S1.3, S1.4, S1.5, S1.6)
**Story:** 4 (S4.1, S4.2, S4.3, S4.4)
**Story:** 5 (S5.1, S5.3, S5.4, S5.5)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/build-review-custom-policy.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Make the existing build-review runner build the effective catalog and enter the prepared-candidate operation for custom members. Resolve using that candidate adapter, capture/preflight material, invoke the existing provider with the enforced profile, then parse and stamp the result. This task owns config-to-custom-provider integration, with faithful process/model/catalog fakes for both hosts and all three source types. Reuse coordinator all-settled branch handling; failures remain unjudged and policy loading never earns unavailability fallback. Cache wiring is owned by Task 19.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): wire installed policy judging through the actual candidate boundary` after its checks pass.

**Done when:**
- The public build-review runner delivers unchanged installed project/global/plugin criteria through both real provider adapters and publishes engine-stamped judged results from the actual candidate.
- Runner integration observes zero affected judgments for ambiguity, missing/disabled installations, invalid resources, and declared incompatibility; runtime unsupported, auth, cancellation, and malformed output preserve their distinct failures and cleanup.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/src/engine/build-review-coordinator.ts`; `src/conductor/test/integration/build-review-custom-policy.integration.test.ts`

**Dependencies:** Task 4, Task 5, Task 6, Task 9, Task 11, Task 14, Task 15, Task 21, Task 22

### Task 17: Define complete semantic cache identity and stable incidental fields
**Story:** 8 (S8.1, S8.2, S8.3)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-cache.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the pure typed cache lookup identity with declaration, effective bundle, contract/projection versions, semantic input, execution-policy fingerprint, engine content stamp, actual provider and resolved model/effort. Retain existing engineStamp content-only/dev behavior. Separate producing provenance from eligibility. Parameterize independent mutations of every semantic component; temporary paths, lap/timing and commit-address-only changes must not enter the key. Config resource selections participate in declaration meaning.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): define complete semantic cache identity and stable incidental fields` after its checks pass.

**Done when:**
- The pure cache matcher hits for identical semantic identity and temporary-path, lap-time, publication-time, or commit-address-only changes, while retaining the original producing provenance.
- Independent changes to definition/support bytes, question/source/resources, input, contract/projection, execution policy, engine content stamp, actual provider, model, or effort produce attributable misses.

**Files:** `src/conductor/src/engine/build-review-cache.ts`; `src/conductor/src/engine/build-review-policy.ts`; `src/conductor/test/engine/build-review-cache.test.ts`

**Dependencies:** Task 1, Task 7, Task 21

### Task 18: Partition candidate entries and refuse incomplete cache writes
**Story:** 8 (S8.4, S8.5)
**Story:** 9 (S9.2)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-cache.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Version stored cache envelopes and partition existing cache storage by rubric plus candidate identity so preferred/fallback entries coexist. Parse persisted custom descriptors independently of current configuration. Keep staged legacy parsing: missing old engine identity retains its established distinct miss; newer incomplete effective-policy evidence is a distinct lazy miss; malformed envelopes remain invalid. Use existing injected filesystem and atomic rename pattern; failure leaves no eligible partial entry. No cache-clear command or rollover bulk deletion.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): partition candidate entries and refuse incomplete cache writes` after its checks pass.

**Done when:**
- Temporary-cache integration preserves separate warm preferred/fallback entries and only reads an entry whose full effective candidate identity and validated result match.
- Legacy missing-evidence entries miss with their staged cause, malformed entries miss as invalid, and interrupted/failed writes cannot publish an eligible partial result or destroy the other candidate entry.

**Files:** `src/conductor/src/engine/build-review-cache.ts`; `src/conductor/test/engine/build-review-cache.test.ts`

**Dependencies:** Task 17, Task 23

### Task 19: Run cache lookup and write after each actual candidate prepares
**Story:** 5 (S5.2, S5.3, S5.4)
**Story:** 8 (S8.1, S8.2, S8.3, S8.4, S8.5)
**Story:** 9 (S9.1, S9.2, S9.3, S9.4, S9.5)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/build-review-candidate-cache.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Move policy-dependent lookup and eligible write into the Task 15 operation after resolve/capture/preflight. A hit bypasses invocation but retains ordinary candidate teardown and a separate current-lap reuse record without new tokens. On early or late provider/model unavailability, let the existing loop prepare the fallback and independently repeat resolution and lookup. Parameterize both hosts and distinct package content. This task owns runner-to-cache/fallback integration; pure identity/storage details belong to Tasks 17/18.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): run cache lookup and write after each actual candidate prepares` after its checks pass.

**Done when:**
- Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback.
- Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/src/engine/build-review-coordinator.ts`; `src/conductor/src/engine/provider-execution.ts`; `src/conductor/test/integration/build-review-candidate-cache.integration.test.ts`

**Dependencies:** Task 16, Task 18

### Task 20: Bind built-in review to its effective candidate without custom prerequisites
**Story:** 18 (S18.1, S18.2, S18.4, S18.5)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/build-review-builtin-candidate.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Resolve and deliver the actual prepared candidate testQuality definition/bundle through the same cache ordering. Keep its specialized scope, vocabulary, preflight, anchors, and existing accepted-risk identity. Existing no-custom attended/daemon paths, empty container, empty scope, default membership and enabled S-tier behavior stay effective without read-only custom containment. Use the existing built-in projection/preflight fixtures and real runner boundary; do not reimplement their rules in a generic parser.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): bind built-in review to its effective candidate without custom prerequisites` after its checks pass.

**Done when:**
- Built-in runner integration hits for unchanged candidate criteria, misses after effective criteria change, and refuses warm harness-root evidence when the actual candidate cannot load its policy, without changing built-in risk matching.
- No-custom fixtures preserve attended/daemon, default/empty-container/empty-scope behavior and require no custom containment; generic custom findings cannot bypass testQuality vocabulary, scope, preflight, or anchor checks.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/src/engine/build-review-registry.ts`; `src/conductor/src/engine/build-review-projections.ts`; `src/conductor/test/integration/build-review-builtin-candidate.integration.test.ts`

**Dependencies:** Task 19

### Task 21: Parse a bounded custom finding contract independently of built-in vocabulary
**Story:** 7 (S7.4)
**Story:** 13 (S13.4)
**Story:** 18 (S18.5)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-domain.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Add a tagged versioned custom payload with bounded concern id, summary, optional finite confidence, evidence locations and source-region references. Keep testQuality on its current specialized parser. Define strict unknown-field rejection for reviewer-claimed envelope identity/verdict/case/effect/disposition. Absence of confidence remains eligible rather than becoming zero confidence. Expose the parser selection via the effective descriptor, not today’s global enabled map.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): parse a bounded custom finding contract independently of built-in vocabulary` after its checks pass.

> **Amended 2026-09-11 by #1986:** The existing confidence contract is integer 0–100, not arbitrary finite numbers; new custom parsing preserves it.

**Done when:**
- The descriptor-selected parser accepts bounded custom findings and absent confidence, but rejects invalid confidence and forged rubric/lap/policy/provider/verdict/case/effect/disposition fields.
- The testQuality descriptor still uses its specialized schema and rejects a generic custom payload; a custom unsupported payload remains distinct from a judged empty finding list.
- The custom parser accepts only optional integer confidence from 0 through 100, rejects fractional/out-of-range/non-finite values, and never computes, defaults, or adjusts reported confidence.

**Files:** `src/conductor/src/engine/build-review-domain.ts`; `src/conductor/src/engine/build-review-projections.ts`; `src/conductor/test/engine/build-review-domain.test.ts`

**Dependencies:** Task 1

### Task 22: Validate content references and stamp custom result identity
**Story:** 7 (S7.4)
**Story:** 13 (S13.5)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-finding-identity.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Validate evidence locations and source-region references against the frozen admitted input before creating a custom judged envelope. Engine code owns rubric, lap, declaration, bundle, provider, reviewed input, and durable finding ids. Include versioned declaration/resource identity and effective content in custom exact identity; preserve built-in identity behavior. Retain historical finding descriptors for semantic recurrence instead of equating wording or rubric name.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): validate content references and stamp custom result identity` after its checks pass.

> **Amended 2026-09-11 by #1986:** Confidence remains presentation evidence under the amended mixed-lap ADR; it is not a new custom finding identity component.

**Done when:**
- Custom result stamping derives envelope and finding identities only from validated declaration, captured policy, actual candidate, and frozen input after checking every evidence reference.
- Out-of-input/invalid references produce no eligible judged result, and a same-named changed policy yields a different exact finding identity while built-in identity fixtures remain unchanged.
- Custom identity tests retain the same finding and risk subject when only reported confidence or engine publication timing changes; declaration and effective policy changes still invalidate exact custom identity.

**Files:** `src/conductor/src/engine/build-review-finding-identity.ts`; `src/conductor/src/engine/build-review-domain.ts`; `src/conductor/src/engine/build-review-projections.ts`; `src/conductor/test/engine/build-review-finding-identity.test.ts`

**Dependencies:** Task 7, Task 12, Task 21

### Task 23: Persist and read self-describing custom evidence and reuse provenance
**Story:** 2 (S2.5)
**Story:** 7 (S7.1, S7.2, S7.3, S7.5)
**Story:** 16 (S16.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-artifacts.test.ts test/engine/build-review-aggregate.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend existing versioned artifact and aggregate parsers/writers with validated custom descriptors and judged-versus-failure discriminants. Store semantic/declaration/source/plugin/version/content/input/provider/model provenance at production, and a separate reuse link for current laps. Historic reads use the stored descriptor after configuration change/removal. Current aggregate membership comes from the lap catalog, so historic disabled evidence is inspectable but cannot re-enter current blockers.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): persist and read self-describing custom evidence and reuse provenance` after its checks pass.

**Done when:**
- Artifact round-trip integration preserves original policy/source/plugin/version/content/input/provider/model attribution and a separate current-lap reuse reference with no invented execution or charge.
- Reading removed/disabled/changed custom configurations preserves historic descriptors while excluding those old results from current membership; loading/invocation failures never claim unknown criteria were judged.

**Files:** `src/conductor/src/engine/build-review-artifacts.ts`; `src/conductor/src/engine/build-review-aggregate.ts`; `src/conductor/test/engine/build-review-artifacts.test.ts`; `src/conductor/test/engine/build-review-aggregate.test.ts`

**Dependencies:** Task 22

### Task 24: Extend suppression and exact settled recurrence to custom identities
**Story:** 13 (S13.2, S13.4, S13.5)
**Story:** 15 (S15.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-effective.test.ts test/engine/remediation-case-reconciler.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Use existing confidence-floor history and exact settled-case matching with tagged custom identities. Suppression is visible context but not an unresolved source row or operator risk record. Missing confidence stays unsuppressed; parser owns invalid confidence. Exact permitted non-action recurrence can settle without another judge or semantic charge. Changed policy invalidates exact reuse while retaining every prior case for semantic judgment; do not add string-equivalence logic.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): extend suppression and exact settled recurrence to custom identities` after its checks pass.

> **Amended 2026-09-11 by #1986:** The approved suppression mechanism includes durable non-blocking history, not only a visible current-lap bucket.

**Done when:**
- Effective-verdict integration retains rejected/deferred/operator-resolved/suppressed custom findings visibly outside repair work, leaves missing confidence unsuppressed, and never writes operator authority from suppression.
- The existing reconciler reuses an exact settled custom non-action without judging or charge but rejects exact reuse after policy identity changes and retains the original case history.
- The existing suppression-history store retains custom finding id, reported confidence, applied floor, summary, and last-seen lap across recurrence/removal; later adjudication receives that history separately from current sources without requiring action dispositions for it.

**Files:** `src/conductor/src/engine/build-review-effective.ts`; `src/conductor/src/engine/build-review-suppression-history.ts`; `src/conductor/src/engine/remediation-case-reconciler.ts`; `src/conductor/test/engine/build-review-effective.test.ts`; `src/conductor/test/engine/remediation-case-reconciler.test.ts`

**Dependencies:** Task 22, Task 23

### Task 25: Match custom accepted risk to the exact judged content
**Story:** 17 (S17.1, S17.4, S17.5)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-dispositions.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the existing self-describing versioned accepted-risk record with custom finding/declaration/effective-policy identity. Keep canonical feature scope and current built-in matching unchanged. Reuse the leased store; reviewer/adjudicator outcomes have no store-writing capability. Test changed content/declaration and same names separately from execution timing; accepted risk is not a waiver for a result with no judgment.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): match custom accepted risk to the exact judged content` after its checks pass.

**Done when:**
- The accepted-risk matcher resolves only the exact current custom finding/declaration/content within the feature and leaves changed same-named findings blocking while preserving built-in matching.
- Rejected, merged, deferred, suppressed, or escalated autonomous outcomes cannot create/replace risk records or substitute missing coverage for a judged finding.

**Files:** `src/conductor/src/engine/build-review-dispositions.ts`; `src/conductor/src/engine/build-review-accepted-risk.ts`; `src/conductor/test/engine/build-review-dispositions.test.ts`

**Dependencies:** Task 22, Task 23

### Task 26: Match digestless custom coverage to declaration and closed reason
**Story:** 17 (S17.2, S17.3, S17.5, S17.7)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-dispositions.test.ts test/engine/build-review-effective.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the distinct reduced-coverage record/matcher with versioned validated custom declaration identity and existing canonical feature plus exact closed reason. Include id, semantic skill, question, source, explicit resources; exclude installation/content/version, diagnostics, lap/scratch, provider/model/retry policy. Model unknown content as unavailable. Reuse existing minimum-judged-coverage and exhaustion rules. Invalid declarations are not a coverage subject; successful judged results never consult coverage as finding acceptance.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): match digestless custom coverage to declaration and closed reason` after its checks pass.

**Done when:**
- Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match.
- Changed declaration/resource/source/question/reason does not match; healed-policy findings remain blocking, invalid declarations are ineligible, and even fully waived infrastructure cannot make a zero-judgment lap PASS.

**Files:** `src/conductor/src/engine/build-review-dispositions.ts`; `src/conductor/src/engine/build-review-effective.ts`; `src/conductor/test/engine/build-review-dispositions.test.ts`; `src/conductor/test/engine/build-review-effective.test.ts`

**Dependencies:** Task 1, Task 23

### Task 27: Expose custom operator decisions through existing CLI and late-state checks
**Story:** 17 (S17.1, S17.2, S17.4, S17.6, S17.7)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-cli.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend existing findings/accept-risk/accept-reduced-coverage operations to select validated current custom subjects. Retain explicit operator identity, rationale, interactive-terminal, exhausted-failure and canonical-feature checks. Use the existing transactional read/modify/write and re-read current operator decisions under the effect lease; stale autonomous decisions cannot overwrite them. No new CLI verb, auto-waiver, or store. Test the real CLI operation boundary with faked terminal identity and disposable state.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): expose custom operator decisions through existing cli and late-state checks` after its checks pass.

> **Amended 2026-09-11 by #1986:** The Steps shorthand accept-risk/accept-reduced-coverage refers to existing build-review accept and build-review record-reduced-coverage, respectively. No alias or renamed command is introduced. The existing CLI parser and current-lap/duplicate refusals remain authoritative.

**Done when:**
- Existing operator CLI operations record exact custom risk or digestless declaration/reason coverage only with current identity, rationale, terminal, feature, and exhaustion checks; non-operator and invalid-declaration requests cannot write.
- A disposition recorded after judging begins is honored at application without stale overwrite or unrelated-finding clearance, and every applicable failure stays visibly unjudged.
- Through build-review accept and build-review record-reduced-coverage, CLI integration requires the existing --feature, --lap, --rationale and the appropriate --finding or --rubric selector, derives the closed reason from current engine state, and refuses stale laps or duplicate decisions without modifying the store.

**Files:** `src/conductor/src/engine/build-review-cli.ts`; `src/conductor/src/engine/build-review-disposition.ts`; `src/conductor/src/engine/build-review-dispositions.ts`; `src/conductor/test/engine/build-review-cli.test.ts`; `src/conductor/src/cli.ts`

**Dependencies:** Task 25, Task 26

### Task 28: Deliver complete policy, ownership, task, and prior-case context
**Story:** 12 (S12.5)
**Story:** 14 (S14.1, S14.2, S14.3)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-adjudication-context.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the existing case-context builder with current eligible findings, stored prior cases, each policy question/criteria/effective identity, reserved lifecycle owner map, and full admitted task contracts. Use the existing bounded context loading path; require complete inputs or stop before dispatch. The same remediate model judges duplicates, contradictions, ownership and admission; do not add another judge or string-match review questions. Model responses in tests are explicit fixtures, not proof of semantic correctness.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): deliver complete policy, ownership, task, and prior-case context` after its checks pass.

**Done when:**
- Adjudication-context integration delivers every current eligible source, prior case, policy criteria/identity/question, reserved owner, and complete admitted task contract to the existing single dispatcher.
- Unreadable/missing scope or case state and context overflow stop before model dispatch instead of truncating sources, criteria, or admission contracts.

**Files:** `src/conductor/src/engine/build-review-adjudication-context.ts`; `src/conductor/src/engine/build-review-adjudication-coordinator.ts`; `src/conductor/test/engine/build-review-adjudication-context.test.ts`

**Dependencies:** Task 23, Task 24

### Task 29: Represent consistency, admission, and escalation in case-v2
**Story:** 12 (S12.1, S12.2)
**Story:** 13 (S13.1)
**Story:** 14 (S14.1, S14.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/remediation-case-artifact.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the existing remediation artifact with tagged case-v2; retain case-v1 and non-case readers. Add consistent/blocked verdict with source/case refs and rationale, admitted existing task ids/rationale on act tasks, and product/plan/architecture escalate outcomes with no external action. Preserve complete source-to-case graph and merge provenance. Update executable dispatch/output-contract guidance in remediate; test parsed behavior rather than prose matching.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): represent consistency, admission, and escalation in case-v2` after its checks pass.

> **Amended 2026-09-11 by #1986:** Preserve the newly merged #2409 contract under the explicit implementation dependency above. The existing repeat-stop wording means an unrefuted attempted repair; admitted refutation uses the predecessor-owned resolution lane.

**Done when:**
- The remediation parser round-trips case-v2 duplicate/consistent-repair graphs with every original source, merge rationale, admission task id, and consistency verdict while retaining case-v1/non-case compatibility.
- Case-v2 can represent blocked consistency and product/plan/architecture escalation with source evidence and rationale without manufacturing an action, operator approval, or external effect.
- Case-v2 parsing retains the inherited #2409 refute/refuted payload, existing-case binding, assertion evidence, and terminal state through the shared case contract rather than creating a second refutation schema.

**Files:** `src/conductor/src/engine/remediation-case-artifact.ts`; `skills/remediate/SKILL.md`; `src/conductor/test/engine/remediation-case-artifact.test.ts`

**Dependencies:** Task 22

### Task 30: Reject incomplete source graphs and illegal partial action sets
**Story:** 12 (S12.3, S12.4)
**Story:** 13 (S13.1, S13.3)
**Story:** 14 (S14.4)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/remediation-case-validator.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Validate v2 complete current-source coverage exactly once, valid canonical merge targets, known bounded refs, consistency/rationale presence, existing task admission and effect legality before application. Reject omissions/duplicates/inventions, unresolved merge targets, nonexistent cases/tasks, missing rationale and contradictory graph outcomes. Block all action effects on any invalid/blocked/escalated result. Semantic compatibility belongs to the supplied adjudicator verdict; mechanics must not re-derive it from text.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): reject incomplete source graphs and illegal partial action sets` after its checks pass.

> **Amended 2026-09-11 by #1986:** Preserve the newly merged #2409 contract under the explicit implementation dependency above. The existing repeat-stop wording means an unrefuted attempted repair; admitted refutation uses the predecessor-owned resolution lane.

**Done when:**
- The case validator accepts exhaustive duplicate/consistent graphs but rejects omitted, duplicate, invented, unresolved-merge, nonexistent-reference, missing-consistency, contradictory-outcome, and missing-admission fixtures.
- Validation/application integration authorizes zero action effects for any invalid graph, blocked consistency, or escalation, including otherwise valid sibling actions.
- Case-v2 validation delegates refutations to the inherited one-time attempted-act refutation validator: invalid binding, missing high-confidence assertion evidence, unresolvable current-tree path/excerpt, or repeated refutation rejects the whole judgment with no action effects.

**Files:** `src/conductor/src/engine/remediation-case-validator.ts`; `src/conductor/src/engine/build-review-adjudication.ts`; `src/conductor/test/engine/remediation-case-validator.test.ts`

**Dependencies:** Task 28, Task 29

### Task 31: Persist decision-owner stops without turning current gaps into deferrals
**Story:** 12 (S12.3)
**Story:** 14 (S14.1, S14.3, S14.4, S14.5)
**Story:** 16 (S16.5)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-adjudication.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Persist the typed decision stop through the existing case/effect state owner. Retain implicated sources, rationale, and product/plan/architecture owner; escalation has no tracker effect, plan append, artifact rewrite, or BUILD charge. Context/output contract distinguishes current-outcome gaps from legitimate out-of-scope deferrals, whose existing durable path remains. Restart preserves the stop; explicit approved-baseline change permits new evaluation without rewriting historic verdicts.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): persist decision-owner stops without turning current gaps into deferrals` after its checks pass.

**Done when:**
- Decision-routing integration records each owner stop with original source evidence and zero work publication, plan append, sealed-artifact mutation, automatic waiver, or semantic charge.
- Current-outcome gaps cannot settle through deferral, restart alone retains decision/repeat stops, and an explicitly changed approved baseline causes new evaluation while preserving the old verdict.

**Files:** `src/conductor/src/engine/build-review-adjudication.ts`; `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/test/engine/build-review-adjudication.test.ts`

**Dependencies:** Task 30

### Task 32: Create one shared custom-review outcome operation
**Story:** 11 (S11.1, S11.3, S11.5)
**Story:** 12 (S12.1, S12.2)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-outcome.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extract the review-domain outcome application currently inside the daemon branch into one operation over a settled lap. Reuse coordinateBuildReviewAdjudication, current operator checks and durable case outcomes; return a lap-bound typed repair/decision-stop/infrastructure/settled route. Refuse partial branch input; consume existing recorded aggregate results without another semantic dispatch. This task owns the application-service boundary, while Task 33 owns navigation wiring.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): create one shared custom-review outcome operation` after its checks pass.

> **Amended 2026-09-11 by #1986:** The first check’s repair-or-stop result applies only to eligible unresolved content. Infrastructure-only and exact-settled laps preserve their existing no-judgment routes, as Task 34 and the approved mixed-lap ADR require.

**Done when:**
- The shared outcome operation waits for settled branches, sends eligible current content to exactly one adjudicator, and returns only a validated consistent admitted repair set or inspectable decision stop.
- Early/raw rubric instructions authorize no effect or charge, and consuming an already recorded lap outcome never invokes a second adjudicator.
- For a settled lap without eligible unresolved content, the shared outcome operation returns the existing infrastructure or settled route without a content judge; only the eligible-content branch is restricted to the first check’s admitted repair or decision-stop results.

**Files:** `src/conductor/src/engine/build-review-outcome.ts`; `src/conductor/src/engine/build-review-adjudication-coordinator.ts`; `src/conductor/test/engine/build-review-outcome.test.ts`

**Dependencies:** Task 24, Task 27, Task 28, Task 30, Task 31, Task 34

### Task 33: Route attended and daemon custom review through the shared operation
**Story:** 11 (S11.1, S11.3, S11.5)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/build-review-custom-routing.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Wire both real execution-mode entry paths to the shared operation whenever any custom rubric is enabled, including legacy/scalar provider wiring. Navigation/checkpoints consume its durable typed result; remove only the duplicated custom authority branch, preserving built-in-only behavior. A compatibility path lacking profile support returns a capability error before judging. Acceptance flow A is authored by writing-system-tests at BUILD entry; this task implements its aggregate-route behavior and owns the entry-point integration.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): route attended and daemon custom review through the shared operation` after its checks pass.

**Done when:**
- Attended and daemon entry integration each observes one settled custom aggregate judgment and one terminal repair or decision-stop route with no raw-finding kickback and no duplicate daemon adjudication.
- Unsupported scalar/compatibility wiring refuses custom review before judging, while no-custom routing retains the preexisting mode-specific behavior.

**Files:** `src/conductor/src/engine/conductor.ts`; `src/conductor/src/engine/conductor-deps.ts`; `src/conductor/test/integration/build-review-custom-routing.integration.test.ts`

**Dependencies:** Task 19, Task 32, Task 35, Task 37

### Task 34: Compose mixed coverage and content outcomes without erasing either
**Story:** 11 (S11.2, S11.4)
**Story:** 13 (S13.2)
**Story:** 17 (S17.7)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-adjudication-coordinator.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend the existing mixed-lap classification to dynamic descriptors and v2 decisions. One eligible content judgment may authorize consistent admitted action while infrastructure remains independently blocking. Infrastructure-only and exact-settled/no-live-source routes keep their no-content-judgment behavior and mechanical allowance. Minimum judged coverage remains mandatory even with waived failures. Keep the source eligibility predicate kind-based; no diagnostic string routing.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): compose mixed coverage and content outcomes without erasing either` after its checks pass.

**Done when:**
- Mixed-lap coordinator integration sends eligible custom content to one judgment and retains the sibling closed infrastructure failure even when an admitted repair route is selected.
- Infrastructure-only, exact-settled, and confidence-suppressed/no-live-source fixtures do not dispatch a content judge or semantic charge; wholly unjudged waived laps cannot PASS.

**Files:** `src/conductor/src/engine/build-review-aggregate.ts`; `src/conductor/src/engine/build-review-effective.ts`; `src/conductor/src/engine/build-review-adjudication-coordinator.ts`; `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`

**Dependencies:** Task 23, Task 24, Task 26, Task 30

### Task 35: Publish only admitted consistent repairs through the existing work order
**Story:** 13 (S13.1, S13.2)
**Story:** 14 (S14.2, S14.4)
**Story:** 15 (S15.1)
**Type:** happy-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-work-order.test.ts test/engine/remediation-case-effects.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Carry custom source identity and admitting task/rationale into the existing one-work-order effect. Publish only act cases from a validated consistent result after re-reading current operator state; retain merge/reject/defer/suppression/escalation evidence outside the delivered work. Reuse durable effect id and current-lap binding rather than a per-rubric work queue. Existing case transaction owns authorization; Task 38 owns crash recovery proof.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): publish only admitted consistent repairs through the existing work order` after its checks pass.

**Done when:**
- Work-order application publishes one durable prioritized repair set containing only admitted act outcomes, with real task ids, rationale, and complete custom/merged source links.
- Blocked/escalated/invalid/stale-lap results and all non-action dispositions publish no repair work; late exact operator decisions are respected without dropping unrelated unresolved sources.

**Files:** `src/conductor/src/engine/build-review-work-order.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/test/engine/build-review-work-order.test.ts`; `src/conductor/test/engine/remediation-case-effects.test.ts`

**Dependencies:** Task 27, Task 30, Task 31

### Task 36: Reopen invalidated verification when a custom repair changes code
**Story:** 15 (S15.1, S15.5)
**Type:** negative-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/build-review-custom-reverification.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Connect applied custom repair work to existing repair-obligation and gate-invalidating state writers. Code completion requires current evidence for every invalidated configured test/review gate before progression. Reuse current code/task proof binding and existing reopened-obligation semantics, not a new verifier. Acceptance flow B starts with custom repair authorization and ends at this progression decision; scoped integration covers current, stale, missing, and failing proof without extending into unrelated SHIP work.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): reopen invalidated verification when a custom repair changes code` after its checks pass.

**Done when:**
- The repair/progression entry flow applies one admitted custom repair, reopens its invalidated test/review obligations, and proceeds only after all required evidence binds to the repaired input.
- Progression integration refuses stale, missing, or failing post-repair test/review evidence and cannot consume the pre-repair PASS as current proof.

**Files:** `src/conductor/src/engine/repair-obligations.ts`; `src/conductor/src/engine/engine-state-store.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/test/integration/build-review-custom-reverification.integration.test.ts`

**Dependencies:** Task 33, Task 35

### Task 37: Preserve cumulative charges and semantic repeat stops for custom cases
**Story:** 15 (S15.2, S15.3, S15.4)
**Story:** 16 (S16.5)
**Type:** negative-path

**Steps:**
1. Add the unit or focused boundary integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/engine/build-review-custom-convergence.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Use existing effect-bound semantic charge and attempted-case ledger for custom action outcomes. The existing adjudicator sees all previous cases and supplies semantic recurrence even when wording/code movement or policy identity changes. Do not add a lifetime counter or reset on policy rename/update/disable/re-enable/fallback/restart. Preserve separately authorized rebase-invalidation refunds, fresh-session clears, explicit operator resets and per-tree failure behavior; tests distinguish those real triggers from policy changes.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): preserve cumulative charges and semantic repeat stops for custom cases` after its checks pass.

> **Amended 2026-09-11 by #1986:** Preserve the newly merged #2409 contract under the explicit implementation dependency above. The existing repeat-stop wording means an unrefuted attempted repair; admitted refutation uses the predecessor-owned resolution lane.

**Done when:**
- Convergence integration charges one new aggregate action effect, reuses exact settled non-actions without charge, and stops attempted/regressed semantic recurrence or an exhausted bound.
- Policy rename/update/disable/re-enable, fallback, incidental movement, and restart cannot reset charges; existing genuine rebase invalidation, fresh-session, and operator-reset fixtures retain their authorized ledger transitions.
- Infrastructure-only custom failures retain the existing total mechanical allowance and needs-human exhaustion route, with no semantic charge; mixed content remains governed by the separate aggregate action effect.
- The convergence path distinguishes an unrefuted attempted act from an admitted #2409 refutation: the former halts under the existing repeat rule, while the latter settles once without a BUILD route, semantic charge, or operator-risk mutation.

**Files:** `src/conductor/src/engine/kickback-ledger.ts`; `src/conductor/src/engine/build-review-adjudication.ts`; `src/conductor/src/engine/remediation-case-reconciler.ts`; `src/conductor/test/engine/build-review-custom-convergence.test.ts`

**Dependencies:** Task 24, Task 31, Task 35

### Task 38: Resume persisted custom outcomes and apply only missing effects
**Story:** 16 (S16.1, S16.2, S16.5)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/remediation-case-recovery.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend existing leased case/effect recovery with v2/custom descriptors and durable decision stops. Inject interruption before/after decision persist, work publication, and charge recording in the real internal recovery flow. Resume only missing authorized effects using stored ids, preserving original producing provenance after policy removal/update. A pending effect is not a settled PASS; restart does not clear decision or repeated-case stops. Every third-party effect adapter is a faithful fake.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): resume persisted custom outcomes and apply only missing effects` after its checks pass.

**Done when:**
- Recovery integration at each decision/work-publication/charge boundary completes only missing effects and observes at most one publication and one semantic charge with original custom source attribution.
- Removed/updated policy recovery preserves unresolved history and producing descriptors, while pending effects, decision stops, and attempted-repeat stops remain blocking until their existing resolution conditions hold.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/src/engine/build-review-work-order.ts`; `src/conductor/test/integration/remediation-case-recovery.integration.test.ts`

**Dependencies:** Task 23, Task 31, Task 35, Task 37

### Task 39: Refuse corrupt state and competing recovery effects
**Story:** 16 (S16.3, S16.4)
**Story:** 17 (S17.6)
**Type:** negative-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/integration/remediation-case-recovery.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Reuse existing conduct-state lease acquisition and atomic replacement for v2/custom state. Inject concurrent resumes, unreadable/malformed/incomplete records and failed writes at the transaction boundaries. Only the lease owner applies an effect; current operator state is checked inside the same protected application sequence. Never substitute empty state, infer completion from a missing record, or fall back to memory-only production defaults.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): refuse corrupt state and competing recovery effects` after its checks pass.

**Done when:**
- Concurrent recovery integration admits one effect owner and one publication/charge; a late exact operator disposition is re-read before application without stale overwrite.
- Unreadable, malformed, incomplete, or unwritable case/effect state stops with the affected state named, retaining blockers and preventing partial second publication or assumed completion.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/test/integration/remediation-case-recovery.integration.test.ts`

**Dependencies:** Task 38

### Task 40: Publish policy and decision provenance through existing event consumers
**Story:** 7 (S7.1, S7.2, S7.3, S7.5)
**Story:** 17 (S17.2, S17.3)
**Type:** happy-path

**Steps:**
1. Add the integration fixtures in the listed test file(s) for the mapped criteria, asserting each Done-when observation below. Preserve the explicit negative permutations; combine fixtures only when the same boundary and assertion suffice.
2. From `src/conductor`, run `npx vitest run test/daemon-render-build-review-rubrics.test.ts test/integration/build-review-policy-events.integration.test.ts` and observe RED for the behavior being added, not an import/setup failure.
3. Extend ConductorEvent and EVENT_SINKS for bounded policy resolution/failure and effective provenance; extend existing cache discard/hit, judgment, adjudication consistency/escalation and effect occurrences, not a parallel file or observer. Connect existing emitter/persister/CLI/daemon render consumers to historic custom descriptors and current reuse/failure records. Keep metadata-process lifecycle on the existing provider lifecycle/event path. Exclude credentials and full policy bodies; artifact/state writes are durable evidence under event-spine exception C, with their occurrences emitted.
4. Run the same scoped command and observe GREEN. Each mapped criterion uses the named boundary assertion below; direct helper proof cannot replace a task's entry-point obligation.
5. Commit the scoped change with message `feat(build-review): publish policy and decision provenance through existing event consumers` after its checks pass.

> **Amended 2026-09-11 by #1986:** The approved publication obligation also reaches retained PR and shipped-record consumers. This adds their named proof to the same publication-owning task; existing accepted-risk public redaction remains unchanged.

**Done when:**
- Emitter-to-persister/CLI/daemon integration renders custom source/plugin/version/content/input/candidate provenance, original production versus current reuse, and inspectable consistency/escalation/effect outcomes after configuration removal.
- Current policy failures and applicable digestless coverage remain visibly unjudged with operator attribution; bounded event payloads omit credentials/full policy bodies and cache reuse creates no model-execution or token-charge event.
- Cache discard publication retains existing engine/skill mismatch events and staged causes; ordinary projection/policy misses do not gain the old discard event, and new effective-policy diagnostics use typed declared sinks.
- The existing finish-publication and shipped-record entry adapters use the shared reduced-coverage renderer to publish rubric, closed reason, current diagnostic, operator, rationale, and decision time for matching custom failures; known unrenderable evidence blocks publication, healed/nonmatching failures add no notice, and accepted-risk output retains its existing finding-id/rubric-only public contract.

**Files:** `src/conductor/src/types/events.ts`; `src/conductor/src/engine/event-sinks.ts`; `src/conductor/src/engine/build-review-cli.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/src/engine/build-review-outcome.ts`; `src/conductor/src/daemon-cli.ts`; `src/conductor/test/daemon-render-build-review-rubrics.test.ts`; `src/conductor/test/integration/build-review-policy-events.integration.test.ts`; `src/conductor/src/engine/build-review-coordinator.ts`; `src/conductor/src/engine/audit-trail.ts`; `src/conductor/src/engine/build-review-projections.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/engine/shipped-record-cli.ts`; `src/conductor/src/engine/shipped-record.ts`; `src/conductor/test/engine/finish-publication-production.test.ts`; `src/conductor/test/engine/shipped-record.test.ts`

**Dependencies:** Task 19, Task 23, Task 27, Task 32, Task 38

## Integration Points

| Production boundary | Sole integration owner | Observable result |
| --- | --- | --- |
| Config loader to catalog membership/rejection | Tasks 1 and 2, disjoint valid/invalid behaviors | Loaded enablement reaches membership; invalid declarations stop before dispatch. |
| Codex and Claude metadata transports | Tasks 4 and 5 respectively; Task 6 owns failure termination | Actual prepared environment reaches host metadata; incomplete discovery terminates explicitly. |
| Installed selection/material contract | Tasks 3, 7, 8, 9, 10, 11, each owning its stated selection/capture/refusal/contract behavior | Complete unchanged source material or explicit unsupported coverage. |
| Frozen-input preparation | Task 12 | One captured source reaches every lap member. |
| Review containment and provider process invocation | Tasks 13 and 14, respectively | Probed access restrictions reach both real invoke adapters. |
| Auxiliary candidate lifecycle operation | Task 15 | Preparation, classification, accounting, and cleanup surround hits and execution. |
| Project configuration to custom provider judgment | Task 16 | Both hosts and three sources produce attributable review evidence. |
| Candidate loop to cache/fallback | Task 19 | Only actual-candidate policy can hit or write; fallback is independently prepared. |
| Built-in-only runner compatibility | Task 20 | Effective criteria bind cache without new custom prerequisites. |
| Result, artifact, and historic aggregate boundary | Tasks 21–23, disjoint parsing/stamping/persistence behaviors | Validated source identity and original producing evidence survive removal. |
| Effective suppression/settled recurrence | Task 24 | Only exact permitted settlement reuses; suppression is not operator risk. |
| Operator subjects and CLI transaction | Tasks 25–27, disjoint risk/coverage/CLI behaviors | Exact distinct identities and current operator state determine authorization. |
| Existing adjudicator context and result contract | Tasks 28–30, disjoint context/parser/validator behaviors | Complete input and valid exhaustive consistent admitted output before effects. |
| Decision stop persistence/resolution | Task 31 | Owner stop has no unauthorized effect and survives restart. |
| Shared outcome application service | Task 32 | One settled adjudication returns one lap-bound route. |
| Attended/daemon navigation entry | Task 33 | One aggregate route is consumed without re-judging or raw kickback. |
| Mixed/infrastructure-only aggregate classification | Task 34 | Content and coverage remain separate with minimum judged coverage. |
| Work-order publication | Task 35 | One admitted consistent action set only. |
| Repair to evidence/progression | Task 36 | Invalidated gates require current proof. |
| Case recurrence to convergence ledger | Task 37 | One charge and existing repeated/exhausted stops, with genuine reset/refund semantics retained. |
| Durable replay and transaction contention/failure | Tasks 38 and 39, respectively | Only missing effects apply once; corrupt/concurrent state cannot invent completion. |
| Emitter to persisted/read/rendered policy occurrences and retained PR/shipped-record publication | Task 40 | Current failures and original provenance remain visible through existing consumers without a parallel channel. |

Task numbers are identifiers, not a forced serial execution order. Dependencies are the authoritative acyclic readiness graph; shared Files additionally constrain safe scheduling. There is no terminal feature-wide validation task: the configured verifier and SHIP gates own that work.

## Coverage Check

Each row quotes a named mechanism's completion assertion from a cited task. Multiple task citations retain the full lower-layer behavior and its production wiring; the quotation is the primary terminal observation. Every referenced source is within the implementation's control, so these criteria are diff-local. Host fixtures prove the interface contract; they do not assert live model semantic correctness or private-package compatibility.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given one enabled project-local installation of a named policy and a valid enabled custom declaration, when review resolves that selection, then it selects that installation, delivers its criteria, and leaves its installed files unchanged without creating an authored project copy. | 3, 4, 5, 16 | "The public build-review runner delivers unchanged installed project/global/plugin criteria through both real provider adapters and publishes engine-stamped judged results from the actual candidate." | diff-local |
| Story 1 happy: Given one enabled global installation of a named policy and no competing match, when the same kind of declaration is reviewed, then the global installation supplies the criteria without requiring a local installation or changing another project's selection. | 3, 4, 5, 16 | "The public build-review runner delivers unchanged installed project/global/plugin criteria through both real provider adapters and publishes engine-stamped judged results from the actual candidate." | diff-local |
| Story 1 happy: Given an enabled installed plugin containing a named skill, when the project selects that plugin-qualified skill, then review uses that plugin's skill and preserves its plugin identity and installation source. | 3, 4, 5, 16 | "The public build-review runner delivers unchanged installed project/global/plugin criteria through both real provider adapters and publishes engine-stamped judged results from the actual candidate." | diff-local |
| Story 1 negative: Given distinct project and global installations match an unqualified selection, when review resolves it, then it names the conflicting sources and requests disambiguation without invoking either policy; an explicit matching source selection resolves the ambiguity. | 3, 16 | "The resolver refuses distinct-origin ambiguity even for byte-equal copies, selects the explicitly qualified source, and names absent, unreadable, disabled, marketplace-only, or incomplete installations without substituting another copy." | diff-local |
| Story 1 negative: Given the selected global installation is absent or unreadable, when review resolves it, then it names the policy and failed source without substituting a project or harness copy. | 3, 16 | "The resolver refuses distinct-origin ambiguity even for byte-equal copies, selects the explicitly qualified source, and names absent, unreadable, disabled, marketplace-only, or incomplete installations without substituting another copy." | diff-local |
| Story 1 negative: Given a plugin is disabled, only present in a marketplace listing, or lacks locally available required files, when review resolves its skill, then it reports unavailable installed policy without downloading, enabling, or choosing a cached alternative. | 3, 16 | "The resolver refuses distinct-origin ambiguity even for byte-equal copies, selects the explicitly qualified source, and names absent, unreadable, disabled, marketplace-only, or incomplete installations without substituting another copy." | diff-local |
| Story 2 happy: Given a valid custom declaration, when the maintainer enables it, then the existing build-review gate includes that member alongside enabled built-in members without a harness implementation edit. | 1 | "Configuration-to-catalog integration loads a valid custom declaration alongside testQuality and resolves its existing execution-policy fields without editing the registry implementation per policy." | diff-local |
| Story 2 happy: Given a declaration is disabled or omits enablement, when review runs, then it performs no discovery, cache access, or judgment for that member; disabling the public gate disables all its members. | 1 | "The effective catalog excludes omitted/disabled custom members and every member of a disabled public gate; instrumented downstream discovery, cache, and judge callbacks receive zero calls for them." | diff-local |
| Story 2 negative: Given a declaration uses a built-in or retired id, a prototype key, an invalid id or field, a duplicate configuration key, or more than 32 custom declarations, when configuration is loaded, then it identifies the invalid declaration before any rubric invocation. | 2 | "The production configuration loader rejects each invalid-id, reserved/retired/prototype-id, duplicate-key, unknown-field, invalid-source/resource, and 33-member fixture before any rubric callback." | diff-local |
| Story 2 negative: Given custom review is enabled while aggregate adjudication is disabled, when configuration is loaded, then it refuses that combination before judging rather than permitting independent repair authority. | 2 | "Configuration integration rejects enabled custom review with adjudication disabled, while legacy unknown keys still error and retired keys still warn and contribute no member." | diff-local |
| Story 2 negative: Given a formerly enabled rubric has cached findings but is now disabled, when the next lap is evaluated, then its historical evidence remains inspectable but supplies no current blocker or new repair work. | 23 | "Reading removed/disabled/changed custom configurations preserves historic descriptors while excluding those old results from current membership; loading/invocation failures never claim unknown criteria were judged." | diff-local |
| Story 3 happy: Given complete valid installed-policy metadata with one eligible canonical match, when review resolves the policy, then it proceeds with that match and identifies the selected source. | 3, 4, 5 | "The installed-policy resolver selects the project, global, and plugin-qualified fixtures with exact canonical source/plugin identity; aliases of one installation collapse and original files remain unchanged." | diff-local |
| Story 3 happy: Given two discovered aliases resolve to the same canonical installation, when selection is evaluated, then it selects that one installation without reporting a false ambiguity. | 3 | "The installed-policy resolver selects the project, global, and plugin-qualified fixtures with exact canonical source/plugin identity; aliases of one installation collapse and original files remain unchanged." | diff-local |
| Story 3 negative: Given catalog output is partial, malformed, reports errors, or uses an unsupported format, when selection runs, then it reports a catalog failure rather than treating an empty or incomplete list as confirmed absence or successful coverage. | 6 | "Both metadata adapters classify partial-success, error-bearing, malformed, unsupported, unreadable, timeout, and cancellation fixtures as named loading failures rather than confirmed absence or judged coverage." | diff-local |
| Story 3 negative: Given catalog discovery times out, is canceled, or cannot read the selected source, when discovery terminates, then the candidate's discovery activity is stopped and the affected policy receives a loading failure with no judging call, cache hit, or cache write. | 6 | "Catalog-failure integration observes terminated child/session activity, zero policy judge/cache calls, and no provider-unavailable fallback for an otherwise available candidate." | diff-local |
| Story 3 negative: Given two byte-identical copies have different canonical installation origins, when an unqualified selection is resolved, then review reports ambiguity instead of deduplicating them by content. | 3 | "The resolver refuses distinct-origin ambiguity even for byte-equal copies, selects the explicitly qualified source, and names absent, unreadable, disabled, marketplace-only, or incomplete installations without substituting another copy." | diff-local |
| Story 3 negative: Given a required declared capability is unavailable to the selected reviewer, when preflight examines that policy, then it names the capability and recovery action before requesting its judgment; it does not activate unrelated plugin components. | 11 | "Policy preflight rejects declared unavailable capabilities/actions before judging and reports provider, capability, and recovery without activating unrelated components." | diff-local |
| Story 4 happy: Given a compatible installed skill with ordinary instructions and supporting criteria, when it participates in review, then the reviewer receives those criteria and returns attributable findings without requiring new harness-specific frontmatter or an installed-file edit. | 10, 16 | "The review-contract renderer delivers unchanged ordinary skill criteria and supporting material with the shared findings schema, without requiring harness-specific frontmatter or installed-file edits." | diff-local |
| Story 4 happy: Given a skill describes a standalone presentation format but can apply its criteria in review mode, when it is invoked, then its review evidence follows the shared finding contract and its presentation instructions do not replace the aggregate verdict. | 10, 16 | "A standalone-presentation fixture remains reviewable under the engine envelope and cannot supply the aggregate verdict, repair work order, or another output contract." | diff-local |
| Story 4 negative: Given declared required actions cannot run in the supported review role, when policy preflight runs, then the affected policy is refused before judging, with the incompatible requirement named and no reported coverage. | 11, 16 | "Policy preflight rejects declared unavailable capabilities/actions before judging and reports provider, capability, and recovery without activating unrelated components." | diff-local |
| Story 4 negative: Given an undeclared dynamic dependency or incompatible instruction is discovered during review, when the policy reports that inability, then the result is explicitly unsupported rather than an empty successful judgment or permission to edit code, install dependencies, or publish comments. | 11, 16 | "The custom result boundary maps a runtime unsupported response to visibly unjudged failed coverage; it neither accepts an empty PASS nor grants edits, installation, publishing, or repair authority." | diff-local |
| Story 5 happy: Given equivalent installed policy content for Claude Code and Codex, when each provider reviews the same declared policy and implementation input, then each receives the complete selected criteria and the same review obligations and output contract, with its own producing provenance; identical model wording is not required. | 14, 16 | "Both production invoke adapters deliver the same full review envelope and captured support tree through the enforced read-only profile while retaining provider-specific producing identity and private bookkeeping." | diff-local |
| Story 5 happy: Given the preferred provider or model is unavailable and a configured fallback can load the selected policy, when fallback runs, then that actual candidate reviews its resolved policy under the same declaration and reports its own identity. | 19 | "Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge." | diff-local |
| Story 5 negative: Given the fallback lacks the selected policy or resolves it ambiguously, when it prepares review, then it reports failed policy coverage without borrowing the preferred provider's policy or silently selecting another installation. | 16, 19 | "Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback." | diff-local |
| Story 5 negative: Given policy loading fails on an otherwise available candidate, when routing evaluates that failure, then it does not classify it as provider unavailability merely to obtain a different policy judgment. | 6, 16, 19 | "Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback." | diff-local |
| Story 5 negative: Given a candidate fails authentication, is canceled, or returns a malformed review result, when that attempt ends, then it retains the existing cause-specific failure/fallback rules and records no invented successful judgment; all candidate-owned activity ends. | 15, 16 | "Auxiliary lifecycle tests observe prepare before the candidate operation and exactly one cleanup after hit, invoke success, authentication failure, malformed result, timeout, or cancellation." | diff-local |
| Story 6 happy: Given a selected skill references supporting criteria inside its package, when review begins, then the reviewer can read the captured required content at its preserved relative locations, including safely resolved in-package links. | 7 | "The policy-bundle loader delivers SKILL.md, nested criteria, and admitted in-package link targets at preserved relative locations with bytes equal to the captured manifest." | diff-local |
| Story 6 happy: Given the installed package remains unchanged throughout loading, when review uses it, then the effective content identity describes exactly the captured definition and supporting package bytes delivered to that candidate. | 7 | "Bundle identity changes with every captured package-byte change, agrees with the delivered material, and remains unchanged when only its runtime parent path changes." | diff-local |
| Story 6 negative: Given a required resource is missing or unreadable, a local file reference is broken, or a link escapes the admitted package or cycles, when policy loading runs, then it identifies the resource defect and requests no informed judgment or cache lookup from that policy. | 8 | "The bundle loader rejects missing/unreadable resources, broken local references, escaping/cyclic links, and special-file fixtures with the offending resource named and no eligible bundle." | diff-local |
| Story 6 negative: Given the package exceeds 4,096 files or 64 MiB, or contains a special file, when loading runs, then it reports the breached limit or unsupported resource without truncating the policy into apparent coverage. | 8 | "Boundary fixtures accept 4096 files and 64 MiB but refuse either exceeded limit without a partial manifest, judging call, or cache lookup." | diff-local |
| Story 6 negative: Given package content changes during capture or storage cannot complete the captured material, when loading finishes, then it rejects the incomplete or inconsistent material without publishing an eligible judgment/cache entry; a later attempt must load again. | 9 | "The bundle capture rejects changed definition/resource bytes, added/removed members, and changed link targets between capture and final consistency check." | diff-local |
| Story 7 happy: Given a successful custom-policy judgment, when evidence is published, then it identifies the semantic skill, declaration, installation source, plugin/version when available, effective content, reviewed input, and producing provider/model policy. | 23, 40 | "Artifact round-trip integration preserves original policy/source/plugin/version/content/input/provider/model attribution and a separate current-lap reuse reference with no invented execution or charge." | diff-local |
| Story 7 happy: Given a compatible prior judgment is reused, when the current lap is published, then it retains the original producing provenance and identifies the current reuse separately without claiming another model execution or token charge. | 23, 40 | "Artifact round-trip integration preserves original policy/source/plugin/version/content/input/provider/model attribution and a separate current-lap reuse reference with no invented execution or charge." | diff-local |
| Story 7 negative: Given a policy fails loading or invocation, when its result is reported, then it is distinguishable from a judged result and does not claim that unavailable criteria were reviewed. | 23, 40 | "Reading removed/disabled/changed custom configurations preserves historic descriptors while excluding those old results from current membership; loading/invocation failures never claim unknown criteria were judged." | diff-local |
| Story 7 negative: Given a reviewer supplies a forged rubric, lap, policy, provider, verdict, case identity, or out-of-input evidence reference, when its result is validated, then those claims cannot become authoritative evidence or an eligible cache result. | 21, 22 | "Out-of-input/invalid references produce no eligible judged result, and a same-named changed policy yields a different exact finding identity while built-in identity fixtures remain unchanged." | diff-local |
| Story 7 negative: Given custom policy configuration is later removed or changed, when historical evidence is inspected, then it remains attributable to its original descriptor rather than being relabeled through today's configuration or rendered unreadable. | 23, 40 | "Reading removed/disabled/changed custom configurations preserves historic descriptors while excluding those old results from current membership; loading/invocation failures never claim unknown criteria were judged." | diff-local |
| Story 8 happy: Given a valid prior result and unchanged effective policy, review input, contracts, engine content, and execution policy, when the same candidate reviews again, then it reuses that judgment without another judging call. | 17, 19 | "Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge." | diff-local |
| Story 8 happy: Given only temporary runtime paths, lap timing, or commit addresses change while all semantic inputs remain equivalent, when reuse is evaluated, then those incidental changes alone do not invalidate the judgment. | 17, 19 | "The pure cache matcher hits for identical semantic identity and temporary-path, lap-time, publication-time, or commit-address-only changes, while retaining the original producing provenance." | diff-local |
| Story 8 negative: Given the skill definition, a supporting package file, declared question/source, reviewed content, contract, engine content, or resolved execution policy changes, when reuse is evaluated, then an incompatible prior judgment is not reused and the mismatch remains attributable. | 17, 19 | "Independent changes to definition/support bytes, question/source/resources, input, contract/projection, execution policy, engine content stamp, actual provider, model, or effort produce attributable misses." | diff-local |
| Story 8 negative: Given a legacy entry lacks effective-policy evidence or a stored entry is malformed, when review encounters it, then it misses without fabricating provenance; only a newly valid result can replace it. | 18, 19 | "Legacy missing-evidence entries miss with their staged cause, malformed entries miss as invalid, and interrupted/failed writes cannot publish an eligible partial result or destroy the other candidate entry." | diff-local |
| Story 8 negative: Given loading of the current effective policy fails or a cache write cannot complete, when that branch settles, then no partial entry becomes eligible for future reuse and the existing failure semantics remain effective. | 18, 19 | "Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback." | diff-local |
| Story 9 happy: Given the actual fallback has an eligible judgment for its own effective policy, when the preferred candidate is unavailable, then fallback reuses its own result and retains that producing identity. | 19 | "Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge." | diff-local |
| Story 9 happy: Given both preferred and fallback candidates have different valid warm results, when routing alternates between them, then each can reuse its own compatible result without the other's write destroying its reusable candidate entry. | 18, 19 | "Temporary-cache integration preserves separate warm preferred/fallback entries and only reads an entry whose full effective candidate identity and validated result match." | diff-local |
| Story 9 negative: Given a warm preferred-candidate result and different effective policy bytes for the fallback, when fallback is selected, then the preferred result cannot satisfy it, even if the declaration and implementation input are unchanged. | 19 | "Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge." | diff-local |
| Story 9 negative: Given preferred-candidate preparation succeeds but invocation reports provider/model unavailability, when fallback prepares, then it performs policy resolution and reuse eligibility for itself rather than inheriting the earlier prepared identity. | 19 | "Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback." | diff-local |
| Story 9 negative: Given candidate preparation or cancellation ends before policy resolution succeeds, when that attempt is cleaned up, then it leaves no claimed cache hit, judged artifact, or successful coverage for that candidate. | 15, 19 | "Existing unavailability classification, session policy, attempt accounting, and non-review callers retain their behavior; cancellation/preparation failure cannot emit a claimed judgment or cache hit." | diff-local |
| Story 10 happy: Given a lap with enabled custom policies and a built-in peer, when the rubrics execute, then all observe the same frozen implementation input and receive only their own review context, regardless of completion order. | 12 | "Input-preparation integration gives every custom and built-in peer the same captured source identity, independent of completion order, with no sibling evidence in branch contexts." | diff-local |
| Story 10 happy: Given the selected provider needs writable bookkeeping during a supported custom review, when the reviewer runs, then it can write its private scratch while the reviewed source, original checkout, original policy installation, and engine evidence remain protected. | 13, 14 | "The production containment adapter reaches its fake process boundary and admits scratch writes while refusing protected source/installation/engine-state writes and sibling-evidence reads under the generated mount profile." | diff-local |
| Story 10 negative: Given a reviewer attempts to modify protected input or read a sibling's private review evidence, when that access is attempted, then it cannot alter protected state or obtain the sibling evidence; no later rubric observes a changed input caused by that reviewer. | 13, 14 | "The production containment adapter reaches its fake process boundary and admits scratch writes while refusing protected source/installation/engine-state writes and sibling-evidence reads under the generated mount profile." | diff-local |
| Story 10 negative: Given containment is unavailable, a protected-write or scratch-write probe fails, or the host's nested sandbox cannot support the boundary, when review prepares, then it names the provider, missing capability, and recovery action before judging, with no writable fallback. | 13, 14 | "Missing bubblewrap, a successful protected write, failed scratch write, or unsupported nested sandbox yields a named unsupported-capability failure and zero reviewer launches with no writable fallback." | diff-local |
| Story 10 negative: Given the original checkout changes after a custom lap's input was captured, when remaining reviewers execute, then they still observe that lap's captured input and their evidence is not relabeled as reviewing the new checkout. | 12 | "Changing the original checkout after capture leaves later reviewer reads and evidence identity on the captured bytes; a built-in-only fixture creates no custom materialization prerequisite." | diff-local |
| Story 11 happy: Given enabled custom policies produce unresolved findings in either attended or daemon execution, when all branches settle, then one aggregate decision consumes their eligible findings and supplies the sole repair or decision-stop route for that lap. | 32, 33 | "Attended and daemon entry integration each observes one settled custom aggregate judgment and one terminal repair or decision-stop route with no raw-finding kickback and no duplicate daemon adjudication." | diff-local |
| Story 11 happy: Given a valid custom finding and a sibling infrastructure failure, when the lap is evaluated, then both remain visible, content receives the one aggregate judgment, and an admitted consistent repair may proceed while the infrastructure result remains independently blocking. | 34 | "Mixed-lap coordinator integration sends eligible custom content to one judgment and retains the sibling closed infrastructure failure even when an admitted repair route is selected." | diff-local |
| Story 11 negative: Given one reviewer finishes early or instructs immediate repair, when other branches are unsettled, then no implementation work or semantic charge is authorized by that individual result. | 32, 33 | "Early/raw rubric instructions authorize no effect or charge, and consuming an already recorded lap outcome never invokes a second adjudicator." | diff-local |
| Story 11 negative: Given an infrastructure-only lap, or content already settled by exact permitted dispositions with no live finding, when review evaluates it, then it preserves the corresponding existing no-judgment route rather than inventing new content work. | 34 | "Infrastructure-only, exact-settled, and confidence-suppressed/no-live-source fixtures do not dispatch a content judge or semantic charge; wholly unjudged waived laps cannot PASS." | diff-local |
| Story 11 negative: Given an attended compatibility path cannot provide the required custom-review capability, when it prepares the lap, then it refuses before judging rather than routing raw findings directly to BUILD; consuming a recorded aggregate result never invokes a second adjudicator. | 32, 33 | "Unsupported scalar/compatibility wiring refuses custom review before judging, while no-custom routing retains the preexisting mode-specific behavior." | diff-local |
| Story 12 happy: Given two custom policies identify the same admitted defect, when the aggregate judgment merges their findings, then one repair case retains both original findings and the reason for their shared disposition. | 29, 32 | "The remediation parser round-trips case-v2 duplicate/consistent-repair graphs with every original source, merge rationale, admission task id, and consistency verdict while retaining case-v1/non-case compatibility." | diff-local |
| Story 12 happy: Given two policies propose incompatible repairs and the aggregate judgment resolves them consistently within approved scope, when that judgment is accepted, then the worker receives only the selected consistent repair set and can inspect the disposition of both proposals. | 29, 32 | "The shared outcome operation waits for settled branches, sends eligible current content to exactly one adjudicator, and returns only a validated consistent admitted repair set or inspectable decision stop." | diff-local |
| Story 12 negative: Given the conflict remains unresolved, when the aggregate reports blocked consistency, then no action from that adjudication reaches the worker and the stop identifies the implicated findings and rationale. | 30, 31 | "Validation/application integration authorizes zero action effects for any invalid graph, blocked consistency, or escalation, including otherwise valid sibling actions." | diff-local |
| Story 12 negative: Given a decision omits consistency, has contradictory outcomes, or references nonexistent findings/cases, when it is checked, then none of its action effects is applied and the defect is reported. | 30 | "The case validator accepts exhaustive duplicate/consistent graphs but rejects omitted, duplicate, invented, unresolved-merge, nonexistent-reference, missing-consistency, contradictory-outcome, and missing-admission fixtures." | diff-local |
| Story 12 negative: Given complete current findings, relevant policy/scope context, or required prior-case history cannot fit within the supported bounds or cannot be loaded, when adjudication prepares, then it stops rather than judging a truncated account or delivering partially reconciled work. | 28 | "Unreadable/missing scope or case state and context overflow stop before model dispatch instead of truncating sources, criteria, or admission contracts." | diff-local |
| Story 13 happy: Given several current unresolved custom findings, when the aggregate settles, then every finding has one traceable permitted outcome, including a retained canonical target for merged findings, and only admitted action outcomes supply repair work. | 29, 30, 35 | "Work-order application publishes one durable prioritized repair set containing only admitted act outcomes, with real task ids, rationale, and complete custom/merged source links." | diff-local |
| Story 13 happy: Given rejected, legitimately deferred, operator-resolved, or confidence-suppressed custom findings, when the effective gate outcome is derived, then those findings remain inspectable without becoming autonomous repair work; suppression remains distinct from accepted risk. | 24, 34, 35 | "Effective-verdict integration retains rejected/deferred/operator-resolved/suppressed custom findings visibly outside repair work, leaves missing confidence unsuppressed, and never writes operator authority from suppression." | diff-local |
| Story 13 negative: Given a judgment omits, duplicates, or invents a source finding or leaves a merge target unresolved, when it is validated, then it cannot settle successfully or partially apply valid sibling actions. | 30 | "The case validator accepts exhaustive duplicate/consistent graphs but rejects omitted, duplicate, invented, unresolved-merge, nonexistent-reference, missing-consistency, contradictory-outcome, and missing-admission fixtures." | diff-local |
| Story 13 negative: Given a custom finding has absent confidence, invalid confidence, or an attempted self-awarded disposition, when its result is interpreted, then absent confidence is not suppressed, invalid confidence is malformed, and the reviewer cannot grant itself operator authorization. | 21, 24 | "The descriptor-selected parser accepts bounded custom findings and absent confidence, but rejects invalid confidence and forged rubric/lap/policy/provider/verdict/case/effect/disposition fields." | diff-local |
| Story 13 negative: Given a current policy update changes a finding's effective identity, when historic settled outcomes are considered, then the new finding cannot be treated as an exact settled recurrence solely because its rubric name or wording matches; prior cases remain available for semantic judgment. | 22, 24 | "The existing reconciler reuses an exact settled custom non-action without judging or charge but rejects exact reuse after policy identity changes and retains the original case history." | diff-local |
| Story 14 happy: Given a policy finding requires changing the approved product requirement, implementation plan, or architecture, when the aggregate identifies that need, then it records the appropriate decision owner and an actionable stop with the source findings preserved. | 28, 29, 31 | "Decision-routing integration records each owner stop with original source evidence and zero work publication, plan append, sealed-artifact mutation, automatic waiver, or semantic charge." | diff-local |
| Story 14 happy: Given an actionable finding can be repaired under an existing approved task, when the aggregate authorizes it, then the repair cites the admitting task and explains how the repair fits that approved scope. | 28, 29, 35 | "Work-order application publishes one durable prioritized repair set containing only admitted act outcomes, with real task ids, rationale, and complete custom/merged source links." | diff-local |
| Story 14 negative: Given a custom policy attempts to take over product-completion or architecture-choice authority, when findings are adjudicated, then it cannot override that authority or authorize an unapproved mechanism; the recorded outcome explains rejection or the required decision stop. | 28, 31 | "Decision-routing integration records each owner stop with original source evidence and zero work publication, plan append, sealed-artifact mutation, automatic waiver, or semantic charge." | diff-local |
| Story 14 negative: Given an action cites a nonexistent task or lacks admission evidence, or any case requires escalation, when the result is checked, then no action from that adjudication is delivered and no plan task is appended or BUILD charge spent for the escalation. | 30, 31, 35 | "Validation/application integration authorizes zero action effects for any invalid graph, blocked consistency, or escalation, including otherwise valid sibling actions." | diff-local |
| Story 14 negative: Given a gap affects the current approved outcome, when a reviewer proposes treating it as an unrelated future improvement, then review cannot settle it through a non-blocking deferral; after an explicit owning decision changes the approved baseline, recovery re-evaluates without rewriting the old verdict into PASS. | 31 | "Current-outcome gaps cannot settle through deferral, restart alone retains decision/repeat stops, and an explicitly changed approved baseline causes new evaluation while preserving the old verdict." | diff-local |
| Story 15 happy: Given a new consistent set of admitted code repairs within the remaining allowance, when the aggregate authorizes repair and BUILD completes it, then one repair route is charged and all tests and reviews invalidated by that repair must supply current evidence before the feature proceeds. | 35, 36 | "The repair/progression entry flow applies one admitted custom repair, reopens its invalidated test/review obligations, and proceeds only after all required evidence binds to the repaired input." | diff-local |
| Story 15 happy: Given a settled non-action custom finding recurs with the same effective identity, when the next lap is evaluated, then its permitted finalized outcome can be reused without a new adjudicator call or semantic repair charge, while retaining the original case evidence. | 24, 37 | "The existing reconciler reuses an exact settled custom non-action without judging or charge but rejects exact reuse after policy identity changes and retains the original case history." | diff-local |
| Story 15 negative: Given an attempted or regressed case is reported again with equivalent substance despite wording or code movement, when the aggregate identifies that unrefuted recurrence and again proposes action, then it follows the existing repeated-case stop rather than granting a fresh repair allowance. | 37 | "Convergence integration charges one new aggregate action effect, reuses exact settled non-actions without charge, and stops attempted/regressed semantic recurrence or an exhausted bound." | diff-local |
| Story 15 negative: Given the cumulative bound is exhausted or a policy is renamed, updated, disabled, and re-enabled, when new repair routing is evaluated, then those changes do not reset the feature's accumulated charges or authorize an over-limit route. | 37 | "Policy rename/update/disable/re-enable, fallback, incidental movement, and restart cannot reset charges; existing genuine rebase invalidation, fresh-session, and operator-reset fixtures retain their authorized ledger transitions." | diff-local |
| Story 15 negative: Given repair completes but invalidated test or review evidence is stale, missing, or failing, when progression is attempted, then the feature cannot proceed on the pre-repair success and the known failure remains blocking. | 36 | "Progression integration refuses stale, missing, or failing post-repair test/review evidence and cannot consume the pre-repair PASS as current proof." | diff-local |
| Story 16 happy: Given an admitted custom-policy action is interrupted around decision persistence, work publication, or charge recording, when recovery runs, then it completes only missing authorized effects, retains original source attribution, and records at most one publication and one semantic charge for that action. | 38 | "Recovery integration at each decision/work-publication/charge boundary completes only missing effects and observes at most one publication and one semantic charge with original custom source attribution." | diff-local |
| Story 16 happy: Given a custom policy is removed or its installation changes after a decision was recorded, when recovery reads the old decision, then it retains that decision's original identity and complete unresolved history while evaluating any new lap against current policy. | 23, 38 | "Removed/updated policy recovery preserves unresolved history and producing descriptors, while pending effects, decision stops, and attempted-repeat stops remain blocking until their existing resolution conditions hold." | diff-local |
| Story 16 negative: Given concurrent recovery attempts encounter the same pending effect, when they try to resume it, then only one can own its application and the other cannot duplicate work or charge. | 39 | "Concurrent recovery integration admits one effect owner and one publication/charge; a late exact operator disposition is re-read before application without stale overwrite." | diff-local |
| Story 16 negative: Given required durable state is unreadable, malformed, incomplete, or cannot be written, when recovery evaluates it, then it stops with the affected state named rather than assuming completion, dropping unresolved findings, or publishing a partial second effect. | 39 | "Unreadable, malformed, incomplete, or unwritable case/effect state stops with the affected state named, retaining blockers and preventing partial second publication or assumed completion." | diff-local |
| Story 16 negative: Given recovery resumes a decision stop or an already attempted repeated case, when the run restarts, then restart alone neither clears the stop nor buys another repair route; required operator decisions and existing bounds remain in force. | 31, 37, 38 | "Removed/updated policy recovery preserves unresolved history and producing descriptors, while pending effects, decision stops, and attempted-repeat stops remain blocking until their existing resolution conditions hold." | diff-local |
| Story 17 happy: Given an exact current operator accepted-risk decision covers a custom finding, when review evaluates it, then that finding remains visible as operator-resolved and does not create autonomous repair work. | 25, 27 | "The accepted-risk matcher resolves only the exact current custom finding/declaration/content within the feature and leaves changed same-named findings blocking while preserving built-in matching." | diff-local |
| Story 17 happy: Given a valid custom declaration whose policy has never loaded, an exhausted loading failure, a healthy judged sibling, and an exact current operator reduced-coverage decision for that declaration and closed failure reason, when the aggregate is evaluated, then that decision applies without an effective content fingerprint and the failed branch remains visibly unjudged. | 26, 27, 40 | "Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match." | diff-local |
| Story 17 happy: Given a custom reduced-coverage decision and the same validated declaration and closed failure reason, when the installed package changes or review restarts, then the decision still applies to that missing coverage and the current failure is reported without claiming the package was judged. | 26, 40 | "Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match." | diff-local |
| Story 17 negative: Given an automated rejection, deferral, merge, suppression, or escalation occurs, when it is recorded, then it cannot create, replace, or broaden an operator accepted-risk or reduced-coverage decision. | 25, 27 | "Rejected, merged, deferred, suppressed, or escalated autonomous outcomes cannot create/replace risk records or substitute missing coverage for a judged finding." | diff-local |
| Story 17 negative: Given risk acceptance belongs to different effective policy content, or reduced coverage belongs to a different validated declaration or closed failure reason, when current evidence is evaluated, then it cannot authorize the new finding or failure merely because its rubric name matches. | 25, 26 | "Changed declaration/resource/source/question/reason does not match; healed-policy findings remain blocking, invalid declarations are ineligible, and even fully waived infrastructure cannot make a zero-judgment lap PASS." | diff-local |
| Story 17 negative: Given the operator records a disposition after adjudication starts but before effects apply, when the result is applied, then the current exact disposition is respected and cannot be overwritten by stale autonomous work; unrelated unresolved findings remain blocking. | 27, 39 | "A disposition recorded after judging begins is honored at application without stale overwrite or unrelated-finding clearance, and every applicable failure stays visibly unjudged." | diff-local |
| Story 17 negative: Given a previously covered policy now produces a judged finding, or every rubric remains unjudged, when the aggregate is evaluated, then reduced coverage cannot suppress that finding or make the entirely unjudged lap pass; invalid declarations and non-operator callers cannot gain waiver authority. | 26, 27, 34 | "Changed declaration/resource/source/question/reason does not match; healed-policy findings remain blocking, invalid declarations are ineligible, and even fully waived infrastructure cannot make a zero-judgment lap PASS." | diff-local |
| Story 18 happy: Given no custom declarations, when review runs, then existing built-in selection/defaults, empty-container and empty-scope behavior, permitted dispositions, and attended/daemon routing remain effective without requiring custom-policy containment. | 20 | "No-custom fixtures preserve attended/daemon, default/empty-container/empty-scope behavior and require no custom containment; generic custom findings cannot bypass testQuality vocabulary, scope, preflight, or anchor checks." | diff-local |
| Story 18 happy: Given an enabled built-in rubric and an unchanged effective policy on the actual candidate, when an eligible judgment exists, then review retains reuse; changed effective built-in criteria invalidate incompatible reuse without erasing existing built-in operator-risk binding. | 20 | "Built-in runner integration hits for unchanged candidate criteria, misses after effective criteria change, and refuses warm harness-root evidence when the actual candidate cannot load its policy, without changing built-in risk matching." | diff-local |
| Story 18 negative: Given an unknown key in the legacy rubric subtree or a retired rubric key, when configuration is loaded, then the unknown key retains rejection and the retired key retains its warning/no-op behavior rather than silently becoming a custom policy. | 2 | "Configuration integration rejects enabled custom review with adjudication disabled, while legacy unknown keys still error and retired keys still warn and contribute no member." | diff-local |
| Story 18 negative: Given a built-in candidate cannot load the effective criteria, when review considers a warm harness-root judgment, then it cannot use that cache entry to claim successful coverage; missing effective-policy evidence still requires a miss or loading failure. | 20 | "Built-in runner integration hits for unchanged candidate criteria, misses after effective criteria change, and refuses warm harness-root evidence when the actual candidate cannot load its policy, without changing built-in risk matching." | diff-local |
| Story 18 negative: Given a custom finding shape is supplied to the built-in rubric, when the result is validated, then the specialized built-in vocabulary, scope, preflight, and anchor rules remain intact rather than accepting the generic custom contract. | 20, 21 | "No-custom fixtures preserve attended/daemon, default/empty-container/empty-scope behavior and require no custom containment; generic custom findings cannot bypass testQuality vocabulary, scope, preflight, or anchor checks." | diff-local |

## Architecture Obligation Coverage

All 43 citable decisions extracted by the repository parser from the seven changed accepted ADRs are mapped below. The one-owner ADR has no numbered citable decisions; its substantive ownership constraint is implemented by Tasks 28–31. Older clauses apply with their accepted amendments and later supersessions, including mixed-lap content handling.

> **Amended 2026-09-11 by #1986:** The land gate requires every changed approved ADR to have a citable decision. The existing one-owner decision is now labeled D1 without changing its substance. The authoritative mapping therefore contains 44 decisions; its added row cites the already-approved ownership and effect checks.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-10-portable-build-review-policy#D1 | task | task-1, task-2 | Configuration-to-catalog integration loads a valid custom declaration alongside testQuality and resolves its existing execution-policy fields without editing the registry implementation per policy. |
| adr-2026-09-10-portable-build-review-policy#D2 | task | task-3, task-4, task-5, task-6 | The installed-policy resolver selects the project, global, and plugin-qualified fixtures with exact canonical source/plugin identity; aliases of one installation collapse and original files remain unchanged. |
| adr-2026-09-10-portable-build-review-policy#D3 | task | task-7, task-8, task-9 | The policy-bundle loader delivers SKILL.md, nested criteria, and admitted in-package link targets at preserved relative locations with bytes equal to the captured manifest. |
| adr-2026-09-10-portable-build-review-policy#D4 | task | task-10, task-11, task-16 | The review-contract renderer delivers unchanged ordinary skill criteria and supporting material with the shared findings schema, without requiring harness-specific frontmatter or installed-file edits. |
| adr-2026-09-10-portable-build-review-policy#D5 | task | task-12, task-13, task-14 | Input-preparation integration gives every custom and built-in peer the same captured source identity, independent of completion order, with no sibling evidence in branch contexts. |
| adr-2026-09-10-portable-build-review-policy#D6 | task | task-15, task-17, task-18, task-19, task-20 | Auxiliary lifecycle tests observe prepare before the candidate operation and exactly one cleanup after hit, invoke success, authentication failure, malformed result, timeout, or cancellation. |
| adr-2026-09-10-portable-build-review-policy#D7 | task | task-21, task-22, task-23, task-24, task-25, task-26, task-27 | The descriptor-selected parser accepts bounded custom findings and absent confidence, but rejects invalid confidence and forged rubric/lap/policy/provider/verdict/case/effect/disposition fields. |
| adr-2026-09-10-portable-build-review-policy#D8 | task | task-28 | Adjudication-context integration delivers every current eligible source, prior case, policy criteria/identity/question, reserved owner, and complete admitted task contract to the existing single dispatcher. |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-29, task-30, task-31, task-35 | The remediation parser round-trips case-v2 duplicate/consistent-repair graphs with every original source, merge rationale, admission task id, and consistency verdict while retaining case-v1/non-case compatibility. |
| adr-2026-09-10-portable-build-review-policy#D10 | task | task-32, task-33, task-34 | The shared outcome operation waits for settled branches, sends eligible current content to exactly one adjudicator, and returns only a validated consistent admitted repair set or inspectable decision stop. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-35, task-37, task-38, task-39 | Work-order application publishes one durable prioritized repair set containing only admitted act outcomes, with real task ids, rationale, and complete custom/merged source links. |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-40 | Emitter-to-persister/CLI/daemon integration renders custom source/plugin/version/content/input/candidate provenance, original production versus current reuse, and inspectable consistency/escalation/effect outcomes after configuration removal. |
| adr-2026-09-10-separate-custom-review-coverage-identity#D1 | task | task-25 | The accepted-risk matcher resolves only the exact current custom finding/declaration/content within the feature and leaves changed same-named findings blocking while preserving built-in matching. |
| adr-2026-09-10-separate-custom-review-coverage-identity#D2 | task | task-26 | Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match. |
| adr-2026-09-10-separate-custom-review-coverage-identity#D3 | task | task-26, task-27, task-34 | Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match. |
| adr-2026-09-10-separate-custom-review-coverage-identity#D4 | task | task-23, task-25, task-26, task-27, task-40 | Artifact round-trip integration preserves original policy/source/plugin/version/content/input/provider/model attribution and a separate current-lap reuse reference with no invented execution or charge. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | task | task-11, task-34 | Policy preflight rejects declared unavailable capabilities/actions before judging and reports provider, capability, and recovery without activating unrelated components. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | task | task-11, task-34 | Policy preflight rejects declared unavailable capabilities/actions before judging and reports provider, capability, and recovery without activating unrelated components. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | task | task-34 | Mixed-lap coordinator integration sends eligible custom content to one judgment and retains the sibling closed infrastructure failure even when an admitted repair route is selected. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | task | task-37 | Infrastructure-only custom failures retain the existing total mechanical allowance and needs-human exhaustion route, with no semantic charge; mixed content remains governed by the separate aggregate action effect. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-37 | Infrastructure-only custom failures retain the existing total mechanical allowance and needs-human exhaustion route, with no semantic charge; mixed content remains governed by the separate aggregate action effect. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | task | task-26, task-27 | Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | task | task-26 | Reduced-coverage integration applies an exact first-use loading-failure waiver without a digest and retains it across package/version, diagnostic, execution-policy, and restart changes while declaration and reason match. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | task | task-25, task-26, task-34 | The accepted-risk matcher resolves only the exact current custom finding/declaration/content within the feature and leaves changed same-named findings blocking while preserving built-in matching. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | task | task-40 | Emitter-to-persister/CLI/daemon integration renders custom source/plugin/version/content/input/candidate provenance, original production versus current reuse, and inspectable consistency/escalation/effect outcomes after configuration removal. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | task | task-40 | Emitter-to-persister/CLI/daemon integration renders custom source/plugin/version/content/input/candidate provenance, original production versus current reuse, and inspectable consistency/escalation/effect outcomes after configuration removal. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D1 | task | task-17 | The pure cache matcher hits for identical semantic identity and temporary-path, lap-time, publication-time, or commit-address-only changes, while retaining the original producing provenance. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D2 | task | task-17 | The pure cache matcher hits for identical semantic identity and temporary-path, lap-time, publication-time, or commit-address-only changes, while retaining the original producing provenance. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D3 | task | task-7, task-19, task-20 | The policy-bundle loader delivers SKILL.md, nested criteria, and admitted in-package link targets at preserved relative locations with bytes equal to the captured manifest. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D4 | task | task-18 | Temporary-cache integration preserves separate warm preferred/fallback entries and only reads an entry whose full effective candidate identity and validated result match. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D5 | task | task-40 | Cache discard publication retains existing engine/skill mismatch events and staged causes; ordinary projection/policy misses do not gain the old discard event, and new effective-policy diagnostics use typed declared sinks. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D6 | task | task-15, task-19 | Auxiliary lifecycle tests observe prepare before the candidate operation and exactly one cleanup after hit, invoke success, authentication failure, malformed result, timeout, or cancellation. |
| adr-2026-08-21-engine-identity-in-build-review-cache-key#D7 | task | task-25, task-26 | The accepted-risk matcher resolves only the exact current custom finding/declaration/content within the feature and leaves changed same-named findings blocking while preserving built-in matching. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | task | task-1, task-20 | Configuration-to-catalog integration loads a valid custom declaration alongside testQuality and resolves its existing execution-policy fields without editing the registry implementation per policy. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | task | task-2 | The production configuration loader rejects each invalid-id, reserved/retired/prototype-id, duplicate-key, unknown-field, invalid-source/resource, and 33-member fixture before any rubric callback. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | task | task-20 | No-custom fixtures preserve attended/daemon, default/empty-container/empty-scope behavior and require no custom containment; generic custom findings cannot bypass testQuality vocabulary, scope, preflight, or anchor checks. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | task | task-21, task-22, task-23 | The descriptor-selected parser accepts bounded custom findings and absent confidence, but rejects invalid confidence and forged rubric/lap/policy/provider/verdict/case/effect/disposition fields. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | task | task-20 | No-custom fixtures preserve attended/daemon, default/empty-container/empty-scope behavior and require no custom containment; generic custom findings cannot bypass testQuality vocabulary, scope, preflight, or anchor checks. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | task | task-34 | Mixed-lap coordinator integration sends eligible custom content to one judgment and retains the sibling closed infrastructure failure even when an admitted repair route is selected. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | task | task-28, task-29, task-32, task-33 | Adjudication-context integration delivers every current eligible source, prior case, policy criteria/identity/question, reserved owner, and complete admitted task contract to the existing single dispatcher. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-30, task-34, task-35, task-37 | The case validator accepts exhaustive duplicate/consistent graphs but rejects omitted, duplicate, invented, unresolved-merge, nonexistent-reference, missing-consistency, contradictory-outcome, and missing-admission fixtures. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-21, task-24 | The descriptor-selected parser accepts bounded custom findings and absent confidence, but rejects invalid confidence and forged rubric/lap/policy/provider/verdict/case/effect/disposition fields. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-24, task-37 | Effective-verdict integration retains rejected/deferred/operator-resolved/suppressed custom findings visibly outside repair work, leaves missing confidence unsuppressed, and never writes operator authority from suppression. |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-28, task-30, task-31, task-32, task-33, task-37 | Decision-routing integration records each owner stop with original source evidence and zero work publication, plan append, sealed-artifact mutation, automatic waiver, or semantic charge. |

## Authoring Verification

- All 93 happy and negative criteria have task citations, exact Done-when evidence, and a lowest-sufficient test disposition; the two multi-step acceptance flows retain their distinct endpoints.
- Every task has two to four single-line, named-mechanism completion checks, explicit Files, and genuine dependencies. Infrastructure/internal helpers are not assigned duplicate full-flow tests.
- The 40-task size is at the normal supported ceiling. At five minutes per focused task the nominal task work is about 3 hours 20 minutes, excluding queued gates, review, and environment setup; this is a sizing aid rather than a delivery-time guarantee. Consider splitting if that implementation batch is too large; the current artifact preserves the already approved full feature scope.
- Load-bearing design choices are operator-approved. Module entry points and existing lifecycle/store/parser seams were verified against the local baseline. The two host metadata formats were inspected during DECIDE; adapter failure tests cover unsupported formats. Live provider behavior and the private Kotlin package remain outside the claimed verification.
- Protected-target, overlap, diagram rendering, and repository integrity results are recorded with this plan's review; none is represented as implemented runtime proof.
