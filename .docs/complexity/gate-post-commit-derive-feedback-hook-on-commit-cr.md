# Complexity: Gate the post-commit derive-feedback hook on commit-creating Bash commands

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds two early exits to one existing 130-line shell hook, extends that hook's existing shell test script, updates one documentation table row, and commits an internal-only release waiver for the path-based `hook wiring` classifier. It reuses this repository's established bounded-stdin read, `tool_input.command` extraction, and quoted-span stripping verbatim from two sibling hooks; it invents no parser, no new state file, no configuration key, and no telemetry. The engine contract, the warning text, the bash fallback, and the hook's settings wiring are untouched, so no consumer migration is owed. Three production files plus one waiver, no new module, and no cross-component coordination put this well inside Small; architecture, conflict-check, and coherence artifacts are not required.
