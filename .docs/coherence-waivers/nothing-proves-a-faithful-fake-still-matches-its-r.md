Waives: outcome-1

Rationale: #1990's first desired outcome asks for fake-versus-real divergence detection at every external boundary. Only `llm` has a port today. The operator chose on 2026-11-08 to deliver this in two parts. This spec ships the harness, the `llm` contract for the Claude, Codex and Pi adapters, and the registry obligation (`adr-2026-11-07-external-boundary-ports-registry-and-ratchet` D7, delivered by task-3 and task-10). Under that obligation, any boundary set to `ported` fails the default suite until its paired contract lands. Each remaining boundary's contract therefore ships with its port migration, which already has an open intake:

- git: jstoup111/ai-conductor#3043
- gh: jstoup111/ai-conductor#3637
- tmux: jstoup111/ai-conductor#3639
- process: jstoup111/ai-conductor#3634
- clock: jstoup111/ai-conductor#3638
- otel: jstoup111/ai-conductor#3635
- filesystem: jstoup111/ai-conductor#3636
