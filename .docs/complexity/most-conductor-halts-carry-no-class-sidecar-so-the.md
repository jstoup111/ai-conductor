# Complexity: Complete and enforce conductor HALT classification

Tier: M

Rationale:

- One daemon subsystem, but the current engine still has 22 raw HALT writer paths plus helper call sites that permit omitted classification.
- The change alters persisted halt-state semantics and requires an explicit compatibility boundary for pre-existing classless markers.
- Negative and recovery paths are load-bearing: corrupt or missing new classifications must fail closed, while stamped legacy markers retain prior re-kick behavior.
- Deterministic enforcement must prevent future direct marker writes, and operator documentation must describe the migration and recovery behavior.
- No new external integration, authentication surface, or user-facing product workflow is introduced; Medium architecture, conflict, and coherence gates are proportionate.
