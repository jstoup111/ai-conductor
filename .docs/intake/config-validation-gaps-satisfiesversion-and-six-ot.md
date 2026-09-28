# Intake origin: config-validation-gaps-satisfiesversion-and-six-ot

Source-Ref: jstoup111/ai-conductor#1026
Owner: jstoup111

## Desired outcome

- `satisfiesVersion` handles the constraint forms it accepts and rejects the ones it cannot evaluate, rather than returning `true`.
- Docstrings match validation behavior.
- Documented mutual exclusions are enforced, or the documentation is corrected.
- Nested blocks validate their required fields.
- The disable-rejection message describes the actual rule.
