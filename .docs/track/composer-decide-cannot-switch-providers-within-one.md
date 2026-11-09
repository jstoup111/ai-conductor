# Track: Composer DECIDE cannot switch providers within one handoff

Track: product

Scope boundary: Resume and provider switch with person-to-person hand-off. Each accepted DECIDE step checkpoints its artifacts and a run journal to the pushed `spec/<slug>` branch; a draft spec PR opened at the first checkpoint is the pickup surface for another operator; the `ai-conductor compose` launcher guides continue / switch provider / hand off between sessions, and `compose resume` continues a run on any machine, operator, or supported provider. Excluded: in-session cross-provider critique/revise turns, and replacing the host-agent-owned clarity loop (ADR-008) with engine-driven one-shot provider turns. Launch-time provider selection (#1007) already exists and is not re-specified.

New operator-facing capability (resume, switch, teammate hand-off) with user-visible requirements and negative paths, so it carries a PRD.
