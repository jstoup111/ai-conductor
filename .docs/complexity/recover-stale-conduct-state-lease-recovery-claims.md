# Complexity: Recover stale conduct-state lease recovery claims

Tier: M

Assessment status: Operator approved Medium review depth on 2026-09-11. The conduct size rubric leans Small (few production modules, no external integration, no authorization change, and a small expected story set); The operator accepted Medium for concurrency safety review.

Source: jstoup111/ai-conductor#2170

The implementation is concentrated in a shared lease primitive, but correctness spans dead-owner recovery, concurrent recoverers, replacement ownership, malformed metadata, bounded waits, and diagnostic classification. Existing callers include conduct state, engine state, intake ledger, remediation cases, build-review dispositions, kickback ledger, and closeout authorization storage. A race can compromise multiple persistence users even without changing their APIs.

Medium is appropriate for this bounded cross-process state machine: no new external service or foundational dependency is selected, but a lightweight architecture review, conflict check, and coherence map are warranted. The issue's size:S label predates the operator-confirmed edge-case breadth and is not the final complexity assessment.

Technical track: no PRD. Required DECIDE outputs: architecture diagram, lightweight architecture review, accepted stories, conflict report, implementation plan, and coherence map, with this stem shared by the plan and complexity marker.
