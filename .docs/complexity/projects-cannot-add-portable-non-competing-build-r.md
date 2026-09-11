# Complexity: Portable, non-competing build review policy

Tier: L

Source: jstoup111/ai-conductor#1986

Operator confirmed 2026-09-10.

The change crosses project policy configuration, installed-skill discovery, provider fallback and prepared execution environments, policy-dependent cache identity, rubric result contracts, and aggregate adjudication/remediation. Backward compatibility must hold for projects without custom rubrics, while custom policies must not acquire competing decision authority. Existing mechanisms reduce new construction but do not remove the cross-boundary correctness obligations.

Required DECIDE evidence: approved product requirements, architecture diagrams, full architecture review with approved decisions, accepted stories, clean conflict check, implementation plan with explicit task dependencies, and coherence mapping. The plan filename must use this artifact's stem.
