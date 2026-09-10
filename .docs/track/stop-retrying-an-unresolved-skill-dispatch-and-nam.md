# Track: Stop retrying an unresolved skill dispatch and name its remedy

Track: technical

Scope boundary: Small fix for #1631, approved by the operator on 2026-09-06 (delegated). An
auxiliary (build_review rubric) member whose provider reports an unresolved skill command must
stop consuming its retry allowance immediately, and the resulting condition must name the skill,
the cause, and both remedies — relink the provider skill catalog, or rebase a feature whose base
predates the skill. Out of scope: a pre-dispatch skill-existence preflight for ordinary lifecycle
steps and provider parity for the unresolved-command signal (both owned by #1823); any change to
park-versus-halt routing, the kickback budget, or the proactive-rebase trigger.

This is an internal engine dispatch correction; acceptance criteria live in technical stories
rather than a PRD.

The operator approved, on 2026-09-06 (delegated), naming the remedy in the existing failure detail
over introducing a new park disposition. The issue left "routed into the existing proactive-rebase
machinery or parked with a rebase-needed reason" open; a new daemon disposition is neither Small
nor reversible, while a named detail on the existing infrastructure-failure path gives the operator
the same diagnosis at the point the fault is recorded.

Scope check: A — consumer-facing (the auxiliary dispatch executor and the build_review rubric lane
run in every repository that installs the harness; no self-host, daemon-only, or repository-local
gate is touched); B — n/a (no new skill); C — provider-agnostic (the change reads the
provider-neutral `commandUnresolved` field of the provider contract and forks on no provider name;
only the claude adapter populates that field today, which is the asymmetry #1823 owns and this
slice deliberately does not close). No catalog registration is required.

Verified foundation: `provider-execution.ts:781-810` retries an auxiliary member
`policy.max_retries` times and returns early only on `result.success`; `executeProviderCandidates`
returns an unresolved-command attempt immediately because `classifyProviderCandidateFailure` treats
only provider- and model-unavailability as candidate-advancing, so no provider fallthrough exists to
preserve. `claude-provider.ts:509,745` sets `commandUnresolved`/`commandUnresolvedName` from a
zero-turn `Unknown command:` envelope, and `llm-provider.ts:235-237` declares both on the shared
provider contract. `conductor.ts:8757` already halts an ordinary step's unresolved command
mechanically without retrying (#1311), so only the auxiliary lane still retries.
`step-runners.ts:2200,2259` drops the classification at `invokeOnce` and returns bare `undefined`,
which `build-review-coordinator.ts:451-465` records as an `invalid-provider-result` infrastructure
failure with no detail. `step-runners.ts:1946-1967` and `build-review-coordinator.ts:376-384`
already fail a rubric closed before dispatch when its `SKILL.md` is unreadable, so the checkout-
absence half of the observation is covered and the remaining hole is a definition present in the
checkout but unresolvable in the provider catalog.
