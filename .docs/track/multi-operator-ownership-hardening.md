# Track: Multi-operator ownership hardening

Track: technical

Internal harness identity/config plumbing (operator identity resolution, config
layering, spec stamping, daemon gating). No user-facing product behavior — acceptance
criteria live directly in stories. No PRD.

## Selected approach (explore)

**Enforcement posture: FAIL-CLOSED.** When a daemon cannot resolve its own operator
identity (no machine-level `spec_owner`, no `gh` login), it builds NOTHING and logs a
loud, distinct error. Reverses today's fail-open behavior (unresolved owner → gate
inactive → build all), which is the multi-operator hazard.

**Identity mechanism: user-sourced + anti-leak guard (Approach A).** Operator identity
(`spec_owner`) is read STRUCTURALLY from user config (`~/.ai-conductor/config.yml`),
outside the project-over-user merge — the daemon and authoring flow never read
`spec_owner` from project config. A validation guard REJECTS (loud, fail-closed) a
`spec_owner` committed in a project `.ai-conductor/config.yml`. The leak is impossible by
construction: identity never reads project config.

Rejected:
- **B (merged read + guard):** leak prevented only by a validation rule, not structurally;
  a guard regression silently re-leaks via project precedence; broadens the daemon's
  config read surface.
- **C (per-key precedence inversion):** a surprising per-key exception in the generic
  `mergeConfigs`; a committed project `spec_owner` can still exist (overridden but
  confusing); worst maintainability.

Constraint honored: lightweight — no broker/queue/new infra; GitHub stays the shared
substrate; identity stays behind the existing `resolveDaemonOwner` seam, forward-compatible
with a future `PlatformIdentity` (EKS/OIDC) resolver.
