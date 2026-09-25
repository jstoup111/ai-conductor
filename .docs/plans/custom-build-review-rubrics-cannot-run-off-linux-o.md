# Implementation Plan: Custom build_review rubrics run on every platform without an OS containment boundary

**Date:** 2026-09-24
**Design:** .docs/decisions/adr-2026-09-10-portable-build-review-policy.md
**Stories:** .docs/stories/custom-build-review-rubrics-cannot-run-off-linux-o.md
**Conflict check:** Clean as of 2026-09-24

## Summary

Custom-policy `build_review` laps stop using the Linux-only bubblewrap review boundary. Their members launch in
each provider's own read-only review mode, in the ordinary provider environment. An engine digest of the lap's
inputs discards the whole lap on any change. A host capability check reports an unavailable read-only mode at
daemon start, at interactive config load, and in `daemon status`, before any review fault is spent.
17 tasks. Source: jstoup111/ai-conductor#2735.

## Technical Approach

- **One additive invoke option.** `readOnlyReview` on `InvokeOptions` follows
  adr-2026-08-24-one-dispatch-member-on-the-provider-contract: the single `invoke` member, an additive field.
  - Claude maps it to `--restricted`, a `--tools` list of Read, Grep, Glob and Bash, `--allowedTools`
    rules for read-only git subcommands, and `--strict-mcp-config`, and never passes
    `--dangerously-skip-permissions`.
  - Codex maps it to `sandbox_mode="read-only"` with approval `never`.

  Environments are untouched: a reviewer gets exactly what an ordinary step for that candidate gets. On
  self-host that is the self-host prepared invocation (adr-2026-09-10 D5.1–D5.2). Tasks 1–2.
- **Dispatch sites.** `dispatchInstalledBuildReviewPolicy` and the built-in-peer branch of a custom-policy
  lap in `engine/step-runners.ts` drop their containment block and set the option. Frozen view, policy
  capture, preflight, cache and native-schema scratch are unchanged. Tasks 3–4.
- **Detect and discard.** `engine/build-review-input-integrity.ts` hashes the frozen head, frozen baseline,
  captured policy material, installed policy package, and the evidence files present at fan-out. The lap
  coordinator captures the digest before fan-out and diffs it after the join. Any change replaces every
  member result with `review-input-mutated`, which is retryable through the existing mechanical-fault lane
  (adr-2026-08-18 D2.3, D3.2). Tasks 5–7.
- **Capability.** `engine/build-review-read-only-capability.ts` runs the provider's own mechanism with an
  injected runner:
  - Codex: `codex sandbox` with the read-only profile, where a started marker plus a refused write means
    available.
  - Claude: the CLI help lists the restricted-mode flags; no model call is made.

  The result rides a new `build_review_read_only_capability` event. It runs once at `runDaemonMode` start,
  and the frozen result is threaded to each Conductor like `rateLimitEpisode`. Interactive config load
  runs it too and prints a config warning. `daemon status` renders the latest persisted result, never
  probing. Tasks 8–12.
- **Dispatch skip.** An unavailable candidate is skipped through the existing setup-skip path in
  `engine/provider-execution.ts` (`setup-unavailable` with a named `setupCapability`); no new skip reason is
  added, and #1492's unbuilt admission gate will subsume it. If every candidate is skipped this way, the
  member settles `read-only-review-unavailable`, deterministic and refused at once. `record-reduced-coverage`
  accepts that cause below the ceiling (architecture review Condition 4). Tasks 13–15.
- **Retirement, then invariance.** The bubblewrap review module and its env and scratch helpers lose every
  caller and are deleted per `code-removal`; the frozen-scope renderer moves to the materialization module
  (Task 16). A literal-expectation regression pins built-in-only laps, ordinary BUILD and self-host
  invocations (Task 17).

**Local pattern basis:** two-sided probe, via `probeContainment` in
`engine/self-host/live-containment.ts` (Task 8). Deterministic refuse-at-once causes, via the
`native-schema-unsupported` branches in `publishCustomOnlyBuildReview` and the mixed-lap path (Task 14).
Daemon-scoped injection, via `createRateLimitEpisode` in `runDaemonMode` (Task 10).

**Assumptions carried from DECIDE:** the darwin form of the Codex sandbox helper is unverified. A helper
error there reports Codex unavailable, and Claude remains a candidate. Real macOS behavior is unverified at
ship (architecture review Condition 2).

## Prerequisites

- #1884 (Pi) is `blocked_by` #2735. The companion branch `docs/2735-companion-amendments` (Pi spec, and
  shipped stories aligned with read-only review mode) merges together with this spec.

## Tasks

### Task 1: Claude adapter maps the read-only review option
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider.test.ts`: an invocation with `readOnlyReview: true` carries `--restricted`, `--tools` naming exactly Read, Grep, Glob and Bash, `--allowedTools` rules admitting only read-only git subcommands (`git show`, `git diff`, `git log`, `git ls-tree`, `git ls-files`, `git cat-file`, `git rev-parse`, `git blame`, `git grep`), and `--strict-mcp-config`; `--dangerously-skip-permissions` is absent even when `dangerouslySkipPermissions` is also set; the child environment equals the same invocation's environment without the option.
2. Verify the tests fail (RED): the option does not exist yet.
3. Implement: add the optional `readOnlyReview?: boolean` field to `InvokeOptions` in `src/conductor/src/execution/llm-provider.ts` (additive, on the single `invoke` member per adr-2026-08-24). In `ClaudeProvider.buildArgs` push the restricted-mode flags when it is set and skip the skip-permissions flag. The flags are engine constants, never read from project or operator configuration. Restricted mode rejects skip-permissions (verified 2026-09-24), and restricted mode alone still exposes Edit, Write and Agent, which is why `--tools` is explicit. Leave `buildEnv` untouched for this option.
4. Verify the tests pass (GREEN).
5. Commit: "feat(claude-provider): map the read-only review option to restricted mode"

**Done when:**
- a claude-provider test asserts an invocation with `readOnlyReview` set carries `--restricted`, a `--tools` list naming exactly Read, Grep, Glob and Bash, `--allowedTools` rules for read-only git subcommands only, and `--strict-mcp-config` with no MCP configuration
- the same test asserts `--dangerously-skip-permissions` is absent when `readOnlyReview` and `dangerouslySkipPermissions` are both set
- a claude-provider test asserts no allowed-tools rule admits Edit, Write, NotebookEdit, an MCP tool, or a Bash command other than a read-only git subcommand
- a claude-provider test asserts the child environment of a `readOnlyReview` invocation equals the environment of the same invocation without the option

**Files likely touched:**
- src/conductor/src/execution/llm-provider.ts — additive `readOnlyReview` field
- src/conductor/src/execution/claude-provider.ts — argv mapping
- src/conductor/test/execution/claude-provider.test.ts — argv and env tests

**Dependencies:** none

### Task 2: Codex adapter maps the read-only review option
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider.test.ts`: an unattended invocation with `readOnlyReview: true` carries `sandbox_mode="read-only"` and approval policy `never`, and none of the workspace-write, network-access, on-request or auto_review overrides; its child environment equals the same invocation's environment without the option; an unattended invocation without the option keeps all four existing overrides.
2. Verify the tests fail (RED).
3. Implement: in `CodexProvider.buildArgs` (`src/conductor/src/execution/codex-provider.ts`), when `readOnlyReview` is set, emit the read-only sandbox mode and approval `never` in place of the unattended workspace-write block. Leave `invocationEnv` untouched for this option.
4. Verify the tests pass (GREEN).
5. Commit: "feat(codex-provider): map the read-only review option to the read-only sandbox"

**Done when:**
- a codex-provider test asserts an unattended invocation with `readOnlyReview` set carries the read-only sandbox mode and approval policy never
- the same test asserts that argv carries none of the workspace-write sandbox mode, the workspace-write network access override, the on-request approval policy, or the auto_review approvals reviewer
- a codex-provider test asserts the child environment of a `readOnlyReview` invocation equals the environment of the same invocation without the option
- a codex-provider test asserts an unattended invocation without `readOnlyReview` still carries the workspace-write, network access, on-request and auto_review overrides

**Files likely touched:**
- src/conductor/src/execution/codex-provider.ts — argv mapping
- src/conductor/test/execution/codex-provider.test.ts — argv and env tests

**Dependencies:** none

### Task 3: Custom members launch in read-only review mode in the ordinary environment
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/build-review-custom-policy.integration.test.ts` over the execa process boundary (mock execa and prove the production adapter reaches the mock before any assertion, per the repository's test process isolation rule). Three non-self-host host fixtures: Linux where any `bwrap` spawn fails with the AppArmor userns denial, Linux unrestricted, and darwin with no `bwrap` on PATH. Assert that each settles the custom member with a judged result, that no member settles `preflight-failed`, and that zero `bwrap` spawns are recorded. Assert that Claude and Codex launches carry `readOnlyReview` and an environment equal to an ordinary step's environment for that candidate. Assert that a Codex member copies no login file and receives only `nativeSchemaScratchHome`. Assert that a provider-error fixture settles `provider-error` with no text naming bubblewrap, a nested sandbox or a containment probe. Assert that a self-host fixture launches through the self-host prepared invocation with its overlay intact.
2. Verify the tests fail (RED): today every fixture settles `preflight-failed` from the containment probe.
3. Implement: in `dispatchInstalledBuildReviewPolicy` (`src/conductor/src/engine/step-runners.ts`), delete the block that acquires the review scratch home, seeds the Codex login, writes the host-state sentinel and calls `prepareBuildReviewContainment`. Pass `readOnlyReview: true` with the existing frozen `cwd` and prompt. Keep the frozen view, policy capture, preflight, cache and native-schema scratch handling exactly as they are.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): launch custom members in provider read-only review mode"

**Done when:**
- an integration test of `dispatchInstalledBuildReviewPolicy` on three non-self-host host fixtures (Linux with nested namespaces refused, Linux unrestricted, darwin without bubblewrap) settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns; on the darwin-without-bubblewrap fixture no member result text names bubblewrap, a nested sandbox, or a containment probe
- the same test asserts the Claude and Codex custom-member launches carry the `readOnlyReview` option and an environment equal to an ordinary step's environment for that candidate, with no engine-overridden HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, TMPDIR or XDG scratch path
- a Codex custom-member test asserts no login file is copied and the only engine scratch home passed is `nativeSchemaScratchHome`, which is not the child's CODEX_HOME
- a provider-error fixture settles the custom member with cause `provider-error`, and no member result text names bubblewrap, a nested sandbox, or a containment probe
- a self-host fixture asserts the custom member launches through the self-host prepared invocation with that invocation's environment overlay intact

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — custom-member dispatch
- src/conductor/test/integration/build-review-custom-policy.integration.test.ts — host-fixture launch tests

**Dependencies:** 1, 2

### Task 4: Built-in peers of a custom-policy lap launch in read-only review mode
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/build-review-custom-routing.integration.test.ts`: in a mixed custom and built-in lap, the built-in peer's launch carries `readOnlyReview`, its Claude argv lacks `--dangerously-skip-permissions`, its cwd is the frozen head, and its prompt carries the frozen input scope. A Claude testQuality peer's argv allow rules admit `git show`, which it uses for its pinned-ref evidence reads.
2. Verify the tests fail (RED).
3. Implement: in the built-in-peer branch of a custom-policy lap in `src/conductor/src/engine/step-runners.ts`, delete the scratch-home and `prepareBuildReviewContainment` block. Set `readOnlyReview: true` on the dispatched options; the adapter drops skip-permissions, per Task 1.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): run built-in peers of custom laps in read-only review mode"

**Done when:**
- an integration test of a mixed custom and built-in lap asserts the built-in peer's launch carries the `readOnlyReview` option and its Claude argv lacks `--dangerously-skip-permissions`, and the built-in peer's Claude argv carries every read-only review flag the custom member's argv carries (`--restricted`, the `--tools` list, the `--allowedTools` rules and `--strict-mcp-config`)
- the same test asserts the built-in peer's cwd is the lap's frozen head and its prompt carries the frozen input scope
- a testQuality peer fixture on Claude asserts the launched argv allow rules admit `git show`

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — built-in-peer dispatch in custom laps
- src/conductor/test/integration/build-review-custom-routing.integration.test.ts — peer launch tests

**Dependencies:** 3

### Task 5: Lap input integrity digest
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/build-review-input-integrity.test.ts` for `captureBuildReviewInputDigest(roots)` and `diffBuildReviewInputDigests(before, after)`. Roots: frozen head, frozen baseline, captured policy material, installed policy package, evidence root. A modified, added or removed file under the first four roots is reported with its path. A file created under the evidence root after capture is ignored, while a modification to an evidence file present at capture is reported. Identical captures yield an empty list. The feature checkout is never a root.
2. Verify the tests fail (RED): the module does not exist.
3. Implement `src/conductor/src/engine/build-review-input-integrity.ts`: content hashes (sha256) of regular files under each root, keyed by root kind and relative path; evidence-root entries are compared only for paths present in `before`. Pure functions over an injected filesystem reader.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): digest custom-lap review inputs"

**Done when:**
- a unit test asserts `diffBuildReviewInputDigests` reports a modified, added or removed file under the frozen head, frozen baseline, captured policy material or installed policy package root, naming the changed path
- a unit test asserts a file created under the evidence root after capture is not reported, while a modification to an evidence file present at capture is reported
- a unit test asserts identical captures produce an empty change list and that `captureBuildReviewInputDigest` accepts no feature-checkout root

**Files likely touched:**
- src/conductor/src/engine/build-review-input-integrity.ts — new module
- src/conductor/test/engine/build-review-input-integrity.test.ts — unit tests

**Dependencies:** none

### Task 6: Closed causes and event fields for read-only review
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-artifacts.test.ts` and `src/conductor/test/engine/event-sinks.test.ts`: `isBuildReviewCustomInfrastructureFailureReason` accepts `review-input-mutated` and `read-only-review-unavailable`; a custom artifact member with reason `review-input-mutated` round-trips through `parseBuildReviewCustomArtifactMember`; `build_review_rubric_infrastructure_failure` accepts optional `changedInputs` (string array) and `platform` (string) with its existing sink declaration.
2. Verify the tests fail (RED).
3. Implement: extend `BuildReviewInfrastructureFailureReason` in `src/conductor/src/engine/build-review-domain.ts` and the custom reason set in `src/conductor/src/engine/build-review-artifacts.ts` with both causes (adr-2026-08-18 D2.3), keeping the closed mapping total. Add the two optional fields to the event in `src/conductor/src/types/events.ts` (D10.2).
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): add read-only review closed causes"

**Done when:**
- the build-review-artifacts test asserts `isBuildReviewCustomInfrastructureFailureReason` accepts `review-input-mutated` and `read-only-review-unavailable`
- a custom artifact member with reason `review-input-mutated` round-trips through `parseBuildReviewCustomArtifactMember` unchanged
- the event-sinks test asserts `build_review_rubric_infrastructure_failure` carries the optional `changedInputs` and `platform` fields under its existing sink declaration

**Files likely touched:**
- src/conductor/src/engine/build-review-domain.ts — reason union
- src/conductor/src/engine/build-review-artifacts.ts — custom reason set
- src/conductor/src/types/events.ts — optional event fields
- src/conductor/test/engine/build-review-artifacts.test.ts — reason tests
- src/conductor/test/engine/event-sinks.test.ts — field test

**Dependencies:** none

### Task 7: Custom-policy laps discard every verdict when an input changes
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing lap tests in `src/conductor/test/integration/build-review-custom-policy.integration.test.ts`:
   - An unchanged lap publishes as today and writes the digest record under the lap's build-review evidence root.
   - A fixture reviewer modifying a frozen-head file settles every member `review-input-mutated` naming the path, publishes no aggregate, increments the mechanical-fault counter by one, and emits the infrastructure-failure event with the changed inputs.
   - Changes to a baseline file, a captured policy material file, an installed package file, or a pre-existing evidence file each settle `review-input-mutated`.
   - A new engine branch artifact plus a changed tracked feature-checkout file still publishes, with results naming the captured input identity.
   - At the last allowance the lap halts `needs-human` naming the cause and inputs; with allowance remaining, the re-run materializes a fresh frozen view.
2. Verify the tests fail (RED).
3. Implement in the custom-policy lap coordinator of `src/conductor/src/engine/step-runners.ts`:
   - Capture the digest after frozen-view materialization and before fan-out.
   - Diff it after the join and before aggregation.
   - On any change, replace every member result with an infrastructure failure carrying `review-input-mutated` and the changed inputs, so the existing mechanical-fault routing applies (D3/D4).
   - Persist both digests as engine evidence under the evidence root.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): discard a custom lap whose inputs changed"

**Done when:**
- a custom-policy lap test whose inputs stay unchanged publishes the aggregate the existing lap test expects and writes the digest record under the lap's build-review evidence root
- a lap test with a fixture reviewer that modifies a frozen-head file during fan-out settles every member `review-input-mutated` naming that path, publishes no aggregate, increments the mechanical-fault counter by one, and emits `build_review_rubric_infrastructure_failure` with the changed inputs
- lap tests that modify a frozen-baseline file, a captured policy material file, an installed policy package file, or a pre-existing evidence file each settle `review-input-mutated` naming that input
- a lap test that writes a new engine branch artifact and changes a tracked feature-checkout file during fan-out publishes its aggregate, and the member results name the lap's captured input identity
- a lap test at the last mechanical allowance halts `needs-human` with a body naming `review-input-mutated` and the changed inputs, and a lap test with allowance remaining re-runs on a freshly materialized frozen view whose members judge again and settle judged results

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — digest capture and discard
- src/conductor/test/integration/build-review-custom-policy.integration.test.ts — mutation lap tests

**Dependencies:** 3, 5, 6

### Task 8: Host read-only review capability probe
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/build-review-read-only-capability.test.ts` for `probeReadOnlyReviewCapability({ provider, platform, runProcess, scratchDir })` with an injected process runner (no real exec):
   - Codex: `codex sandbox -P :read-only -- /bin/sh -c …` prints a started marker and the probe write is refused, so the result is available.
   - Codex: cannot start, write succeeds, ENOENT, or unrecognized output each yield unavailable with that reason.
   - Claude: `claude --help` listing `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config` yields available; a missing flag yields unavailable naming it. No model call is made.
   - Any other provider yields unavailable without a spawn.
   - Every result names `platform`.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/build-review-read-only-capability.ts`. Follow the two-sided probe precedent of `probeContainment` in `src/conductor/src/engine/self-host/live-containment.ts`: an injected runner, both observations asserted, fail closed on unrecognized output, and the reason kept verbatim. The allowed variation is that the probed command is the provider's own sandbox helper, and there are two outcomes, not four. Use the codex readiness result shape (`readiness()` in `src/conductor/src/execution/llm-provider.ts`) as the precedent. The probe write targets a file under `scratchDir`, which lies under the already-excluded `.pipeline/` prefix. The darwin form of the Codex helper is unverified (no macOS host); a helper error there yields unavailable, never a crash.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): probe provider read-only review capability"

**Done when:**
- a unit test with an injected process runner asserts a Codex probe whose sandboxed process starts and whose write is refused yields `available` naming the platform
- unit tests assert a Codex probe that cannot start, whose write succeeds, whose executable is absent, or whose output is unrecognized each yield `unavailable` with that reason and the platform
- a unit test asserts a Claude probe yields `available` when the CLI help lists `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config`, and `unavailable` naming the missing flag otherwise
- a unit test asserts a provider with no read-only review mode yields `unavailable` and the injected runner records no spawn

**Files likely touched:**
- src/conductor/src/engine/build-review-read-only-capability.ts — new module
- src/conductor/test/engine/build-review-read-only-capability.test.ts — unit tests

**Dependencies:** none

### Task 9: Capability result event on the spine
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/engine/daemon-render.test.ts`: the `build_review_read_only_capability` variant (provider, platform, status, reason) is declared with render and persist sinks; an unavailable result renders one daemon log line naming the provider, the platform and the reason.
2. Verify the tests fail (RED).
3. Implement: add the variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts`, declare it in `src/conductor/src/engine/event-sinks.ts`, and render it in the daemon log renderer in `src/conductor/src/daemon-cli.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(events): carry the read-only review capability result"

**Done when:**
- the event-sinks registry test asserts the `build_review_read_only_capability` variant carrying provider, platform, status and reason is declared with render and persist sinks
- a daemon-render test asserts an unavailable capability result renders one log line naming the provider, the platform and the reason

**Files likely touched:**
- src/conductor/src/types/events.ts — new variant
- src/conductor/src/engine/event-sinks.ts — sink declaration
- src/conductor/src/daemon-cli.ts — log renderer
- src/conductor/test/engine/event-sinks.test.ts — registry test
- src/conductor/test/engine/daemon-render.test.ts — render test

**Dependencies:** none

### Task 10: Daemon start runs the capability check and threads its result
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-cli-read-only-capability-wiring.test.ts`, following the other `daemon-cli-*-wiring` tests, with an injected probe runner:
   - A project enabling a custom rubric whose candidates include Codex emits one capability event per named provider before the first dispatch.
   - An unavailable result is logged, and the daemon still enters its dispatch loop.
   - No enabled custom rubric means no probe spawn and no event.
   - The Conductor's build_review dispatch receives the result through its options.
2. Verify the tests fail (RED).
3. Implement: in `runDaemonMode` (`src/conductor/src/daemon-cli.ts`), after config resolution, collect the providers named by enabled custom members' candidate policies and probe each once (Task 8). Emit the Task 9 event and pass the frozen result into each Conductor's options, as `rateLimitEpisode` is created and passed. Add the option to Conductor options in `src/conductor/src/engine/conductor.ts` and hand it to the build_review step runner.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): report read-only review capability at start"

**Done when:**
- a runDaemonMode wiring test with a project enabling a custom rubric naming Codex emits one `build_review_read_only_capability` event for Codex before the first feature dispatch, and a sibling test with a project enabling a custom rubric naming Claude and a Claude CLI fixture accepting the restricted-mode flags emits one event recording Claude `available`
- a runDaemonMode wiring test with an unavailable Codex result logs the provider, the platform and the reason and still enters the dispatch loop; with a Codex sandbox helper fixture that cannot start the probe process, the capability event recording Codex `unavailable` and the daemon log line naming the platform and the helper's error are both emitted before the first feature dispatch
- a runDaemonMode wiring test with no enabled custom rubric records no capability probe spawn and no capability event
- a wiring test asserts the daemon-scoped capability result reaches the build_review step runner through the Conductor options

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — start-time probe and threading
- src/conductor/src/engine/conductor.ts — Conductor option
- src/conductor/test/engine/daemon-cli-read-only-capability-wiring.test.ts — wiring tests

**Dependencies:** 8, 9

### Task 11: Interactive config load warns about an unavailable read-only mode
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli-read-only-capability-warning.test.ts`: an interactive run whose config enables a custom rubric naming an unavailable provider prints a config warning naming the provider, the platform and the reason before any step runs, and passes the result to its Conductor; a config with no enabled custom rubric spawns no probe.
2. Verify the tests fail (RED).
3. Implement: in `src/conductor/src/index.ts`, where config warnings are printed, run the Task 8 probe for the providers named by enabled custom members, print each unavailable result through the existing config-warning line, emit the Task 9 event, and pass the result into the Conductor options added in Task 10.
4. Verify the tests pass (GREEN).
5. Commit: "feat(cli): warn at config load when read-only review is unavailable"

**Done when:**
- an interactive CLI test whose config enables a custom rubric naming an unavailable provider prints a config warning naming the provider, the platform and the reason before any step runs
- the same test asserts the capability result is passed to its Conductor, and a config with no enabled custom rubric records no capability probe spawn

**Files likely touched:**
- src/conductor/src/index.ts — config-load probe and warning
- src/conductor/test/cli-read-only-capability-warning.test.ts — CLI tests

**Dependencies:** 8, 9, 10

### Task 12: daemon status renders the latest capability result
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts`: status renders the latest persisted capability result per provider from the daemon event log (provider, platform, status, reason); with none recorded it says so; rendering spawns no probe.
2. Verify the tests fail (RED).
3. Implement: in `src/conductor/src/engine/daemon-observe-cli.ts`, read the daemon event log with a bounded tail and keep the last `build_review_read_only_capability` event per provider. Render it in the status output. Consume the persisted spine; do not re-probe.
4. Verify the tests pass (GREEN).
5. Commit: "feat(status): show read-only review capability"

**Done when:**
- a daemon-observe-cli test asserts `daemon status` renders the latest persisted `build_review_read_only_capability` result per provider from the daemon event log, naming provider, platform, status and reason
- the same test asserts that with no recorded result the status output states none has been recorded, and that rendering records no probe spawn

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts — status section
- src/conductor/test/engine/daemon-observe-cli.test.ts — status tests

**Dependencies:** 9

### Task 13: Dispatch skips a candidate whose read-only mode is unavailable
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts` and `src/conductor/test/integration/build-review-custom-routing.integration.test.ts`:
   - A candidate refused for read-only review yields a `provider_attempt` with `invoked` false, skipReason `setup-unavailable`, and a setupCapability naming the read-only review mode, and the next candidate is invoked.
   - With Codex unavailable and Claude available, Claude judges.
   - A provider with no read-only review mode records its skip and launches nothing.
   - With one read-only-unavailable candidate and one usage-limited candidate, each yields exactly one `provider_attempt`, and the existing usage-limit wait result is returned.
2. Verify the tests fail (RED).
3. Implement: inside the custom-policy `preparedCandidateOperation` in `src/conductor/src/engine/step-runners.ts`, consult the threaded capability result (Task 10). When it is absent, probe once per run and memoize. Return the skipped-invocation result that `src/conductor/src/engine/provider-execution.ts` classifies as setup-unavailable, adding a third arm to `skippedCandidateSetupUnavailable` for the read-only review mode with its recovery action. Reuse the existing fallback loop, and add no skip reason (adr-2026-09-10 D5.5).
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): skip candidates without an available read-only mode"

**Done when:**
- a provider-execution test asserts a candidate whose read-only review capability is unavailable yields a `provider_attempt` with `invoked` false, skipReason `setup-unavailable`, and a setupCapability naming the read-only review mode, and the next candidate is invoked
- a custom-member test with Codex unavailable and Claude available settles the member with the judged result of the Claude candidate
- a custom-member test with a provider that declares no read-only review mode records its setup-unavailable skip and launches no process for it
- a custom-member test with one read-only-unavailable candidate and one usage-limited candidate records exactly one `provider_attempt` per candidate and returns the existing usage-limit wait result rather than `read-only-review-unavailable`

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — setup-skip arm
- src/conductor/src/engine/step-runners.ts — capability consult in custom-member preparation
- src/conductor/test/engine/provider-execution.test.ts — skip record test
- src/conductor/test/integration/build-review-custom-routing.integration.test.ts — candidate ladder tests

**Dependencies:** 3, 8, 10

### Task 14: No read-only candidate settles and halts at once
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-custom-convergence.test.ts`: when every candidate is refused for read-only review, the member settles `read-only-review-unavailable`, naming the platform and each candidate's reason, with zero provider launches; the lap halts `needs-human` on that first occurrence with the mechanical-fault counter unchanged, and the halt body names the platform and the providers.
2. Verify the tests fail (RED).
3. Implement: in `src/conductor/src/engine/step-runners.ts`, map a custom member's `providerSetupExhaustion` whose every candidate carries the read-only capability to the new cause. Route the cause through the deterministic refuse-at-once branch that already handles `native-schema-unsupported` (adr-2026-08-18 D3.2), and render its halt body in `src/conductor/src/engine/conductor.ts` with the platform and providers. Precedent: the deterministic refusal branches in `publishCustomOnlyBuildReview` and the mixed-lap path. The trait to preserve is refusal without bumping the mechanical-fault counter.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): halt at once when no read-only candidate exists"

**Done when:**
- a custom-member test with every candidate read-only-unavailable settles `read-only-review-unavailable` naming the platform and each candidate's reason, with zero provider launches
- a lap test settling `read-only-review-unavailable` halts `needs-human` on that first occurrence with the mechanical-fault counter unchanged, and the halt body names the platform and the providers

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — deterministic refusal routing
- src/conductor/src/engine/conductor.ts — halt body
- src/conductor/test/engine/build-review-custom-convergence.test.ts — refusal tests

**Dependencies:** 6, 13

### Task 15: Reduced coverage accepts a read-only-review-unavailable halt
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts`: a reduced-coverage decision for a rubric halted on `read-only-review-unavailable` below the mechanical-fault ceiling is stored; a retriable cause below the ceiling is still refused for remaining allowance.
2. Verify the tests fail (RED): today only `projection-oversized` is exempt.
3. Implement: extend the deterministic-cause exemption in `src/conductor/src/engine/build-review-cli.ts` (the three `projection-oversized` checks) to `read-only-review-unavailable`, as named by architecture review Condition 4.
4. Verify the tests pass (GREEN).
5. Commit: "fix(build-review-cli): accept reduced coverage for read-only-review-unavailable"

**Done when:**
- a build-review-cli test records a reduced-coverage decision for a rubric halted on `read-only-review-unavailable` with the mechanical-fault counter below the ceiling, and the decision is stored
- the same test file asserts a retriable cause below the ceiling is still refused for remaining allowance

**Files likely touched:**
- src/conductor/src/engine/build-review-cli.ts — deterministic exemption
- src/conductor/test/engine/build-review-cli.test.ts — decision tests

**Dependencies:** 6

### Task 16: Retire the bubblewrap review boundary
**Story:** 1
**Type:** refactor

**Steps:**
1. Follow the `code-removal` skill. What dies:
   - `src/conductor/src/engine/build-review-containment.ts`: probe, mounts, masks, host-state sentinel, runtime roots.
   - `BuildReviewAccessProfile`, the `reviewAccess` field and `reviewAccessRefusal` in `llm-provider.ts`.
   - The `reviewAccess` wrap and scratch-env branches in both provider adapters.
   - `buildReviewChildEnvironment` and `filterReviewChildEnvironment` in `src/conductor/src/execution/child-environment.ts`.
   - `acquireReviewScratchHome` in `src/conductor/src/engine/self-host/provider-scratch.ts`.
   - Their tests: `src/conductor/test/engine/build-review-containment.test.ts`, `src/conductor/test/execution/build-review-profile.test.ts`, `src/conductor/test/integration/build-review-frozen-input-containment.integration.test.ts`.
2. What survives: move `renderBuildReviewFrozenInputScope` and `BuildReviewFrozenInputScope` into `src/conductor/src/engine/build-review-materialization.ts`, unchanged, and update their imports. `copySelectedCodexLogin` stays, since self-host auth uses it. No directory is deleted.
3. Run the surviving behavior checks: Tasks 3, 4 and 7 integration tests and the existing frozen-scope prompt test.
4. Commit: "refactor(build-review): retire the bubblewrap review boundary"

**Done when:**
- the Task 3, Task 4 and Task 7 integration tests pass after the deletion with unchanged assertions
- the frozen input scope text rendered for a custom member is byte-identical before and after the move, as asserted by the existing frozen-scope prompt test
- `npm run typecheck` in src/conductor exits 0 after the deletion

**Files likely touched:**
- src/conductor/src/engine/build-review-containment.ts — deleted
- src/conductor/src/engine/build-review-materialization.ts — receives the scope renderer
- src/conductor/src/engine/step-runners.ts — imports
- src/conductor/src/execution/llm-provider.ts — review access field removed
- src/conductor/src/execution/claude-provider.ts — wrap and scratch env removed
- src/conductor/src/execution/codex-provider.ts — wrap and scratch env removed
- src/conductor/src/execution/child-environment.ts — review env helpers removed
- src/conductor/src/engine/self-host/provider-scratch.ts — review scratch lease removed
- src/conductor/test/engine/build-review-containment.test.ts — deleted
- src/conductor/test/execution/build-review-profile.test.ts — deleted
- src/conductor/test/integration/build-review-frozen-input-containment.integration.test.ts — deleted

**Dependencies:** 3, 4, 7, 13, 14

### Task 17: Built-in-only laps and non-review steps keep their invocations
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/integration/build-review-builtin-invariance.integration.test.ts`:
   - A lap with no enabled custom rubric launches Claude and Codex members with exactly the pre-change argv and environment, written as literal expectations, including skip-permissions for Claude and the workspace-write overrides for Codex.
   - No digest record is written, no capability result is consulted, and no member settles `read-only-review-unavailable`.
   - A declared-but-disabled custom rubric produces the same invocations.
2. Run the existing ordinary BUILD Codex argv test and the self-host live-containment invocation tests unchanged.
3. Verify the tests pass. They guard preserved behavior; if one fails, the defect is in Tasks 3–16's scoping.
4. Commit: "test(build-review): pin built-in-only invocations"

**Done when:**
- a build_review regression test for a lap with no enabled custom rubric asserts the Claude and Codex member argv and environment equal the literal pre-change expectations, including `--dangerously-skip-permissions` for Claude and the workspace-write overrides for Codex
- the same test asserts no digest record is written, no capability result is consulted, and no member settles `read-only-review-unavailable`
- a lap test with a declared but disabled custom rubric produces the same invocations as the built-in-only lap
- the existing ordinary BUILD Codex argv test and the self-host live-containment invocation tests pass with unchanged assertions

**Files likely touched:**
- src/conductor/test/integration/build-review-builtin-invariance.integration.test.ts — regression tests

**Dependencies:** 7, 14, 16

## Task Dependency Graph

Independent roots: 1, 2, 5, 6, 8, 9.

- 1, 2 → 3 → 4
- 3, 5, 6 → 7
- 8, 9 → 10 → 11
- 9 → 12
- 3, 8, 10 → 13 → 14 (also 6 → 14)
- 6 → 15
- 3, 4, 7, 13, 14 → 16
- 7, 14, 16 → 17

## Integration Points

- After Task 3: a custom member judges on restricted Linux, unrestricted Linux and darwin fixtures, with no bubblewrap spawned.
- After Task 7: a custom-policy lap discards itself on any input change and re-runs within the mechanical-fault bound.
- After Task 10: the daemon reports read-only review capability at start and hands it to every Conductor.
- After Task 14: a custom member with no read-only candidate halts `needs-human` at once, naming the platform.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a custom-policy lap on a Linux host fixture where a second-level bubblewrap namespace is refused, when the lap runs with an admitted candidate, then the custom member settles with a judged result and no bubblewrap process is spawned by build_review. | 3 | "settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns" | diff-local |
| Story 1 happy: Given a custom-policy lap on a Linux host fixture with unrestricted bubblewrap, when the lap runs, then the custom member settles with a judged result through the same launch shape as the restricted host. | 3 | "Linux with nested namespaces refused, Linux unrestricted, darwin without bubblewrap" | diff-local |
| Story 1 happy: Given a custom-policy lap on a host fixture reporting platform darwin with no bubblewrap on PATH, when the lap runs with a Claude candidate, then the custom member settles with a judged result. | 3 | "darwin without bubblewrap) settles the custom member with a judged result" | diff-local |
| Story 1 negative: Given a custom-policy lap on a host with no bubblewrap executable at all, when the lap runs, then no member settles with `preflight-failed` and no member result names bubblewrap, a nested sandbox, or a containment probe. | 3, 16 | "no member result text names bubblewrap, a nested sandbox, or a containment probe" | diff-local |
| Story 1 negative: Given a custom-policy lap whose admitted candidate returns a provider error, when the member settles, then it records the existing `provider-error` cause, not a containment or platform cause. | 3 | "a provider-error fixture settles the custom member with cause `provider-error`" | diff-local |
| Story 1 negative: Given a custom-policy lap on a darwin host fixture whose only candidate is Claude, when the lap runs, then the member is not refused for lack of a Linux read-only boundary. | 3 | "darwin without bubblewrap) settles the custom member with a judged result, no member settles `preflight-failed`" | diff-local |
| Story 2 happy: Given a custom member dispatched to a Claude candidate, when the provider is launched, then its argv carries `--restricted`, a `--tools` list naming exactly Read, Grep, Glob and Bash, `--allowedTools` rules admitting only read-only git subcommands, and `--strict-mcp-config` with no MCP configuration. | 1, 3 | "carries `--restricted`, a `--tools` list naming exactly Read, Grep, Glob and Bash, `--allowedTools` rules for read-only git subcommands only, and `--strict-mcp-config` with no MCP configuration" | diff-local |
| Story 2 happy: Given a built-in peer of a custom-policy lap dispatched to a Claude candidate, when the provider is launched, then its argv carries the same read-only review flags as the custom member. | 4 | "the built-in peer's launch carries the `readOnlyReview` option" | diff-local |
| Story 2 happy: Given a custom member dispatched to a Claude candidate on a non-self-host project, when the provider is launched, then its environment equals the environment an ordinary Claude step receives, with no engine-overridden `HOME`, `CLAUDE_CONFIG_DIR`, `TMPDIR`, or `XDG_*` scratch paths. | 3 | "an environment equal to an ordinary step's environment for that candidate, with no engine-overridden HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, TMPDIR or XDG scratch path" | diff-local |
| Story 2 negative: Given step options that request `dangerouslySkipPermissions` for build_review, when any member of a custom-policy lap launches on Claude, then `--dangerously-skip-permissions` is absent from its argv. | 1, 4 | "`--dangerously-skip-permissions` is absent when `readOnlyReview` and `dangerouslySkipPermissions` are both set" | diff-local |
| Story 2 negative: Given a custom-policy lap member launched on Claude, when its argv is inspected, then no allow rule admits a Bash command other than a read-only git subcommand, and no rule admits Edit, Write, NotebookEdit or an MCP tool. | 1 | "no allowed-tools rule admits Edit, Write, NotebookEdit, an MCP tool, or a Bash command other than a read-only git subcommand" | diff-local |
| Story 2 negative: Given a self-host project, when a custom-policy lap member launches on Claude, then it launches through the self-host prepared invocation with that invocation's own environment overlay intact. | 3 | "launches through the self-host prepared invocation with that invocation's environment overlay intact" | diff-local |
| Story 3 happy: Given a custom member dispatched to a Codex candidate, when the provider is launched, then its argv carries `sandbox_mode="read-only"` and approval policy `never`. | 2 | "carries the read-only sandbox mode and approval policy never" | diff-local |
| Story 3 happy: Given a custom member dispatched to a Codex candidate on a non-self-host project, when the provider is launched, then its environment equals the environment an ordinary Codex step receives, with no engine-overridden `HOME`, `CODEX_HOME`, or `XDG_*` scratch paths and no copied login file. | 2, 3 | "the child environment of a `readOnlyReview` invocation equals the environment of the same invocation without the option" | diff-local |
| Story 3 negative: Given a custom member dispatched to a Codex candidate, when the provider is launched, then its argv carries none of `sandbox_mode="workspace-write"`, `sandbox_workspace_write.network_access=true`, `approval_policy="on-request"`, or `approvals_reviewer="auto_review"`. | 2 | "argv carries none of the workspace-write sandbox mode, the workspace-write network access override, the on-request approval policy, or the auto_review approvals reviewer" | diff-local |
| Story 3 negative: Given a custom member dispatched to a Codex candidate on a non-self-host project, when the provider is launched, then no login file is copied for it, and the only engine-owned scratch home it receives is the native-schema scratch home, which it does not use as `CODEX_HOME`. | 3 | "no login file is copied and the only engine scratch home passed is `nativeSchemaScratchHome`, which is not the child's CODEX_HOME" | diff-local |
| Story 4 happy: Given a custom-policy lap whose inputs are unchanged between fan-out and join, when the join completes, then the member results proceed to the aggregate exactly as today, and the lap's digest record exists under its build-review evidence root. | 7 | "publishes the aggregate the existing lap test expects and writes the digest record under the lap's build-review evidence root" | diff-local |
| Story 4 happy: Given the engine writes a new branch artifact under the evidence root during the lap, when the join completes, then the lap is not treated as mutated. | 5, 7 | "a file created under the evidence root after capture is not reported" | diff-local |
| Story 4 happy: Given a tracked file in the feature checkout changes during the lap, when the join completes, then the lap is not discarded and its members' results still name the lap's captured input identity. | 7 | "changes a tracked feature-checkout file during fan-out publishes its aggregate, and the member results name the lap's captured input identity" | diff-local |
| Story 4 negative: Given a fixture reviewer that modifies a file in the frozen head tree during fan-out, when the join completes, then every member result of that lap is discarded, the lap settles with closed cause `review-input-mutated` naming that path, no aggregate is published, and the mechanical-fault counter increases by one. | 7 | "settles every member `review-input-mutated` naming that path, publishes no aggregate, increments the mechanical-fault counter by one" | diff-local |
| Story 4 negative: Given a file in the frozen baseline tree, the captured policy material, or the installed policy package changes during fan-out, when the join completes, then the lap settles `review-input-mutated` naming the changed input. | 5, 7 | "modify a frozen-baseline file, a captured policy material file, an installed policy package file, or a pre-existing evidence file each settle `review-input-mutated` naming that input" | diff-local |
| Story 4 negative: Given an engine-evidence file that existed at fan-out is modified during the lap, when the join completes, then the lap settles `review-input-mutated` naming that file. | 5, 7 | "while a modification to an evidence file present at capture is reported" | diff-local |
| Story 4 negative: Given `review-input-mutated` occurs on the lap that exhausts the mechanical-fault allowance, when the step settles, then the feature halts `needs-human` with a body naming `review-input-mutated` and the changed inputs. | 7 | "halts `needs-human` with a body naming `review-input-mutated` and the changed inputs" | diff-local |
| Story 4 negative: Given a lap settled `review-input-mutated` with allowance remaining, when build_review re-runs, then the new lap materializes a fresh frozen view and its members judge again. | 7 | "a lap test with allowance remaining re-runs on a freshly materialized frozen view" | diff-local |
| Story 5 happy: Given a project whose enabled custom rubric names Codex, and a Codex sandbox helper fixture that starts the probe process and refuses its write, when the daemon starts, then one capability event records Codex available on the host platform and `daemon status` renders it as available. | 8, 10, 12 | "emits one `build_review_read_only_capability` event for Codex before the first feature dispatch" | diff-local |
| Story 5 happy: Given a project whose enabled custom rubric names Claude, and a Claude CLI fixture that accepts the restricted-mode flags, when the daemon starts, then the capability event records Claude available. | 8, 10 | "a Claude probe yields `available` when the CLI help lists `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config`" | diff-local |
| Story 5 happy: Given an interactive run whose config enables a custom rubric naming an unavailable provider, when the config loads, then a config warning names the provider, the platform and the reason before any step runs. | 11 | "prints a config warning naming the provider, the platform and the reason before any step runs" | diff-local |
| Story 5 negative: Given a Codex sandbox helper fixture that cannot start the probe process, when the daemon starts, then the capability event and the daemon log record Codex unavailable naming the platform and the helper's error, before any feature is dispatched. | 8, 10 | "logs the provider, the platform and the reason and still enters the dispatch loop" | diff-local |
| Story 5 negative: Given a Codex sandbox helper fixture that starts the probe process but lets its write succeed, when the daemon starts, then Codex is recorded unavailable with a reason stating the write was not refused. | 8 | "whose write succeeds" | diff-local |
| Story 5 negative: Given the Codex executable is absent or the probe emits unrecognized output, when the daemon starts, then Codex is recorded unavailable naming that reason, and the daemon still starts. | 8, 10 | "whose executable is absent, or whose output is unrecognized each yield `unavailable` with that reason and the platform" | diff-local |
| Story 5 negative: Given no project enables a custom rubric, when the daemon starts, then no capability probe process is spawned and no capability event is emitted. | 10 | "with no enabled custom rubric records no capability probe spawn and no capability event" | diff-local |
| Story 5 negative: Given the daemon is not running, when `daemon status` renders, then it shows the latest persisted capability result, or states that none has been recorded, and spawns no probe. | 12 | "with no recorded result the status output states none has been recorded, and that rendering records no probe spawn" | diff-local |
| Story 6 happy: Given a custom member whose candidates are Codex then Claude, with Codex recorded unavailable and Claude available, when the member dispatches, then a `provider_attempt` records Codex with `invoked` false, skip reason `setup-unavailable`, and a setup capability naming the read-only review mode, and Claude produces the member's judged result. | 13 | "yields a `provider_attempt` with `invoked` false, skipReason `setup-unavailable`, and a setupCapability naming the read-only review mode, and the next candidate is invoked" | diff-local |
| Story 6 negative: Given a custom member none of whose candidates has an available read-only review mode, when the lap runs, then the member settles `read-only-review-unavailable` naming the platform and each candidate's reason, and zero provider processes are launched for it. | 14 | "settles `read-only-review-unavailable` naming the platform and each candidate's reason, with zero provider launches" | diff-local |
| Story 6 negative: Given a lap in which a member settled `read-only-review-unavailable`, when the step settles, then the feature halts `needs-human` on that first occurrence without incrementing the mechanical-fault counter, and the halt body names the platform and the providers. | 14 | "halts `needs-human` on that first occurrence with the mechanical-fault counter unchanged, and the halt body names the platform and the providers" | diff-local |
| Story 6 negative: Given a candidate whose provider declares no read-only review mode, when it is considered for a custom-policy lap member, then it is refused as having no read-only review mode and is never launched. | 8, 13 | "records its setup-unavailable skip and launches no process for it" | diff-local |
| Story 6 negative: Given a member whose candidates are one read-only-unavailable provider and one usage-suppressed provider, when the member dispatches, then each candidate yields exactly one `provider_attempt`, and the step enters the existing usage wait rather than settling `read-only-review-unavailable`. | 13 | "records exactly one `provider_attempt` per candidate and returns the existing usage-limit wait result rather than `read-only-review-unavailable`" | diff-local |
| Story 6 negative: Given a feature halted `needs-human` for `read-only-review-unavailable` with mechanical allowance remaining, when the operator records reduced coverage for that rubric, then the decision is accepted rather than refused for remaining allowance. | 15 | "records a reduced-coverage decision for a rubric halted on `read-only-review-unavailable` with the mechanical-fault counter below the ceiling, and the decision is stored" | diff-local |
| Story 7 happy: Given a build_review lap with no enabled custom rubric, when its Claude and Codex members launch, then their argv and environment are identical to the pre-change invocation, including `--dangerously-skip-permissions` for Claude and the workspace-write overrides for Codex. | 17 | "asserts the Claude and Codex member argv and environment equal the literal pre-change expectations" | diff-local |
| Story 7 happy: Given an ordinary BUILD step dispatched to Codex, when it launches, then its argv carries the existing workspace-write sandbox overrides and no read-only review option. | 2, 17 | "an unattended invocation without `readOnlyReview` still carries the workspace-write, network access, on-request and auto_review overrides" | diff-local |
| Story 7 negative: Given a build_review lap with no enabled custom rubric, when it runs, then no integrity digest is recorded, no read-only capability is consulted, and no member is refused for read-only-review-unavailable. | 17 | "no digest record is written, no capability result is consulted, and no member settles `read-only-review-unavailable`" | diff-local |
| Story 7 negative: Given a self-host dispatch of an ordinary step, when it launches, then its self-host live-containment wrap and prepared environment are unchanged. | 17 | "the self-host live-containment invocation tests pass with unchanged assertions" | diff-local |
| Story 7 negative: Given a custom rubric declared but disabled, when build_review runs, then the lap behaves as a built-in-only lap. | 17 | "a lap test with a declared but disabled custom rubric produces the same invocations as the built-in-only lap" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | Custom rubric declaration schema, validation, defaults and the disabled-member behavior are unchanged; this feature changes only how an enabled member executes. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Installed-catalog discovery through Codex skills/list and the Claude plugin and skill roots is unchanged; D5.1 removes the review scratch home from the launch, not from discovery. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | Policy bundle capture, hashing, limits and delivery of the captured SKILL.md text are unchanged; D5.3 digests the material path the capture already produces. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The read-only review policy contract and unsupported-policy diagnostics are unchanged; the git tool admission stays because both read-only modes run read-only git. |
| adr-2026-09-10-portable-build-review-policy#D5 | task | task-1, task-2, task-3, task-4, task-7, task-8, task-10, task-11, task-12, task-13, task-16 | settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Cache identity (declaration, contract versions, input digest, execution policy, engine stamp, bundle digest, provider, model, effort) is unchanged; the invocation profile is not part of semantic identity. |
| adr-2026-09-10-portable-build-review-policy#D7 | no-change | none | The custom-v1 result contract, finding identity, and engine stamping are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D8 | no-change | none | Adjudicator case context and the single remediate judgment are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D9 | no-change | none | The case-v2 consistency and escalation contract is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D10 | task | task-14 | settles `read-only-review-unavailable` naming the platform and each candidate's reason, with zero provider launches |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-7 | increments the mechanical-fault counter by one |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-9 | is declared with render and persist sinks |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | task | task-6 | accepts `review-input-mutated` and `read-only-review-unavailable` |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | task | task-6 | round-trips through `parseBuildReviewCustomArtifactMember` unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | task | task-7, task-14 | publishes no aggregate |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | task | task-7 | increments the mechanical-fault counter by one |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-14 | halts `needs-human` on that first occurrence with the mechanical-fault counter unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | task | task-15 | records a reduced-coverage decision for a rubric halted on `read-only-review-unavailable` |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | no-change | none | Every member branch of a discarded lap settles with its own rubric and the closed reason, so the existing rubric-plus-reason identity applies unchanged. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | no-change | none | Judged-finding blocking and the separation of finding acceptance from reduced coverage are unchanged. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | no-change | none | Reduced-coverage stamping and its no-expiry rule are unchanged. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | task | task-7 | emits `build_review_rubric_infrastructure_failure` with the changed inputs |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
