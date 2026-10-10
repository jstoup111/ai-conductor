# Track: coverage_binding lap-cap halt has no supported recovery (#2846)

Track: technical

Scope boundary: Comprehensive within the four Desired-outcome bullets of jstoup111/ai-conductor#2846. In scope: `ai-conductor kickback-budget raise` and `reset` accept `--gate coverage_binding` for a live coverage_binding lap-cap halt and record the operator rationale in that gate's adjustment history; the coverage_binding cap halt persists the typed cap evidence and halt generation the existing recovery path requires; the coverage_binding restage path honors the feature-local raised lap cap so the next dispatch reopens the bound tasks; `kickback-budget inspect` lists coverage_binding's consumed laps, cap, adjustments, and resume authorization beside the other gates; unknown gates and empty or unacceptable rationales stay refused. Excluded: a new `coverage_binding.max_remediation_laps` root config key (the engine default per-gate cap stays the default); any change to coverage_binding's judge, claim, or conflict-refusal behavior; any new halt class; the `restack` pseudo-gate; automatic or unattended lap grants.

Operator-recovery machinery inside the harness engine (kickback ledger, budget CLI, halt evidence); no end-user product requirements, so no PRD — acceptance criteria live in stories. Precedent: the #2190 gate-selector extension of the same command family was technical.
