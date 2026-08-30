# Track: cumulative kickback cap recovery

Track: product

Scope boundary: Full remaining outcomes from jstoup111/ai-conductor#1760, operator-confirmed
2026-08-29. Add a guarded operator workflow to inspect the cumulative `build_review` budget,
credit/reset it or raise its effective cap with an attributable reason, and resume a matching
cumulative-cap halt without hand-editing `.pipeline` state. Preserve the unchanged-spin bound;
make the halt and inspection output account for what consumed, credited, or extended the budget;
and use the existing mechanical-fault lane rather than re-solving infrastructure-fault
classification. No automatic finding-equivalence inference, review-contract fingerprint reset, or
LLM judgment at exhaustion.

Product track because this introduces operator-facing CLI behavior, recovery validation, audit
output, and documented semantics that require explicit requirements.

## Selected approach

Guarded operator intervention (Approach A): machinery validates the target feature, gate, halt
class, and requested adjustment; durable state retains before/after accounting and attribution;
the occurrence is published on the existing event spine. The operator remains the authority for
the judgment that prior findings are obsolete.

