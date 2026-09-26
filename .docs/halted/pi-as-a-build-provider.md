# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-26T15:17:10.353Z
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: cf21e767bea2e834224312790af2fde806e0bdcd
Halted at: 2026-09-26T15:09:27.614Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 2 negative: Given pi is selected for a path that requires the selfHost capability, when that path is reached, then it fails before spawning with an error naming provider pi, capability selfHost, and the owning intake.
Task ids: 6
Done when checks: a test asserts preparing a self-host provider home for pi throws `ProviderCapabilityUnsupportedError` naming `selfHost` and `#1887`, and that the subprocess spawn stub was never called | the existing self-host provider-home, live-boundary, and sandbox tests for claude and codex pass with unchanged assertions
Missing assertion: The cited check requires naming selfHost and #1887 and no spawn, but does not explicitly require the error to name provider pi.

Criterion: Story 2 negative: Given pi is selected for build-review with a custom review policy, when the review-policy catalog path is reached, then it fails naming capability reviewPolicyCatalog instead of falling into the codex or claude branch.
Task ids: 5
Done when checks: a test asserts the review-policy catalog factory given provider pi throws `ProviderCapabilityUnsupportedError` naming `reviewPolicyCatalog`, and that neither the claude nor the codex policy discovery stub was called | build-review read-only review and policy modules accept `ProviderWith` capability types, and the existing claude and codex build-review tests pass with unchanged assertions
Missing assertion: The cited check requires naming reviewPolicyCatalog and avoids both provider branches, but does not explicitly require the error to name provider pi.

Criterion: Story 7 happy: Given Pi credentials are present and live tests are opted in, when the Pi smoke leg runs, then a trivial Pi step completes through the real CLI.
Task ids: 20
Done when checks: the live-coverage structural test iterates `BUILT_IN_PROVIDERS` together with registered external plugin ids and a test asserts a registered fixture plugin is enumerated | a test asserts the live-coverage structural test requires the pi entry and smoke leg while discovery reports no provider installed | `live-e2e-providers.ts` is keyed by catalog ids, contains a pi entry, and `daemon-e2e-live-pi.smoke.test.ts` runs a trivial Pi step when credentials are present and live tests are opted in | a test asserts the Pi smoke leg skips with a named reason when Pi credentials are absent and makes no real Pi call
Missing assertion: The cited checks do not explicitly require that the trivial Pi step completes through the real CLI.
```
