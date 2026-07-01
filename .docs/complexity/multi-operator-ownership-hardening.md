# Complexity: Multi-operator ownership hardening

Tier: L

## Signals

- **Security / trust boundary (dominant):** the feature exists to prevent operator
  identity leaking across a shared repo and to stop an unidentified daemon building
  another operator's specs. Misjudged behavior has cross-operator blast radius.
- **Default reversal with negative paths:** flips the owner-gate from fail-open to
  fail-closed on unresolved identity. Every call site that resolves identity or gates a
  build needs an adversarial negative-path derivation (unresolved owner, project-committed
  spec_owner, un-owned spec, gh-unauth).
- **Cross-cutting integration points (≥5):** config loading/validation (`config.ts`),
  identity resolution (`owner-gate/identity.ts`), daemon loop wiring (`daemon-cli.ts`),
  authoring + land stamping (`engineer/authoring.ts`, `engineer/land-spec.ts`), and the
  discovery gate logging (`daemon-backlog.ts`).
- **Docs surface:** operator setup docs, skill docs for the stamping paths, self-host
  cutover caveat.
- **No new external integrations, no LLM, no new state machine** — which keeps it from
  being an XL, but the trust dimension + default reversal put it firmly at L.

Story count estimate: ~7–9 (happy + negative paths per gap). Full architecture-review,
ADR(s), and conflict-check apply.
