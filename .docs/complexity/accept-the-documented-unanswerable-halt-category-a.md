# Complexity: Accept the documented unanswerable halt category

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated). The issue carries the operator's own `size: S` label.

The change is bounded to one union widening in the remediation plan parser, one additional rejection path in that same parser, one additive optional field on an existing event variant, and the wording of three existing renderers. It reuses the typed rejection record, the rejection event, the operator halt formatter, and the existing rejection test file introduced for unrecognized dispositions; it introduces no new module, no new event variant, no new channel, no storage, and no configuration key. Halt categories drive no routing, so widening the accepted set changes only operator-visible text. Halt-class policy and retry behavior are excluded. Small-tier architecture, conflict, and coherence artifacts are not required, and no ADR is created or amended.
