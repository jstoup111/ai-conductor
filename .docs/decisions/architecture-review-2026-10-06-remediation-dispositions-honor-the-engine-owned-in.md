# Architecture Review: Remediation dispositions on an engine-owned contract

**Date:** 2026-10-06
**Source:** jstoup111/ai-conductor#2522
**Track / tier:** technical / L, operator-approved
**Inputs reviewed:** approved track and diagrams; governing ADRs; current source and tests.
**Verdict:** APPROVED WITH CONDITIONS
**Approval:** Operator chose OD-1 to OD-4 and approved this review, including whole-plan
rejection and the three additive ADR amendments, in chat on 2026-10-06. During conflict-check the
operator also approved extending Decision 9 to `agents/remediation-planner.md` and the stated
caller no-plan behaviors in Decision 6.

## Scope and feasibility

The operator selected scope option 3 and approach A: one native output contract for every
`planRemediation` source, with full structural accounting for the typed sources. This review
covers architecture before stories; no stories or plan exist yet.

Verified from current source (reads in this worktree, no project code executed):

- `planRemediation` dispatches `remediate` with a prose `retryReason`. It ignores the step
  result and reads `.pipeline/remediation.json` through the tolerant, mtime-gated
  `readRemediationPlanResult`. Absent, stale, or unparseable output returns `none`; there is no
  retry lane for gap planning.
- `InvokeOptions.nativeSchema` is set per invocation. Claude, Codex and Pi declare the
  capability. The step runner already passes a schema for the PRD-widening `remediationRequest`
  mode, whose coordinator owns the only bounded remediate retry loop today.
- The disposition vocabulary is defined in code. `skills/remediate/SKILL.md` duplicates it and
  contradicts itself on as-built keys (finding id at §2, ADR stem at §4). The engine's
  exact-match check needs the finding id, so following §4 halts the run.
- As-built finding ids are provider-minted strings. Duplicates are not rejected. The pending
  as-built finding map is keyed by that id and survives a BLOCKED re-review, so a later lap that
  reuses an id overwrites an earlier pending record.
- Only the as-built source has a missing/duplicate/unexpected check. PRD-audit admission keys by
  FIXABLE `criterionId` with no completeness check. No `test:` or `stall:` key is computed by the
  engine; those formats exist only in skill prose and acceptance tests that pin it.
- `existing-task` binding resolves through the shared plan-task resolver. Nothing compares the
  bound task with the finding's owning task.
- The build_review case-v1/v2 adjudication also writes `.pipeline/remediation.json` through
  `remediate`, but has its own reader and contract and never enters `planRemediation`.
- #2753 `pendingRepair` settlement is implemented at this base, so the accounting seam is the
  current one; no prerequisite feature is required.

No new runtime dependency, provider flag, or transport is required. No live provider behavior was
tested in this session; BUILD proves both adapters with faithful injected boundaries. All new
state is feature-worktree-local. No server, port, watcher, or daemon channel is added.

## Complexity

Large. The schema is small; the work is preserving meaning across seven `planRemediation` call
sites, the as-built identity change, the fault lane, restart, and the skill. A writer-only change
would leave the prose contract as a competing authority. No production directory is deleted;
obsolete reader code follows the code-removal survivor method.

## Operator decisions

- **OD-1 Fault lane — retry, then caller.** Missing or schema-invalid output, or a rejected
  plan, reruns within `remediate`'s configured retry allowance, each retry in a fresh session.
  On exhaustion a named mechanical fault reaches the caller's existing no-plan handling
  unchanged. A missing native-schema capability, or required input that is missing, unreadable
  or over its limit, halts without retry.
- **OD-2 As-built ids — engine stamps.** The provider no longer supplies a finding id. The engine
  assigns ids unique across the feature's laps and keys pending findings by them. The as-built
  contract version increments; a verdict of the prior version is not authoritative and as-built
  reruns once.
- **OD-3 Owner binding — reject mismatch.** For a typed reference with an owning task, an
  `existing-task` binding must name that owner; otherwise it is a field-specific rejection.
- **OD-4 Case mode — separate path, excluded.** The typed gap plan gets its own engine store.
  The case-v1/v2 and PRD-widening modes are unchanged.
- **OD-5 Refusal references — typed reference, admission keeps completeness.** Chosen by the
  operator in chat on 2026-10-07 during plan authoring, after #3010
  (adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework) landed on main. A
  refusal-rework round's refused decisions are a third structured reference kind (`refusal` plus
  the durable decision id), projected as input. The validator rejects foreign, duplicate, and
  malformed refusal references like any other reference, and rejects a task-less `build` on a
  refusal like any non-stall `build` (Story 4 negative 4), so that case retries and writes the
  refused HALT only on exhaustion (operator-confirmed during coherence-check on 2026-10-07).
  Completeness and non-`build` answers stay with the existing `admitRefusalReworkPlan` admission,
  which keeps #3010's immediate refused HALT for those cases. The skill's `refusal-<decisionId>` gap-id wire prose
  moves into the engine schema; its removal-only rule stays as judgment guidance. Full refusal
  accounting with retry was considered and deferred because it changes #3010's routing.

## Decisions

### 1. One bounded, versioned input projection

Add a remediation projection beside the as-built and PRD-audit projections. It carries:

- the requesting source kind (validation group, PRD audit, as-built, build stall, finish
  verification), unchanged from the existing `source` values;
- the required typed references: PRD-audit FIXABLE criteria (engine `criterionId`, owning task,
  judgment summary) and as-built REMEDIABLE findings (engine-stamped id, governing reference,
  summary), read from the typed verdict stores through their existing readers;
- untyped source evidence by its existing key grammar: build-stall question (`stall:<slug>`) and
  finish test failures (`test:<stem>`);
- plan ownership for referenced tasks (ids, titles, Done-when) from the active plan;
- applicable prior decisions already held in engine state: pending as-built remediation findings
  through the seam's read-only accessor (as-built ADR D7.1), refusal decision bindings
  (adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework), and prior remediation
  laps recorded in the kickback ledger. No new history store (#2440) is introduced;
- the accepted vocabulary rendered from the code constants.

Required structured dimensions have finite named engine constants sized from the corresponding
corpus at BUILD, rounded up and recorded beside the constants. Untyped evidence text follows the
existing as-built per-file and total caps with explicit omission digests for read-only
inspection. Required input is never truncated. Missing, unreadable, or over-limit required input
names the dimension, source, and actual/limit before dispatch. Optional absent history is empty;
present corrupt history is a named fault.

### 2. One static engine schema; the provider returns judgment only

A module-constant JSON Schema defines the plan, and the dispatched shape is rendered from it. The
root is a flat object (Codex strict-mode precedent). Each disposition carries a structured
reference (kind plus id), a disposition from the code vocabulary enum, a halt category from its
enum, rationale, new tasks (`id`, `title`), and bound existing task ids. The unused task `status`
field is dropped.

Per-dispatch enum slots (approach B) are rejected. No current schema is dynamic, duplicates still
need the validator, and the PRD-widening precedent validates free reference strings in the
engine instead. The provider cannot submit an attempt identity, a stamp, an admission result, or
a route.

Gap planning becomes a second `remediationRequest` mode carried on the existing request field.
No new provider option, adapter, or step is added.

### 3. Validation and reference accounting

The engine validates the terminal structured result before any consumer reads it:

- Every required typed reference is answered exactly once. Missing, duplicate, foreign (not in
  the required set), and malformed references are rejected, naming the field and reference.
- An untyped-source reference must match its source's key grammar. Untyped sources get no
  completeness accounting.
- Unknown disposition or category values are rejected naming the value and the accepted set.
- `existing-task` bound ids resolve through the shared plan-task resolver and, for a typed
  reference with an owning task, must name that owner (OD-3).
- `build` requires at least one new task, except for the build-stall source, where an answer in
  `rationale` with no tasks remains valid (daemon-stall ADR D7.1).
- `halt` requires a category.

Any rejection rejects the whole plan. A schema-invalid response is never a partial plan, and
never becomes a BLOCKED, halt, or other substantive judgment. Per-entry
`remediation_disposition_rejected` events keep #2187's diagnostic coverage on the existing event
spine. The provider-supplied halt rationale is still never matched back to a finding.

### 4. Engine-owned persisted plan

Store the validated plan at `.pipeline/remediation-plan.json`, versioned and stamped with the
attempt identity, source kind, and a digest of the required-reference set. Write atomically. A
single reader returns a discriminated present/absent/invalid result, and only a plan carrying the
current attempt identity is authoritative. Gap planning no longer reads or writes
`.pipeline/remediation.json`; the case-v1/v2 mode keeps that file. A prior attempt's plan, or a
legacy prose-authored file, never substitutes for the current dispatch, and its mtime is
irrelevant.

### 5. Downstream rules are unchanged

`planRemediation` receives validated dispositions from the reader and applies the existing
sealed-artifact redirect, admission sets, `existing-task` restage, plan-growth and lap budgets,
operator authority on DECIDE re-entry, pending-repair recording and settlement, and the no-op
guard. Routing does not change. The obsolete reader, its absence renderer, and its tolerant
fallbacks are removed after survivor coverage.

### 6. Fault lane (OD-1)

Add a bounded retry around the gap-plan dispatch inside `planRemediation`, using `remediate`'s
configured retry allowance, following the PRD-widening coordinator loop. Provider
authentication, rate-limit, and model-availability classification precedes the structured-output
fault. Capability and input faults halt through the existing validator-fault halt without retry.
On exhaustion, callers receive a no-plan result carrying the named fault and keep their current
handling. This includes the PRD-audit deterministic fallback and refused-widening HALT, the
validation group's deterministic manual-test kickback, the build-stall halt and auto-park
behavior, and the finish-verification halt. Pending as-built entries recorded before the upgrade
keep their original ids as historical records and never take part in accounting.

### 7. Engine-stamped as-built identity (OD-2)

Remove `id` from the as-built output schema and increment its contract version. At validation and
persist, the engine assigns each finding an id qualified by attempt and ordinal, unique across
the feature's laps. The exact rendering is chosen at BUILD. Pending-finding records, the
prior-findings projection, the rendered report, and the shipped record carry the stamped id. A
prior-version verdict is not authoritative and as-built reruns once through its lifecycle; it is
never converted (as-built review OD-6 precedent).

### 8. Restart and compatibility

Restart keeps today's behavior: re-entering `planRemediation` is a new attempt that dispatches
again. Pending-repair receipts keep charges idempotent, and admission replays reuse their
recorded baselines. No config schema, CLI command, hook, or installed skill target changes.

### 9. Skill boundary and reintroduction guard

`skills/remediate` keeps its judgment guidance:

- the three HALT categories and when to use them;
- the implementation-only routing rule (build versus `architecture_review`);
- the recorded-red exception obligation (adr-2026-08-09 D5);
- the environmental-stall rule, plan-coverage judgment, low-confidence HALT, verify-claims;
- standalone interactive use, which produces a human-readable plan without claiming a managed,
  persisted result.

Remove the gap-plan input-reading recipe, the id rules, the vocabulary table, the output contract,
and the stale plan-append section. Keep the sealed-set prose naming `.docs/decisions/`. Keep the plan-contract and prior-attempt pointer
guidance (#1620) as mode-neutral judgment outside the audited gap-plan sections. Leave the
PRD-widening and case-v1/v2 sections unchanged. Apply the same split to
`agents/remediation-planner.md`, which the skill dispatches and which carries the same output
contract and id table: keep its judgment rules (prefer autonomous remediation, reject
contradictory dispositions, `plan` terminal in daemon runs) and remove the machine contract.

Add a remediate audit to `test/test_provider_skill_contracts.sh`, scoped to the skill's gap-plan
sections and the planner agent, rejecting reintroduced output-format, vocabulary, and input-recipe content. Invert the
prose pins in `remediate-skill-contract.test.ts`. Move the behavior pinned by prose-matching
acceptance tests (id formats, halt categories) to engine validator tests.

### 10. Delivery and test ownership

Use real internal projection, dispatch, validation, persistence and `planRemediation` paths with
fake provider and process boundaries. Cover:

- both adapters, and the unsupported capability;
- input faults before invocation;
- every rejection class and owner mismatch;
- retry exhaustion for each caller's existing handling;
- as-built stamping and the legacy-version rerun;
- restart idempotence.

Existing remediation acceptance tests are survivor evidence that routing, caps, the single
appender, validation-group primacy, and `existing-task` restage are unchanged. Update affected
docs (`docs/reference/artifacts.md` remediate row) in behavior tasks. Aggregate proof is owned by
test_suite.

## Governing ADR alignment and proposed amendments

Amendments only; no new ADR. The structural shapes (engine-owned typed contract, native-schema
seam, single appender) are already governed.

1. `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`:
   - **D1.2:** finding ids are engine-stamped (OD-2), and the contract version increments.
   - **D3.1:** planner accounting is structural (Decision 3), including owner binding for D9
     `existing-task`.
   - D3–D5, D7/D7.1, D8, and D9 restage rules are unchanged.
2. `adr-2026-09-07-durable-prd-widening-decision-reconciliation`:
   - **D6.4:** `remediate` gap planning is the fifth native-schema consumer, as a second
     `remediationRequest` mode.
   - **D7.3:** named bounds for the remediation projection.
   - D5 reconciliation mode is unchanged.
3. `adr-2026-07-10-daemon-stall-remediation`:
   - **D7.1:** the stall-question rule (`stall:<slug>` key, `build` with no tasks and the answer
     in `rationale`) moves from skill prose into the engine schema and validator.
   - D1–D6 are unchanged.

Cited, not amended:

- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`: its scope is SHIP-tail gates;
  D3.2 ("named mechanical failure, never a synthetic substantive finding") is the precedent
  applied.
- `adr-2026-07-05-engine-owned-task-status` and `adr-2026-08-30-shared-plan-task-reference-resolver`
  D4: the `rem-` producer is unchanged.
- `adr-2026-08-09-recorded-red-exception-for-remediation`: D5 prose survives.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: the case contract is
  untouched.
- `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework`: refusal bindings are
  projected as input.
- `adr-2026-07-27-daemon-decide-kickback-halt` D3: preserved.

`architecture-review-2026-08-02-implementation-only-remediation-routing` states that
`remediation.json` keeps its schema under `readRemediationPlan`. That wiring note is superseded by
this review; its classification rule survives as skill guidance.

## Domain integrity

- References are typed (kind plus id) and resolve against independent authoritative sets; there
  are no stringly-typed ADR-stem keys.
- The persisted plan is a discriminated union: present for the current attempt, absent, or
  invalid with named diagnostics. A rejected plan cannot be represented as a usable one.
- Disposition and category are closed enums with exhaustive handling; no default branch routes
  an unknown value.
- Identity is engine-authored: criterion ids, stamped as-built ids, `rem-` task ids, and attempt
  stamps. The provider authors judgment only.

## Wiring surface

| Production surface | Existing caller / consumer | Candidate paths |
| --- | --- | --- |
| Remediation projection builder/renderer | `planRemediation` gap-plan request, before dispatch | new remediation-projection.ts; conductor.ts |
| Plan schema and validator | Step runner `remediationRequest` gap-plan mode; terminal-result validation | new remediation-plan-contract.ts; step-runners.ts; plan-task-parse.ts reused |
| Typed plan store and reader | Step runner persists; `planRemediation` reads | new remediation-plan-store.ts; artifacts.ts (reader removal) |
| Bounded retry and fault mapping | `planRemediation` around dispatch; existing validator-fault halt | conductor.ts |
| As-built id stamping | As-built validation/persist; pending-finding map; projection; shipment association | as-built-contract.ts; as-built-verdict-store.ts; as-built-projection.ts; conductor.ts; kickback-ledger.ts; shipment-association.ts |
| Rejection diagnostics | Existing `remediation_disposition_rejected` event and sinks | types/events.ts (unchanged shape); conductor.ts |
| Skill and planner-agent guidance and guard | Provider-rendered skill invocation and its planner dispatch; integrity audit | skills/remediate/SKILL.md; agents/remediation-planner.md; test/test_provider_skill_contracts.sh |

Paths are rediscovery hints. The plan assigns exactly one integration-proof owner per changed
boundary.

## Overlap scan

The advisory scan over the candidate paths reported overlap on `conductor.ts` with
`origin/spec/daemon-self-host-guardrails` and `origin/spec/self-host-phase6-wiring`. No blocker
was reported. Renames may not be detected.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| A caller's no-plan handling changes while the fault is threaded through | Technical | Medium | High | Per-caller survivor acceptance tests; the fault reuses the existing no-plan result shape |
| As-built id change breaks shipped-record or pending-ledger readers | Data | Medium | High | Inventory every `AsBuiltFinding.id` consumer; legacy-version rerun; ledger round-trip tests |
| Whole-plan rejection increases halts where #2187 routed the valid remainder | Technical | Medium | Medium | Bounded retry first; native enum prevents most unknown values; per-entry diagnostics retained |
| Owner-binding check rejects bindings that previously succeeded legitimately | Technical | Low | Medium | Applies only to typed references with an owning task; field-specific diagnostic names both tasks |
| Skill strip removes judgment guidance an ADR requires | Knowledge | Low | Medium | Audit scoped to gap-plan format sections; recorded-red D5 and routing rule retained explicitly |
| Concurrent conductor.ts changes collide | Integration | Medium | Medium | Re-resolve symbols at BUILD; overlap scan is advisory |

## Implementation conditions

1. Operator approval is recorded above; the three amendments are in this spec diff before BUILD.
2. Stories cover every #2522 outcome, OD-1 to OD-4, and survivor evidence for unchanged routing.
3. The plan covers all seven `planRemediation` call sites and every `AsBuiltFinding.id`
   consumer, with one integration owner per boundary.
4. BUILD removes `readRemediationPlanResult` only after survivor coverage, and keeps tests fake
   at the provider and process boundaries.
5. Aggregate verification is deferred to test_suite.

## Verify-claims ledger

Verified (read in this worktree):

- the remediate dispatch and reader paths;
- the per-invocation `nativeSchema` path and Codex strict-schema handling;
- provider-minted as-built ids and the pending-map key;
- the case-mode separate reader;
- #2753 settlement present;
- the absence of any remediate entry in the provider skill audit.

Inferred:

- the exact as-built id rendering and corpus bounds, which BUILD settles;
- whether Codex strict mode accepts per-dispatch enums, which is moot because approach B is
  rejected.

OD-1 to OD-4 are operator choices, not claims about pre-change behavior. No unconfirmed
load-bearing assumption remains.

Verify-claims verdict: CLEAR.

## ADRs created

None. Three additive amendments, listed above.
