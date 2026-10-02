# Complexity: Daemon session command compatibility and visibility

Tier: M

Source-Ref: jstoup111/ai-conductor#2709

Medium was proposed with Approach A and accepted by the operator in chat on 2026-10-01.

The change crosses the instruction-audit, session-execution, and event-consumer boundaries, so Small would omit needed architecture and interaction review. It extends existing guard, source-audit, and event-spine mechanisms rather than replacing the lifecycle, introducing a service, or redesigning GitHub ownership.

Medium requires an architecture diagram, lightweight feasibility/alignment review, accepted technical stories, conflict check, implementation plan, and coherence mapping. No PRD is required on the approved technical track.

A shared generated-command catalog and a general-purpose process sandbox are not part of the selected approach. If feasibility requires either, return to the operator before expanding the design.

