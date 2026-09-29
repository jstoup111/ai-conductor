# Complexity: Exempt Vitest's own temp dir from the tmpdir leak guard

Tier: S

Operator scope: small, confirmed 2026-09-28 (delegated); the issue is labeled `size: S`.

The change is bounded to one exact-name exemption computed from the Vitest project handed to the existing globalSetup, one extra parameter on the existing pure diff helper, a package-local binary lookup in the existing runner script, and one documentation sentence. It touches three production files plus one contributing doc, adds no service, schema, CLI surface, configuration key, or telemetry channel, and needs no ADR. Small-tier architecture, conflict, and coherence artifacts are not required.
