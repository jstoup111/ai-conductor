# Track: live daemon E2E build step never runs a real agent

Track: technical

CI and test-harness infrastructure. The change is confined to the live daemon E2E tier —
its GitHub Actions workflow, its fixture setup, and the attributability of a
step-command-unavailable failure. There is no user-facing product behavior and no new
consumer-visible runtime surface, so there are no functional requirements to spec in a
PRD; acceptance criteria live directly in the stories.

Source: jstoup111/ai-conductor#1311.
