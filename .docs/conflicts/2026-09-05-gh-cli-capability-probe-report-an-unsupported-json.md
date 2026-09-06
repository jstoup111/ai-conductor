# Conflict Report: `gh` version floor and machine-level environment gate

**Date:** 2026-09-05
**Feature:** gh-cli-capability-probe-report-an-unsupported-json
**ADR corpus scope:** `repo_wide` (from `.ai-conductor/config.yml:123`)
**Stories scanned:** all 354 files in `.docs/stories/`, plus this feature's 6 new stories
**Result:** 1 blocking contradiction, 1 degrading overlap — both resolved by the operator on 2026-09-05; re-check clean

## ADR corpus record (`repo_wide` requires this)

**Examined** — approved ADRs whose subject overlaps these stories:
`adr-2026-07-22-canonical-tracker-client-seam`, `adr-2026-07-22-daemon-level-missing-credential-gate`,
`adr-2026-07-07-finish-record-primitive`, `adr-2026-07-03-halt-pr-rehabilitation-at-finish`,
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-08-03-fail-closed-decide-entry`,
`adr-2026-08-01-multi-proof-park-deletion-authority`, `adr-2026-07-27-ancestry-proven-park-reconciliation`,
`adr-2026-07-07-daemon-owned-build-credential`, `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`,
`adr-2026-08-24-refused-step-status`, `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`,
`adr-2026-07-29-codex-readiness-probe-failure-disposition`, `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`.

**Narrowed out** — the remaining approved ADRs in `.docs/decisions/` (535 files), whose subjects
(build_review rubrics, coherence/plan gates, memory providers, cost attribution, release gating,
provider routing, test-quality preflight, intake ledger, OTel) do not address `gh` invocation,
daemon dispatch preconditions, FINISH outcome recording, or park deletion authority. No ADR was
excluded on supersession grounds: none of the examined set is fully superseded.

**No ADR-versus-story conflict was found.** Two pairs were checked closely and are aligned, not
opposed:

- `adr-2026-07-03-halt-pr-rehabilitation-at-finish` decision 3 makes the finish completion gate
  fail-open on `gh` read errors. Story 6 asserts that gate still passes with a warning on a
  capability error. Aligned.
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` binds non-`done` **dispatch**
  outcomes to leave an operator-clearable marker. Story 2 asserts no per-feature marker is written.
  No contradiction: the gate acts **before** any feature is claimed, so no dispatch outcome exists
  to bind. The operator lever is the waiting condition itself, which Story 2 requires to state its
  remedy.

---

## Conflict 1: park-reconciliation's refusal reason for an unavailable `gh`

**Stories involved:** Story 6 (Every `gh` caller keeps its existing failure disposition) vs
Story S1 (A refused branch says why, not "not ancestor")
**Files:** `.docs/stories/gh-cli-capability-probe-report-an-unsupported-json.md` vs
`.docs/stories/park-reconciliation-refusal-observability-1114.md`
**Type:** contradiction
**Severity:** blocking

**Story A opposing sentence (verbatim, park-reconciliation-refusal-observability-1114 S1):**
"**Given** `gh` is unavailable or returns unparsable output, **when** the helper runs, **then** it
refuses with `no-merge-proof` and deletes nothing; an unavailable proof never authorizes anything."

**Story B opposing sentence (verbatim, this feature's Story 6):**
"Given the park-reconciliation path takes no action because of a capability error, when its refusal
cause is reported, then the cause names the CLI capability problem rather than a missing merge
proof."

**Description:** Both stories govern the same field — the refusal reason `park-reconciliation`
reports when `gh` cannot supply a merge proof — and require different values for the same input.
The accepted story requires `no-merge-proof`; this feature's story requires a capability cause
"rather than a missing merge proof". `RefusalReason` is a closed vocabulary of four values, so one
value must win.

**Two-directional check:** fully satisfying Story 6 breaks S1 (the reason is no longer
`no-merge-proof`); fully satisfying S1 breaks Story 6 (the capability cause is never reported).
Both directions fail. The oscillation signature — non-terminating rework — is nevertheless absent,
because the resolution is a single value choice rather than a design change, so this is recorded as
a contradiction rather than an oscillation.

**Note:** the two stories agree completely on *behavior*. Neither deletes anything; an unavailable
proof authorizes nothing. The dispute is confined to the reported reason string.

**Resolution Options:**
1. Narrow this feature's Story 6: park-reconciliation keeps `no-merge-proof` for an unavailable or
   unparsable `gh`, exactly as S1 requires. This feature contributes only the typed error and its
   log line there; the refusal vocabulary is untouched.
2. Add a fifth `RefusalReason` (`gh-capability`) and replace S1's superseded assertion in place.
   Better diagnosis, but widens a closed taxonomy that `adr-2026-08-01-multi-proof-park-deletion-authority`
   governs, and requires editing another feature's accepted story file.
3. Route the capability error to a distinct non-refusal outcome in park-reconciliation.

**Recommendation:** Option 1, for two reasons. First, value: with the v2.73.0 floor gating dispatch,
park-reconciliation cannot encounter an unsupported-field error in normal operation — only a
mid-run downgrade reaches it — so the diagnostic gain is near zero against the cost of widening a
governed taxonomy. Second, mechanics: editing
`.docs/stories/park-reconciliation-refusal-observability-1114.md` is a foreign-stem story edit,
which the engineer land gate rejects on this spec branch. Option 2 could not land here without a
companion main-based PR.

---

## Conflict 2: two `gh` error classifiers with different evidence standards

**Stories involved:** Story 5 (An unsupported `--json` field is reported as a CLI capability
problem) vs Story 1 and Story 3 of the pr-labels not-found classifier
**Files:** `.docs/stories/gh-cli-capability-probe-report-an-unsupported-json.md` vs
`.docs/stories/pr-labels-structured-gh-not-found-detection.md`
**Type:** overlap
**Severity:** degrading

**Story A opposing sentence (verbatim, pr-labels-structured-gh-not-found-detection Story 1):**
"**Then** `isNotFoundError` returns `true` from the **structured** fields (`err.stderr`/`err.code`),
not from an `err.message` substring guess,"

**Story B opposing sentence (verbatim, this feature's Story 5):**
"Given a `gh` invocation fails with `Unknown JSON field: \"headRefOid\"`, when the seam handles it,
then it produces a typed capability error naming the `gh` CLI and the field `headRefOid`."

**Description:** Not a contradiction — the two classifiers answer different questions and neither
changes the other's result. The overlap is an evidence-standard inconsistency: the accepted
classifier was deliberately moved off message-substring matching so wording and locale drift cannot
flip a classification, while this feature's classifier recognizes an English phrase. Unlike
GraphQL `NOT_FOUND`, `gh`'s unsupported-field error carries no structured error type, so an
equivalent structured signal does not exist for it.

**Resolution Options:**
1. Align Story 5 with the accepted evidence standard as far as the CLI allows: classify from
   structured fields (`stderr`, exit code) rather than `err.message`, and require that an
   ambiguous or unrecognized failure yields **no** capability error — mirroring S2b's
   "never `NOTFOUND`" rule.
2. Accept the inconsistency and record it.
3. Petition upstream for a structured error code — out of scope and not actionable here.

**Recommendation:** Option 1. It costs nothing, it preserves the fail-safe direction (ambiguity
never produces a confident wrong classification), and it keeps one evidence standard across both
`gh` classifiers.


---

## Resolutions applied (2026-09-05)

**Conflict 1 — Option 1 selected.** This feature's Story 6 was replaced in place: park-reconciliation
keeps `no-merge-proof` for an unavailable or unparsable `gh`, and this feature adds no member to
`RefusalReason`. The typed capability error is logged instead, so the cause stays recoverable
without changing the reason string. `park-reconciliation-refusal-observability-1114.md` is not
edited, so no foreign-stem story edit reaches the land gate.

**Conflict 2 — Option 1 selected.** Story 5 was replaced in place to adopt the accepted evidence
standard: the classifier reads structured fields (`stderr`, exit code) rather than `message`, and an
ambiguous or unrecognized failure produces no capability error — mirroring the accepted
"exit code alone must not prune" rule.

## Re-check

Re-run after both resolutions: **zero blocking conflicts remain.** Story 6 and
`park-reconciliation-refusal-observability-1114` S1 now assert the same reason for the same input.
Story 5 and `pr-labels-structured-gh-not-found-detection` now share one evidence standard, and
neither classifier can change the other's result. No degrading conflict was left accepted.
