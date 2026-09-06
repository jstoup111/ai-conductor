# Complexity: Recoverable resolution worktree after a crashed attempt

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one guarded reap step to a single existing helper in one production file and extends one existing integration test file that already stands up a real local git repository for this helper. It introduces no module, interface, configuration key, event, metric, CLI surface, or schema, and it changes no caller: both call sites keep the same signature and the same serial-guard and active-claim semantics. The reap reuses the git subcommand the teardown path already issues through the same worktree lifecycle queue. Small-tier architecture, conflict-check, and coherence artifacts are not required.
