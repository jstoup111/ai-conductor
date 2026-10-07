# Complexity: Monitor guided sessions — choose provider, model, and effort

Tier: M

## Rationale

- Touches several modules across two layers: config schema/validation (`engine/config.ts`, a new
  top-level `monitor` block registered in `CONFIG_CONSUMER_KEY_SETS`), the monitor CLI
  (`engine/monitor-cli.ts` flags + provider/model/effort resolution), the guided session
  (`engine/monitor/session.ts`), and the shared provider catalog
  (`execution/provider-catalog.ts` `interactiveLaunch` descriptor gains model/effort argv and
  accepted-effort sets).
- Retires monitor's private launch table in `execution/interactive-launch.ts` so monitor shares
  the catalog launch path already used by compose/engineer — a shared-contract change whose
  consumers must be re-verified.
- No persistence, auth, or external integration; no state machine. Roughly 5–7 stories.
- The issue is labelled `size: M`. Not Small (cross-module shared-contract change with a
  retirement); not Large (no new subsystem, no data migration).

Per tier rules: PRD (product track), architecture-diagram, lightweight architecture-review,
stories, conflict-check, plan, and coherence-check are required.
