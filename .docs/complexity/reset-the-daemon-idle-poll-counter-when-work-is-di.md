# Complexity: Reset the daemon idle-poll counter when work is dispatched

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is one assignment in the daemon's existing dispatch branch, unit coverage in the daemon loop's established injected-dependency test file, and a wording correction on two documentation pages. It introduces no new option, event, metric, log channel, module, or persisted state, and it changes no signature. The existing `runDaemon` fixture seam already drives the loop with injected backlog, feature runner, and sleep, so no new harness is required. Small-tier architecture, conflict, and coherence artifacts are not required.
