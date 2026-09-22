# Halt record

Status: halted
Slug: projects-cannot-add-portable-non-competing-build-r
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-projects-cannot-add-portable-non-competing-build-r
Head SHA: 795c91347fe0c453053c03407a0669c10ac606a3
Halted at: 2026-09-22T00:18:14.600Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 8 negative: Given a legacy entry lacks effective-policy evidence or a stored entry is malformed, when review encounters it, then it misses without fabricating provenance; only a newly valid result can replace it.
Task ids: 18, 19
Done when checks: Temporary-cache integration preserves separate warm preferred/fallback entries and only reads an entry whose full effective candidate identity and validated result match. | Legacy missing-evidence entries miss with their staged cause, malformed entries miss as invalid, and interrupted/failed writes cannot publish an eligible partial result or destroy the other candidate entry. | Runner integration observes prepare → resolve/capture → lookup → optional judge/validated write → cleanup for each actual candidate; a load failure never reaches lookup/write and cannot buy a fallback. | Alternating early/late-unavailable candidates reuse only their own warm results without overwrite, borrowed preferred policy, another judging call, or duplicate token accounting; incompatible, legacy, or malformed entries re-judge. | The candidate-cache integration test 'resolves the prepared provider candidate before its model ladder judges' proves the fallback candidate that actually judged reports its own producing identity in the published branch artifact's producer and result candidate, and reviewed under the same declaration as the preferred candidate would have. | The candidate-cache integration test 'reports failed policy coverage when the fallback provider %s instead of borrowing the preferred policy' proves that a fallback provider lacking the selected policy or resolving it ambiguously resolves the policy for itself, records a policy-load-failed infrastructure failure with no judged descriptor, and never judges under the preferred provider's policy or a silently substituted installation.
Missing assertion: The checks explicitly require legacy and malformed entries to miss, but do not explicitly require that no provenance is fabricated or that only a newly valid result may replace such an entry.

Criterion: Story 10 negative: Given a reviewer attempts to modify protected input or read a sibling's private review evidence, when that access is attempted, then it cannot alter protected state or obtain the sibling evidence; no later rubric observes a changed input caused by that reviewer.
Task ids: 13, 14
Done when checks: The production containment adapter reaches its fake process boundary and admits scratch writes while refusing protected source/installation/engine-state writes and sibling-evidence reads under the generated mount profile. | Missing bubblewrap, a successful protected write, failed scratch write, or unsupported nested sandbox yields a named unsupported-capability failure and zero reviewer launches with no writable fallback. | The containment unit test 'refuses review preparation when containment has %s' proves that missing bubblewrap, a successful protected write, a failed scratch write, or an unsupported nested sandbox yields an unsupported result naming the provider, the missing linux-read-only-review-boundary capability, and the install-bubblewrap-and-enable-nested-sandboxing recovery action before any reviewer launches. | Both production invoke adapters deliver the same full review envelope and captured support tree through the enforced read-only profile while retaining provider-specific producing identity and private bookkeeping. | Adapter integration refuses an unsupported review profile before model launch; ordinary non-review invocation fixtures retain their existing arguments and writable behavior.
Missing assertion: No cited check explicitly requires that a later rubric cannot observe changed input caused by the reviewer.

Criterion: Story 12 negative: Given the conflict remains unresolved, when the aggregate reports blocked consistency, then no action from that adjudication reaches the worker and the stop identifies the implicated findings and rationale.
Task ids: 30, 31
Done when checks: The case validator accepts exhaustive duplicate/consistent graphs but rejects omitted, duplicate, invented, unresolved-merge, nonexistent-reference, missing-consistency, contradictory-outcome, and missing-admission fixtures. | Validation/application integration authorizes zero action effects for any invalid graph, blocked consistency, or escalation, including otherwise valid sibling actions. | Case-v2 validation delegates refutations to the inherited one-time attempted-act refutation validator: invalid binding, missing high-confidence assertion evidence, unresolvable current-tree path/excerpt, or repeated refutation rejects the whole judgment with no action effects. | The case validator unit test 'rejects %s before any action is authorized' proves that a decision omitting consistency, carrying contradictory outcomes, or referencing nonexistent findings or cases is rejected with a typed reason reporting that specific defect while zero action effects are authorized. | Decision-routing integration records each owner stop with original source evidence and zero work publication, plan append, sealed-artifact mutation, automatic waiver, or semantic charge. | Current-outcome gaps cannot settle through deferral, restart alone retains decision/repeat stops, and an explicitly changed approved baseline causes new evaluation while preserving the old verdict.
Missing assertion: No cited check explicitly requires the stop to identify the implicated findings and rationale, or states that adjudicated actions cannot reach the worker.
```
