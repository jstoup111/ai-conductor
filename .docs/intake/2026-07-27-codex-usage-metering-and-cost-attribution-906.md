# Intake origin: 2026-07-27-codex-usage-metering-and-cost-attribution-906

Source-Ref: jstoup111/ai-conductor#906
Owner: jstoup111

## Desired outcome

- Codex JSON output is parsed into `TokenUsage` when the CLI provides usage data.
- If Codex does not expose per-run usage locally, reports explicitly mark Codex steps unmetered without fabricating zeros.
- Cost rollups continue to work for Claude and mixed historical event logs.
- Parser tests cover at least one real or fixture Codex JSONL stream.
