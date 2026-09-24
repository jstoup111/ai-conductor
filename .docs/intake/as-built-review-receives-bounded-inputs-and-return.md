# Intake origin: as-built-review-receives-bounded-inputs-and-return

Source-Ref: jstoup111/ai-conductor#2188
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2188 digest=2583a5ddf1a3442b20316e82eb3cc3712d5e6b7f1c95a692f9e042d8a2149b6b >>>
## Desired outcome

- As-built review receives a bounded, versioned engine-rendered projection of the changed code, plan task/Done-when ownership, sealed story criteria, approved ADR decisions, and relevant available prior findings. Missing or over-limit required inputs are explicit; code inspection on demand remains possible.
- Its verdict and findings reach the engine as a validated typed object. Required ADR stem/decision-number or plan-task references are structural; malformed or missing fields produce field-specific mechanical diagnostics.
- All as-built verdict consumers, including validation, remediation handoff, and restart/replay, use the authoritative typed result. No as-built judge Markdown parser retains gate or routing authority.
- Existing verdict, routing, operator-authority, and delivery semantics are preserved. #2184 owns the subsequent change to which responsibilities this reviewer judges, not this migration.
- As-built skill guidance stops prescribing engine input-reading recipes, output tables, columns, cell formatting, and clause grammar. The migrated-surface audit detects their reintroduction. Interactive guidance remains usable.
- Claude and Codex honor the same contract through native schema-constrained output. Missing/invalid output or unavailable capability is a mechanical fault, never a substantive judgment. Any human-readable report agrees with the authoritative result.
- The behavior is proved through production dispatch/consumer paths with fake provider boundaries, including invalid output and missing/over-limit context. Existing diagnostic coverage is retained or replaced by equivalent proof.
<<< END INBOUND >>>
