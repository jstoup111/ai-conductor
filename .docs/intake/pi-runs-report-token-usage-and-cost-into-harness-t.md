# Intake origin: pi-runs-report-token-usage-and-cost-into-harness-t

Source-Ref: jstoup111/ai-conductor#1889
Owner: jstoup111

## Desired outcome

- A completed Pi step records token usage (fresh input, output, cache read/write split per the TokenUsage contract) in events and the cost rollup.
- Cost per Pi step is attributed against the underlying model that actually ran, not a generic Pi rate; the metering classification for Pi runs is honest (`fully-metered` when cost is known, `cost-unmetered` when only tokens are).
- The per-feature cost rollup committed at ship includes Pi-dispatched steps.
- Negative path: a Pi run whose usage never arrives (zero until completion, or a crashed run) records unmetered rather than fabricating zeros as real cost.
