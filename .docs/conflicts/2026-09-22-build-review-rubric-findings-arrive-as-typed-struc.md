# Conflict Check: build_review rubric findings arrive as typed, structurally keyed output (#2384)

**Date:** 2026-09-22
**Stories checked:** `.docs/stories/build-review-rubric-findings-arrive-as-typed-struc.md` (Stories 1–8) against all 90 existing story files that name build_review, and against the ADR corpus.
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`). All 596 files in `.docs/decisions/` were title-and-status swept during architecture review; the corpus was narrowed to the ADRs whose subject overlaps these stories (listed below). Supersession parsing applied only at this scope: `adr-2026-07-03-gated-writeback-announcements` is the only SUPERSEDED ADR encountered and is fully superseded; every other candidate is APPROVED and retained.
**Result:** 0 blocking, 1 degrading (accepted), 0 superseding ADRs.

## Examined ADRs (narrowed corpus)

adr-2026-08-13-engine-managed-build-review-rubric-branches (as amended D1.1/D1.2/D2.2), adr-2026-08-13-stable-build-review-finding-dispositions, adr-2026-08-16-closed-build-review-finding-vocabularies (D5.1), adr-2026-08-18-content-anchored-finding-reference-schema, adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane (D2.2), adr-2026-08-19-engine-stamped-rubric-judged-result-envelope (D7.1/D10.1/D2.3), adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-08-21-engine-identity-in-build-review-cache-key, adr-2026-08-22-build-review-opt-in-rubric-container, adr-2026-08-22-one-owner-per-review-question, adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope, adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded, adr-2026-09-02-adr-decision-citability-contract, adr-2026-09-06-engine-owned-test-quality-scope, adr-2026-09-07-durable-prd-widening-decision-reconciliation (D6.1), adr-2026-09-10-portable-build-review-policy (D7.1), adr-2026-09-10-separate-custom-review-coverage-identity, adr-2026-08-29-build-review-remediate-case-adjudication, adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-07-23-build-review-fresh-base-disposition, adr-2026-08-17-build-review-rubric-repetition-short-circuit, adr-2026-08-13-markdown-default-inversion, adr-2026-07-26-event-sink-registry-exhaustiveness.

**Narrowed out** (subject does not overlap: tautology/completeness exemptions, wiring rubric retirement, coverage-binding judge, telemetry lifecycle, daemon dispatcher seam, reseal audit, release mechanics, and every ADR outside build_review, provider dispatch, or skill/engine ownership).

## Pairwise scan (both directions)

| Pair | Shared subject | A→B holds? | B→A holds? | Verdict |
|---|---|---|---|---|
| S2 (ignore prose payload) vs S8 (Codex `output` still carries transcript) | provider result fields | yes | yes | compatible — transcript retained for observation, never parsed |
| S3 (`invalid-structured-result` retryable to 3 laps) vs S4 (`native-schema-unsupported` charged once) | mechanical-fault charging | yes | yes | distinct closed causes with distinct charge rules (D2.2) |
| S3 (rejection settles absent, one invocation) vs S6 (cache entry written on clean judge) | branch settlement | yes | yes | rejected branch writes no cache entry, unchanged |
| S1 (judged schema top-level = four fields) vs S5 (custom schema top-level = kind/version/findings) | descriptor schemas | yes | yes | different descriptors, different contracts |
| S6 (pre-migration cache misses) vs S6 (pre-migration dispositions match) | persisted stores | yes | yes | cache keyed on engine identity; dispositions keyed on finding identity — independent |
| S7 (audit forbids fenced `findings` payload in SKILL.md) vs S6 (SKILL.md defines every vocabulary member) | skill text | yes | yes | definitions are prose under Judgement, not a payload block |
| S8 (interactive mode still dispatches non-interactive) vs S4 (adapter `nativeSchemaUnsupported` → fault) | interactivity | yes | yes | S8 makes the S4 refusal unreachable in production and observable under test |
| S2/S3 vs adr-2026-08-19 D6 (field-named rejection) | rejection diagnosis | yes | yes | S3 is D6 applied to the structured result |
| S3 vs adr-2026-08-19 D7 (repair turn) | repair | — | — | superseded by D7.1; see degrading entry below |
| S6/S7 vs adr-2026-08-16 D5 (SKILL.md enumerates vocabulary) | vocabulary binding | yes | yes | D5.1 relocates the binding; S7 keeps it bidirectional |
| S1/S5 vs adr-2026-09-10 D4/D7 (generic bounded finding schema) | custom contract | yes | yes | D7.1 |
| S2 vs adr-2026-09-07 D6 ("No other step's parser is migrated in #2429") | seam consumers | yes | yes | D6.1 records the second consumer; D6's prohibition was scoped to #2429's own build |
| S6 vs adr-2026-08-18-content-anchored-finding-reference-schema (closed three kinds) | identity | yes | yes | no new kind; identity grammar untouched |
| S4 vs adr-2026-08-18-mechanical D3.1 (deterministic fault charged once) | charging | yes | yes | S4 copies D3.1's shape |
| S2 vs adr-2026-08-24-streaming-dispatch (one argument-construction path) | adapter args | yes | yes | schema option rides the existing argument path the PRD-widening consumer already uses |

No oscillation: no pair returned two "no" answers.

## Conflict: Retiring the repair turn supersedes a landed acceptance story

**Stories involved:** Story 3 (An invalid structured result is rejected naming the field and settles as a mechanical fault) vs Story 11 of the landed #1683 spec (A repair that cannot converge does not spend the remaining retry budget)
**Files:** [.docs/stories/build-review-rubric-findings-arrive-as-typed-struc.md] vs [.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
**Story ID:** 3
**ADR opposing sentence (verbatim):** "A repair whose output is byte-identical to the output it was asked to repair […] settles the branch without spending the remaining retries."
**Story opposing sentence (verbatim):** "Given an `invalid-structured-result` on the first dispatch, when the branch settles, then exactly one provider invocation was made for that branch and no repair prompt was sent."

**Description:** The landed story and D7 describe a bounded repair turn over free-text output. Story 3 sends no repair prompt. Both cannot hold for the same rejected branch. The root is the design, not story phrasing, and the design change is already recorded: D7.1 (approved 2026-09-22) retires the repair turn because the provider enforces shape natively and the residual rejections are semantic reruns the mechanical-fault lane already bounds.

**Resolution Options:**
1. Accept the supersession: the landed story remains the historical acceptance record for #1683; D7.1 governs going forward; Story 3 stands.
2. Keep one repair turn over the structured result (drop D7.1); Story 3's "exactly one invocation" criterion becomes "at most two".
3. Make the repair turn a per-rubric policy option (new config key, new ADR).

**Recommendation:** Option 1 — the operator approved D7.1 with this trade-off stated; option 2 keeps a prompt over output that has no free text to repair, and option 3 adds a config surface nothing has asked for.

**Resolution (operator, 2026-09-22):** Option 1, by the D7.1 approval at architecture review. The landed story file is not edited; historical acceptance records are not rewritten.

## Summary

Conflict check passed: 0 blocking, 1 degrading accepted (repair-turn supersession, governed by D7.1). No story edits required. No ADR superseded.
