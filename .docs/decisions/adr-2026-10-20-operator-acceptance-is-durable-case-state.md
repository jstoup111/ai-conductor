# ADR: Operator acceptance is durable remediation case state, carried by one reconciler lane

**Date:** 2026-10-20
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#3271 (respec after
revert #3319; includes the outcomes consolidated from #3303)
**Amends:** `adr-2026-08-29-build-review-remediate-case-adjudication` D2, D4, D5, D7, D9;
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5 (including D5.4–D5.7, added by #3292);
`adr-2026-08-13-stable-build-review-finding-dispositions` D2, D4, D6;
`adr-2026-09-10-portable-build-review-policy` D9

## Context

An operator acceptance (`build-review accept`) is an exact disposition on one canonical finding id
(`matchesBuildReviewDisposition`, `build-review-dispositions.ts`). A later lap can raise the same
substance under a new id. This happens routinely for custom rubrics, whose identity includes
per-lap content digests (`adr-2026-09-10-portable-build-review-policy` D7). The `remediate` judge
then binds the new finding to the old case through `existingCaseId`, and the engine does one of
three things:

- An `act` binding to a resolved `act` case halts as `halt-regression`
  (`classifyRemediationCaseReuse`, `remediation-case-reconciler.ts`).
- An `escalate` binding opens a new decision stop or fails with `conflicting-case-id`
  (`persistBuildReviewDecisionStop`, `remediation-case-effects.ts`).
- An `act` binding to an operator-retired case is stripped and re-opened as a fresh case (the
  coordinator's `neverBuilt` strip).

**Baseline: #3292 builds first.** #3292's spec (#3313) landed on `main` on 2026-10-21, and #3271 is
blocked by #3292, so this change builds on top of #3292's
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.4–D5.7:

- an explicit `existingCaseId` rebind with disposition `act` of a resolved action case still halts
  as a regression (D5.6);
- an escalation bound to a resolved case persists a new open decision stop, which halts (D5.7);
- every reader that maps a source across cases reads one authoritative link through
  `currentBuildReviewSourceLinks` (D5.5).

None of those paths recognizes operator acceptance, so the defect survives #3292.

The case store has no notion of operator acceptance. Its strict schema
(`remediation-case-store.ts`, v2, exact-keyed, `{ sourceId, outcome, recordedAt }` links) records
none. On 2026-10-17 this caused at least five `needs-human` halts across two features.

#3303 adds a second symptom of the same gap. `finalize` retires an open case only when every source
is accepted *in the current lap's aggregate*. So a case whose sources were accepted on earlier laps
is never retired. At a clean PASS its failed action effect then blocks durable settlement
(`settleRemediationCasesOnCleanBuildReview`, `conductor.ts`). No operator command can resolve it;
recovery needed a hand edit of `remediation-cases.json`.

The first spec for #3271 (#3308) was reverted (#3319) for two design contradictions, filed as #3318.

1. **The carry rule lived in two places.** A read-time resolver over persisted links "decided"
   carry. The coordinator had to decide it too, before the link existed.
2. **The carry event was emitted after the write.** A crash between the write and the emit lost
   the event for good.

The parked build also showed two more gaps. First, some effective-verdict callers (`step-runners.ts`,
`artifacts.ts`) were not given the child scope and adjudication flag. Second, the coordinator's
current-finding map dropped custom findings.

## Options Considered

### Option A: Acceptance is case state, written once; one lane decides carry
- **Pros:** each rule has exactly one owner and readers consume a persisted fact. It reuses the
  existing settled-source reader, the existing `finalize` retirement point, and the existing
  reconciler lanes (refute, deferral, action retry). It needs no timestamp or lap comparisons
  beyond one guard.
- **Cons:** a case-store schema bump (v2 → v3), and operator-authored fields inside a store that
  was autonomous-only.

### Option B: Read-time resolver over persisted links (the reverted design, repaired)
- **Pros:** nothing new persisted for acceptance; disposition withdrawal is automatic.
- **Cons:** about seven consumers each need dispositions, cases, child scope and lap context. The
  coordinator still needs the answer before persistence, which invites a second implementation.
  The parked build failed on exactly these two problems.

### Option C: Stabilize custom-rubric finding identity
- **Pros:** exact dispositions would keep matching and no carry concept would be needed.
- **Cons:** it contradicts the intentional identity semantics of
  `adr-2026-08-13-stable-build-review-finding-dispositions` D1 and
  `adr-2026-09-10-portable-build-review-policy` D7. It cannot express the judge's equivalence and
  does nothing for #3303.

## Decision

Adopt **Option A**. Each numbered decision names the single component that owns its rule. No other
component may re-implement that rule. Other components consume only its output.

> **Amended 2026-10-23 by #3298:** #3298 adds a case disposition `advisory` and a per-rubric
> `min_severity` threshold. Each change below stays inside the owner named here.
>
> - **Decision 3.** `classifyRemediationCaseReuse` also classifies `advisory` proposals that bind an
>   `existingCaseId`. A carry-eligible bound case yields `carry` before any advisory reduction.
> - **Decision 4.** `finalizedBuildReviewSourceIds` also settles a source whose authoritative link
>   is on an `advisory` case with effect `none`, only while every source rubric's current
>   `min_severity` stays strictly above the case's adjudicated severity. Resolved thresholds become
>   a required parameter. The advisory branch is decided before the generic non-`act` branch, after
>   operator resolution and `carried`.
> - **Decision 5.** An advisory source is not raised: it is outside the live sources, so on a
>   mechanically healthy lap it counts as absent for retirement.
>
> (adr-2026-10-19-build-review-finding-severity-advisory-threshold D4, D6, D7.)

1. **Case store v3 carries operator acceptance as state.** `remediation-case-store.ts` gains
   store version `v3`. v2, like v1 today, stays readable and is upgraded on the next write. The
   strict exact-key parser and `mutate()` re-parse remain the only validation and write seam.
   v3 adds four things:
   - an optional case field `operatorAcceptance: { origins: [{ sourceId, lapId }] }`, where
     `sourceId` is a rubric-namespaced source id and `lapId` is the lap in which the operator
     acceptance was first recorded on this case;
   - an optional case field
     `operatorResolution: { operator, rationale, resolvedAt }`;
   - the source outcome `carried`;
   - an envelope `outbox: [{ eventId, occurredAt, event }]` holding `ConductorEvent` values
     (decision 6).

   Provider output can set none of these. The judgement schema, `validateRemediationCaseGraph` and
   every reconciler lane other than decision 3's carry lane never write them.

2. **`finalize` is the only writer of acceptance origins.** The coordinator's `finalize`
   already runs a leased mutation that retires accepted cases. Inside that same mutation it now
   appends an origin `{ sourceId, lapId: <current lap> }` to a case for every source that meets
   all four conditions:
   - it is linked to that case;
   - it is a current-lap source;
   - it is operator-resolved by an exact disposition (not suppressed, not carried);
   - it has no origin on that case yet.

   This covers open and resolved cases, built-in and custom findings alike. All current sources
   are keyed through `buildReviewAdjudicationSourceId`. Origins are append-only and never removed.
   Retirement itself is decided by decision 5's predicate.

3. **`classifyRemediationCaseReuse` is the only owner of the carry decision.**
   - **Result:** it gains the result `carry`. The coordinator and every partition only route
     according to the value returned.
   - **Inputs:** the bound case record, the current lap id and the set of currently effective
     operator-accepted source ids.
   - **When a case is carry-eligible:** it holds an `operatorResolution`, or all three of the
     following hold:
     - it is `resolved` and holds at least one origin;
     - every origin's disposition is still effective;
     - no origin's `lapId` equals the current lap.
   - **Why "resolved" implements "every source accepted":** an open case can never carry. An open
     case whose every source is covered is retired by decision 5 in the same `finalize` that
     writes its origins. A resolved case's other sources were already closed by a fix or a
     finalized outcome. So a case with an outstanding unaccepted source never carries.
   - **Linking on a reuse halt:** when the result is a reuse halt (`halt-regression` or
     `halt-repeat`) for an explicit binding, the coordinator first links the proposal's live
     sources to the bound case. It does so through the reconciler's existing source-append path,
     with outcome `acted`, and changes nothing else on the case. This is source-trace bookkeeping
     under `adr-2026-08-29-build-review-remediate-case-adjudication` D5, not a carry decision. Its
     purpose is that an operator acceptance of the halting finding is recorded on that case by
     decision 2.
   - **Which proposals:** the classification applies to every proposed disposition (`act`,
     `defer`, `reject`, `refute`, `escalate`) that binds an `existingCaseId`.
   - **Order:** it runs before the `neverBuilt` strip, the reuse halts (including the D5.6
     explicit-rebind regression halt), the escalation split, decision-stop persistence (D5.7) and
     action authorization.
   - **Resolved rows:** D5.4 leaves a resolved row untouched when a new case links its source. This
     change adds exactly three writers that may change a resolved row: `finalize` origins
     (decision 2), the carry lane, and reuse-halt linking. No other path rewrites one.
   - **The carry lane:** a `carry` proposal is reconciled by one reconciler lane. In one
     `mutate()` that lane appends each new live source with outcome `carried` and one outbox
     entry per newly appended link. It leaves the case's disposition, resolution, effect and
     earlier links unchanged.
   - **Effects:** a carried proposal reserves no effect, publishes no work order, opens no
     decision stop, files no intake and charges no kickback. It does not deny sibling actions.

4. **`finalizedBuildReviewSourceIds` is the only reader path for carry.** It counts a source as
   settled when its authoritative link (D5.5, `currentBuildReviewSourceLinks`) is `carried`. That removes the source from the live set by exact id
   (`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.1), and the
   effective verdict treats it as resolved.
   - **Shared resolver:** the effective verdict, its settled-id read, the CLI and settlement all
     reach carry only through this function.
   - **Required parameters:** the effective-verdict resolver (`resolveEffectiveBuildReviewVerdict`
     in `build-review-effective.ts`) makes `child` and `adjudicationEnabled` required. Every
     caller must pass them, so a missing caller fails to compile. That covers `conductor.ts` (3
     sites), `step-runners.ts` (2) and `artifacts.ts` (2). `build-review-cli.ts` does not call the
     resolver; it passes `finalizedBuildReviewSourceIds` to `deriveComposedBuildReviewEffectiveVerdict`
     directly.
   - **What it reads:** the child-scoped case store, and only when adjudication is enabled.
   - **Judge context:** the adjudication context projects
     `operatorAccepted: { originSourceIds, originLapIds }` on each carry-eligible prior case. It
     carries no operator name and no rationale.

5. **One settlement predicate decides operator and absence retirement.** Today the reconciler
   has an open-case absence-resolution condition (`remediation-case-reconciler.ts`) and `finalize`
   has its own acceptance-retirement condition. They become one exported reconciler function, and
   three places call it: reconciler absence resolution, `finalize` acceptance retirement, and
   `settleRemediationCasesOnCleanBuildReview`. No other component judges open-case retirement. It
   extends today's absence rule in two ways:
   - **Accepted counts as covered.** A source that is accepted in the current lap, carries an
     origin, or is `carried` counts as covered whether or not it is still raised.
   - **Failed and unbuilt actions can retire.** An `act` case whose action effect is `failed` or
     `reserved` retires when every source is covered or, on a mechanically healthy lap, not
     raised. Today such cases are excluded.
   - **Mechanically healthy, for absence.** A lap is mechanically healthy for absence retirement
     only when no current built-in or custom rubric had an infrastructure failure or an
     incomplete scope in that lap. A reduced-coverage decision does not make a lap healthy for
     absence: it lets the lap route past the fault (`adr-2026-08-29-build-review-remediate-case-adjudication`
     D3.3), but a rubric that did not judge is no evidence that its findings are gone. Only the
     current lap counts; reduced-coverage records from earlier laps play no part. This is a
     separate input from the lap's `mechanical` routing value (`healthy` / `retry` / `halt`),
     which keeps its existing meaning. One helper computes it, and every retirement caller uses
     that helper.
   - **On retirement:** the case becomes `resolved`. A `reserved` effect becomes `failed` with a
     diagnostic naming the reason. Every link and earlier effect state is kept.
   - **Still blocks:** a failed action case whose source is still raised and unaccepted. A failed
     deferral or an open decision stop still blocks a clean PASS
     (`adr-2026-08-29-build-review-remediate-case-adjudication` D6 never drops a deferral
     silently).

6. **Every occurrence this feature adds goes through the case-store outbox.** The outbox entry
   is written in the same `mutate()` as the state change that causes it. That covers three
   occurrences:
   - each carried link: a new event, `build_review_acceptance_carried`;
   - each operator resolution: a new event, `remediation_case_operator_resolved`;
   - each retirement under decision 5: the existing `remediation_case_reconciled`, with an
     additive optional `eventId`.

   **One drain function** emits the head entry with `emitOrThrow`, then removes it by `mutate()`,
   and repeats. The engine calls it at coordinator entry before any exit, after each mutation
   that adds entries, and at clean-PASS settlement entry and exit.

   **Dedup:** these event types join the event persister's eventId dedup set, beside the routing
   occurrences.

   **Crash safety:** a crash after the write and before the emit is delivered by the next drain. A
   crash after the persist and before the removal is reported `duplicate`. So exactly one line
   per `eventId` reaches `.pipeline/events.jsonl`. This is the routing outbox pattern
   (`drainOutbox`, `route-record-store.ts`) applied to the file-backed case store.

7. **`build-review resolve-case` is the one operator command that writes case state.**
   - **Command:**
     `ai-conductor build-review resolve-case --feature <slug> [--child <child>] --case <id> --rationale "<text>"`.
   - **Gating:** it is pre-boot and local, and has the same interactive-TTY and machine-identity
     gate as `accept` (`adr-2026-08-13-stable-build-review-finding-dispositions` D4).
   - **Write:** under the case-store lease it resolves any open case. It records
     `operatorResolution`, retires a `reserved` effect as `failed`, keeps every link and the
     effect history, and writes one outbox entry.
   - **Refusals:** an unknown case, an already resolved case, an empty rationale, a
     non-interactive session, an unresolved identity, and a feature mismatch. Each refusal leaves
     the store unchanged.
   - **Delivery:** the command does not append to an event ledger. The engine drains its outbox
     entry at the next pass, using the occurrence time the command stamped. The command prints the
     resolution, and `findings` shows any pending outbox entry.
   - **Carry:** an operator-resolved case is carry-eligible under decision 3.
   - **Halt text:** clean-PASS settlement halts name the exact command for the blocking case,
     including `--child` when the case store is child-scoped.

8. **Carried and operator-resolved state is visible, local detail stays local.**
   - **`build-review findings`** (text and `--json`) lists each carried source with its case,
     origin source ids, origin laps, and the origin dispositions' operators and rationales. It
     also lists each operator-resolved case with its operator, rationale and time.
   - **PR and shipped-record accepted-risk renderer** lists carried findings (finding id, rubric,
     carried-from origin id and lap) and operator-resolved cases (case id and source ids). Per
     #1614 it shows no operator, rationale, summary or time.
   - **Unreadable case store:** publication still renders every direct row, fabricates no carried
     row, and reports the unreadable state.
   - **`skills/remediate/SKILL.md`** may bind a same-substance finding to a case marked
     `operatorAccepted`, and still never asserts or creates acceptance.

9. **Scope boundaries.** An acceptance carries only within its feature and its child case store;
   the disposition store stays feature-scoped. Carry is never decided by mechanical matching: an
   unbound look-alike finding routes exactly as today. An origin disposition that is later
   invalidated stops new carry admission (decision 3) but does not revoke links already carried.
   A contract-version invalidation re-keys every finding id, so those exact ids cannot recur.

## Event-Spine Verdict

```text
Event spine
  Channel?    yes — carry, operator resolution and settlement retirement are occurrences
  Concern:    occurrence for the three events; durable state for marks, resolution and outbox
  Verdict:    extend the union; the outbox holds ConductorEvent values drained onto the spine
  Exception:  C for the case-store fields and outbox (authority state under lease, read by name)
```

The outbox has no second schema or reader. It carries `ConductorEvent` values and its only consumer
is the drain, which emits on the existing bus to the existing persister.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `EventPersister.persistDurably` drops a repeated `eventId` for types in its dedup set, and `ConductorEventEmitter.emitOrThrow` awaits the persister handler and surfaces its failure | verified | 95% | yes | The drain could lose or duplicate an event; the outbox would need its own ack | — |
| A2 | The case store's only write seam is `mutate()` with a strict re-parse, and v1 is already read and upgraded to v2 on write | verified | 97% | yes | A v3 migration would need a separate upgrade path | — |
| A3 | `finalize` retires only cases whose every source is accepted in the current lap's sources, which explains the #3303 halt | verified | 95% | yes | Decision 5 would not resolve the #3303 shape | — |
| A4 | Every production caller of the effective-verdict resolver has its child scope and the adjudication flag in reach | verified | 90% | yes | Some callers would need plumbing before they could pass the required parameters | — |
| A5 | Operator-resolved cases should carry later bindings, and a case with any unaccepted source should never carry | unverified | 90% | yes | Too broad: silent suppression. Too narrow: halt loops | APPROVED by operator 2026-10-20 |
| A6 | Leaving already-carried links settled after an origin disposition is invalidated is acceptable, because invalidation re-keys finding ids | inferred | 85% | yes | A stale carry could hide a re-keyed recurrence | APPROVED by operator 2026-10-20 |
| A7 | A failed or reserved action case whose sources are all accepted or absent in a mechanically healthy lap (decision 5: no current built-in or custom rubric failed or was scope-incomplete in that lap, reduced coverage notwithstanding) is safe to retire | inferred | 85% | yes | A real defect hidden by a failed effect could be dropped | APPROVED by operator 2026-10-20 |
| A8 | #3292's build (D5.4–D5.7, `currentBuildReviewSourceLinks`) merges before this feature builds, enforced by the native edge "#3271 blocked by #3292", which the daemon's blocker resolver honors while #3292 is open | verified | 90% | yes | This plan would target seams that do not exist yet, and #3292's build would have to reconcile against this code | APPROVED by operator 2026-10-21 |

## Consequences

### Positive
- The carry rule, the acceptance-origin write, the settlement predicate and event delivery each
  have exactly one owner. The two #3319 contradictions cannot be expressed.
- Every reader of carry already reads `finalizedBuildReviewSourceIds`. Required resolver
  parameters make a missing caller fail to compile instead of misbehaving at SHIP.
- #3303's hand-edit recovery is replaced by an automatic retirement and a supported command.

### Negative
- A durable schema bump. A v3 store cannot be read by an engine predating this change, so
  rolling the engine back after a write needs a manual store downgrade.
- The case store gains its first operator-authored field (`operatorResolution`), so the
  autonomous/operator separation now holds per field rather than per file.
- Events from `resolve-case` are delayed until the next engine pass.

### Follow-up Actions
- [ ] #3294 (spec PR #3312) reconciles against this ADR after it lands; it is blocked by #3271
      and #3292. #3292 (spec #3313, on `main`) is the baseline (A8): the 2026-10-21 edge flip made
      #3271 blocked by #3292.
- [ ] #3318 tracks plan review catching two-owner rules and persist-then-emit without crash coverage.
