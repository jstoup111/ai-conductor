# Intake origin: live-daemon-e2e-build-step-never-runs-a-real-agent

Source-Ref: jstoup111/ai-conductor#1311
Owner: jstoup111

## Desired outcome

- The live daemon E2E build step produces a genuine agent turn — non-zero turns and
- The seeded fixture task in that run completes with `madeCommit`, `touchedFixture`, and
- When a harness step command is unavailable to the provider, the run fails naming that
- A genuine build regression still fails the test, and is distinguishable in the output
- The signal holds for any harness step command the live tier dispatches, not only the
