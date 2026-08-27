# Complexity: remove the unattended one-shot inline run (--auto)

Tier: M

Rationale: Deletion-shaped work with an evidence-gated audit across ~13 `'auto'` branches
in `src/conductor/src/engine/conductor.ts`, where the same mode value is live daemon
contract — misclassifying a branch changes daemon behavior. Also retires a shipped example
(`examples/inline.sh`) with its test suite, edits the CLI rejection message, and updates
docs. No new models, integrations, auth, or state machines; multiple coordinated surfaces
and a reachability audit push it above S, well short of L.
