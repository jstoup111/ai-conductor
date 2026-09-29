# Complexity: Stage wrapped Desired-outcome bullets in full

Tier: S

Operator scope: small, approved 2026-09-28 (delegated); the issue is labeled size S.

The change is one pure function in one production file (the Desired-outcome extractor in outcome-staging.ts) plus its unit tests and one landSpec acceptance case in the existing coherence acceptance file. The staged file format, intake marker writer, per-line readers, and coherence validator are unchanged. It introduces no service, schema, storage, CLI surface, or telemetry. No ADR is created or amended. Small-tier architecture, conflict, and coherence artifacts are not required.
