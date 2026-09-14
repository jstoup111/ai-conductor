# Complexity: Support multiple test suites in BUILD

Tier: M

Source: jstoup111/ai-conductor#2358
Plan stem: support-multiple-test-suites-in-build

The change extends an existing deterministic verifier rather than adding a service, provider transport, or execution subsystem. It is Medium because configuration, ordered execution, evidence compatibility, fingerprinting, failure routing, and existing telemetry consumers must agree across one established boundary. Negative paths include invalid configuration, timeout and process cleanup, incomplete evidence, and stale proof. A lightweight architecture review and the full Medium DECIDE artifact set are required.

Scope remains all of #2358, suite agnostic. The #658 self-host configuration adoption remains separate.
