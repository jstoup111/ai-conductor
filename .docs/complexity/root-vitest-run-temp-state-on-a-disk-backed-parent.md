# Complexity: Root the vitest run temp state on a disk-backed parent

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one resolver and one real-tmpdir accessor to the existing leak-guard module, then routes the four existing run-root creation sites through them. It introduces no new subsystem, no schema, no event, metric, span, or report, and no new telemetry channel. The `TMPDIR` redirect, the run-root prefix, the ignored-prefix list, the stray/ignored classification, and the teardown reap are reused untouched. The parent-directory decision is a local policy function with a fail-open default and a fail-closed explicit override, both directly unit-testable at the exported seam. Small-tier architecture, conflict-check, and coherence artifacts are not required.
