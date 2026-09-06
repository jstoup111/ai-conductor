# Complexity: Close the unguarded tmux fixture session that orphans keepalive loops

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one condition in the existing runner-level kill-switch, one fixture session name and its kill-switch handling in a single test file, and regression coverage in two existing test files. It reuses the leak guard's established sweep, reap, two-signal kill contract, and tmpdir corroboration without altering any of them, and it introduces no new module, session lifecycle, configuration key, event, metric, or telemetry channel. No production daemon behavior changes: the widened refusal is reachable only when `AI_CONDUCTOR_NO_REAL_EXEC=1`, which only this repository's test setup sets. Small-tier architecture, conflict, and coherence artifacts are not required.
