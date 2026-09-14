# Track: Reliable CI repair dispatch

Track: technical

Source: jstoup111/ai-conductor#2153

Scope boundary: Restore useful failing-check context and visible retrieval failures; ensure repair outcomes truthfully distinguish unsuccessful verification/publication from success; avoid consuming repair attempts when startup readiness prevents any repair session; and make readiness and repair execution inherit the existing build provider, model, effort, and fallback configuration. The operator expanded the original issue after reviewing these adjacent defects and selected build-configuration inheritance.

This repairs internal daemon orchestration rather than introducing a separate product capability. Acceptance criteria belong in stories; no PRD is required. Do not add independent CI-repair provider configuration, redesign general provider routing, or repair the underlying failures of individual PRs.

## Confirmed direction

The operator approved ai-conductor as the target, requested a review before choosing breadth, then requested expansion to the reviewed dispatch-reliability defects. The operator selected “inherit” when offered existing build configuration versus independent CI-repair settings.

Use deterministic engine checks and explicit outcomes at the dispatch and publication boundaries. Keep provider judgment responsible for diagnosing and repairing CI failures; the daemon remains responsible for verification and publication.

## Scope classification

Audience: shared engine / consumer-facing. The scope-check daemon heuristic flags repository-only, but the mechanism is distributed and is not gated on self-host execution. The repository's mechanism-existence override therefore determines placement. No new harness behavioral rule is proposed.

Catalog: n/a; no new skill. Provider: agnostic; inherit the existing build selection and provider-native settings rather than adding a Claude-only requirement. Registration: none.

## Verified exploration basis

- `engine/ci-fix.ts`, `buildCiFixHint`: requests JSON without fields, expects nested check suites, and collapses failures into an empty string.
- `engine/ci-fix.ts`, `runCiFix`: returns the runner's `changed` result after guard, verifier, or lease-push refusal.
- `daemon-cli.ts`, CI-fix dispatch: translates `changed` to `green-verified`; `engine/mergeable-sweep.ts` resets attempts on that result.
- `daemon-cli.ts`, startup preflight: checks Claude independently of configured providers; the disabled-dispatch check runs after the sweep's attempt increment.
- `engine/step-runners.ts`, `resolveCiFailure` and `executeProviderAwareOneShotCore`: already resolve execution as the build step, including its provider preference and native model/effort configuration.

These findings are verified by source review, not a live repair run. The review changed no production files and ran no provider sessions.
