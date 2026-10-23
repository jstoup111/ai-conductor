# Components: build_review finding severity and the per-rubric advisory threshold

**Last updated:** 2026-10-19
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#3298. Every built-in and custom
rubric finding carries a required reviewer-assigned severity (critical, major, minor, nit). A
per-rubric `min_severity` lets the effective reducers classify below-threshold findings as advisory
before build_review fails. The adjudicator gains an `advisory` per-source outcome that downgrades a
finding with a rationale. Advisory findings are surfaced on the spine, the CLI and the PR body.
This extends the confidence-floor architecture
(`operator-configurable-confidence-floor-for-acting-.md`) in place and adds no new seam.

## Diagram

```mermaid
graph TD
  subgraph Graders["Rubric judgement (contract changed)"]
    SKILL["skills/build-review-«rubric»/SKILL.md<br/>+ custom rubric contract<br/>severity guidance per concern kind"]
    GRADE["Rubric session<br/>reviewer assigns severity"]
  end

  subgraph Parse["Finding contract (changed)"]
    DOMAIN["build-review-domain.ts<br/>built-in v4 / custom v2<br/>severity required, closed enum"]
    IDENT["build-review-finding-identity.ts<br/>severity excluded, unchanged"]
  end

  subgraph Config["Operator configuration (changed)"]
    CFG["config.ts / resolved-config.ts<br/>rubrics.«id».min_severity<br/>custom_rubrics.«id».min_severity<br/>undeclared = no advisory"]
    FLOORS["build-review-effective.ts<br/>one threshold helper<br/>confidence floor + severity threshold"]
  end

  subgraph Effective["Effective verdict (changed)"]
    RAW["Raw join<br/>unchanged, keeps every finding"]
    REDUCE["built-in and custom reducers<br/>accepted, settled, replication,<br/>suppressed (confidence), advisory (severity),<br/>unresolved; only unresolved blocks"]
    SEAM["build-review-suppression-history.ts<br/>persists suppressed + advisory entries<br/>before the pass/fail fork"]
    PASSQ{"unresolved empty?"}
  end

  subgraph Adjudication["Post-join judgement (outcome added)"]
    COORD["coordinator<br/>live sources minus accepted,<br/>suppressed and advisory"]
    JUDGE["remediate dispatch<br/>may return advisory + rationale"]
    REDUCEADJ["reduceBuildReviewAdjudication<br/>advisory is a finalized non-action"]
    STORE["RemediationCaseStore<br/>cases + suppression/advisory entries"]
    SETTLED{"settled-recurrence predicate<br/>exact id binds a finalized<br/>non-action case?"}
  end

  subgraph Surfaces["Operator surfaces (changed)"]
    OUTER["build_review_outer_verdict<br/>+ advisoryFindings"]
    CLI["build-review findings<br/>JSON + human list advisory"]
    PR["engine-owned PR body region<br/>Advisory build-review findings"]
  end

  SKILL --> GRADE
  GRADE --> DOMAIN
  DOMAIN --> IDENT
  DOMAIN --> RAW
  CFG --> FLOORS
  FLOORS --> REDUCE
  RAW --> REDUCE
  REDUCE --> OUTER
  REDUCE --> SEAM
  SEAM --> STORE
  SEAM --> PASSQ
  PASSQ -->|yes: PASS| PR
  PASSQ -->|no| COORD
  STORE --> SETTLED
  COORD --> SETTLED
  SETTLED -->|no| JUDGE
  JUDGE --> REDUCEADJ
  REDUCEADJ --> STORE
  STORE --> CLI
  STORE --> PR
```

## Legend

- **Severity is reviewer-owned and immutable.** The engine never assigns, defaults or rewrites it, and
  identity excludes it, the same as confidence. Severity and confidence are independent.
- **Classification order.** The reducers check accepted, then settled, then declared replication, then
  the confidence floor (suppressed), then the severity threshold (advisory), then unresolved. A
  finding below both thresholds is recorded as *suppressed*, because it is not established as real.
  *Advisory* means real but below the operator's impact bar.
- **Missing severity is malformed, not silent.** The field is required in both schemas. A result
  without it fails parsing through the existing invalid-field path. A cached v3 or custom v1 result
  is discarded on the contract-version mismatch.
- **Undeclared threshold keeps today's behavior.** With no `min_severity`, the advisory bucket is
  always empty.
- **One threshold helper.** The duplicated built-in-only floor maps in `artifacts.ts` are folded into
  the shared helper, so the custom-rubric and gate-completion paths apply the same thresholds.
- **Adjudicator downgrade stays out of the finding.** `advisory` is a per-source case outcome with a
  rationale. The raw aggregate is never mutated. It is a finalized non-action outcome, so the
  existing settled-recurrence predicate keeps the same exact-id finding advisory on later laps
  without a new dispatch.
- **Never charged.** Threshold-advisory findings never reach the coordinator's live sources.
  Downgraded findings route no BUILD and charge no kickback.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | Authored during DECIDE for jstoup111/ai-conductor#3298 |
