# Complexity: Retry a lease whose owner vanished before its metadata read

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one function's error branch and one branch of the acquire loop in a single engine module, plus its existing unit test file. It adds no interface member, no configuration key, no telemetry channel, and no new failure kind; the public `ConductStateLeaseFailureKind` union, the filesystem seam, and every call site are untouched. It reuses the module's existing `isMissing` helper and the test file's existing in-memory filesystem fixture. Stale-claim liveness and the full-suite lock are separate issues and remain out of scope. Small-tier architecture, conflict, and coherence artifacts are not required.
