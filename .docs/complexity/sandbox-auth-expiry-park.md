# Complexity: Sandbox auth-expiry park-and-poll

Tier: M

## Rationale

- **Integration points (multiple, all internal):** auth-failure signature in
  `claude-provider.ts`, new flag through `StepRunResult`/`step-runners.ts`, a
  park-and-poll branch in the conductor per-step retry loop, sandbox
  re-provision on credentials change (`activeSandbox` lifecycle), and
  credentials-aware HALT reason wording.
- **Stateful wait behavior:** poll-with-timeout on the operator credentials
  file (mtime/`expiresAt`), interaction with the existing no-budget-burn
  paths (rateLimited/sessionExpired) and the future retry-as-escalation
  ladder (#188) — an auth failure must never trigger retries or model
  escalation.
- **Not L:** no new external services, no schema/config-format changes, no
  new auth model, story count expected ~4–6.
- **Not S:** more than a single-file fix; needs conflict-check (overlaps the
  retry ladder that #188 will reshape) and a lightweight architecture review
  with an ADR for the park-vs-retry classification decision.
