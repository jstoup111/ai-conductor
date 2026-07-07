# Complexity: Fix #400 — stale-engine respawn-in-place stacks daemon generations

Tier: M

## Rationale

- No new models, integrations, external auth, or schema changes → not L.
- Not S: concurrency/state-machine-sensitive daemon lifecycle work spanning four modules
  (`daemon.ts` idle-boundary trigger, `daemon-cli.ts` restart requester + lock-loser path,
  `daemon-lock.ts` bounded pidfile-release wait, `daemon-tmux.ts` respawn semantics), with
  process-exit ordering guarantees and a real-tmux e2e verification surface
  (`pgrep` count == 1 across the transition).
- Story count expected ~4-6 (one-shot trigger, predecessor exit, successor bounded wait,
  loser termination, config re-enable, e2e single-generation assertion).
- Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check all run.
