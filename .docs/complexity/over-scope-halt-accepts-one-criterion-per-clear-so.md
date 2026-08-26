# Complexity: over-scope-halt-accepts-one-criterion-per-clear-so

Tier: M

Rationale: Engine-internal but multi-surface — a new halt-body decision-block format
(`OVER_SCOPE_DECISIONS` JSON array), a durable refusal record extending
`.pipeline/accepted-widenings.json` semantics (with acceptance-overrides-refusal and
staleness rules), candidate-selection fixes at two conductor halt call sites, and the
clear-path reader rewrite. No new models, integrations, auth, or external state machines;
story count moderate. Not S (schema + multi-site behavior change); not L (single
subsystem, no cross-service concerns).
