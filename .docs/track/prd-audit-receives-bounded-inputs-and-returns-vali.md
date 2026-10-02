# Track: PRD audit receives bounded inputs and returns validated typed verdicts

Track: technical

Source: jstoup111/ai-conductor#2521

Scope boundary: Full migration of the PRD-audit input and verdict boundary, including all existing consumers, onto bounded engine-owned inputs and validated structured judgments with engine-owned persistence. Preserve approval, refusal, OVER_SCOPE, FIXABLE, PLAN_GAP, delivery, widening-decision authority, provider parity, and interactive skill use. Carry forward #2875's missing-current-dispatch verdict diagnostics and restrictions against validator execution of project code or unrelated writes. Reuse the shipped as-built contract pattern from #2188. Do not implement new finding-history capabilities (#2440), combined routing/budgets (#2060), cross-gate reconciliation (#2441), or a generic step-contract platform (#191).

The operator selected approach B (engine-owned verdict persistence), approved replacing #2875 with #2521, and approved the technical track on 2026-09-30. This is an internal review-contract migration; acceptance criteria belong in stories and no product PRD is required.

Scope check: consumer-facing shared engine and shipped skills; no new skill or registration; provider-agnostic contract with the existing Claude and Codex native-schema adapters.

## Verified basis

- `DefaultStepRunner.run` in `src/conductor/src/engine/step-runners.ts` already sends as-built review through the native-schema one-shot path and persists its validated judgment through `persistAsBuiltVerdict`.
- `artifacts.ts` and `conductor.ts` still consume `parsePrdAuditReport` and Markdown-based coverage and widening projections. This is executable behavior, not documentation-only work.
- #2188 and #2429 are closed; #2521 is open. No #2521 spec or open matching PR was found at exploration time.
- #2875 was closed as superseded at the operator's request, not as implemented. #1721 was returned to the queue and is outside this feature.

Verify-claims: CLEAR for the selected approach and track. Detailed contract decisions remain subject to architecture approval.
