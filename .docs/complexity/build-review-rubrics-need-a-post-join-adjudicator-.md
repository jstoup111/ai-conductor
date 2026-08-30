# Complexity: build_review rubrics need a post-join adjudicator so findings do not compete

Tier: L

## Rationale

- **Judgement contract:** the existing `remediate` capability expands from independently routing
  reported gaps to synthesizing all current rubric findings against prior adjudication outcomes.
  Its result must account for every raw finding as actionable, merged, deferred, or rejected, while
  preserving exact source traceability and emitting one prioritized repair set.
- **Durable state:** prior adjudication outcomes and their later resolution status must survive laps
  and daemon re-dispatch so semantic duplicates do not consume another budget or re-enter BUILD.
  This autonomous history must remain distinct from operator-authored accepted-risk dispositions.
- **State machines:** the feature changes the boundary between rubric settlement, raw aggregate
  publication, `remediate` dispatch, kickback-budget consumption, durable BUILD work-order
  publication, deferred-intake filing, PASS/FAIL publication, and retry exhaustion. It does not
  append plan tasks. A partial or malformed synthesis must never publish PASS.
- **External effect:** a real but out-of-scope finding becomes a GitHub intake through deterministic
  engine machinery after judgement. Retry and idempotency behavior must prevent both silent loss
  and duplicate issues.
- **Observability:** raw rubric results, adjudication lifecycle occurrences, and the effective outer
  verdict remain on the existing `ConductorEvent` spine. Adjudication records are durable gate state,
  not a bespoke telemetry channel.
- **Integration surface:** expected changes span the rubric aggregate/coordinator, `remediate`
  dispatch context and schema validation, persistent control state, kickback accounting, intake
  adapter, event union/sinks, failure rendering, and canonical gate/configuration documentation.
- **Provider behavior:** no second adjudicator is introduced. A failed content join adds one dispatch
  of the existing provider-neutral `remediate` capability, with its normal provider selection,
  retry, escalation, and fresh-session behavior; current `build_review` failure routing does not
  dispatch it.
- **Related ownership:** #2020 retains rubric-catalog expansion and blocking-authority configuration.
  #2060 separately repairs the validation group's post-`remediate` split into per-gate budgets,
  appends, and terminal paths while reusing this feature's fan-in contract.

Not Small or Medium: durable cross-lap judgement state, external deferral effects, and several
fail-closed lifecycle transitions create a multi-boundary correctness problem that requires a full
architecture review, conflict sweep, and coherence proof.

Not larger than L: the design reuses the existing rubric fan-out, raw aggregate, `remediate`
capability, provider execution policy, GitHub intake adapter, event spine, and kickback machinery.
It adds no public lifecycle step or new adjudicator skill.

**Agreement with intake:** jstoup111/ai-conductor#2033 carries `size: L`, which matches this
assessment. Operator confirmed Tier L on 2026-08-29.
