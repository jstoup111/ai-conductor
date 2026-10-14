# Complexity: Pipeline batch evaluators remain an unenforced second review authority

Tier: L

Rationale: The work spans several engine subsystems, not one prose surface:
- **Event union and sinks:** retire two `ConductorEvent` kinds and their event-sink entries.
- **CLI:** remove the `closeout-event` subcommand and its dispatch, which is a consumer-visible `bin/conduct CLI` breaking surface carrying a migration block.
- **OTel exporter:** remove a histogram instrument and a span event, a consumer-visible metric.
- **Output:** remove the terminal-renderer and daemon-log closeout lines.
- **Build-tail:** reshape the rollup state machine and its CLI output.
- **Sibling-ledger tail:** add an admitted-type check with a new diagnostic reason.
- **Configuration:** flip the resolved-config default for the build_review `security` rubric.
- **Model table:** update the generated model-table metadata.
- **Instructions:** edit about 20 skill, agent, template, and harness instruction files.

It also needs a new APPROVED ADR (adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry), on-main amendments to four ADRs, and in-place rewrites of ten accepted stories files from earlier features. More than 15 plan tasks are expected. Version skew between live skill text and the rebuilt engine is a real failure mode, accepted by the operator.
