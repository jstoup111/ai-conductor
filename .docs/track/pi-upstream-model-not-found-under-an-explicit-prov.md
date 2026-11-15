# Track: Pi upstream model-not-found under an explicit provider is an ordinary failure

Track: technical

Scope boundary: classify an upstream unknown-model rejection under an explicit `--provider` as
`modelUnavailable` only for the OpenRouter shape captured from real Pi 1.0.0 output on 2026-11-15
(`400: {"message":"<model> is not a valid model ID","code":400}`), so the existing Pi model ladder
advances. Every other upstream, including DeepSeek, stays unclassified. Excludes Pi's
pre-request `Warning: Model "…" not found for provider "…"` stderr line as a signal, HTTP 402
insufficient-balance rejections, and any change to the ladder, the boot probe, or other providers.

Internal provider-failure classification with no new user-facing capability. Source: intake
jstoup111/ai-conductor#3505.
