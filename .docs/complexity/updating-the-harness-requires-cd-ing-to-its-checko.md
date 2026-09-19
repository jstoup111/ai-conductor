# Complexity: updating-the-harness-requires-cd-ing-to-its-checko

Tier: S

Rationale: one new engine module (detector, dispatcher, runner) modeled on `auto-update-check.ts`, one command declaration in `cli.ts`, one dispatch block in `index.ts` one test file, one entry-point test case. No schema, config, hook, or event change; no ADR governs CLI pass-through commands. Matches the issue's `size: S` label.
