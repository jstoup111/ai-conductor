# Halt record

Status: halted
Slug: custom-build-review-rubrics-cannot-run-off-linux-o
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-custom-build-review-rubrics-cannot-run-off-linux-o
Head SHA: aac085c9e8164941a8b6ff90ccaccad6d96cab92
Halted at: 2026-09-25T12:12:30.034Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given a custom-policy lap on a Linux host fixture with unrestricted bubblewrap, when the lap runs, then the custom member settles with a judged result through the same launch shape as the restricted host.
Task ids: 3
Done when checks: an integration test of `dispatchInstalledBuildReviewPolicy` on three non-self-host host fixtures (Linux with nested namespaces refused, Linux unrestricted, darwin without bubblewrap) settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns; on the darwin-without-bubblewrap fixture no member result text names bubblewrap, a nested sandbox, or a containment probe | the same test asserts the Claude and Codex custom-member launches carry the `readOnlyReview` option and an environment equal to an ordinary step's environment for that candidate, with no engine-overridden HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, TMPDIR or XDG scratch path | a Codex custom-member test asserts no login file is copied and the only engine scratch home passed is `nativeSchemaScratchHome`, which is not the child's CODEX_HOME | a provider-error fixture settles the custom member with cause `provider-error`, and no member result text names bubblewrap, a nested sandbox, or a containment probe | a self-host fixture asserts the custom member launches through the self-host prepared invocation with that invocation's environment overlay intact
Missing assertion: No cited check explicitly compares the unrestricted Linux launch shape with the nested-namespace-refused host's launch shape.

Criterion: Story 5 negative: Given the Codex executable is absent or the probe emits unrecognized output, when the daemon starts, then Codex is recorded unavailable naming that reason, and the daemon still starts.
Task ids: 8, 10
Done when checks: a unit test with an injected process runner asserts a Codex probe whose sandboxed process starts and whose write is refused yields `available` naming the platform | unit tests assert a Codex probe that cannot start, whose write succeeds, whose executable is absent, or whose output is unrecognized each yield `unavailable` with that reason and the platform | a unit test asserts a Claude probe yields `available` when the CLI help lists `--restricted`, `--tools`, `--allowedTools` and `--strict-mcp-config`, and `unavailable` naming the missing flag otherwise | a unit test asserts a provider with no read-only review mode yields `unavailable` and the injected runner records no spawn | a runDaemonMode wiring test with a project enabling a custom rubric naming Codex emits one `build_review_read_only_capability` event for Codex before the first feature dispatch, and a sibling test with a project enabling a custom rubric naming Claude and a Claude CLI fixture accepting the restricted-mode flags emits one event recording Claude `available` | a runDaemonMode wiring test with an unavailable Codex result logs the provider, the platform and the reason and still enters the dispatch loop; with a Codex sandbox helper fixture that cannot start the probe process, the capability event recording Codex `unavailable` and the daemon log line naming the platform and the helper's error are both emitted before the first feature dispatch | a runDaemonMode wiring test with no enabled custom rubric records no capability probe spawn and no capability event | a wiring test asserts the daemon-scoped capability result reaches the build_review step runner through the Conductor options
Missing assertion: A cited check must require that the daemon still starts specifically when Codex is absent or emits unrecognized output.
```
