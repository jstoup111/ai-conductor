# Complexity: Configurable harness log export

Tier: L

Source-Ref: jstoup111/ai-conductor#1935

Scope: Both daemon-managed and interactive runs, shared log delivery and attribution, operational diagnostics, four requested destination families, separate default-off log sending, preserved local output, and isolated delivery failures. The operator approved this approach after the Large effort estimate was presented on 2026-09-30.

## Assessment

| Signal | Assessment |
| --- | --- |
| New domain models | Small: no business-domain tables; the existing event and telemetry models are extended. |
| External integration compatibility | Large: Loki, Elasticsearch, Sumo Logic, and Datadog each need a documented, verifiable configuration contract. A common transport avoids four adapters but does not erase destination differences. |
| Authentication | Small: reuse existing credential-reference behavior; no new user authentication system. |
| Lifecycle and failure states | Large: daemon versus interactive ownership, concurrent feature attribution, startup and teardown diagnostics, failure reporting without recursion, and the approved durable transport lifecycle interact. |
| Estimated stories | Medium: approximately 8–12 behavior groups, refined after architecture review. |

Small and Large have two signals each; the harness tie-break selects Large. This also preserves the full-review scope presented during approach selection. The feature needs a full architecture review, conflict check, and coherence check.

The existing durable traces/metrics export specification is a dependency/overlap to resolve, not implementation work to duplicate in this plan. The final plan must use this document's exact stem so discovery resolves the tier correctly.
