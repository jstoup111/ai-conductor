# Complexity: Scale rate-limit waits by the stated time unit

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one duration branch in each of the two provider adapters plus a small shared module holding the unit alternation and its seconds multiplier. It adds no service, schema, record, storage, event, metric, or telemetry channel, changes no public CLI or configuration surface, and touches no reset-time, timezone, classification, or episode-coordinator code. Existing second-phrased fixtures on both adapters keep their current results, so the delivered behaviour change is confined to phrasings that are mis-derived today. Small-tier architecture, conflict-check, and coherence artifacts are not required, and no ADR is created or amended: the governing rate-limit episode decision constrains reset-time deadlines and the escalation ladder, neither of which this slice touches.
