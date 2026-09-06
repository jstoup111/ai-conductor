# Intake origin: seed-the-live-daemon-e2e-smoke-as-a-linked-worktre

Source-Ref: jstoup111/ai-conductor#1669
Owner: jstoup111

## Desired outcome
- The live smoke exercises build_review's effective-verdict resolution through the production code path, with no injected resolver.
- A regression in feature-identity or disposition-store resolution fails the smoke gate before it can fail a release.
- The smoke continues to pass in its isolated temp environment.
