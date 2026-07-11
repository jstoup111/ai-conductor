# Complexity: daemon-build-agents-leak-edits-into-the-main-check

Tier: M

## Rationale

- Two engine components touched: the FF-skip path in `daemon-backlog.ts` (detection +
  verified-identical auto-heal) and build-session dispatch (prevention fence hook
  injection via the sandbox settings provisioning).
- Git plumbing against in-flight branch heads (blob comparison, restore) with strict
  safety gating — needs adversarial/negative-path tests, but no new data models, no
  external integrations, no auth surface, no new state machines.
- Estimated 4–6 stories. Medium ⇒ architecture-diagram + lightweight architecture-review
  + conflict-check required before plan.
