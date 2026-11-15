# Architecture Review: Reduce mechanical restack resolver cost

**Date:** 2026-11-15
**Inputs reviewed:** Approved technical track and comprehensive Approach A; operator-approved component and recovery diagrams; intake #3632.
**Verdict:** APPROVED

## Feasibility

The existing Git-object replay, durable journal, recorded resolution, configured resolver, and event spine supply the necessary boundaries. No new service, external dependency, or provider-specific capability is required. The feature is not a hotfix.

Verified source basis:
- `restack-replay.ts::replayChildRange` already selects candidates, handles selected bookkeeping conflicts, and constructs commits without moving stack refs.
- `restack-recovery.ts::resumePlanned` skips non-pending children using their staging refs. Re-running every completed child is not current intended behavior.
- `restack-conflict-record.ts::consumeRecordedResolution` checks range identity and parent-tree identity, with narrowly defined halt-record normalization. Similar conflict text is not its authority.
- `restack-executor.ts` and recovery both invoke `checkResolvedTipOwnership`.
- `restack-ownership.ts::checkResolvedTipOwnership` checks changed paths and selected parent reverts; it does not establish arbitrary behavioral equivalence.
- `restack-journal.ts` stores exact rewrite mappings and routed round identity.

Prevention must preserve the existing candidate selection semantics, including originally empty evidence commits and reverts followed by reapplication. Extending bookkeeping resolution from one conflicted path to several is feasible only when every path is individually covered by an explicit existing rule. A mixed conflict must not accidentally authorize a union of its remaining source-code paths.

Reuse should extend the existing durable resolution architecture to accepted automatic results, scoped to the feature and exact replay inputs. The design must distinguish a completed provider invocation from a validated, durably reusable result: a crash before a result is durably recorded may require another invocation. Exactly-once provider execution across that crash window is not promised.

Memory files remain ordinary repository content. No general append-only or commutative meaning has been established for them. Preserve their storage policy and route unsupported conflicts to the configured resolver.

## Complexity

Large: replay, recovery, durable state, validation, and reporting interact. Expected scope is roughly 8–12 implementation tasks, below the 20-task early split threshold; this is a sizing estimate, not a task contract. No delivery slicing has been approved.

## Alignment

Reuse `adr-2026-10-10-stacked-restack-journaled-replay`: off-worktree computation, journaled exact rewrites, expected-ref atomic movement, and post-restack invalidation remain governing boundaries. Existing recorded-resolution rules remain conservative; do not silently broaden their normalization exceptions.

The uncovered structural decision is durable reuse of automatically accepted resolutions across interrupted or subsequently restarted operations, with a shared acceptance boundary used by executor and recovery. It is governed by the operator-approved `adr-2026-11-15-accepted-restack-resolution-reuse`, which complements the existing journaled replay decision.

The selected local pattern is the existing conflict-record/journal pair: Git-backed authoritative state, parsed domain identities, expected-old-value updates, and consumption retired with application. Preserve these traits. Internal extraction into shared helpers is allowed; a separate global cache or replay engine is not.

## Domain Integrity

Represent candidate origin as an exhaustive union: deterministic rule, recorded accepted resolution, or strong resolver. Eligibility outcomes distinguish applicable, inapplicable, invalid evidence, and operational failure. A boolean resolved flag alone is insufficient authority to reuse a candidate.

Parse operation, child, commit, and round identities through existing domain types. Durable acceptance evidence binds the original range, replay parent, candidate tree, rewrite mapping, and rule/validation version. Missing or incompatible evidence is a cache miss or explicit recovery failure, never permission to accept. Preserve separate operator-answer provenance.

## Wiring Surface

- Deterministic rule evaluation extends `replayChildRange` and the conflict handoff used by both executor and recovery. Only named bookkeeping rules qualify; arbitrary source-text union is excluded.
- A shared candidate acceptance boundary is called before executor and recovery persist a newly accepted candidate. It verifies applicable rule or reuse evidence, existing ownership constraints, exact rewrites, and expected input identities.
- Automatic-resolution persistence extends existing Git-backed resolution/journal handling. Executor records accepted results; recovery and subsequent eligible operations consume them; existing feature cleanup owns their retirement.
- Resolver escalation uses the existing configured `RestackResolver` and attempt budget. Rejection of a deterministic candidate escalates once; rejection or exhaustion of strong-resolver work follows the existing bounded failure path, never loops back through shortcuts.
- Resolution outcome events extend `ConductorEvent` through the existing emitter and persister. Existing reporting consumers aggregate per operation and routed round. Provider cost remains sourced from provider-attempt evidence, with correlation added where needed rather than inferred from timestamps.
- Reporting distinguishes conflict units (child and replayed commit), attempted candidates, accepted tier, cache misses, and provider attempts. Resume deduplication uses durable outcome identity. Missing historical cost is unknown, not zero; no hypothetical savings are reported as measured savings.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Apparently mechanical merge changes behavior | Technical | High | High | No generic textual merge shortcut; explicit rule predicates and negative proofs |
| Reuse applies an answer to changed history | Data | Medium | High | Bind full replay context and validation version; conservative invalidation |
| Crash repeats provider work | Integration | Medium | Medium | Persist accepted results before continuing; document pre-persistence limit |
| Reports double-count recovery | Data | Medium | Medium | Stable outcome identity and separate attempt counts |
| Validation cost consumes savings | Performance | Medium | Medium | Rule-specific checks; no aggregate suite per conflict; report actual cost |
| Related work overlaps current design | Knowledge | Medium | Medium | Reconcile #3599 and #3628 before final stories and plan; do not promise their reported historical defects still reproduce |

## ADRs Created

`adr-2026-11-15-accepted-restack-resolution-reuse` — APPROVED after explicit operator acceptance of conditions 1–6 on 2026-11-15.

## Conditions

1. Cheap acceptance means proof by a named deterministic rule or reuse of a previously accepted result under matching inputs. Ownership checks and passing tests alone do not certify arbitrary semantic equivalence.
2. Start with existing bookkeeping semantics, including safe composition across independently eligible conflict paths, and exact-context automatic-result reuse. Generic adjacent-line merging, ambient Git rerere acceptance, blanket memory union, and a small-model tier are excluded.
3. Preserve current memory storage policy. Inspect its conflicts for covered rules, but unsupported cases remain with the strong resolver. Any policy change returns to the operator.
4. A validation or infrastructure failure may stop the operation without implying a human design choice. A wrong shortcut is rejected before stack refs move. This does not promise mathematical detection of every possible semantic error in strong-model output.
5. Accepted durable results survive recovery; provider work completed but not durably accepted can repeat after a crash.
6. Reporting extends the event spine, preserves authoritative state separately, and never invents dollar savings from avoided calls.

## Verify-Claims Ledger

All statements about current code above are verified by source inspection, not runtime reproduction. Historical intake costs and conflict classifications remain unverified tracker evidence. The 8–12 task estimate is inferred and must be revised against the final ADR. Conditions 1–6 were approved by the operator on 2026-11-15; they are design commitments, not claims that the current implementation already satisfies them.

## Blocking Issues

None. Operator approval is recorded. GitHub reads confirmed #3599 remains open and #3628 is closed. This spec covers automatic-resolution reuse from #3599; it preserves the existing approved scheduling design associated with #3628.

## Approved bounded-review refinement

On 2026-11-15 the operator approved validation-error refusal for invalid bookkeeping evidence, with no provider call and no ref movement. Strong-resolver fallback remains for eligible source conflicts. This preserves halt-record exclusion from model resolution and prevents reapplying a rejected mechanical rule in the resolver rebase. ADR D6, Story 3, Task 5 and the diagram state this distinction consistently.
