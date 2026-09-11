# ADR: Separate custom review risk identity from reduced-coverage identity

**Date:** 2026-09-10
**Status:** APPROVED
**Approved:** James Stoup, 2026-09-10, after reviewing the distinction and persistence across package updates in plain English
**Deciders:** James Stoup; conflict resolution for jstoup111/ai-conductor#1986
**Mode:** Architecture amendment, limited to the custom-disposition identity gap found during conflict-check
**Partial supersession:** `adr-2026-09-10-portable-build-review-policy` D7's common binding for custom operator dispositions, and its amendment beside `adr-2026-08-21-engine-identity-in-build-review-cache-key` D7. All other decisions remain effective.

## Context

A custom policy can fail before its effective bytes are available: a missing installation, unreadable definition, or incomplete supporting package has no valid complete bundle identity. The approved design requires explicit failed coverage in that state, but its general custom-disposition binding requires effective-policy identity. An exact reduced-coverage decision cannot be constructed reliably from content that was never loaded. Reusing an old digest would assert knowledge of the current package the engine does not have.

The existing operator contract deliberately distinguishes accepting a judged finding from accepting missing coverage. `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D7 binds the latter to feature-local rubric and closed failure reason, excluding changing diagnostic details. The current `BuildReviewReducedCoverageIdentity` and matcher implement that distinction. This amendment extends it to custom declarations without making a coverage waiver equivalent to accepting a policy's findings.

## Options Considered

1. **Separate the two subjects of approval (recommended).** Accepted risk binds to a content-grounded finding; reduced coverage binds to a validated custom declaration and closed failure reason. This preserves an actionable operator decision even when loading never succeeded.
2. **Make loading failures ineligible for reduced coverage.** Keep content identity mandatory for every custom disposition. The operator must repair or disable the policy instead; this narrows the existing reduced-coverage capability for custom rubrics and requires a corresponding product decision.
3. **Require a last-known successful policy bundle.** Coverage could refer to historical bytes, but first-use loading failures still have no subject. Treating historical bytes as current would violate provenance, so this does not completely resolve the approved outcome without another exception.

## Decision

### D1 — A risk acceptance remains about one judged finding

Custom accepted-risk identity includes the validated finding identity, versioned declaration identity, and effective policy content identity specified by the primary ADR. Changed effective policy cannot borrow acceptance of a previous policy's finding. A failure that produced no valid judgment has no finding to accept. Built-in accepted-risk binding is unchanged.

### D2 — A coverage decision is about an observed inability to judge a declared policy

A custom reduced-coverage identity is versioned and scoped to the existing canonical feature identity, the complete validated review declaration, and the exact closed infrastructure-failure reason. The declaration portion includes rubric id, semantic skill, review question, source selection, and explicitly required resource selections; use the same canonical declaration meaning as policy configuration rather than a display name or path guessed from diagnostics.

The identity does not require effective package bytes, an actual resolved installation, a candidate scratch path, a lap id, or a diagnostic excerpt. Those facts, when known, remain producing/current-failure evidence. Missing effective content is represented honestly as unavailable, never by a guessed digest or an old bundle presented as current.

The declaration is the selected policy obligation, not the execution attempt: candidate timing, provider availability, and retry/model settings do not silently create a new coverage subject. A different declared policy/question/source/resource selection or different closed failure reason requires a new operator decision. Invalid project configuration that cannot produce a validated declaration is not made waivable by this decision.

### D3 — Preserve the existing reduced-coverage authority and limits

Only the existing explicit operator operation can record the decision, under its current exhaustion, interactive-terminal, identity, rationale, and current-state checks. No adjudicator, reviewer, fallback, or configuration flag creates it.

While the same declared obligation still has the same closed failure reason, the decision remains effective across retries, restarts, and installed package-content/version changes. This persistence is an intentional coverage trade-off: the operator accepted inability to judge that declared policy for that failure class, not the safety of any package contents. The current failure is reported on every applicable lap. When the policy can be judged, the coverage decision becomes inert and cannot suppress any resulting finding.

Existing minimum-judged-coverage rules remain: waiving every failed rubric does not let a lap that judged nothing pass. A coverage waiver does not make unsupported containment available or launch a reviewer without the required boundary; it can affect only eligible failure evaluation under the existing rules. Other unresolved findings and uncovered failures remain blocking.

### D4 — Use the existing store, matcher, and publication path

Extend the current versioned custom disposition representation and its existing transactional matcher. Do not add another approval store, expiry mechanism, sidecar, or model judgment. Historical built-in records keep their exact matching behavior. Custom record parsers remain self-describing after declaration removal.

Risk acceptance and reduced coverage keep distinct record kinds and matching functions. Current failure diagnostics and operator attribution remain visible through the existing findings view, persisted event spine, and publication renderer. Package-content identity remains mandatory for eligible judged-result caching and for custom finding acceptance; this decision does not relax either cache or judgment validation.

## DECIDE amendments applied after approval

- Add the narrow correction beside the primary ADR's D7 and its D7 amendment in the older cache-identity ADR; preserve their original text.
- Add the custom-declaration extension beside the infrastructure-fault ADR's D7, preserving built-in `{rubric, closed reason}` semantics.
- Replace Story 17's shared policy-identity wording with separate risk and coverage criteria, and explicitly cover a first-use loading failure with no digest, changed declaration/reason, unchanged declaration across package changes, healing, and the no-judgments prohibition. Do not add story amendment notes.
- Re-run conflict-check against the corrected assertions before planning. No BUILD task owns these DECIDE corrections.

## Consequences

An operator can make an honest durable decision about missing coverage even if a policy has never loaded successfully. Such approval does not attest to unknown content and cannot suppress a future judged finding.

The deliberate cost is that a same-declaration, same-reason coverage decision survives a package update. Requiring content-bound reapproval for that failure would reintroduce the unavailable-identity problem. A declaration or reason change still prevents transfer, and every applicable lap exposes the actual current failure.

## Verify-Claims Ledger

- **Verified:** The existing reduced-coverage identity contains rubric and closed reason, and uses a separate record kind from finding acceptance (`build-review-dispositions.ts`, `BuildReviewReducedCoverageIdentity`, `matchesBuildReviewReducedCoverageDisposition`).
- **Verified:** The primary ADR D2/D3 refuses missing or incomplete policy; its cache-identity ADR amendment binds custom dispositions to effective-policy identity. These are the opposing accepted clauses.
- **Inferred, 95%:** A first-use missing policy cannot supply a valid effective bundle digest, so a content-required reduced-coverage binding cannot satisfy the existing operator path without an unstated exception. This follows directly from the agreed loading and identity contracts, not from a claimed runtime reproduction.
- **Operator-approved:** Declaration-and-reason binding for custom reduced coverage, including persistence across package changes, was approved on 2026-09-10. The identity gap is resolved by D1–D4; conflict-check rechecks the amended criteria before planning.
