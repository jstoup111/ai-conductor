# Complexity: Protected-artifact halt prints no recovery command

Tier: S

Rationale: One behavior — append an operator recovery line to the protected-artifact seal halt —
inside existing modules. `protected-artifact-seal.ts` splits `resealProtectedArtifactSeal` into a
read-only validation/recompute part and its existing persist tail (behavior-preserving: reseal runs
the same checks in the same order and writes the same seal), and failure verdicts carry the path
they name. `reseal-cli.ts` gains the hint builder that dry-runs those checks with reseal's own
inputs, and `conductor.ts` appends its output where the BUILD/SHIP seal verdict becomes the halt
reason. No new module, dependency, step, halt class, event, config key, CLI flag, or persisted
format; reseal's flags, refusals, and audit records are unchanged, so it contradicts no APPROVED ADR
(adr-2026-08-09-operator-only-scoped-artifact-reseal stays satisfied: the hint never reseals, and
the operator still runs the command in an interactive terminal) and needs no new ADR. Signals: 0
models, 0 external integrations, no auth change (the existing TTY gate is untouched), no state
machine, 3 stories. The event-spine procedure does not apply: nothing new is observed or signalled;
it renders text into an existing HALT write.
