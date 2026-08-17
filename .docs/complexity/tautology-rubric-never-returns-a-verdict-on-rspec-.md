# Complexity: Framework-agnostic tautology scoped-run classification

Tier: M

The change narrows a closed union inside a shared BUILD gate, deletes a classifier, adjusts the
evidence shape that a shipped judgement skill consumes, adds an additive optional field to one
existing `ConductorEvent` variant, and updates the canonical gate documentation — coordinated engine,
skill, test, and documentation work across four source files and their tests.

It introduces no authentication, no third-party integration, no data model, and no state machine. The
blast radius is bounded by construction: the classifier has exactly two call sites, the narrowed
reason union has no consumer outside the preflight and its projection, and the event field is
optional so every existing reader keeps parsing. It is expected to fit within four stories and
roughly a dozen tasks, which places it above Small (multiple coordinated surfaces, a shipped-skill
contract change) and well below Large (no new subsystem, no migration, no cross-phase redesign).
