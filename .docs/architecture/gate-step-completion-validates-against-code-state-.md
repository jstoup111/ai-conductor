# Architecture — Gate-step completion validates against code state

**Stem:** `gate-step-completion-validates-against-code-state-`
**Tier:** Medium (lightweight diagram)
**Source:** jstoup111/ai-conductor#817

Scope: how a re-dispatched feature's judged-gate completion check decides *preserve vs re-run*, and
where the new per-gate code-validity check plugs into the existing completion-predicate flow. Reuses
the `GATE_SURFACE` + `partitionDelta` machinery from `gate-invalidation.ts` (ADR-2026-07-20).

## C4 — Component / control flow (the resume gate decision)

```mermaid
flowchart TD
  RD[Daemon re-dispatch\ndaemon-cli.ts:823-909] --> RUN[Conductor.run\nre-stamps session_started_at\nconductor.ts:1578-1581]
  RUN --> CSC[checkStepCompletion\nartifacts.ts:2499-2517]
  CSC --> PRED{judged-gate\nverdict predicate?\nbuild_review / prd_audit /\narch_review_as_built / manual_test}

  PRED -->|no| OLD[unchanged predicate\n(task-status build, acceptance_specs,\nwiring_check already HEAD-anchored)]

  PRED -->|yes| PARSE{verdict file exists\n& parses & PASS?}
  PARSE -->|no / FAIL / invalid| RERUN[re-run gate\n(dispatch judge)]
  PARSE -->|yes| STAMP{codeStamp present\non verdict?}

  STAMP -->|absent\n(legacy / opt-out)| MTIME[fall back to existing\nmtime attempt-floor check]
  MTIME --> RERUN

  STAMP -->|present| VALID[gate-code-validity helper]
  VALID --> REACH{stamped baseline\nreachable in history?}
  REACH -->|no — orphaned #766| RERUN
  REACH -->|yes| DELTA{delta baseline..HEAD\ncomputable?}
  DELTA -->|no| RERUN
  DELTA -->|yes| SURF{partitionDelta by\nGATE_SURFACE hits\nthis gate's surface?}
  SURF -->|yes — code changed| RERUN
  SURF -->|no — surface unchanged| KEEP[PRESERVE verdict\nstep = done, no re-run]

  subgraph writepath[Verdict write path unchanged shape, + stamp]
    JUDGE[judge dispatch writes\nbuild-review.json etc.] --> WSTAMP[stamp codeStamp = current HEAD\nat write time]
  end
```

## Key elements

- **Insertion seam:** the four judged-gate verdict predicates in `artifacts.ts`
  (`build_review` 1442, `prd_audit` 1325, `architecture_review_as_built` 1381, `manual_test` ~1230)
  gain a code-validity branch *before* the mtime-freshness rejection. The `CompletionContext`
  (`artifacts.ts:404-473`) already threads git access (`getHeadSha`); the new helper reads the
  stamp + computes the delta.
- **Reused, not rebuilt:** `GATE_SURFACE` (`gate-invalidation.ts:44-53`), `partitionDelta` (:71-88),
  and the classify/fail-closed pattern (`classifyGateInvalidation` :106-137). The delta baseline is the
  gate's own recorded `codeStamp` (a HEAD SHA) rather than the rebase pre-tree.
- **New stamp:** an additive `codeStamp` field on the verdict artifact, written at judge-dispatch time
  (the code state the verdict was formed against). Not a bare-SHA *pin* — validity is a *delta check*
  against current HEAD, and an unreachable baseline fails closed to re-run (avoids #766 wedge).
- **Sweep coupling:** `sweepStaleReviewArtifacts` (:338-355) gates its delete on the same validity
  helper so a still-valid prior-session verdict is not removed before the resume completion check reads
  it.
- **Preserved orthogonals:** the mtime **attempt-floor** (`verdictFreshnessComparand`, guards a judge
  that declines to rewrite *within* a dispatch, incident 2026-07-12); `wiring_check`'s existing
  HEAD anchor; `task-status.json` build resume; the rebase-path invalidation (ADR-2026-07-20).

## Data / state touched

- `.pipeline/build-review.json` (+ `codeStamp`), and the evidence artifacts for `prd_audit` /
  `architecture_review_as_built` / `manual_test`.
- No new persistent store; `state.session_started_at` semantics unchanged (still per-run) — the fix
  changes what the predicates *do with* the floor, not the floor itself.
