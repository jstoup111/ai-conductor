# Complexity: Pi per-step model selection via wrapped providers

Tier: M

Rationale: The change adds no new subsystem. It extends seams that already exist:
- Pi adapter argv (`--model`, `--thinking`).
- Pi's catalog model policy and a capability flag.
- Config validation for `provider/id` syntax, a configurable escalation order, and a Pi-requires-a-model rule.
- A boot-time `pi --list-models` probe behind a fakeable seam, modeled on #1884's installation probe.
- Escalation and ladder walking over Pi rungs.
- Generalizing the model-table generator from two fixed provider column pairs to N pairs taken from the catalog.

That is roughly 7-9 production files and 8-10 tasks. The boot probe and the table-schema widening are cross-cutting, which puts this above Small. It is not Large, because no ADR-level seam is replaced: #1884's catalog ADR already reserves model selection for this intake.
