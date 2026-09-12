# Track: Provider setup failures preserve configured fallback

Track: technical

Source: jstoup111/ai-conductor#1285

Scope boundary: General provider candidate setup, not only self-host isolation. Skip explicitly classified unusable candidates and try the next configured provider without consuming a dispatch retry. Preserve authentication, safety, and runtime-failure handling. Prove that fallback actually reaches and completes on the next provider through production wiring; do not assume the candidate loop alone establishes this.

The operator selected approach A: classify known capability failures during setup and reuse the existing fallback mechanism. This repairs the existing execution contract; acceptance criteria belong in stories rather than a PRD. A separate preflight would duplicate setup checks and could miss failures discovered during preparation.

## Verified exploration evidence

- The shared `executeProviderCandidates` loop in `provider-execution.ts` advances for classified provider/model unavailability; missing lifecycle supervision capability already returns a classified unavailable result.
- Preparation exceptions currently escape before that classification. `conductor.ts` contains the reported missing-isolation-capability throw, but the execution contract is shared across ordinary and self-host callers.
- `provider-execution.test.ts`, `provider-selection.test.ts`, and `per-step-provider-routing-927.acceptance.test.ts`: 95 assertions passed on the spec branch's unchanged source. An initial run reported a temporary-directory teardown violation; the scoped rerun with a worktree-private temporary directory passed. Providers were faked; no live provider fallback was exercised.
- The operator suspects additional fallback failures. No concrete additional live incident has yet been supplied, so a general live-fallback failure is unverified, not an established diagnosis.

Verify-claims verdict: CLEAR for the selected approach. Live behavior beyond the supplied incident remains unverified and is not asserted as proven by these tests.
