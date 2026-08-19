# Track: Review infrastructure failures are operator-unrecoverable and spend the semantic kickback budget

Track: product

Scope boundary: Both filed outcomes are in scope — (1) a first-class, recorded operator
decision that resolves a review blocked solely by a persistent rubric infrastructure
failure, with reduced coverage stamped on lap and shipped evidence; (2) rubric
infrastructure failures no longer increment the semantic `build_review` cumulative
kickback counter, gaining their own bounded retry policy. Excluded: any authority that
lets the daemon self-clear reduced coverage — the decision is operator-only and
interactive (same TTY + verified-local-operator gate as `build-review accept`); no
pre-granted authority, no engine auto-accept. A genuine semantic FAIL must block exactly
as today.

Operator-facing gate behavior plus a recorded decision and new evidence stamping, so the
functional requirements are worth a PRD rather than living only in stories.
