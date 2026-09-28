**Status:** Accepted

# Stories: Custom build_review rubrics run on every platform without an OS containment boundary

Source: jstoup111/ai-conductor#2735. Technical track, with no PRD. These stories derive from the
track scope boundary and the APPROVED amendments adr-2026-09-10-portable-build-review-policy
D5.1–D5.5 and adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D2.3, D3.2 and D10.2.

A "custom-policy lap" is a `build_review` lap with at least one enabled `build_review.custom_rubrics`
member. Its "members" are the custom members plus the built-in peers of the same lap. Provider
processes, the host platform and the provider sandbox helpers are replaced by faithful fakes at
the process boundary. Real macOS behavior is not exercised by this repository's CI and is
unverified at ship.

## Story 1: A custom rubric produces a verdict without a nested sandbox

**Requirement:** outcome-1

As an operator on macOS or on Ubuntu with the default AppArmor userns restriction, I want an
enabled custom rubric to judge my feature so that custom review is usable on my machine.

### Acceptance Criteria

#### Happy Path

- Given a custom-policy lap on a Linux host fixture where a second-level bubblewrap namespace is refused, when the lap runs with an admitted candidate, then the custom member settles with a judged result and no bubblewrap process is spawned by build_review.
- Given a custom-policy lap on a Linux host fixture with unrestricted bubblewrap, when the lap runs, then the custom member settles with a judged result through the same launch shape as the restricted host.
- Given a custom-policy lap on a host fixture reporting platform darwin with no bubblewrap on PATH, when the lap runs with a Claude candidate, then the custom member settles with a judged result.

#### Negative Paths

- Given a custom-policy lap on a host with no bubblewrap executable at all, when the lap runs, then no member settles with `preflight-failed` and no member result names bubblewrap, a nested sandbox, or a containment probe.
- Given a custom-policy lap whose admitted candidate returns a provider error, when the member settles, then it records the existing `provider-error` cause, not a containment or platform cause.
- Given a custom-policy lap on a darwin host fixture whose only candidate is Claude, when the lap runs, then the member is not refused for lack of a Linux read-only boundary.

### Done When

- [ ] A custom-policy lap test on each of three host fixtures reaches a judged custom result: Linux with nested namespaces refused, Linux unrestricted, and darwin without bubblewrap.
- [ ] Across those non-self-host fixtures, the build_review process-boundary spy records zero bubblewrap spawns.

## Story 2: Claude reviewers in a custom-policy lap launch in read-only review mode

**Requirement:** outcome-2

As an operator, I want a Claude reviewer in a custom-policy lap to have no tool that can change files
so that the frozen input, the policy and the evidence cannot be altered through it.

### Acceptance Criteria

#### Happy Path

- Given a custom member dispatched to a Claude candidate, when the provider is launched, then its argv carries `--restricted`, a `--tools` list naming exactly Read, Grep, Glob and Bash, `--allowedTools` rules admitting only read-only git subcommands, and `--strict-mcp-config` with no MCP configuration.
- Given a built-in peer of a custom-policy lap dispatched to a Claude candidate, when the provider is launched, then its argv carries the same read-only review flags as the custom member.
- Given a custom member dispatched to a Claude candidate on a non-self-host project, when the provider is launched, then its environment equals the environment an ordinary Claude step receives, with no engine-overridden `HOME`, `CLAUDE_CONFIG_DIR`, `TMPDIR`, or `XDG_*` scratch paths.

#### Negative Paths

- Given step options that request `dangerouslySkipPermissions` for build_review, when any member of a custom-policy lap launches on Claude, then `--dangerously-skip-permissions` is absent from its argv.
- Given a custom-policy lap member launched on Claude, when its argv is inspected, then no allow rule admits a Bash command other than a read-only git subcommand, and no rule admits Edit, Write, NotebookEdit or an MCP tool.
- Given a self-host project, when a custom-policy lap member launches on Claude, then it launches through the self-host prepared invocation with that invocation's own environment overlay intact.

### Done When

- [ ] Adapter-level tests assert the exact read-only Claude argv for a custom member and for a built-in peer, and assert the skip-permissions flag is absent.
- [ ] A test asserts that a custom member's Claude environment equals an ordinary step's environment for the same candidate.

## Story 3: Codex reviewers in a custom-policy lap launch in read-only review mode

**Requirement:** outcome-2

As an operator, I want a Codex reviewer in a custom-policy lap to run under Codex's own read-only
sandbox so that its shell commands cannot change files.

### Acceptance Criteria

#### Happy Path

- Given a custom member dispatched to a Codex candidate, when the provider is launched, then its argv carries `sandbox_mode="read-only"` and approval policy `never`.
- Given a custom member dispatched to a Codex candidate on a non-self-host project, when the provider is launched, then its environment equals the environment an ordinary Codex step receives, with no engine-overridden `HOME`, `CODEX_HOME`, or `XDG_*` scratch paths and no copied login file.

#### Negative Paths

- Given a custom member dispatched to a Codex candidate, when the provider is launched, then its argv carries none of `sandbox_mode="workspace-write"`, `sandbox_workspace_write.network_access=true`, `approval_policy="on-request"`, or `approvals_reviewer="auto_review"`.
- Given a custom member dispatched to a Codex candidate on a non-self-host project, when the provider is launched, then no login file is copied for it, and the only engine-owned scratch home it receives is the native-schema scratch home, which it does not use as `CODEX_HOME`.

### Done When

- [ ] Adapter-level tests assert the read-only Codex argv for a custom-policy lap member and the absence of each workspace-write override.
- [ ] A test asserts that a custom member's Codex environment equals an ordinary step's environment for the same candidate.

## Story 4: A change to a protected lap input discards the whole lap

**Requirement:** outcome-2

As an operator, I want a custom-policy lap whose inputs change while reviewers run to be thrown
away rather than trusted, so that no verdict rests on altered input.

### Acceptance Criteria

#### Happy Path

- Given a custom-policy lap whose inputs are unchanged between fan-out and join, when the join completes, then the member results proceed to the aggregate exactly as today, and the lap's digest record exists under its build-review evidence root.
- Given the engine writes a new branch artifact under the evidence root during the lap, when the join completes, then the lap is not treated as mutated.
- Given a tracked file in the feature checkout changes during the lap, when the join completes, then the lap is not discarded and its members' results still name the lap's captured input identity.

#### Negative Paths

- Given a fixture reviewer that modifies a file in the frozen head tree during fan-out, when the join completes, then every member result of that lap is discarded, the lap settles with closed cause `review-input-mutated` naming that path, no aggregate is published, and the mechanical-fault counter increases by one.
- Given a file in the frozen baseline tree, the captured policy material, or the installed policy package changes during fan-out, when the join completes, then the lap settles `review-input-mutated` naming the changed input.
- Given an engine-evidence file that existed at fan-out is modified during the lap, when the join completes, then the lap settles `review-input-mutated` naming that file.
- Given `review-input-mutated` occurs on the lap that exhausts the mechanical-fault allowance, when the step settles, then the feature halts `needs-human` with a body naming `review-input-mutated` and the changed inputs.
- Given a lap settled `review-input-mutated` with allowance remaining, when build_review re-runs, then the new lap materializes a fresh frozen view and its members judge again.

### Done When

- [ ] A lap-level test with a mutating fixture reviewer settles every member of that lap `review-input-mutated` and publishes no aggregate.
- [ ] Tests cover mutation of each protected input kind, and a no-mutation test covers engine-authored evidence writes and a changed feature checkout.
- [ ] The occurrence is emitted on `build_review_rubric_infrastructure_failure` with cause `review-input-mutated` and the changed-input list.

## Story 5: An unavailable read-only review mode is reported before any feature runs

**Requirement:** outcome-3

As an operator, I want to learn at startup that a provider cannot run custom review on this platform,
so that I do not discover it after three wasted review faults.

### Acceptance Criteria

#### Happy Path

- Given a project whose enabled custom rubric names Codex, and a Codex sandbox helper fixture that starts the probe process and refuses its write, when the daemon starts, then one capability event records Codex available on the host platform and `daemon status` renders it as available.
- Given a project whose enabled custom rubric names Claude, and a Claude CLI fixture that accepts the restricted-mode flags, when the daemon starts, then the capability event records Claude available.
- Given an interactive run whose config enables a custom rubric naming an unavailable provider, when the config loads, then a config warning names the provider, the platform and the reason before any step runs.

#### Negative Paths

- Given a Codex sandbox helper fixture that cannot start the probe process, when the daemon starts, then the capability event and the daemon log record Codex unavailable naming the platform and the helper's error, before any feature is dispatched.
- Given a Codex sandbox helper fixture that starts the probe process but lets its write succeed, when the daemon starts, then Codex is recorded unavailable with a reason stating the write was not refused.
- Given the Codex executable is absent or the probe emits unrecognized output, when the daemon starts, then Codex is recorded unavailable naming that reason, and the daemon still starts.
- Given no project enables a custom rubric, when the daemon starts, then no capability probe process is spawned and no capability event is emitted.
- Given the daemon is not running, when `daemon status` renders, then it shows the latest persisted capability result, or states that none has been recorded, and spawns no probe.

### Done When

- [ ] Daemon-start tests, using an injected process runner, emit one capability event per provider named by enabled custom members, and cover each of: available, cannot start, write not refused, absent, unrecognized.
- [ ] `daemon status` output and the interactive config warning name the provider, the platform and the reason for an unavailable result.
- [ ] The capability event variant is declared in the event-sink registry with its render and persist sinks.

## Story 6: Dispatch skips an unavailable candidate and halts at once when none remains

**Requirement:** outcome-3

As an operator, I want a custom member to use another available provider when its first choice cannot
run read-only here, and to stop at once with a clear reason when none can.

### Acceptance Criteria

#### Happy Path

- Given a custom member whose candidates are Codex then Claude, with Codex recorded unavailable and Claude available, when the member dispatches, then a `provider_attempt` records Codex with `invoked` false, skip reason `setup-unavailable`, and a setup capability naming the read-only review mode, and Claude produces the member's judged result.

#### Negative Paths

- Given a custom member none of whose candidates has an available read-only review mode, when the lap runs, then the member settles `read-only-review-unavailable` naming the platform and each candidate's reason, and zero provider processes are launched for it.
- Given a lap in which a member settled `read-only-review-unavailable`, when the step settles, then the feature halts `needs-human` on that first occurrence without incrementing the mechanical-fault counter, and the halt body names the platform and the providers.
- Given a candidate whose provider declares no read-only review mode, when it is considered for a custom-policy lap member, then it is refused as having no read-only review mode and is never launched.
- Given a member whose candidates are one read-only-unavailable provider and one usage-suppressed provider, when the member dispatches, then each candidate yields exactly one `provider_attempt`, and the step enters the existing usage wait rather than settling `read-only-review-unavailable`.
- Given a feature halted `needs-human` for `read-only-review-unavailable` with mechanical allowance remaining, when the operator records reduced coverage for that rubric, then the decision is accepted rather than refused for remaining allowance.

### Done When

- [ ] A candidate-ladder test shows the unavailable candidate skipped as `setup-unavailable` with the read-only review setup capability, and the next candidate judging.
- [ ] A no-candidate test settles `read-only-review-unavailable` with zero launches, and halts `needs-human` on the first occurrence with the mechanical-fault counter unchanged.
- [ ] A reduced-coverage CLI test accepts a decision for a rubric halted on `read-only-review-unavailable` below the mechanical-fault ceiling.

## Story 7: Built-in-only laps and non-review steps behave as today

**Requirement:** outcome-4

As an operator who has not enabled a custom rubric, I want nothing about my review or build steps to
change.

### Acceptance Criteria

#### Happy Path

- Given a build_review lap with no enabled custom rubric, when its Claude and Codex members launch, then their argv and environment are identical to the pre-change invocation, including `--dangerously-skip-permissions` for Claude and the workspace-write overrides for Codex.
- Given an ordinary BUILD step dispatched to Codex, when it launches, then its argv carries the existing workspace-write sandbox overrides and no read-only review option.

#### Negative Paths

- Given a build_review lap with no enabled custom rubric, when it runs, then no integrity digest is recorded, no read-only capability is consulted, and no member is refused for read-only-review-unavailable.
- Given a self-host dispatch of an ordinary step, when it launches, then its self-host live-containment wrap and prepared environment are unchanged.
- Given a custom rubric declared but disabled, when build_review runs, then the lap behaves as a built-in-only lap.

### Done When

- [ ] A regression test compares built-in-only build_review invocations (argv and env) for Claude and Codex against the pre-change expectations.
- [ ] Existing ordinary BUILD and self-host invocation tests pass with unchanged assertions.
