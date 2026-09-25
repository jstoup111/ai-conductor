# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-25T12:09:40.311Z
Slug: custom-build-review-rubrics-cannot-run-off-linux-o
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-custom-build-review-rubrics-cannot-run-off-linux-o
Head SHA: f420b5194839d3ae176d134a62db47df6e6296a9
Halted at: 2026-09-25T11:47:32.464Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 negative: Given a custom-policy lap on a host with no bubblewrap executable at all, when the lap runs, then no member settles with `preflight-failed` and no member result names bubblewrap, a nested sandbox, or a containment probe.
Task ids: 3, 16
Done when checks: an integration test of `dispatchInstalledBuildReviewPolicy` on three non-self-host host fixtures (Linux with nested namespaces refused, Linux unrestricted, darwin without bubblewrap) settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns | the same test asserts the Claude and Codex custom-member launches carry the `readOnlyReview` option and an environment equal to an ordinary step's environment for that candidate, with no engine-overridden HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, TMPDIR or XDG scratch path | a Codex custom-member test asserts no login file is copied and the only engine scratch home passed is `nativeSchemaScratchHome`, which is not the child's CODEX_HOME | a provider-error fixture settles the custom member with cause `provider-error`, and no member result text names bubblewrap, a nested sandbox, or a containment probe | a self-host fixture asserts the custom member launches through the self-host prepared invocation with that invocation's environment overlay intact | the Task 3, Task 4 and Task 7 integration tests pass after the deletion with unchanged assertions | the frozen input scope text rendered for a custom member is byte-identical before and after the move, as asserted by the existing frozen-scope prompt test | `npm run typecheck` in src/conductor exits 0 after the deletion
Missing assertion: No cited check requires the no-bubblewrap-host fixture itself to produce member results that omit bubblewrap, nested-sandbox, and containment-probe wording.

Criterion: Story 2 happy: Given a built-in peer of a custom-policy lap dispatched to a Claude candidate, when the provider is launched, then its argv carries the same read-only review flags as the custom member.
Task ids: 4
Done when checks: an integration test of a mixed custom and built-in lap asserts the built-in peer's launch carries the `readOnlyReview` option and its Claude argv lacks `--dangerously-skip-permissions` | the same test asserts the built-in peer's cwd is the lap's frozen head and its prompt carries the frozen input scope | a testQuality peer fixture on Claude asserts the launched argv allow rules admit `git show`
Missing assertion: The cited checks require the built-in peer to receive readOnlyReview and omit --dangerously-skip-permissions, but do not require its argv to carry all of the custom member’s read-only review flags.

Criterion: Story 4 negative: Given a lap settled `review-input-mutated` with allowance remaining, when build_review re-runs, then the new lap materializes a fresh frozen view and its members judge again.
Task ids: 7
Done when checks: a custom-policy lap test whose inputs stay unchanged publishes the aggregate the existing lap test expects and writes the digest record under the lap's build-review evidence root | a lap test with a fixture reviewer that modifies a frozen-head file during fan-out settles every member `review-input-mutated` naming that path, publishes no aggregate, increments the mechanical-fault counter by one, and emits `build_review_rubric_infrastructure_failure` with the changed inputs | lap tests that modify a frozen-baseline file, a captured policy material file, an installed policy package file, or a pre-existing evidence file each settle `review-input-mutated` naming that input | a lap test that writes a new engine branch artifact and changes a tracked feature-checkout file during fan-out publishes its aggregate, and the member results name the lap's captured input identity | a lap test at the last mechanical allowance halts `needs-human` with a body naming `review-input-mutated` and the changed inputs, and a lap test with allowance remaining re-runs on a freshly materialized frozen view
Missing assertion: The cited check requires a re-run on a freshly materialized frozen view, but does not explicitly require that the new lap's members judge again.

Criterion: Story 5 happy: Given a project whose enabled custom rubric names Claude, and a Claude CLI fixture that accepts the restricted-mode flags, when the daemon starts, then the capability event records Claude available.
Task ids: 8, 10
Done when checks: a unit test with an injected process runner asserts a Codex probe whose sandboxed process starts and whose write is refused yields `available` naming the platform | unit tests assert a Codex probe that cannot start, whose write succeeds, whose executable is absent, or whose output is unrecognized each yield `unavailable` with that reason and the platform | a unit test asserts a Claude probe yields `available` when the CLI help lists `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config`, and `unavailable` naming the missing flag otherwise | a unit test asserts a provider with no read-only review mode yields `unavailable` and the injected runner records no spawn | a runDaemonMode wiring test with a project enabling a custom rubric naming Codex emits one `build_review_read_only_capability` event for Codex before the first feature dispatch | a runDaemonMode wiring test with an unavailable Codex result logs the provider, the platform and the reason and still enters the dispatch loop | a runDaemonMode wiring test with no enabled custom rubric records no capability probe spawn and no capability event | a wiring test asserts the daemon-scoped capability result reaches the build_review step runner through the Conductor options
Missing assertion: No cited daemon wiring check requires a Claude capability event recording Claude as available.

Criterion: Story 5 negative: Given a Codex sandbox helper fixture that cannot start the probe process, when the daemon starts, then the capability event and the daemon log record Codex unavailable naming the platform and the helper's error, before any feature is dispatched.
Task ids: 8, 10
Done when checks: a unit test with an injected process runner asserts a Codex probe whose sandboxed process starts and whose write is refused yields `available` naming the platform | unit tests assert a Codex probe that cannot start, whose write succeeds, whose executable is absent, or whose output is unrecognized each yield `unavailable` with that reason and the platform | a unit test asserts a Claude probe yields `available` when the CLI help lists `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config`, and `unavailable` naming the missing flag otherwise | a unit test asserts a provider with no read-only review mode yields `unavailable` and the injected runner records no spawn | a runDaemonMode wiring test with a project enabling a custom rubric naming Codex emits one `build_review_read_only_capability` event for Codex before the first feature dispatch | a runDaemonMode wiring test with an unavailable Codex result logs the provider, the platform and the reason and still enters the dispatch loop | a runDaemonMode wiring test with no enabled custom rubric records no capability probe spawn and no capability event | a wiring test asserts the daemon-scoped capability result reaches the build_review step runner through the Conductor options
Missing assertion: No cited daemon wiring check requires an unavailable failed-to-start Codex probe to emit the capability event before dispatch.
```
