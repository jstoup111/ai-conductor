# Components: Verify-Only-Anchored Tautology Exception (#1579, absorbs #1529)

**Last updated:** 2026-08-15
**Scope:** The evidence flow for the fourth closed Tautology exception ("verify-only
maintenance") — plan-task marker parsing (`autoheal.ts` `parsePlanTaskVerifyOnly`), the
build_review input assembly (`build-review-inputs.ts`), the grader prompt rendering
(`build-review-prompt.ts`), and the maker-side authoring boundaries in the `tdd` and
`writing-system-tests` skills.

## Diagram

```mermaid
graph TD
    subgraph Authoring["DECIDE / BUILD authoring contract"]
        PLAN["/plan task block<br/>Verify-only: yes | Type: verification<br/>(DECIDE-time, or maker plan amendment<br/>on first post-finding lap)"]
        TDD["/tdd SKILL.md<br/>NEW boundary: behavior already exists →<br/>no invented RED; mark verify-only<br/>or delete redundant test"]
        WST["/writing-system-tests SKILL.md<br/>NEW: same boundary for<br/>acceptance-spec generation"]
    end

    subgraph Parse["Deterministic engine parse"]
        PVO["parsePlanTaskVerifyOnly<br/>autoheal.ts:638<br/>existing — fail-closed marker parse"]
        PTP["parsePlanTaskPaths<br/>autoheal.ts<br/>existing — per-task declared paths"]
    end

    subgraph Inputs["build-review-inputs.ts"]
        BRI["BuildReviewInputs<br/>NEW: verifyOnlyContext —<br/>task id + plan-declared paths<br/>for each verify-only task"]
        RC["removalContext<br/>deriveBuildReviewRemovals<br/>existing sibling anchor (#1521)"]
    end

    subgraph Prompt["build-review-prompt.ts"]
        BLOCK["NEW evidence block:<br/>Engine-parsed verify-only tasks<br/>(evidence, not exemption)"]
        EXC["Closed exception list<br/>1 rebase repair · 2 removal maintenance<br/>3 fixture relocation · NEW 4 verify-only<br/>maintenance (3-condition per-test predicate)"]
    end

    GRADER["build_review grader session<br/>per-test judgement:<br/>(1) test's changed lines reference a<br/>verify-only task's declared files<br/>(2) no new assertion about<br/>diff-introduced behavior<br/>(3) task appears in engine block"]

    VERDICT[(".pipeline/build-review.json<br/>PASS: exempted + audit entry<br/>FAIL: genuinely tautological tests<br/>(helper assertions, unanchored)")]

    PLAN --> PVO
    PLAN --> PTP
    TDD -.->|"maker follows boundary"| PLAN
    WST -.->|"maker follows boundary"| PLAN
    PVO --> BRI
    PTP --> BRI
    RC --> BLOCK
    BRI --> BLOCK
    BLOCK --> GRADER
    EXC --> GRADER
    GRADER --> VERDICT
```

## Legend

- **NEW** — surfaces added or changed by this feature; everything else exists today.
- Solid arrows: data/evidence flow. Dotted arrows: behavioral contract (skill instructs maker).
- The engine block is *evidence, not exemption* — same doctrine as the #1521 removal anchor:
  the grader still applies a closed per-test predicate; an unanchored pre-diff-passing test
  still FAILs Tautology.
- Deferred (follow-up intake, Approach B): replacing the plan-marker anchor with engine-run
  pre-diff pass/fail evidence per changed test.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-15 | Initial generation | DECIDE phase for #1579 |
