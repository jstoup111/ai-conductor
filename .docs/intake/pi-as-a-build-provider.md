# Intake origin: pi-as-a-build-provider

Source-Ref: jstoup111/ai-conductor#1884
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1884 digest=31f5cf8e1784e02edb5b61819542865c42a9a7c7b4c8b6e3ca59d2dd168a81c0 >>>
## Desired outcome

- A config selecting `llm_provider: pi` (run-level or `steps.<step>.llm_provider`) dispatches that work through the Pi CLI headlessly and the step completes with a normal verdict.
- Pi participates in the existing candidate-fallback ladder: when Pi is unavailable or exhausted, the run advances to the next configured provider exactly as claude/codex do today.
- Every Pi invocation is a fresh session (no resume), consistent with the harness's no-provider-session-resume policy.
- Pi CLI failures (auth, rate limit, model unavailable, missing binary) surface as the harness's classified provider failure signals, not as opaque step errors.
- Config validation rejects a `pi` selection with the same quality of error messaging as an unknown provider today, until/unless Pi is installed and registered.
- The default test suite exercises the Pi integration against a faithful fake; no real Pi/LLM calls outside opt-in smoke tests.
<<< END INBOUND >>>
