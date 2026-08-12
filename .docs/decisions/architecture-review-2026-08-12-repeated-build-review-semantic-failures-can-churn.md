# Architecture Review: bounded build_review convergence and removal-anchored Tautology grading

**Date:** 2026-08-12
**Issue:** #1521
**Tier:** M (lightweight mode — feasibility and alignment run in full; complexity and domain
pre-check skipped per the tier rules)
**Stories reviewed:** none yet — this is the pre-stories DECIDE pass. The review input is the
technical intent from `/explore` plus `.docs/track/` and `.docs/complexity/`.
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. Both changes extend existing TypeScript modules in `src/conductor/src/engine/`. |
| **Prerequisites** | None. `.pipeline/kickback-ledger.json` already exists with an atomic-write/tolerant-read discipline (ADR-2026-07-26 D1), and `BuildReviewInputs` already resolves the `mergeBase` the removal deriver needs. |
| **Integration surface** | Four modules: `kickback-ledger.ts` (new field + cap), `conductor.ts` (the `build_review` FAIL branch at ~7329), `build-review-inputs.ts` + `build-review-prompt.ts` (new evidence block), `types/events.ts` and `types/config.ts` (one additive field each). No boundary is crossed that the existing kickback path does not already cross. |
| **Data implications** | One additive optional field on a gitignored per-feature JSON ledger. No schema migration: `isKickbackGateEntry` folds a missing `cumulative` to `0`, so a ledger written by the current engine reads clean under the new one. Verified against the existing tolerant-read implementation. |
| **Performance risk** | Negligible. The cumulative increment is arithmetic on a file already being read and written on this path. The removal deriver parses a diff string the engine has already computed for the grader — no additional `git` invocation. |
| **Worktree isolation** | Unchanged. All new state is per-feature under `.pipeline/`, which is already per-worktree. No port, database, shared file, or queue is introduced. Two worktrees cannot contend. |

**Feasibility risk of note:** the removal deriver must parse TypeScript declarations out of a raw
unified diff. This is text analysis, not compilation, so it will be approximate at the edges
(multi-line type declarations, re-exports). That is acceptable because the derived facts are
*evidence offered to a judge*, not an automatic gate decision — an under-derived removal simply
means the ordinary mutation-sensitivity check applies, which is today's behavior. The design fails
in the safe direction by construction.

## Alignment

**Against `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` — reconciled, not contradicted.**
This is the check that mattered most. That ADR fixed the per-tree bound and chose its reset rule
deliberately ("a genuine tree change always earns a fresh budget (fail-open)"). The cumulative bound
does not modify that rule, `MAX_KICKBACKS_PER_GATE`, or D2's no-op escalation. It adds a second
counter answering a different question, in the same ledger, with the same lifecycle. The two are
independent by design and the ADR tabulates the distinction explicitly. **No supersession is
required and none is claimed.**

**Against D3 of that same ADR — respected.** D3 rejected reason-text keying on measured evidence
that `build_review` reasons are LLM prose. The cumulative bound is count-based precisely because of
that finding, and the ADR says so rather than silently re-deriving it.

**Against `adr-2026-08-09-recorded-red-exception-for-remediation` — followed as precedent.** Its
governing principle is that an exception is valid only when recorded, attributable, and observable.
The removal exemption is engine-derived rather than maker-asserted for exactly that reason, and it
is rendered into the prompt as a visible evidence block rather than as an invisible rule relaxation.

**Against the event-spine principle — compliant, and the compliance is conditional.** Verdict from
`.agents/skills/event-spine/SKILL.md`: extend the union; the ledger field is exception C (durable
state, read by name by its own writer as a control input). The condition is recorded in
ADR-2026-08-12-cumulative D5 and is load-bearing — the `cumulativeCount` event field is what keeps
the ledger field from being a parallel channel wearing an existing file as a disguise. **Dropping
D5 as "optional polish" during BUILD would convert a compliant design into a violating one.** It is
called out here so a later reviewer catches it if it goes missing.

**Against the Deterministic-where-possible principle — compliant.** No LLM sits in either decision
path. The bound is arithmetic; the removal facts are derived from the diff. The only LLM
involvement is the grader applying supplied evidence to specific test hunks, which is the grader's
existing mandate.

**Against the scope-check verdict — consumer-facing, provider-agnostic, no new skill.** Notably, no
`HARNESS.md` or `AGENT_INSTRUCTIONS.md` rule is added. Both behaviors are machinery-enforced, so
prose would be the prompt-discipline substitute the Design Principle rejects. Documentation records
the behavior; it does not govern it.

**Pattern consistency.** Every seam used here already exists and is used the same way by a
neighbour: an additive optional config block mirroring `KickbackEscalationConfig`; a fourth prompt
evidence block beside three existing ones; an additive optional event field on an existing union
member; `writeHaltMarker(..., 'needs-human')` as used by the peer cap halts. No new pattern is
introduced, so no pattern-departure ADR is owed.

**State management.** The two counters are separate named fields with disjoint reset rules rather
than one overloaded counter with a mode flag — invalid combinations (a "cumulative" count subject to
tree reset) are unrepresentable. The kill-switch is an explicit optional block resolving to a
default, not an `is_*` boolean sprayed through call sites.

**Diagram accuracy.** `.docs/architecture/repeated-build-review-semantic-failures-can-churn-.md` and
its sequence counterpart were authored for this change and both pass
`conduct-ts render-diagrams --check`. They show the new ledger field, the new prompt input, and the
new halt path.

## Wiring Surface

Design-time commitments — where each new production surface will be called from. No `file:line` is
cited because the code does not exist yet; the SHIP-time as-built sweep verifies the shipped callers
independently.

| New surface | Wired into |
|---|---|
| `cumulative` field on `KickbackGateEntry` | Written by `bumpKickbackGate` in `kickback-ledger.ts`, on the path `conductor.ts`'s `consumeKickbackBudget` already calls for every gate kickback. |
| Cumulative cap constant + exhaustion result | Read in `conductor.ts`'s `build_review` FAIL branch, at the existing `consumeKickbackBudget('build_review', evidence)` call site, immediately after the D2 escalation check and before the existing per-tree `exhausted` branch. |
| Cumulative-reset-on-PASS | Invoked from the `build_review` PASS path in `conductor.ts`, where the step verdict is recorded. |
| `needs-human` cap HALT | `writeHaltMarker` + the existing `surfaceRemediationPr` / `loop_halt` emission, matching the peer cap-halt sites in the same function. |
| `cumulativeCount` on the `kickback` event | Populated at the existing `emitTracked({ type: 'kickback', ... })` call in the `build_review` branch; reaches `.pipeline/events.jsonl` through the unchanged `EventPersister`. |
| Config block for the kill-switch | Resolved through the existing merged-config path in `types/config.ts`, consulted at the cap check. |
| Removal-evidence deriver | Called from `build-review-inputs.ts` during grader input assembly, from the diff and `mergeBase` that function already resolves. |
| `removalContext` on `BuildReviewInputs` | Rendered by `buildGraderPrompt` in `build-review-prompt.ts` alongside `repairContext` / `acceptedWidenings` / `gateInstructions`. |

**Overlap scan (advisory).** `conduct-ts overlap-scan` over these paths reports `kickback-ledger.ts`
overlapping ~30 unmerged spec branches. This is noise, not signal: the file is recent enough that
most branches' merge-bases predate it, so the scan matches on the file's existence rather than on
contended edits. No usable collision warning. Recorded for completeness; it does not affect the
verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Cap of 5 is too tight; a converging feature halts for a human on lap 6 | Technical | Medium | Medium | D4's config kill-switch reverts behavior in one line; ADR records the cap as the least-evidenced decision and names the revisit signal (operators routinely clearing this halt) |
| Removal exemption applied per-diff instead of per-test, gutting Tautology on any deletion-bearing diff | Technical | Medium | **High** | ADR D3 states the predicate as three conjunctive per-test conditions and names the blanket-exemption failure explicitly; condition 3 blocks a test that also adds new behavioral assertions |
| `cumulativeCount` (D5) dropped during BUILD as non-essential, turning the ledger field into a parallel channel | Knowledge | Low | Medium | Called out in Alignment above and in ADR D5 as load-bearing rather than cosmetic, so a reviewer can catch its absence |
| Removal deriver under-parses multi-line or re-exported declarations | Technical | Medium | Low | Fails safe — an underived removal means the ordinary check applies, which is today's behavior |
| Legacy in-flight ledger without `cumulative` misread | Data | Low | Medium | Tolerant read folds a missing field to `0`; an in-flight feature gets a fresh budget, never a spurious halt |
| Halt classified weaker than `needs-human`, letting the re-kick sweep recycle it | Technical | Low | High | ADR D3 fixes the classification and cites `daemon-rekick.ts:184-192` as the reason |

One **High**-impact risk is registered, so the review marker is written.

## ADRs Created

Both reached APPROVED after the operator confirmed all four load-bearing decisions (cap value, gate
scope, kill-switch, evidence breadth). No ADR was superseded.

- `adr-2026-08-12-cumulative-build-review-convergence-bound.md` — the cumulative bound, cap 5,
  `build_review` only, config-gated default-on, `needs-human` halt, `cumulativeCount` on the event.
- `adr-2026-08-12-removal-anchored-tautology-exemption.md` — engine-derived removal evidence as a
  fourth prompt evidence block, with a three-condition per-test exemption predicate.

## Conditions

None. The verdict is a clean APPROVED — the four decisions that could have blocked it were resolved
with the operator before the ADRs were written, rather than deferred into conditions.
