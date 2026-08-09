# Intake origin: prd-audit-passes-on-a-partial-report-when-backgrou

Source-Ref: jstoup111/ai-conductor#1398
Owner: jstoup111

## Desired outcome

- Every functional requirement in the approved PRD carries a verdict in the audit that gates the ship; an FR with no verdict blocks rather than passes.
- A `prd_audit` run that did not audit every FR can never be recorded as a pass, and a pass recorded from an incomplete run is never preserved or reused by a later run.
- Auditing an FR is bounded and observable: an operator can see how many FR audits were dispatched, how many returned, and which did not, without reading provider transcripts.
- No per-FR audit can outlive the step that dispatched it, and the step cannot report success while any of its audits is still unfinished or was killed.
- When a re-audit is needed and the implementation has not changed, only the FRs that lack a verdict are re-audited; when the implementation has changed, every FR is re-audited.
- The per-FR audits and the aggregate write-up can be run at different capability tiers, and which tier each used is visible after the fact.
- A feature whose FRs all genuinely audit clean still passes with no added operator prompt and no added wall-clock beyond the audits themselves.
