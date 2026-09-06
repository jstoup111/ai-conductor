# Intake origin: skip-a-provider-candidate-whose-preparation-fails-

Source-Ref: jstoup111/ai-conductor#1285
Owner: jstoup111

## Desired outcome
- A provider candidate that fails a static capability/setup check is skipped, and the next candidate in the declared list is resolved and dispatched.
- Exhausting every candidate is what fails the step — not the first unusable one.
- A skipped candidate is logged with the reason it was skipped, so the fallback is observable rather than silent.
- A setup-time capability failure does not consume a dispatch retry: retries exist for transient runtime failures, and a deterministic capability gap can never succeed on retry.
- Negative path: a candidate that resolves successfully but whose dispatch fails at runtime still burns a retry as it does today.
- Regression coverage: `llm_provider: [codex, claude]` with codex isolation unavailable dispatches on claude and completes.
