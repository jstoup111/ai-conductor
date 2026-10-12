# ADR: Source-grounded adversarial plan review as a bounded DECIDE step

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for intake #3038

## Context

Every DECIDE gate reads only `.docs/` artifacts. These include the plan's §7a coverage judge, its
§7b contradiction judge, coherence-check §4a/§4d, and every `landSpec` rung
(`src/conductor/src/engine/engineer/land-spec.ts:198`, verified by reading). None of them reads the
target's real source.

On spec PR #3036 (intake #2941, tier M), all of these gates passed. An operator-requested
adversarial subagent that read the real source then found 2 blocking and 5 significant defects:

- a test that would go red with no task updating it;
- an export with no production caller;
- a config source that is wrong in the daemon;
- a refusal path that wipes state;
- three dependency-order defects;
- a grammar defect.

Fixing them took 4+ unbounded judge rounds, about 1M tokens.

Constraints:

- The repo's Design Principle: machinery for bookkeeping, LLM judgement only where the question is
  one.
- `adr-2026-08-31-coverage-binding-judge-step` was retired by #3164. With the judge enabled, it
  caused 38% of halts, and its refusals gave the operator no lever. Any new judge must be
  hard-bounded and overridable.
- `adr-2026-07-22-coherence-gate-placement-and-validation-split` D3 keeps `land` model-free.
- Consumer repos may not be TypeScript, so analysis must be language-agnostic.

Verified engine seams (read in source):

- `executeProviderCandidates` (`engine/provider-execution.ts:796`) is exported and already runs
  outside the conductor loop (`engine/project-prelude.ts:197-221`).
- All three built-in providers declare `nativeSchema` (`execution/provider-catalog.ts`). Each also
  honours `readOnlyReview`: claude through its read-only policy args, codex through a read-only
  sandbox, pi through read-only tools.
- The composer launcher sets no authoring-provider env var (`engine/engineer-cli.ts:571-577`).
- The daemon halts a DECIDE step that has a completion contract but no artifact and no grant
  (`engine/decide-entry-policy.ts:146-191`).

This step dispatches the reviewer as a provider subprocess. That does not conflict with
`adr-008-agent-hosted-loop-and-in-chat-authoring` D4 ("run the real DECIDE skills in chat"), which governs how artifacts are *authored*:
plan review authors no spec artifact, and the engine writes its review artifact as gate state.

## Options Considered

### Option A: New engine-dispatched `plan_review` step after `coherence_check`, mechanical candidates feeding one adversarial reviewer
- **Pros:**
  - It sees the final plan, after coherence remediations.
  - The reviewer is independent of the author, and is a different provider where possible.
  - Machinery does the bookkeeping and the model does only the judgement.
  - A single owner replaces two judge passes.
- **Cons:** It adds one step, one committed artifact, one land rung and one reviewer brief.

### Option B: Adversarial red-team inside `/plan` (replacing §7b)
- **Pros:** fewer moving parts.
- **Cons:**
  - It runs before coherence-check, so later edits go unreviewed.
  - It runs in the authoring skill, so it is less independent.

### Option C: Mechanical `landSpec` rungs only
- **Pros:** instant, token-free.
- **Cons:**
  - It cannot catch feasibility defects (the wrong config source, the refusal that wipes state).
  - Heuristic false positives would block land with no judgement to filter them.

### Option D: An adversarial review after every DECIDE step
- **Pros:** the operator has seen strong results from this.
- **Cons:**
  - Plan-shaped defects do not exist until the plan does.
  - It costs about 6–10× the tokens.
  - It reviews drafts that later steps rewrite.

## Decision

**Option A.** The decisions below are the citable ids.

1. **A new DECIDE step `plan_review` runs after `coherence_check`, at Medium/Large tier only.** It
   is registered in `ALL_STEPS` with `skippableForTiers: ['S']`, so Small specs are unaffected.
   - The composer reaches it through a new primitive, `ai-conductor compose plan-review --project
     <n> --worktree <path> [--source-ref <ref>]`.
   - Interactive `conduct` reaches it through the step runner.
   - Both entry points call one engine module, so there is a single implementation.

2. **A deterministic candidate builder runs before any model.** It reads the plan text and the
   target worktree's source using path and identifier text search, which works in any language. It
   emits suspect rows for three lenses:
   - **test-impact:** existing test files that reference a task's `**Files likely touched:**`
     paths, or a backticked identifier the task changes, and that no task lists.
   - **reachability:** new exports and primitives named in the plan or in the architecture
     review's `## Wiring Surface` that have no caller in source and none named in any task.
   - **dependency-order:** a task's `Done when` that cites a path or identifier which only a task
     outside its transitive `**Dependencies:**` closure introduces.

   The `**Dependencies:**` parser is promoted out of `validatePlanSlices`' private code into an
   exported dependency-graph function.

   **Candidates are inputs, never findings.** A candidate alone never blocks land; only the
   reviewer's ruling does.

3. **One fresh, read-only, schema-constrained reviewer judges the plan against real source.** It
   is dispatched by the engine, not run in the authoring chat, through `executeProviderCandidates`
   with step `plan_review`, `readOnlyReview: true` and a native output schema.
   - **Inputs:** the stories, every plan task verbatim, the `## Decision` sections of in-scope
     ADRs, the coherence artifact, the candidate rows, and read-only access to the worktree.
   - **What it rules on:** every candidate. It also hunts for **feasibility** defects ("will this
     step work against the real code?") and **contradiction** defects. Contradiction covers static
     contradiction, oscillation, task-vs-task, preserved behaviour and criterion conflict, which
     absorbs plan §7b at M/L and coherence-check §4d.
   - **Brief:** a new shipped skill, `skills/plan-review/`, is the reviewer's instructions,
     following the `prd_audit` precedent.

4. **Reviewer provider is chosen for independence, and the choice never blocks land.**
   - **Selection order:**
     1. `steps.plan_review.llm_provider` when it is configured.
     2. Otherwise, the first configured provider whose id differs from the authoring host.
   - **Authoring host resolution:**
     1. `AI_CONDUCTOR_AUTHORING_PROVIDER`, which `ai-conductor compose` now exports into the
        session it spawns.
     2. Otherwise, the host session markers already in the provider catalog (`CLAUDECODE`;
        `CODEX_THREAD_ID`/`CODEX_SESSION_ID`).
     3. Otherwise, the host is `unknown`.
   - **Fallbacks:** if no other provider is available, or the other provider fails, the review
     runs in a fresh session of the same provider.
   - **Recording:** the artifact records `authoring-host`, `reviewer-provider`, and `independence:
     cross-provider | same-provider | unknown-host`. The operator sees a one-line notice for any
     value other than `cross-provider`.

5. **Findings use one closed schema, validated by the engine.** Each finding carries:
   - `id`;
   - `severity: blocking | significant | advisory`;
   - `lens: test-impact | reachability | dependency-order | feasibility | contradiction`;
   - the artifact path;
   - a reference: `task <id>`, a story id, or `<adr-stem>#D<n>`;
   - evidence;
   - a summary.

   **Evidence rules:**
   - Every finding carries at least one worktree `file:line`.
   - For test-impact and feasibility, that `file:line` is in a source file outside `.docs/`.
   - For reachability, it may be the plan line that introduces the export, since the export does not exist in source yet, together with the source paths searched.
   - For contradiction, the finding also quotes two passages verbatim.
   - For dependency-order, it also cites the related task and its dependency closure.

   **Invalid output:** a finding without the evidence its lens requires is rejected. A response
   that fails the schema counts as a failed dispatch: it falls through the provider chain and is
   not counted as a review round.

6. **Review effort is hard-bounded.**
   - **Round 1** reviews everything.
   - **Round 2** re-checks only two things:
     - whether each prior blocking or significant finding is resolved;
     - the tasks, stories and ADR decisions whose text changed since round 1, identified by the
       per-task digests (`planTaskDigests`).
   - **No third round:** the primitive refuses to dispatch one. "Round" means a counted review
     round. A dispatch whose response fails the schema falls through the provider chain (D5) and is
     not a round.
   - **After the bound:** you resolve each blocking finding that still stands through two
     primitive-recorded operator actions. Nobody hand-edits the artifact.
     - `compose plan-review --accept <finding-id> --reason "<text>"` records that the finding is
       accepted, or is resolved by your own edit.
     - `compose plan-review --acknowledge --reason "<text>"` re-stamps the reviewed digest over the
       current artifacts after edits made once the bound is reached. It dispatches no reviewer.
   - **No findings:** a clean round 1 ends the step with no operator interaction.

7. **The review artifact is committed state, and a model-free land rung enforces it.**
   - **Ownership:** only the primitive writes `.docs/plan-review/<plan-stem>.md`, which is durable
     gate state (event-spine exception C).
   - **Contents:**
     - the round count, provider fields and findings;
     - operator dispositions;
     - the digest of the plan, stories and in-scope ADR set it reviewed.
   - **Integrity:** the primitive also writes an integrity digest over the artifact's own content.
   - **Land rung:** a new `landSpec` rung runs at M/L, after the coherence gate. It refuses land
     when:
     - the artifact is missing or unparseable;
     - the integrity digest does not match the content, which means the file was hand-edited;
     - its reviewed digest differs from the current artifacts, meaning no review round or
       `--acknowledge` covers the current text;
     - any blocking finding is neither resolved by round 2 nor accepted by the operator.

     The refusal names each finding. Land itself never calls a model.

8. **Occurrences ride the existing event spine.** New `ConductorEvent` variants are
   `plan_review_dispatched`, `plan_review_completed` and `plan_review_finding_accepted`. `plan_review_dispatched` carries round, reviewer provider and independence;
   `plan_review_completed` adds finding counts by severity; `plan_review_finding_accepted` carries
   the finding id and reason.
   - **Under `compose`:** they are emitted through the composer's existing emitter
     (`.pipeline/composer-events.jsonl`, the same schema, event-spine exception B).
   - **Under `conduct`:** they go through the step runner's emitter.

   No bespoke log or sidecar is added.

9. **Specs that predate the step are not retroactively halted.**
   - **Daemon, artifact absent:** `plan_review` declares the structural `StepDefinition` field
     `absentArtifactDisposition: 'skipped'`. That field is an amendment to
     `adr-2026-08-03-fail-closed-decide-entry` D1, and it is not a name check. So in daemon mode a
     wholly absent `.docs/plan-review/` artifact fast-forwards the step as skipped, with reason
     `landed-before-plan-review`. Land refuses every new M/L spec without the artifact, so a merged
     spec without one predates the step.
   - **Daemon, artifact present:** the step's completion predicate is satisfied only by a valid
     artifact with no unresolved blocking finding. Anything else halts under that ADR's rule 8.
   - **Interactive `conduct`:** it still runs the step.
   - **Land rung:** it has **no** legacy disengagement. Every M/L land after this feature ships is
     post-step by construction, so a spec authored earlier but landed later must still be
     reviewed.

10. **The duplicated or self-judged contradiction passes are retired at M/L.**
    - Plan §7b (the independent contradiction judge) runs **only at tier S**.
    - Coherence-check drops the §4a paragraph that re-runs the plan §7a coverage judge, and drops
      all of §4d.
    - The plan §7a coverage judge is unchanged.
    - `adr-2026-08-09-adr-contradiction-detection-in-two-halves` D4 is amended to name
      `plan_review` as the late-half LLM judgement in place of coherence-check §4d. Its `adr`-row
      accounting (D3) is unchanged.

## Consequences

### Positive
- The #3036 defect classes surface in DECIDE, carrying `file:line` evidence, before land.
- Review cost is bounded at two reviewer dispatches per spec, down from unbounded judge rounds.
- Independence comes from the provider, not just a fresh context.
- Two LLM passes per M/L spec (§7b and coherence §4d's subagent sweep) are replaced by one.
- Small tier keeps its current behaviour exactly.

### Negative
- One more step, one more artifact and one more land rung to maintain.
- The exhaustive step maps, the model table and the step-enumerating tests all change.
- The grep-level candidate lenses are heuristic. The reviewer filters false positives, so a missed
  candidate depends on the reviewer catching it unprompted.
- Codex's export of its session markers into tool shells is unverified (inferred). If neither the
  env var nor a marker resolves the host, the review runs `unknown-host` and the artifact records
  that. Land still proceeds.
- A legacy spec that bypassed land (for example a hand-merged PR) also skips in the daemon. This
  is accepted: land is the enforcement point.

### Follow-up Actions
- [ ] Consider a Large-only adversarial pass after `architecture_review` (operator note, 2026-10-10)
      as a separate intake if post-coherence review leaves ADR-level rework expensive.
- [ ] Revisit the grep-level lenses if reviewer findings show a recurring missed class.
