# Conflict Check: Codex readiness probe failure separation (#1039)

**Date:** 2026-07-29
**Inventory:** 447 story, active-spec, and prior-conflict artifacts inventoried; full title/status inventory scanned; focused pairwise analysis covered the #1039 stories, #905 PRD/stories, #970 stories/conflict report, auth-park coordinator decomposition, built-in provider installation readiness, provider routing, rate-limit recovery, event durability, and configuration loading.
**Result:** PASSED — the upstream product-requirement contradiction was resolved through the operator-approved #1039 PRD amendment.

## Resolved Conflicts

### Conflict 1: Unknown readiness both blocks and authorizes substantive dispatch

**Stories involved:** #1039 Story 1 vs #905 Story 4 and PRD FR-7/FR-8/FR-9
**Files:** `.docs/stories/codex-readiness-distinguishes-unavailable-doctor-p.md`, `.docs/stories/codex-auth-sandbox-permission-readiness-905.md`, `.docs/specs/2026-07-25-codex-auth-sandbox-permission-readiness-905.md`
**Type:** contradiction
**Severity:** blocking — resolved
**Confidence:** 100%, verified from the cited acceptance criteria and functional requirements.

**Description:**

#905 FR-7 requires an external failure without a conclusive check to be `unverifiable`; FR-8 says an unattended dispatch proceeds only when readiness is `ready`; FR-9 requires every `unverifiable` result to explain why work did not begin. #905 Story 4 repeats that only `ready` reaches substantive invocation and that timeout, unreachable service, malformed output, unsupported schema, conflicting source, or absent evidence becomes blocking `unverifiable`.

#1039 Story 1 requires those same execution and parse failures to become `probe-failed`, record degradation, and proceed with substantive Codex invocation. The approved #1039 PRD now explicitly amends #905 FR-7 through FR-9 for inability-to-obtain-evidence outcomes, and the older PRD/story files carry amendment notices. The #1039 behavior is authoritative for this case.

### Conflict 2: Recovery both requires fresh `ready` and permits an inconclusive probe trial

**Stories involved:** #1039 Story 3 vs #905 Stories 1/4/5 and #970 readiness-park stories
**Files:** `.docs/stories/codex-readiness-distinguishes-unavailable-doctor-p.md`, `.docs/stories/codex-auth-sandbox-permission-readiness-905.md`, `.docs/stories/codex-readiness-park-970.md`
**Type:** state-conflict and sequencing
**Severity:** blocking — resolved
**Confidence:** 100%, verified from the cited recovery scenarios.

**Description:**

#905 requires a cached-login recovery episode to remain parked through `unverifiable` probes and resume only after a fresh `ready` verdict. #970 preserves malformed, unsupported, absent, or ambiguous authentication evidence as fail-closed while changing only unrelated-health classification and polling cadence.

#1039 Story 3 requires a `probe-failed` recovery result to authorize one real invocation trial before `ready`. The approved amendment and regenerated accepted stories now own this transition, while the #905/#970 story files explicitly preserve only affirmative credential recovery and unrelated-health/cadence behavior.

## Root Cause and Kickback Resolution

Both conflicts originated in approved product requirements, not story phrasing or a missing implementation seam. Conflict-check routed the work to **PRD**. The operator selected Option 1, approved the narrow #1039 amendment on 2026-07-30, approved the architecture amendment check, and accepted regenerated FR-traceable stories.

## Resolution Options

1. **Recommended — reclassify #1039 to product and author a narrow PRD amendment.** The amendment explicitly supersedes #905 FR-7/FR-8/FR-9 only for inability-to-obtain-evidence outcomes, preserves affirmative `missing`/`unusable` blocking and all unrelated #905 requirements, and defines the one-trial recovery outcome. Then re-run architecture review in amendment mode and regenerate stories from the approved amendment.
2. **Keep technical track but narrow #1039 to diagnostics only.** Preserve `unverifiable` as blocking and retain resume-only-after-ready behavior. This resolves the conflict but rejects the operator-approved degraded-dispatch and real-trial outcomes.
3. **Treat the old PRD as historical and let the ADR override it.** This is not acceptable under the repository's artifact authority: a technical ADR cannot silently supersede approved functional requirements.

**Recommendation:** Option 1. The requested observable behavior changed, so the product requirement must change explicitly before architecture and stories can be authoritative.

## Resolution Applied

- Reclassified #1039 from technical to product track.
- Added and approved `.docs/specs/codex-readiness-distinguishes-unavailable-doctor-p.md`, amending only #905 FR-7/FR-8/FR-9 for inability-to-obtain-evidence outcomes.
- Added amendment notices to the #905 PRD/stories and #970 stories so their historical criteria are not mistaken for current authority.
- Revalidated the approved architecture and ADR against FR-1 through FR-15 with no structural gap.
- Regenerated and accepted #1039 stories with complete FR traceability.
- Re-ran all five conflict types against the relevant inventory; zero blocking or degrading conflicts remain.

## Compatible Interactions

- **Credential/source isolation:** compatible (verified, 99%). #1039 preserves selected-source and provider isolation.
- **Actual invocation auth failure:** compatible (verified, 99%). It still has auth-recovery precedence and consumes no fallback/retry/escalation budget.
- **Built-in provider installation readiness:** compatible (verified, 98%). A doctor spawn failure may allow the real invocation, whose existing missing-binary classification remains authoritative.
- **Secret safety:** compatible (verified, 99%). #1039 narrows retained evidence to closed structured facts and continues to forbid raw payloads and credential material.
- **Configuration loading:** compatible (verified, 99%). The new key follows existing fail-closed validation and composition patterns without changing other timeout meanings.
- **Rate limits, operator park, and audit allowlist:** compatible (verified, 98%). They retain separate state owners, budgets, markers, and persistence contracts.

## Five-Type Scan

| Conflict type | Result | Evidence summary |
|---|---|---|
| Contradiction | None after amendment | #1039 expressly supersedes the old rule for unobtainable evidence; affirmative credential rules remain unchanged. |
| Behavioral overlap | Compatible | The #1039 amendment owns probe failure; #905/#970 retain affirmative credential, unrelated-health, cadence, and other behavior. |
| State conflict | None | `probe-failed` has the one-trial transition; `missing`/`unusable` retain bounded parking; `ready` resumes normally. |
| Resource contention | None | No marker, budget, timer, event, or credential store gains incompatible ownership. |
| Sequencing conflict | None | The approved transition order is explicit and acyclic, including the one-trial/no-recursion bound. |

## Result

Conflict check passed. Both blocking manifestations were resolved at their product-requirement root, no degrading compromise remains, and the artifact set is clean for implementation planning.
