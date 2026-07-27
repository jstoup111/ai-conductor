# Complexity: Claude within-step retries resume the prior attempt's session (#1071)

Tier: M

## Rationale

**Signals present**

- **State machine change.** `ProviderSessionScope` is a small state machine
  (`create` → `markCreated` → `prepare` returns `resume`). Changing its contract
  changes every consumer of `created`/`resume`, including the fallback-candidate
  and concurrent-group branch paths.
- **Cross-cutting blast radius.** Live resume behavior spans
  `provider-session.ts`, `provider-execution.ts`, `step-runners.ts`,
  `conductor.ts`, `group-core.ts`, and `execution/claude-provider.ts`, plus the
  acceptance tests that pin the current semantics as intended
  (`per-step-provider-routing-927`, `retry-as-escalation`).
- **A behavior-preserving companion change.** Suppressing resume alone is not
  safe: `--session-id <same-uuid>` on attempt 2 collides with the id the CLI
  already registered, so id minting must move to per-invocation.
- **A genuinely new capability.** `runInteractive` currently carries no context
  outside the resumed conversation; cold-starting it requires threading failure
  context into its prompt.
- **Contract documentation is in scope.** An existing ADR states the
  resume-within-step exception as intended; it must be superseded, not silently
  contradicted.

**Signals absent**

- No new data model, no new persistence, no schema migration.
- No new third-party integration, no auth surface, no new CLI command.
- No new external contract; `bin/conduct-ts` flags and `settings.json` are
  untouched.

**Not Small** because it is not a single-seam edit: the fix spans a state-machine
contract, its provider adapters, an operator-facing recovery path, and pinned
acceptance tests. **Not Large** because the change is confined to one subsystem
with a well-understood seam, needs no architectural decomposition, and adds no
new integration or persistence surface.
