# Components: build_review rubric fan-out and operator dispositions

**Last updated:** 2026-08-13
**Scope:** The proposed `build_review` boundary: four independently configured rubric skills,
one engine-owned evidence snapshot and join, durable per-finding operator dispositions, the
existing event spine, reporting, and publication evidence. Issue #1542.

## Diagram

```mermaid
graph TD
  OP["Feature operator<br/>interactive terminal"]
  CFG["Project config<br/>gate enabled<br/>max parallel default 5<br/>per-rubric enabled plus execution policy"]

  subgraph Catalog["Shipped, provider-agnostic rubric skills"]
    TA["build-review-tautology"]
    SC["build-review-scope"]
    RC["build-review-root-cause"]
    CO["build-review-completeness"]
  end

  subgraph Engine["Conductor engine — deterministic authority"]
    VALIDATE["Config validator<br/>reject enabled gate with zero enabled rubrics"]
    SNAPSHOT["Evidence snapshot assembler<br/>one immutable diff plus approved plan,<br/>test-suite proof, and derived context"]
    PREFLIGHT["Tautology RED preflight<br/>closed selector and patch derivation<br/>isolated merge-base production"]
    PROJECT["Closed rubric projections<br/>versioned permitted inputs<br/>plus canonical digest"]
    COORD["BuildReviewCoordinator<br/>resolve enabled rubric registry"]
    CORE["Shared group core<br/>capped fan-out, default 5<br/>detached session per rubric"]
    POLICY["Provider/model policy resolver<br/>provider, model, effort,<br/>fallback, retry, escalation per rubric"]
    CACHE["Rubric cache resolver<br/>projection plus policy fingerprint<br/>fresh-lap rematerialization"]
    RUNNER["Rubric dispatch adapter<br/>skill policy plus closed projection<br/>strict rubric-result contract"]
    ID["Finding identity canonicalizer<br/>rubric version plus concern kind<br/>plus stable logical anchors"]
    JOIN["Single-writer join<br/>classify pass, findings, skip,<br/>or infrastructure failure"]
    MATCH["Post-judgement resolution reducer<br/>v1 disposition matcher<br/>future typed resolution seam"]
    OUTER["Effective outer verdict<br/>PASS only with at least one judgement and<br/>every non-skipped outcome clean"]
  end

  subgraph State["Feature-scoped durable state — event-spine exception C"]
    BRANCH["Per-lap write-disjoint rubric results<br/>.pipeline/build-review/«lap»/«rubric».json"]
    CURRENT["Authoritative joined verdict<br/>.pipeline/build-review.json<br/>raw plus effective results and lap ID"]
    DISP["Disposition store<br/>.pipeline/build-review-dispositions.json<br/>atomic lock plus replace"]
    RCACHE["Bounded result/evidence cache<br/>.pipeline/build-review/cache/<br/>rubrics plus Tautology preflight"]
  end

  subgraph OperatorCommand["Local operator-only command"]
    INSPECT["Inspect current lap and unresolved findings"]
    AUTH["Acceptance guard<br/>interactive TTY plus machine identity<br/>exact feature, lap, finding, rationale"]
    TXN["Shared state transaction<br/>lock, stale-lap compare,<br/>atomic disposition write"]
  end

  subgraph Spine["One telemetry schema and reader path"]
    BUS["ConductorEventEmitter<br/>rubric, disposition, outer-verdict events"]
    PERSIST["EventPersister"]
    EVENTS[".pipeline/events.jsonl"]
    OPEVENTS["Existing external-process ledger<br/>.pipeline/pipeline-events.jsonl<br/>same ConductorEvent schema"]
    MERGE["Shared feature-event reader<br/>merge ledgers by timestamp"]
  end

  subgraph Consumers["Existing operational consumers"]
    REPORT["Report and KPI renderers<br/>laps-to-pass, rubric failure rate,<br/>skip coverage"]
    UI["Daemon log, dashboard, OTel"]
    PUB["PR and shipped-record projector<br/>accepted ID, rubric, rationale,<br/>operator, acceptance time"]
  end

  CFG --> VALIDATE
  VALIDATE --> COORD
  SNAPSHOT --> PREFLIGHT
  RCACHE --> PREFLIGHT
  PREFLIGHT --> RCACHE
  PREFLIGHT --> PROJECT
  PROJECT --> COORD
  TA --> RUNNER
  SC --> RUNNER
  RC --> RUNNER
  CO --> RUNNER
  WI --> RUNNER
  COORD --> CORE
  POLICY --> CORE
  CORE --> CACHE
  RCACHE --> CACHE
  CACHE -->|miss| RUNNER
  CACHE -->|valid judged hit| BRANCH
  RUNNER --> BRANCH
  RUNNER --> RCACHE
  BRANCH --> ID
  ID --> JOIN
  DISP --> MATCH
  JOIN --> MATCH
  MATCH --> OUTER
  OUTER --> CURRENT

  OP --> INSPECT
  CURRENT --> INSPECT
  INSPECT --> AUTH
  AUTH --> TXN
  CURRENT --> TXN
  TXN --> DISP

  CORE --> BUS
  CACHE --> BUS
  OUTER --> BUS
  BUS --> PERSIST
  PERSIST --> EVENTS
  TXN --> OPEVENTS
  EVENTS --> MERGE
  OPEVENTS --> MERGE
  MERGE --> REPORT
  MERGE --> UI
  DISP --> PUB
  CURRENT --> PUB

  classDef new fill:#dff5e1,stroke:#2f7d3c,stroke-width:2px;
  classDef state fill:#fff3e0,stroke:#ef6c00;
  class TA,SC,RC,CO,WI,PREFLIGHT,PROJECT,COORD,CACHE,RUNNER,ID,MATCH,AUTH,TXN new;
  class BRANCH,CURRENT,DISP,RCACHE,OPEVENTS state;
```

## Boundary decisions

- **Engine owns trust and orchestration.** `build_review` remains one engine-native lifecycle gate.
  The engine alone assembles the immutable input snapshot, selects and caps branches, validates
  results, creates finding IDs, applies dispositions, joins the outer verdict, and routes failures.
  A rubric skill supplies judgement policy only; it cannot choose inputs, accept a risk, or publish
  the gate verdict.
- **Rubric policy moves out of the inline prompt.** The four surviving shipped skills are consumer-facing,
  provider-agnostic policy modules. Their model-table rows provide defaults, while project config
  may independently override provider, model, reasoning effort, fallback order, retry budget, and
  retry escalation for each rubric.
- **One source snapshot, closed projections, write-disjoint branches.** The engine freezes one lap's
  base, HEAD, diff, plan, current `test_suite` proof, and derived evidence, then derives a versioned
  permitted-input projection for each rubric. A skill cannot observe inputs outside its projection.
  Each branch writes only its rubric-and-lap-specific result, and the join is the sole writer of the
  compatibility verdict path.
- **Green proof is reused; Tautology gets only the missing RED experiment.** The upstream
  code-valid `test_suite` PASS prevents a redundant HEAD run. An engine preflight keeps changed
  tests and substitutes merge-base production code in an isolated checkout. It records normal test
  failure as RED evidence and treats setup, execution, or cleanup inability as infrastructure
  failure without modifying either live checkout. A separate exact-input preflight cache avoids
  repeating this deterministic run on unchanged re-dispatches; failures never cache.
- **Semantic results may cache; verdict freshness may not.** Every rubric cache key includes its
  contract/projection versions, projection digest, and resolved execution policy. A valid judged hit
  is stamped into a current-lap branch artifact and rejoined; skips bypass the provider, failures do
  not cache, and no old aggregate verdict can satisfy completion.
- **Raw judgement stays independent of accepted risk.** Rubric sessions never receive the
  disposition store. The join first records raw findings, then matches accepted IDs to compute the
  effective verdict. Reporting can therefore distinguish grader failure rate from operator-accepted
  risk instead of making acceptance look like a grader pass.
- **Future claims compose after raw judgement.** The operator identified separate forthcoming work
  for Tautology/Scope claims or bypasses. This architecture reserves only a typed post-judgement
  resolution seam over stable finding identities. It does not define that work's records,
  authorization, matching, expiry, or effect, and rubric skills and semantic caches never receive
  those inputs.
- **Finding identity excludes prose and locations that naturally drift.** Each rubric skill emits a
  versioned concern kind and stable logical anchors, plus separate human-readable evidence
  locations. The engine canonicalizes and hashes the identity fields; summaries and line numbers
  are excluded. A materially different concern must have a different concern kind or logical
  anchor and therefore remains blocking.
- **Operator acceptance is a guarded transaction.** The CLI requires an interactive terminal,
  resolves the machine-scoped operator identity, requires a non-empty rationale, and binds to the
  exact feature, current lap, and current finding under the same lock used by the join. It refuses
  stale or mismatched requests before mutation. Provider subprocesses are non-interactive and
  cannot cross this boundary.
- **Compatibility is at the join.** Existing consumers keep reading `.pipeline/build-review.json`
  and the public `build_review` gate. Legacy verdicts remain fail-closed and are never inferred to
  carry accepted dispositions.

## Event-spine verdict

```text
Event spine
  Channel?    yes — rubric execution, disposition attempts, and effective verdicts are occurrences
  Concern:    occurrence — operators and metrics need to know what happened and when
  Verdict:    extend the ConductorEvent union; sibling operator ledger uses the same schema and reader
  Exception:  A + B for the separate CLI process and concurrent-writer safety; C for current verdict, disposition, and cache state
```

> **Amended 2026-08-13 by #1542 architecture review:** reuse and generalize the existing
> `.pipeline/pipeline-events.jsonl` external-process ledger instead of adding an operator-specific
> third file. The existing same-schema sibling pattern already satisfies exceptions A and B; its
> writer and readers need generalization, not duplication.

The external-process ledger is not a bespoke audit format. It contains `ConductorEvent` records and
enters the same timestamp-merged reader path as `.pipeline/events.jsonl`. The disposition store,
current verdict, and bounded semantic-result cache are durable state, not reconstructed telemetry;
cache hits themselves are occurrences on the event spine.

## Legend

- **Green** — new judgement-policy or deterministic control boundaries.
- **Orange** — new or evolved durable artifacts; only the sibling operator ledger is an event file,
  and it uses the existing event schema.
- `«lap»` and `«rubric»` are runtime identifiers.
- Dashed trust is intentionally absent: graders do not read disposition state, and the operator
  command does not write grader result files.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Confirmed plan wiring and exact-input preflight cache | Post-plan architecture-diagram/review pass |
| 2026-08-14 | Removed the build-review-wiring skill node; fan-out is four rubric branches | Wiring rubric retired repository-wide by adr-2026-08-14-retire-build-review-wiring-rubric (PR #1577) |
| 2026-08-13 | Reserved a typed post-judgement resolution seam | Account for future Tautology/Scope claims without designing them in #1542 |
| 2026-08-13 | Added isolated Tautology RED preflight and per-rubric semantic-result cache | Reuse upstream green proof and bound repeat token spend |
| 2026-08-13 | Reused the existing external-process event ledger | Architecture review found the approved same-schema sibling pattern already exists |
| 2026-08-13 | Initial proposed architecture | DECIDE phase for issue #1542 |
