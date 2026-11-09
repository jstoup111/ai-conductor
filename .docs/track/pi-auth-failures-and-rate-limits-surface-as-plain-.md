# Track: Pi auth failures and rate limits surface as plain step failures

Track: technical

Scope boundary: classify Pi authentication failures, rate limits, and usage exhaustion from
signatures verified against real Pi 1.0.0 output; route a Pi auth failure to a Pi-owned credential
park instead of the Claude credential poll; let Pi usage exhaustion suppress Pi as Codex exhaustion
does, so other dispatches' candidate ladders advance. Excludes upstream model-not-found under an explicit `--provider`, HTTP 403, 402,
and mid-stream limit text that carries no HTTP status, all of which stay ordinary step failures.

Internal provider-failure classification with no new user-facing capability. Source: intake
jstoup111/ai-conductor#2718.
