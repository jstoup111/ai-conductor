# Halt record

Status: halted
Slug: custom-build-review-rubrics-cannot-run-off-linux-o
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-custom-build-review-rubrics-cannot-run-off-linux-o
Head SHA: db863d456e6c29b3b7bffa79034f50ddce2c37d2
Halted at: 2026-09-25T12:20:10.311Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 negative: Given a custom-policy lap on a darwin host fixture whose only candidate is Claude, when the lap runs, then the member is not refused for lack of a Linux read-only boundary.
Task ids: 3
Done when checks: an integration test of `dispatchInstalledBuildReviewPolicy` on three non-self-host host fixtures (Linux with nested namespaces refused, Linux unrestricted, darwin without bubblewrap) settles the custom member with a judged result, no member settles `preflight-failed`, and the execa spy records zero bubblewrap spawns; on the darwin-without-bubblewrap fixture no member result text names bubblewrap, a nested sandbox, or a containment probe; and the Linux-unrestricted fixture's custom-member launch (provider, argv, cwd and environment) is asserted equal to the nested-namespaces-refused fixture's launch | the same test asserts the Claude and Codex custom-member launches carry the `readOnlyReview` option and an environment equal to an ordinary step's environment for that candidate, with no engine-overridden HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, TMPDIR or XDG scratch path | a Codex custom-member test asserts no login file is copied and the only engine scratch home passed is `nativeSchemaScratchHome`, which is not the child's CODEX_HOME | a provider-error fixture settles the custom member with cause `provider-error`, and no member result text names bubblewrap, a nested sandbox, or a containment probe | a self-host fixture asserts the custom member launches through the self-host prepared invocation with that invocation's environment overlay intact
Missing assertion: A check explicitly requiring that the darwin fixture's sole Claude candidate settles without refusal for lack of a Linux read-only boundary.
```
