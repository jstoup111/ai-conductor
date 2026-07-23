# Track: canonical-tracker-client-seam-with-per-backend-tra

Track: technical

Internal seam refactor + config contract (no user-facing product behavior): consolidate
the 10+ divergent gh-runner shapes into one canonical TrackerClient seam so a Jira
backend (REST or MCP transport) can be implemented against it. Source: jstoup111/ai-conductor#846 (Refs #774).
