# Complexity: Trace provenance — commit, base, PR, and originating issue on exported traces

Tier: M

Rationale: No new model, credential, external service, or state machine, but the change spans
the event union (additive fields on `feature_complete`, `loop_halt`, and the rebase outcome
events), their emit sites in the conductor and rebase engine, the OTel trace resource, the
SpanManager root-span close path, and a new validated `otel.provenance` config block whose
`feature` toggle alters `service.instance.id`. It extends ADR-014's attribute and config contract
and so needs an architecture amendment. Too broad for Small (the intake's `size: S` predates the
config requirement); no novel design for Large. The plan stem must remain
`a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t`.
