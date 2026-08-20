# Architecture: Closing the build_review finding-identity vocabulary

**Last updated:** 2026-08-16
**Scope:** The `build_review` result contract and disposition-resolution path —
`build-review-domain.ts`, `build-review-finding-identity.ts`, `build-review-dispositions.ts`,
`build-review-aggregate.ts`'s effective reducers, the four `skills/build-review-*/SKILL.md` result
contracts, and the daemon `build_review` FAIL block in `conductor.ts`. Covers both surfaces filed
as jstoup111/ai-conductor#1611.
All line references are at worktree base `cab8df856`.

## Diagram: where identity drifts today (L3)

```mermaid
graph TD
  subgraph GRADER["Rubric grader — one auxiliary session"]
    SKILL["skills/build-review-*/SKILL.md<br/>'an enumerated concern kind'<br/>ENUMERATES NOTHING"]
    SHAPE["renderBuildReviewJudgedResultShape :206<br/>emits concernKind: &quot;&lt;string&gt;&quot;"]
    OUT["judged result JSON"]
  end

  subgraph PARSE["Trust boundary — build-review-domain.ts"]
    PF["parseFindings :131<br/>nonEmptyString(concernKind) only"]
    PA["parseAnchor :108<br/>every field nonEmptyString"]
  end

  subgraph ID["Identity — build-review-finding-identity.ts"]
    CANON["canonicalize :85<br/>sha256(rubric + contractVersion<br/>+ concernKind + anchor)"]
  end

  subgraph MATCH["Durable state — build-review-dispositions.ts"]
    M["matchesBuildReviewDisposition :154<br/>exact id AND exact canonicalJson"]
    S[".pipeline/build-review-dispositions.json"]
  end

  SKILL --> OUT
  SHAPE --> OUT
  OUT --> PF --> PA --> CANON --> M
  S --> M
  M -->|"lap N: out-of-plan-test-change ✓ binds"| OK["acceptance holds"]
  M -->|"lap N+1: out-of-plan-change ✗"| MISS["new id — acceptance voided<br/>lap fails on accepted substance"]

  classDef defect fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef ok fill:#e2f0d9,stroke:#2e7d32,color:#0b2e13;
  class SKILL,SHAPE,PF,PA,MISS defect;
  class OK ok;
```

## Legend

- **Red** — the unimplemented half of `adr-2026-08-13`. Free text is admitted at the skill contract,
  at the emitted schema, and at the parser, so it reaches the hash and the id moves whenever the
  grader re-words. `matchesBuildReviewDisposition` is not the defect; it is correct, and the ADR
  requires it to stay exact.

## Diagram: identity inputs, before and after

```mermaid
graph LR
  subgraph BEFORE["contract v1 — today"]
    B1["concernKind: free string"]
    B2["scope: path + relation(free)"]
    B3["tautology: changedTest +<br/>exercisedBehavior(free) + violationKind(free)"]
    B4["rootCause: statedDefect(free) +<br/>locus + relation(free)"]
    B5["completeness: planTask + missingOutcome(free)"]
  end

  subgraph AFTER["contract v2 — target"]
    A1["concernKind: CLOSED VOCABULARY per rubric"]
    A2["scope: path(verified) + relation(CLOSED)"]
    A3["tautology: changedTest(verified) + violationKind(CLOSED)<br/>exercisedBehavior → report only"]
    A4["rootCause: locus(verified) + relation(CLOSED)<br/>statedDefect → report only"]
    A5["completeness: planTask(verified) + missingKind(CLOSED)<br/>missingOutcome → report only"]
  end

  B1 --> A1
  B2 --> A2
  B3 --> A3
  B4 --> A4
  B5 --> A5

  classDef defect fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef target fill:#e2f0d9,stroke:#2e7d32,color:#0b2e13;
  class B1,B2,B3,B4,B5 defect;
  class A1,A2,A3,A4,A5 target;
```

Every surviving identity input is either a **closed vocabulary member** or a **reference the engine
can verify against the immutable snapshot**. Neither can be re-worded, so the id is stable by
construction rather than by grader discipline. Prose that identifies a subject in human terms moves
to the report, joining `summary` and `evidenceLocations`, which the ADR already excludes.

Completeness gains a verified missing-surface reference alongside `planTask`. Without it, identity
would reduce to `{rubric, version, missingKind, planTask}` and two genuinely different missing
deliverables under one plan task would collapse to one id — outcome 2 violated by the very change
that serves outcome 1.

**Normalization runs before validation.** An emitted value is lowercased and has `_` folded to `-`,
then checked for membership. Measured over `.daemon/evals-raw`, that folds 82 raw distinct
`concernKind` values to 70 — 12 pairs such as `missing_deliverable`/`missing-deliverable` and
`out-of-plan-change`/`out_of_plan_change` are one concept in two spellings, and become hits rather
than rejections. The guard: normalization may map to at most one member of a set, asserted by test,
so it can never resolve ambiguously at runtime.

## Why this does not become blanket path immunity

Desired outcome 2 requires that genuinely different findings at the same paths still surface. The
classification member is what preserves that:

| Two findings on the same `path` | v1 today | structural-only (rejected) | v2 target |
|---|---|---|---|
| Same substance, re-worded | different ids — **acceptance voided** | same id | same id — acceptance holds |
| Different substance, same path | different ids | **same id — both accepted at once** | different ids — second surfaces |

The rejected structural-only hypothesis collapses the bottom row; dropping only the *prose* while
keeping the *classification* collapses neither.

## Diagram: routing-time re-resolution (surface 2)

```mermaid
graph TD
  FAIL["raw FAIL detected :7440"]
  HOIST["NEW: one pure predicate<br/>consulted ADJACENT to each exit below"]
  MIRAGE["scope-FAIL stale-mirage HALT :7479"]
  ESC["kickback no-op escalation HALT :7519"]
  BUDGET["consumeKickbackBudget :7534"]
  CUM["cumulative-cap HALT :7536"]
  REM["/remediate refusal HALT :7585<br/>the issue's second surface"]
  G["#1605 race guard :7618"]
  CAP["per-gate cap HALT :7669"]

  FAIL --> HOIST --> MIRAGE --> ESC --> BUDGET --> CUM --> REM --> G --> CAP

  classDef target fill:#e2f0d9,stroke:#2e7d32,color:#0b2e13;
  classDef defect fill:#fde2e2,stroke:#b60205,color:#3d0000;
  class HOIST target;
  class MIRAGE,ESC,BUDGET,CUM,REM,CAP defect;
```

Today only `#1605 race guard` reads effective state; everything upstream of it decides on the raw
aggregate, including four terminal HALTs and the budget consumption.

**Why a predicate at each exit rather than one resolution at the top.**
`adr-2026-07-12-judged-attribution-verdict-persistence` fixed this exact defect class by moving the
read *later, adjacent to the decision*, and `adr-2026-07-13-park-all-dispatch-paths` demoted its early
check to "a cheap early filter … no longer the last word". A single top-of-block resolution makes the
early read the only read across exits that mutate in between — `consumeKickbackBudget` mutates and the
`/remediate` planner takes minutes — reopening one level up the very window #1605 was written to
close. The exit set is derived by grep at implementation time, not from the six drawn here.

**Ordering constraint.** `adr-2026-07-27-daemon-decide-kickback-halt` fixes cap-first ordering so a
run that trips a cap reports the ping-pong reason rather than having it masked by a later one. The
hoist therefore computes the effective verdict early but must not *reorder* the cap checks
themselves; it supplies each existing exit with better input in place. `adr-2026-08-12`'s
"incremented on every kickback consumed" is satisfied because a lap resolved to effective PASS
consumes no kickback at all.

**Prior art.** `adr-2026-07-12-judged-attribution-verdict-persistence` is the same bug and the same
fix — a stale pre-computed completion snapshot read after new state had been written, repaired by
recomputing before the decision rather than by patching each consumer.

## Failure posture

| Condition | Outcome |
|---|---|
| Grader emits an out-of-vocabulary `concernKind` or classification | Contract violation → #1605's bounded repair turn → if repair fails, `invalid-provider-result` infrastructure failure, which **blocks** and surfaces a bounded raw excerpt |
| Disposition recorded under contract `v1` | Does not bind a `v2` identity — as `adr-2026-08-13` requires — and is **reported** as version-invalidated, never silently ignored |
| Disposition store unreadable | Unchanged: a failed review, not an implicit absence of accepted findings |

Nothing in this design can suppress a finding. Every failure mode resolves toward the finding
remaining blocking and visible.
