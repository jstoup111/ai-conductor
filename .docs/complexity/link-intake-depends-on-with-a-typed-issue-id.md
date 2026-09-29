# Complexity: Link intake depends-on with a typed issue id

Tier: S

Operator scope: small, delegated approval 2026-09-28; the issue is labeled `size: S`.

The change is bounded to three production files: the private argv translation and the dependency-add method in `tracker-client.ts`, an `unlinked` result field in `file-issue.ts`, and the final report lines in `intake-file-cli.ts`. It reuses the existing id-resolution read, guarded operation runner, and filing transaction. It introduces no new operation, CLI flag, event, storage, ADR, or telemetry channel, and the filing exit-code contract is unchanged. Small-tier architecture, conflict, and coherence artifacts are not required.
