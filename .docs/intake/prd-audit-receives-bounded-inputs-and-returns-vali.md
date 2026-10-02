# Intake origin: prd-audit-receives-bounded-inputs-and-returns-vali

Source-Ref: jstoup111/ai-conductor#2521
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2521 digest=2f39bbf394dc95b12f5bc12a8566b08eb306fb20eb2de056a05d64fe8d6fd129 >>>
## Desired outcome

- PRD audit receives a bounded, versioned engine-rendered projection of relevant requirements, sealed criteria, plan ownership/Done-when blocks, changes, and applicable prior findings/decisions; unavailable or over-limit required inputs are explicit.
- The engine consumes a validated typed PRD verdict and findings, with structural criterion/task references wherever required; Markdown wording and presentation have no gate or routing authority.
- Missing or invalid verdicts, finding references, and required fields are rejected with actionable field-specific mechanical diagnostics.
- Existing approval, refusal, OVER_SCOPE, FIXABLE, PLAN_GAP, and delivery semantics are preserved; this migration grants no new approval or waiver.
- Every PRD verdict consumer uses the same validated result, including remediation and restart/replay. A formatted report cannot disagree with the authoritative result.
- PRD-audit skill text no longer defines engine input-reading recipes or machine output tables/grammars; a contract audit detects their reintroduction for this migrated surface.
- Both supported providers and interactive skill use remain supported.
<<< END INBOUND >>>
