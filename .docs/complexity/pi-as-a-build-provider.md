# Complexity: Pi as a build provider

Tier: L

Rationale: Scope is a new built-in Pi adapter plus a provider-registry refactor replacing 20+ hardcoded claude/codex sites across 8+ production files. On size alone this is Medium. The operator elected Large so the spec gets the full architecture review and complete C4 diagrams, because the change reshapes the provider-registration seam that every later Pi intake (#1885-#1890) builds on.
