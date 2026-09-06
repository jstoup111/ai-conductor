# Intake origin: fetch-intake-outcomes-for-an-unclaimed-source-ref

Source-Ref: jstoup111/ai-conductor#1340
Owner: jstoup111

## Desired outcome

- Handing the engineer an unclaimed issue by ref produces the same staged outcome layer as a claimed one, or the command refuses immediately and says what is missing — the operator learns at worktree-creation time, not after DECIDE is complete.
- When the coherence gate rejects an `outcome-<n>` id, the message distinguishes an id that is genuinely absent from the source from one whose source layer was never staged, and names the staging file in the second case.
- Deleting correct outcome rows is never the shortest path to a green land.
- Whatever supplies the outcome body for a by-ref idea is discoverable from the engineer loop's own documented steps, without reading the CLI parser.
- Negative path: an idea genuinely originating from chat or a CLI argument, with no source ref at all, still lands with the outcome layer treated as not-required, exactly as today. A source ref must not become mandatory.
