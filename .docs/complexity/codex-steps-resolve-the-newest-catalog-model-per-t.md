# Complexity: Codex steps resolve the newest catalog model per tier

Tier: M

## Rationale

- Touches roughly six engine areas: the Codex policy in `provider-model-policy-defaults.ts` (tier
  names replace pinned ids), the Codex descriptor in `execution/provider-catalog.ts` (declares a
  `modelCatalog` listing `codex debug models` with a JSON parser), a tier-to-model resolver fed by a
  once-per-process catalog probe (reusing `provider-model-probe.ts` mechanics), the dispatch path
  in `provider-execution.ts` / `model-availability.ts` (escalation and fallback ladders resolve
  tiers), cost and rate-card attribution (`rateCardModelIds`, unpriced-model warning), and the
  self-host `token-liveness.ts` probe (`haiku` alias).
- Consumers that read Codex model ids out of the policy — monitor selection, the generated model
  table, and `model-table-metadata.ts` review cells — must see resolved ids, not raw tier names.
- Amends existing APPROVED ADRs on the reactive fallback ladder, the built-in provider catalog, and
  catalog-owned interactive model selection; no new persisted state file, CLI flag, or event type
  (the resolved model rides existing dispatch and cost event fields).
- Not Large: the cache is per process, with no cross-process coordination, persistence, migration,
  or git-topology change, and the pinned-id fallback keeps today's behavior when the probe fails.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check and
coherence-check are required.
