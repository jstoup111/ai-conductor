# Complexity: Durable PRD-audit widening decisions

Tier: L

The approved scope crosses operator decision capture, durable schema/recovery, provider-backed equivalence judgment, bounded context, report projection, and gate completion. Replay, conflicting or ambiguous history, and legacy migration require explicit state transitions. Existing build-review case machinery is a useful precedent but currently rejects non-build-review domains; reuse is not a trivial type extension.

This is the first independently useful slice of #2429 -> #2440 -> #2060 -> #2441. Further subdivision into isolated import or matcher patches would leave the agreed decision-to-completion behavior incomplete. Full architecture review, conflict-check, and coherence-check are required.
