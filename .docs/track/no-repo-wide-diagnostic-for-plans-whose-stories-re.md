# Track: Repo-wide diagnostic for plans whose Stories reference cannot resolve

Track: technical

Scope boundary: exactly the five desired outcomes of jstoup111/ai-conductor#1442 — one read-only, network-free invocation that reports every committed default-branch spec (legacy plan or feature manifest, the candidates daemon discovery examines) whose Stories reference does not resolve to an existing artifact (plan, raw reference, attempted path), labels each with its lifecycle state (processed, shipped, parked, halted, actionable), uses discovery's own candidate listing and Stories resolution (shared with discovery by a behavior-preserving extraction) and the production lifecycle predicates, and distinguishes a clean report from a failed run. Excluded: startup-dashboard rendering (#1332), repairing any broken plan, BLOCKED reasons other than the three Stories-resolution reasons (`unresolvable-stories-ref`, `stories-missing`, `malformed-manifest`), and any behavior change to discovery, `.daemon/blocked.json`, or land.

Internal operator tooling for the daemon's discovery: a new `ai-conductor daemon stories-refs` diagnostic verb with acceptance criteria in stories; no product requirements warrant a PRD.
