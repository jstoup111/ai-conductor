# Complexity: On-demand regeneration of the bot-owned release PR

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one CI workflow file and the two existing contract tests that already pin that workflow's shape. It adds a trigger, widens one job condition, adds a fallback to one checkout reference, and adds one guard step. It touches no engine module, no exported action, no configuration schema, no CLI, no hook, and no skill; the candidate collector, renderer, release-PR action, and publisher are all reused unchanged. It introduces no new event, metric, span, or report, so the event-spine decision procedure yields no new channel. Small-tier architecture, conflict-check, and coherence artifacts are not required.
