# Complexity: Bind story-N task references to Story N at land

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one new exported text parser in the existing shared plan-task parsing module, three call sites that already hold copies of the grammar it replaces, and one added field on an existing finding shape. It introduces no module, no schema, no storage, no configuration key, no CLI surface, no hook, and no telemetry channel, and it changes no gate's pass/fail rule — only which story id a reference resolves to and what an existing failure says. Three production files change. Small-tier architecture, conflict-check, and coherence artifacts are not required.
