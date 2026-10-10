# Complexity: Operator action inbox for non-blocking review findings

Tier: L

Rationale: Multiple interacting lifecycles: review classification and case disposition, durable post-ship action resolution, optional intake publication with retry, historical recovery after worktree cleanup, and issue closure linked to implementation publication. Coverage spans three review sources, operator actions, legacy records, concurrent/repeated consumption, and shipping metadata. The approved approach extends existing cases rather than introducing a competing review authority. Large treatment is warranted by those state and authority boundaries, even though this uses the existing tracker integration and requires no new authentication system.

Operator context: Both proposed approaches were estimated Large; the operator selected approach A and product track on 2026-09-30. This assessment remains overrideable by the operator.

Required DECIDE work: product requirements; architecture diagram and full architecture review with approved decisions; accepted stories; conflict check; implementation plan; coherence mapping. The eventual plan uses this exact filename stem.
