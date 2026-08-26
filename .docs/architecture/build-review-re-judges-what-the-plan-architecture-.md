# Architecture: One owner per review question

**Last updated:** 2026-08-22
**Scope:** The review gates `build_review`, `prd_audit`, and `architecture_review_as_built`, BUILD
task close, the kickback ledger and remediation append path in `conductor.ts`, and the config
surface for rubrics. Covers jstoup111/ai-conductor#1805. PRD:
`.docs/specs/build-review-re-judges-what-the-plan-architecture-.md`.

All line references are at worktree base `b6289d647`.

## Diagram: ownership today vs after (L3)

```mermaid
graph LR
  subgraph NOW["Today — one question, several judges"]
    S0["build_review · scope<br/>diff ⊆ plan authority"]
    C0["build_review · completeness<br/>diff delivers plan outcomes"]
    R0["build_review · rootCause<br/>mechanism closes defect<br/>(disabled by #1808)"]
    T0["build_review · tautology<br/>revert preflight = verdict"]
    P0["prd_audit · FRs delivered"]
    A0["as-built · ADRs + reachability<br/>M/L only"]
  end
  subgraph AFTER["After — exactly one owner"]
    TC["BUILD task close<br/>Done when: evidenced"]
    TQ["build_review container<br/>test-quality (opt-in, default off)"]
    PA["prd_audit · stories authority<br/>PRD intent as lens · scope-as-intent<br/>PASS / FIXABLE / PLAN_GAP / OVER_SCOPE"]
    AB["as-built · runs always<br/>per-check policy<br/>APPROVED / PLAN_GAP / BLOCKED"]
    DEC["DECIDE /architecture-review<br/>mechanism soundness"]
  end
  S0 -->|"intent question"| PA
  C0 -->|"holistic"| PA
  C0 -->|"per task"| TC
  R0 -->|"design question"| DEC
  R0 -->|"post-code residue"| AB
  T0 -->|"reshaped, scoped"| TQ
  P0 --> PA
  A0 --> AB
  classDef cut fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef keep fill:#e2f0d9,stroke:#2e7d32,color:#0b2e13;
  class S0,C0,R0 cut;
  class TC,TQ,PA,AB,DEC keep;
```

## Diagram: the BUILD → SHIP path after consolidation (L3)

```mermaid
graph TD
  B["build<br/>task close requires Done when: evidence<br/>(new seam — no engine reader of Done when: today)"]
  B -->|"check cannot be made true under plan"| PG1["PLAN_GAP → HALT needs-human<br/>never an appended task"]
  B --> TS["test_suite"] --> BR["build_review container<br/>build-review-registry.ts · config.ts:105-118<br/>only opted-in rubrics dispatch"]
  BR -->|"FAIL: test insensitive"| B
  BR -->|"PASS / no rubric enabled"| MT["manual_test"]
  MT --> PA["prd_audit<br/>runs on any acceptance-criteria change, all tiers"]
  PA -->|"FIXABLE ≤ cap, lap 1"| REM["appendRemediationTasks<br/>conductor.ts:10662 · caller :2756<br/>engine-enforced: criterion id required,<br/>≤5 and ≤25% authored, one lap"]
  REM --> B
  PA -->|"FIXABLE > cap · lap 2 · happy-path PLAN_GAP<br/>user-visible OVER_SCOPE"| H["HALT needs-human<br/>lists every finding"]
  PA -->|"edge PLAN_GAP · harmless OVER_SCOPE"| REC["recorded in verdict + shipped record<br/>(post-ship channel: #1810)"]
  PA -->|"PASS"| AB["architecture_review_as_built<br/>runs always · checks by artifact presence"]
  REC --> AB
  AB -->|"BLOCKED"| H
  AB -->|"PLAN_GAP, outcome undelivered"| H
  AB -->|"PLAN_GAP, criteria pass"| REC2["recorded · ships"]
  AB -->|"APPROVED"| RT["retro → rebase → finish"]
  REC2 --> RT
  KL["kickback-ledger.ts<br/>consumeKickbackBudget conductor.ts:4220<br/>gains: authored / added / remaining per feature"]
  REM -.-> KL
  classDef halt fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef rec fill:#fff4d6,stroke:#b26a00,color:#3d2600;
  class H,PG1 halt;
  class REC,REC2 rec;
```

## Diagram: backward compatibility (L3)

```mermaid
graph LR
  CFG["config.yml build_review.rubrics.scope|completeness|rootCause<br/>config.ts:118"] -->|"accepted, no-op + one-time notice"| OK["run proceeds"]
  CFG2["build_review enabled with no enabled rubric<br/>config.ts:1093 rejects today"] -->|"becomes valid: container empty → PASS"| OK
  OLD["merged plan without Done when:<br/>or carrying rem-* tasks"] -->|"tasks close on prior evidence rule<br/>rem-* count toward authored baseline"| OK
  DISP["persisted dispositions / lap verdicts<br/>from retired rubrics"] -->|"ignored on resume, never rejected"| OK
```

## Legend

- **Red** — retired or halting. Retired rubrics are removed with their code and tests (FR-23); the
  only survivors are the no-op config acceptance and tolerant readers shown in the third diagram.
- **Green** — the single owner of each question after the change.
- **Amber** — a non-blocking finding recorded at ship; consumed later by #1810.
- Verified at base: `config.ts:1093` rejects an all-disabled rubric set, so the empty container is
  a behavior change; `appendRemediationTasks` (`conductor.ts:10662`) is today the only plan
  appender and stays so; no engine module reads `Done when:` (grep over `src/conductor/src/engine`
  is empty), so task-close evidence is a new seam. Inferred: the `remediate` step path at
  `conductor.ts:2756` is where the cap is enforced — confirm in architecture-review.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-22 | Initial generation | DECIDE for #1805 |
| 2026-08-22 | Plan update: named the new seams (covers-marker.ts, as-built-policy.ts, accepted-widenings.ts, growth record in kickback-ledger.ts) and the removed as-built→build route | /plan Task breakdown |
