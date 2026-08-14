# Intake origin: live-daemon-e2e-tier-covers-only-claude-no-real-ag

Source-Ref: jstoup111/ai-conductor#1264
Owner: jstoup111

## Desired outcome

- The live daemon E2E tier produces a pass/fail verdict for a real Codex agent driving the same
- A Codex run is bounded by the same cost ceiling the Claude run is, and reports its observed cost
- A Codex failure prints the same daemon log excerpt and pipeline state the Claude leg prints, so
- Each provider's verdict is independent: one provider's missing credential or absent CLI never
- Whatever invocation runs the live tier covers every supported provider, so adding a provider to
