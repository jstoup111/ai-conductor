# Conflict Check: daemon-mode-route-halt-user-input-required-through (#459)

**Date:** 2026-07-10
**New stories:** `.docs/stories/daemon-mode-route-halt-user-input-required-through.md` (TR-1..TR-7)
**Result:** PASS — zero blocking conflicts; one degrading conflict (documentation
inconsistency in a neighboring story) surfaced for acceptance.

## Pairs examined (reasoned, not assumed)

| Existing artifact | Interaction examined | Verdict |
|---|---|---|
| `retry-as-escalation.md` (Story 10) | Ladder must not advance on no-burn resumes; ladder derives from `attempt` | **Clean** — TR-3's `attempt--` resume keeps the rung by construction; Story 10's enumeration (rate-limit / stale-session / auth-park) is extended additively, not contradicted. Verified: escalation derives from `attempt` (story text) and the resume never increments it. |
| `prd-audit-kickback-preserves-task-status.md` (Slice 3) | Auto-park vs stall-remediation ordering | **Clean** — TR-2's negative ("park wins, stall remediation never runs after a park") matches Slice 3 and the code order (park check `conductor.ts:1727` precedes the stall block `:1761`). |
| `prd-audit-kickback-preserves-task-status.md` (Slice 2) | remediation.json task validation (empty id rejected) | **Clean** — TR-7 stall answers carry `tasks: []`, so plan-append doesn't run; when a stall disposition does carry tasks, the existing validation (non-empty id) applies unchanged. |
| `sandbox-auth-expiry-park.md` (TR-2/3/4) | No-burn accounting + HALT must not read "retries exhausted" | **Clean** — same idioms, same preserve-specific-reason seam; auth halts and stall halts cannot race (an auth failure exits the loop before the gate-miss stall path runs). |
| `add-a-judgement-gate-at-the-build-manual-test-seam.md` | Counter philosophy (per-gate keyed) vs TR-6 shared `remediationRounds` | **Clean** — different registries: self-heal counters are gate-keyed kickback counters; `remediationRounds` is the single run-scoped remediation budget (`conductor.ts:1174`) ALREADY shared by prd_audit (:2026) and finish/as-built (:2171). TR-6 matches existing semantics. **But see the degrading conflict below.** |
| `manual-test-fail-routing.md` (Story 3) | Kickback-with-hint via navigateBack | **Clean** — different gate, different consumption point (post-gate navigateBack vs in-loop resume); no shared state beyond the budget, which TR-6 accounts for. |
| `operator-park-...md` (FR-2/3/6) | Park precedence over every autonomous decision | **Clean** — TR-2 negative asserts park wins; stall remediation never overrides a park marker. |
| `daemon-halt-reconciliation.md` (FR-7, dashboard) | HALT first-line contract; `.cleared` overwrite rules | **Clean** — TR-4/5 write the question as the first non-empty line, exactly what `readHaltReason`/dashboard consume; rekick clear semantics untouched. |
| `port-test-conduct-worktree-sh-coverage-to-the-ts-s.md` | halt_marker stall "hands off to interactive" | **Clean** — that story ports the *interactive* stall behavior, which TR-2 keeps byte-for-byte; the new branch is daemon-gated. Existing ported tests keep passing. |
| `2026-07-05-changelog-migration-block-enforcement.md` | `/remediate` dispatch pattern + bounded fallback | **Clean** — same pattern (evidence artifact → dispatch → bounded → direct HALT fallback); TR-2/5/6 follow it. |

## Conflict: judgement-gate story mislabels LOOP_HALT_MARKER as halt-user-input-required

**Stories involved:** Build/manual-test judgement gate vs TR-1/TR-2 (this feature)
**Files:** `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md` (line ~141)
vs `.docs/stories/daemon-mode-route-halt-user-input-required-through.md`
**Type:** resource-contention (marker file semantics)
**Severity:** degrading

**Description:**
The judgement-gate story says: at the self-heal cap, "`LOOP_HALT_MARKER`
(`.pipeline/halt-user-input-required`) is written with the grader's evidence". The
parenthetical is **wrong about the code**: `LOOP_HALT_MARKER = HALT_MARKER` from
`halt-marker.ts` = `.pipeline/HALT` (verified `conductor.ts:13,176`,
`halt-marker.ts:14`; the `.pipeline/halt-user-input-required` constant is the *other*
`HALT_MARKER` export in `artifacts.ts:114` — an unfortunate name collision). If that
story's builder follows the story text literally and writes
`.pipeline/halt-user-input-required` with grader evidence, an engine-written marker would
flow into THIS feature's stall-remediation path on the next dispatch — a second,
unintended producer of what TR-1 defines as "the agent's question".

**Resolution Options:**
1. Fix the one-line parenthetical in the judgement-gate story to `(.pipeline/HALT)` in
   this spec branch (hand-committed alongside the spec). Zero behavior change; removes
   the trap for that story's future builder.
2. Leave it and rely on that builder noticing the constant's real value.
3. Rename one of the two `HALT_MARKER` exports (bigger refactor, out of scope here).

**Recommendation:** Option 1 — cheapest, removes a real build-time trap, and this
feature's stories are the ones that now depend on the marker's single-producer semantics.

## Accepted degrading conflicts

- The above, resolved via Option 1 (story-text correction in the same spec branch).
