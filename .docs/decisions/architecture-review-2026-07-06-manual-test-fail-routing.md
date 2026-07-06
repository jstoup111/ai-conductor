# Architecture Review (lightweight, M-tier): manual-test-fail-routing

**Date:** 2026-07-06
**Verdict:** APPROVED
**ADR:** adr-2026-07-06-manual-test-fail-routing.md (APPROVED)

## Feasibility

All four mechanisms land on existing, verified seams:

- Enforcement flip is a one-token topology change (`steps.ts:141-150` block); the auto-mode
  advisory-skip branch (`conductor.ts:1416-1424`) then no longer applies to manual_test.
- The kickback route reuses the exact machinery prd_audit's deterministic fallback uses
  today (`navigateBack`, `pendingRetryHints`, restage-as-`stale`, self-heal counter capped
  at `MAX_KICKBACKS_PER_GATE`) — no new primitives; `build` does NOT need to become a
  `kickbackTarget` (prd_audit routes to build without it; verified in code).
- The fix-evidence gate extends the existing manual_test completion predicate
  (`artifacts.ts:467-491`); the new `getHeadSha` seam is additive-optional on
  `CompletionContext` (`artifacts.ts:245`), so every existing caller/test is unaffected.
- Append-only attempts change only the manual-test skill contract + the gate's parse region.

## Alignment

- Mirrors the established daemon self-heal pattern (prd_audit impl-gap → build) rather than
  inventing a new control flow; consistent with the RED-evidence philosophy (#181/#297):
  gates verify *evidence of work*, not file existence.
- Honors ADR-001's no-dispatch keystone: the deterministic route adds zero LLM dispatches.
- Fail-open only where git/seam is genuinely absent (test envs), matching existing gate
  philosophy; fail-closed on the actual whitewash signature.

## Risks / watch items

1. **Kickback ping-pong:** build "fixes", manual_test still FAILs → loop. Bounded by the
   self-heal cap; exhaustion HALTs with the accumulated attempt history (append-only file
   makes the loop legible post-hoc). Covered by a story.
2. **False whitewash-guard trips:** a legitimately transient FAIL (env flake) re-run to PASS
   with no commits would now be refused. Mitigation: the reason text tells the operator/skill
   exactly what to do (commit a fix or clear via re-route); daemon path routes to build whose
   no-op success still moves HEAD only if it commits — if build has nothing to commit the
   loop HALTs for a human, which is correct for an unexplained FAIL→PASS flip. Covered by a
   negative-path story.
3. **Stale fail-evidence marker across sessions:** marker carries `observedAt`; the gate
   ignores markers older than `sessionStartedAt` (same freshness rule as the results file).
4. **Enforcement-flip blast radius (grep-audited, three findings, all in scope):**
   a. `skills/manual-test/SKILL.md` frontmatter ALREADY declares `enforcement: gating` — the
      flip reconciles `steps.ts` with the skill's long-standing declared contract, not a new
      contract. (The resolver ignores harness-skill frontmatter for built-ins, so the
      engine's advisory value silently won until now.)
   b. `skill-resolver.ts` `ENFORCEMENT_LOCKED_STEPS` (stories/plan/build/finish) permits
      project-local skill overrides to downgrade un-locked steps — manual_test must join the
      locked set or a consumer override can silently re-open the false-ship hole.
   c. `config.ts:401` — only advisory steps may be `disabled`; a consumer config disabling
      manual_test hard-errors after the flip. Requires a CHANGELOG Migration note (remove
      the disable). Tier-skip (`skippableForTiers: []`) and the skill-level auto-skip for
      non-endpoint features are unaffected.
   d. `conductor.ts:1662` — interactive recovery menu already refuses 'skip' for gating
      steps; the flip extends that protection to manual_test as intended.
