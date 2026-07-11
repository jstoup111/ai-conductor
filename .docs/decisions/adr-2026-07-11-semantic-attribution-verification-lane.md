# ADR: Semantic attribution verification lane at the build evidence gate

**Date:** 2026-07-11
**Status:** APPROVED (operator, 2026-07-11)
**Deciders:** James Stoup (operator), engineer session for intake #520

## Context

The build evidence gate derives per-task completion exclusively from provenance proxies —
`Task:` trailers, `Evidence: satisfied-by` citations, and path corroboration
(`engine/autoheal.ts` `deriveCompletion`, sidecar `.pipeline/task-evidence.json`,
consumed by `artifacts.ts` `CUSTOM_COMPLETION_PREDICATES.build`). Six proxy-escape
cycles between 2026-07-07 and 2026-07-11 (#417, #485, #477/#494, #505/#509, #501,
mono-dispatch bundling #519/#520) each stranded a build whose **work was real** but whose
provenance metadata was absent, wrong, or bundled. Every incident was resolved the same
way: an operator read the task definitions, read the candidate diffs, ran tests, judged
the match, and hand-recorded evidence stamps (~10 manual passes; recipe in
`docs/runbooks/evidence-backfill-recovery.md`). Attribution is the only gate in the
harness with no agent-judge lane (`build_review`, `prd_audit`,
`architecture_review_as_built` all have one).

Constraints (all verified against main @ `7138f0f4`):
- **Evidence gate is the sole completion authority** — hooks and judges add feedback,
  never a second completion currency (adr-2026-07-09-deterministic-evidence-attribution-
  enforcement, Decision 3; reaffirmed by adr-2026-07-10-inline-work-attribution-enforcement).
- **Abstain, never misstamp** — a wrong stamp is worse than no stamp.
- **Deterministic-first** (CLAUDE.md): LLM only where judgement is genuine. Attribution
  *residue* — "which task does this real diff satisfy?" — is exactly the judgement the
  manual repairs performed; the fast lane stays mechanical.
- `build_review` precedent: engine-embedded fresh-context judge (fresh uuid session,
  `invokeWithLadder`, input-starved, fail-closed JSON verdict) is an accepted pattern
  (adr-2026-07-07-build-review-judgement-gate).

## Options Considered

### Option A: Two-lane — mechanical fast lane + engine-embedded verifier on gate residue
- **Pros:** judgement runs exactly where the operator repairs happen today (gate-red,
  upstream of `build_review`); gate authority invariant untouched (verifier output is
  ordinary sidecar currency); mechanical lane stays cheap and primary; input starvation
  is enforced by the engine, not promised by a prompt; no skill-symlink install hazard
  (#153/#160 class).
- **Cons:** a per-residue opus dispatch adds cost and latency to red tries; grader
  variance becomes part of gate behavior (bounded, as with build_review).

### Option B: Fold attribution judgement into `build_review`
- **Pros:** one judge, no new dispatch machinery.
- **Cons:** structurally unsound — `build_review` runs strictly *after* the build gate
  passes; a red gate parks the build before build_review is ever dispatched. Fixing the
  ordering moves completion authority downstream into a grader verdict, violating the
  sole-authority invariant, and conflates two rubrics (diff honesty vs task attribution)
  in one PASS/FAIL signal.

### Option C: Deterministic-deeper — per-task scoped tests + path corroboration as completion currency, no LLM
- **Pros:** maximal deterministic-first compliance; zero judge cost.
- **Cons:** the plan's Files:/test mappings are themselves proxies (#445 showed the
  inheritance failure mode); cannot split a bundled diff across tasks; cannot measure its
  own accuracy; blind to doc/config tasks with no test surface. It would be the seventh
  proxy, not a fix.

### Substrate sub-decision: engine-embedded prompt vs new skill
A skill (`STEP_PROMPTS` pattern like `/prd-audit`) was rejected: skill sessions load
project context (input starvation becomes prompt discipline — the failure mode this
harness explicitly distrusts) and new skills are dead until `bin/install` re-links
(daemon-HALT incident class, PR #153/#160). The verifier ships inside the engine like
`build-review-prompt.ts`.

## Decision

**Option A.** Add a semantic verification lane to the build gate, engine-embedded:

1. **Trigger:** after `deriveCompletion` + `applyDerivedCompletion` on a build gate
   evaluation, if unresolved tasks remain (residue), the cutover flag is active, and the
   residue state is new (see memoization below), the engine dispatches the attribution
   verifier. The lane never runs when the gate is green, when enforcement is inactive,
   or when `detectZeroWorkProduct` fired for the try (nothing new to judge).
2. **Memoization:** verdict requests are keyed by `(HEAD sha, sorted residue ids)`. An
   unchanged key never re-dispatches — a retry that produced no new commits reuses the
   prior verdict (or its abstention) at zero cost.
3. **Dispatch:** `runBuildReview` pattern — fresh uuid session, `resume: false`,
   `invokeWithLadder`, model/effort from `resolvedConfigFor('attribution_verify')`
   (opus/high; see the CLI-and-cutover ADR for the model-table entry). The engine
   assembles the verifier's entire input: residue task definitions (verbatim plan
   sections), candidate commits (`sha`, subject, full diff) not already cited by any
   stamp, the plan's declared Files:/test lines for those tasks, and instructions to run
   scoped tests itself. The session receives **nothing else** — no task-status narrative,
   no maker transcript, no prior verdicts.
4. **Verdict:** the verifier writes `.pipeline/attribution-verdict.json` (shape:
   adr-2026-07-11-attribution-verdict-interface). Parsing is fail-closed: unparseable,
   schema-invalid, or missing files are treated as abstention for every residue task.
5. **Engine-side validation (the no-whitewash gate):** for each `satisfied` task verdict
   the ENGINE mechanically verifies, before writing any stamp:
   - every cited SHA exists and is reachable from the branch head (`git merge-base
     --is-ancestor`), is not an empty commit, and is not an engine bookkeeping commit;
   - the union of cited diffs is non-empty and, when the task declares paths, overlaps
     them under the existing `fileMatchesPlanPath` segment-anchored rule;
   - the verdict carries test evidence (command + exit 0) for the task, as reported by
     the verifier's own execution. (Engine re-execution of per-task tests is deferred
     until per-task test mapping (#245) merges — recorded as a residual risk.)
   Any check failing ⇒ **no stamp for that task, ever** — the task stays unresolved and
   the existing retry/auto-park ladder proceeds unchanged. Genuinely unimplemented work
   is refused by construction: there is no SHA whose diff satisfies it.
6. **Stamping:** validated verdicts are written by the ENGINE (the verifier session has
   no write path to the sidecar) as evidence stamps with the new form
   `semantic-verified` (adr-2026-07-11-attribution-verdict-interface §stamp). The gate
   then re-evaluates; judged stamps count as `resolvedTasksAfter` progress, so the
   durable `noEvidenceAttempts` counter resets via the existing progress branch
   (`conductor.ts` Task-12 block — verified: the counter is progress-keyed, no surgery
   needed).
7. **Split attribution:** the verdict is per-task; several tasks may cite the same SHA
   (mono-dispatch bundle case). The validator accepts overlapping citations.
7b. **Id normalization (the #501 lesson):** every task-id comparison inside the lane —
   residue ids, verdict `taskId`s, memo keys, stamp keys — normalizes both sides via
   `String()` before comparing, so numeric ids from agent-authored files can never
   silently fail a match in this lane.
8. **Retry hints:** `unsatisfied` verdicts (task genuinely not implemented) are fed into
   `pendingRetryHints` so the next build try names exactly the missing tasks.
9. **Mechanical-lane growth freeze (operator-approved policy, 2026-07-11):** with the
   judged lane in place, the mechanical attribution lane is CAPPED at its current
   footprint. A future proxy-escape shape is handled as judge residue — it does NOT
   justify a new hook, sentinel, marker, or enforcement surface. Proposals to grow the
   mechanical lane must supersede this ADR explicitly. (Bug fixes to existing machinery
   — e.g. #501/#519/#510 — are repairs, not growth, and remain sanctioned.)
   **Optionality noted, not decided here:** once the lane + spot-audit have live
   agreement data, the fail-closed `commit-msg` rejection surface (which blocked valid
   commits in #501) may be a candidate for relaxation to advisory — that would be its
   own measured decision superseding adr-2026-07-10-inline-work-attribution-enforcement,
   never a silent change.
10. **Out of scope:** the open mechanical-lane bugs #501 (hook id type comparison), #519
   (frozen current-task), #510 (empty range anchor) are separate fixes on their own
   track — the lane compensates for their *symptoms* but does not replace them.
   **Documented non-goal:** the derivation-vs-hook `task-N` alias inconsistency
   (`taskTrailerMatches` accepts the guarded alias; `git-hook-assets.ts` commit-msg hook
   rejects it) is noted for a follow-up mechanical fix, not addressed here.

Why: this systematizes exactly the judgement the ~10 manual repairs performed, at the
exact point they performed it, while every deterministic invariant (sole authority,
abstain-never-misstamp, bounded ladder, fail-open provisioning — the lane adds no
provisioning-time machinery) survives verbatim.

## Consequences

### Positive
- Builds with real-but-misattributed work self-heal at the gate; the six escape shapes
  (and #519's frozen-stamp variant) replay to resolution without operator hands.
- Operator repair recipe becomes machinery; #467's "evidence halts are terminal for
  outsiders" gap shrinks to the rare judged-abstention case.
- Parallel dispatch (#469/#474) inherits a judgement path for interleaved/bundled
  commits instead of a new proxy-escape class.

### Negative
- Opus dispatch cost on red tries (bounded by memoization and the existing retry cap).
- Grader variance can produce judged abstentions on satisfiable residue (the ladder and
  manual recipe remain as backstops); accuracy is measured rather than assumed
  (adr-2026-07-11-attribution-spot-audit-measurement).
- Test evidence is verifier-reported until #245 lands engine-side re-execution
  (residual risk, tracked as a follow-up).

### Follow-up Actions
- [ ] Implement lane orchestrator + input assembler + validator + stamp writer (engine).
- [ ] Fold `attribution_verify` into resolved-config + model table (companion ADR).
- [ ] File the alias-inconsistency mechanical fix as its own intake issue.
- [ ] After #245 merges: engine-side scoped-test re-execution replaces verifier-reported
      test evidence.
