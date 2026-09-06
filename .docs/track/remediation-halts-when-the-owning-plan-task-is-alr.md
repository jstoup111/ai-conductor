# Track: Remediation of previously completed tasks

Track: technical

Scope boundary: Operator-confirmed shared completion semantics for explicitly reopened tasks across remediation dispatch, progress checks, and process restart recovery. Preserve completion behavior for untouched tasks, carry the finding into BUILD, and retain genuine no-work halts with distinct explanations for empty output versus refused work. Do not widen remediation eligibility, rewrite unrelated completion rules, or change retry budgets.

Source: jstoup111/ai-conductor#1831

The operator selected the broader shared-semantics approach and confirmed technical track and Medium complexity in this composer session on 2026-09-06. This repairs internal engine coordination; acceptance criteria belong in stories, with no PRD.

> **Amended 2026-09-06 by #1831:** The operator explicitly requires convergence and acceptance of completed work: a valid grant accepting the current `OVER_SCOPE` finding must remove that blocker without reopening completed work or demanding a new commit. Genuine repair must have a reachable evidence-based close path, and repeated unresolved work must remain bounded. A grant only authorizing another attempt does not itself prove a repair complete; acceptance applies only to the finding it actually covers.

## Scope check

- A. Audience: consumer-facing. The shared conductor and task resolver operate in installed consumer projects; the affected code is not gated by self-host mode. The scope-check daemon heuristic does not make this shared engine behavior repository-only.
- B. Catalog: n/a. No skill is added.
- C. Provider: agnostic. The engine owns resolution independently of the dispatched provider.
- Registration: none. Implementation must update the canonical daemon guidance and affected recovery runbook in the same PR.
