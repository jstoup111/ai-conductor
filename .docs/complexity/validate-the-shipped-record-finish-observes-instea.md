# Complexity: Validate the shipped record FINISH observes

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one observation port. It adds a focused validity module and rewires a single four-line observer in the production FINISH adapter; every downstream consumer already exists and is untouched. The evidence union, the `mapOptionalEvidence` mapping, the `invalid_shipped_record` reason token, its human-required rendering entry, and the three coordinator branches that consume it are all already written and already tested — this feature only makes the observations that reach them producible. It introduces no new record field, no new event, metric, span, or report, no schema or CLI surface, no GitHub or process call, and no new provider dispatch. Identity resolution, record parsing, stories-reference resolution, and spec hashing are all reused from the existing writer and strict verifier rather than reimplemented; the only extraction is lifting the writer's private stories-bytes helper so both sides keep resolving stories through one function. A repository-wide sweep of the decision records found no approved decision this change contradicts and none that needs amending. Small-tier architecture, conflict, and coherence artifacts are not required.
