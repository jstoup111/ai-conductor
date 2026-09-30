# Complexity: Compose launcher honors llm_provider for Codex

Tier: M

Rationale: Adds one capability (`interactiveLaunch`) to the built-in provider catalog from #1884 and rewires the bare `ai-conductor compose` launcher in `engine/engineer-cli.ts` to select its host through it: provider precedence, explicit missing-binary and missing-capability errors, and the nested-session guard for each capable host. Composer skill and docs text is corrected as well. That is roughly 5-7 tasks across two modules plus skill text. It extends the catalog's descriptor contract, so it needs an additive ADR amendment and a lightweight architecture review; nothing touches daemon dispatch or the compose primitives.
