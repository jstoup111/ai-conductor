# Implementation Plan: Semantic Attribution Verification (two-lane evidence gate, #520)

**Date:** 2026-07-11
**Design:** `.docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md`,
`adr-2026-07-11-attribution-verdict-interface.md`,
`adr-2026-07-11-attribution-spot-audit-measurement.md`,
`adr-2026-07-11-evidence-judge-cli-and-cutover.md` (all APPROVED)
**Stories:** `.docs/stories/evidence-gate-validates-provenance-proxies-not-whe.md` (12, Accepted)
**Conflict check:** Clean as of 2026-07-11

## Summary

Adds the judged attribution lane (fresh-context verifier on build-gate residue), the
spot-audit accuracy measurement, and the `conduct-ts evidence judge` recovery CLI — 26
tasks, all in `src/conductor` plus docs/table artifacts.

## Technical Approach

- **New modules, thin wiring.** The lane lives in new files —
  `engine/attribution-verdict.ts` (types + fail-closed parser/coercion),
  `engine/attribution-inputs.ts` (candidate collection + prompt assembly, mirroring
  `build-review-inputs.ts`), `engine/attribution-lane.ts` (orchestrator: memoization,
  dispatch via the `runBuildReview` fresh-uuid + `invokeWithLadder` pattern, validation,
  stamping), `engine/attribution-audit.ts` (sampler, ledger, divergence event),
  `engine/evidence-cli.ts` (CLI entry). Existing files get only integration seams:
  the gate-miss branch in `engine/conductor.ts`, config keys in `engine/config.ts`,
  step model in `resolved-config.ts`, command routing in `cli.ts`.
- **Order:** verdict contract first (pure functions, fully unit-testable), then lane
  internals, then gate wiring, then audit, then CLI, then fixtures/docs. Every task is
  RED→GREEN committable alone; tests run from `src/conductor` (`npx vitest run <file>`;
  the build worktree needs its own `npm install` there first).
- **Data shapes** are fixed by the verdict ADR: `.pipeline/attribution-verdict.json`
  (schema 1, `satisfied`/`unsatisfied`/`no-verdict`), sidecar stamps gain
  `form: 'semantic-verified'` + optional `citedShas`/`verdictAnchor`/`testEvidence`,
  memo at `.pipeline/attribution-memo.json`, ledger at
  `.daemon/attribution-accuracy.jsonl`.
- **Inertness invariant:** every seam is guarded by `attribution_judge_cutover` /
  `attribution_audit_sample_pct`; with both absent the engine's behavior must be
  byte-identical to today (Story 1/11 control tests pin this).

## Prerequisites

- `cd src/conductor && npm install` in the build worktree (vitest must run locally).
- No migrations, no external services.

## Tasks

### Task 1: Verdict types and fail-closed parser
**Story:** Story 4 (schema parse; unknown schema/verdict; truncated/missing file)
**Type:** infrastructure

**Steps:**
1. Write failing tests: valid schema-1 file parses; truncated JSON, missing file,
   `schema: 2`, and verdict string `"maybe"` each yield all-`no-verdict` results.
2. Verify RED.
3. Implement `AttributionVerdict` types + `parseAttributionVerdict(raw, planTaskIds)`
   returning a normalized per-task map, defaulting everything unparseable to
   `no-verdict`. All task-id comparisons normalize both sides via `String()` (lane ADR
   D7b, the #501 lesson) — add a numeric-id fixture asserting the match.
4. Verify GREEN.
5. Commit: "feat(attribution): verdict types + fail-closed parser"

**Files:**
- src/conductor/src/engine/attribution-verdict.ts
- src/conductor/src/engine/attribution-verdict.test.ts

**Dependencies:** none

### Task 2: Whitewash coercion rules
**Story:** Story 4 (satisfied-without-citations / failing-or-missing testEvidence;
missing task ids)
**Type:** negative-path

**Steps:**
1. Failing tests: `satisfied` with empty `citations` → `no-verdict`; `satisfied` with
   `testEvidence.exit: 1` or missing `testEvidence` → `no-verdict`; plan task absent
   from `results` → `no-verdict`; `unsatisfied` passes through with `reason`.
2. RED. 3. Implement coercion inside the parser normalization. 4. GREEN.
5. Commit: "feat(attribution): whitewash coercion in verdict normalization"

**Files:** same as Task 1

**Dependencies:** 1

### Task 3: Anchor echo and invalidation
**Story:** Story 4 (stale anchor invalidates file)
**Type:** negative-path

**Steps:**
1. Failing tests: verdict whose `anchor.head` ≠ supplied HEAD → whole file
   `no-verdict`; matching anchor passes; residue-set mismatch also invalidates.
2. RED. 3. Implement anchor check in the parser entry point. 4. GREEN.
5. Commit: "feat(attribution): anchor invalidation on verdict parse"

**Files:** same as Task 1

**Dependencies:** 1

### Task 4: Candidate commit collector
**Story:** Story 3 (uncited candidates; bookkeeping exclusion; zero-candidate abstention)
**Type:** infrastructure

**Steps:**
1. Failing tests on a fixture repo: commits already cited by any stamp are excluded;
   empty commits excluded; engine bookkeeping commits (env-exempt class) excluded;
   remaining commits returned with sha/subject/diff; zero candidates → empty result.
2. RED. 3. Implement `collectCandidateCommits(git, evidence, range)` in a new inputs
   module, reusing the evidence-range helpers from `autoheal.ts`. 4. GREEN.
5. Commit: "feat(attribution): candidate commit collector"

**Files:**
- src/conductor/src/engine/attribution-inputs.ts
- src/conductor/src/engine/attribution-inputs.test.ts

**Dependencies:** none

### Task 5: Residue input assembly (starved prompt inputs)
**Story:** Story 3 (task definitions verbatim; Files: lines; starvation)
**Type:** happy-path

**Steps:**
1. Failing tests: assembled inputs contain residue task sections verbatim from the plan,
   candidate commits, declared Files: lines; assert task-status.json content and any
   maker-summary text are absent from the assembly even when present on disk.
2. RED. 3. Implement `assembleAttributionInputs(planPath, residueIds, candidates)`
   (pattern: `build-review-inputs.ts`). 4. GREEN.
5. Commit: "feat(attribution): starved input assembler"

**Files:** same as Task 4

**Dependencies:** 4

### Task 6: Verifier prompt builder
**Story:** Story 3 (scoped-test instruction; verdict-file contract in prompt)
**Type:** happy-path

**Steps:**
1. Failing tests: prompt embeds the verdict JSON contract (schema 1, coercion warning),
   instructs running the tasks' scoped tests and recording command+exit, instructs
   split attribution is allowed, and forbids writing anything except
   `.pipeline/attribution-verdict.json`.
2. RED. 3. Implement `buildAttributionPrompt(inputs)` (pattern:
   `build-review-prompt.ts`). 4. GREEN.
5. Commit: "feat(attribution): verifier prompt builder"

**Files:**
- src/conductor/src/engine/attribution-prompt.ts
- src/conductor/src/engine/attribution-prompt.test.ts

**Dependencies:** 5

### Task 7: Fresh-session verifier dispatch
**Story:** Story 3 (fresh uuid session, `attribution_verify` model resolution)
**Type:** infrastructure

**Steps:**
1. Failing tests (injected runner + real-binary smoke per repo convention): dispatch
   creates a fresh session id with `resume: false` through `invokeWithLadder` under
   step id `attribution_verify`; session cwd is the feature worktree.
2. RED. 3. Implement `dispatchAttributionVerifier(...)` in the lane orchestrator
   (pattern: `runBuildReview`, `step-runners.ts:711`). 4. GREEN.
5. Commit: "feat(attribution): fresh-session verifier dispatch"

**Files:**
- src/conductor/src/engine/attribution-lane.ts
- src/conductor/src/engine/attribution-lane.test.ts

**Dependencies:** 6

### Task 8: (HEAD, residue) memoization
**Story:** Story 2 (all paths)
**Type:** happy-path

**Steps:**
1. Failing tests: same (HEAD, sorted residue) → no second dispatch, prior result
   reused; HEAD change, residue change, unreachable memo HEAD → fresh dispatch.
   Memo persisted at `.pipeline/attribution-memo.json`.
2. RED. 3. Implement memo read/write + key check in the lane orchestrator. 4. GREEN.
5. Commit: "feat(attribution): verdict memoization by (HEAD, residue)"

**Files:** same as Task 7

**Dependencies:** 7

### Task 9: Engine-side citation validator
**Story:** Story 5 (all paths)
**Type:** negative-path

**Steps:**
1. Failing tests on fixture repos: unreachable SHA, non-ancestor SHA, empty commit,
   bookkeeping commit, zero path overlap (segment-anchored rule) each refuse the task
   with a recorded reason; reachable + overlapping citations clear the task.
2. RED. 3. Implement `validateCitations(git, task, verdictEntry)` reusing
   `fileMatchesPlanPath` from `autoheal.ts`. 4. GREEN.
5. Commit: "feat(attribution): engine-side citation validation"

**Files:**
- src/conductor/src/engine/attribution-validate.ts
- src/conductor/src/engine/attribution-validate.test.ts

**Dependencies:** 1

### Task 10: `semantic-verified` stamp writer
**Story:** Story 6 (stamp fields; additive immutability; partial validation)
**Type:** happy-path

**Steps:**
1. Failing tests: validated tasks get stamps `{sha, form: 'semantic-verified',
   citedShas, verdictAnchor, testEvidence}`; pre-existing stamp entries byte-identical
   after the write; refused tasks absent; serialization round-trips the optional fields.
2. RED. 3. Extend the sidecar stamp type with optional fields + a
   `writeJudgedStamps(...)` engine API in `task-evidence.ts`. 4. GREEN.
5. Commit: "feat(attribution): semantic-verified stamp writer"

**Files:**
- src/conductor/src/engine/task-evidence.ts
- src/conductor/src/engine/task-evidence.test.ts

**Dependencies:** 9

### Task 11: Config keys with clamped parsing
**Story:** Story 11 (keys read at startup; out-of-range pct; inert defaults)
**Type:** infrastructure

**Steps:**
1. Failing tests: `attribution_judge_cutover` (ISO-8601) and
   `attribution_audit_sample_pct` parsed from `.ai-conductor/config.yml`; absent keys →
   inert defaults (cutover undefined, pct 10 but audit gated on green + cutover); pct
   150/-5 → clamped with a startup warning line.
2. RED. 3. Implement beside `attribution_enforcement_cutover` parsing. 4. GREEN.
5. Commit: "feat(config): attribution judge cutover + audit sample pct"

**Files:**
- src/conductor/src/engine/config.ts
- src/conductor/src/engine/attribution-enforcement.ts
- src/conductor/src/engine/attribution-enforcement.test.ts

**Dependencies:** none

### Task 12: Gate wiring — lane trigger on residue
**Story:** Story 1 (all paths); Story 6 (gate re-derives; counter resets)
**Type:** happy-path (integration point)

**Steps:**
1. Failing engine tests: gate miss + residue + armed cutover ⇒ one lane run whose
   stamps flip the gate green in the same evaluation and reset `noEvidenceAttempts`
   via the existing progress branch; green gate ⇒ no lane; unset/future cutover ⇒
   byte-identical outputs vs a feature-absent control (gate verdict JSON, sidecar,
   hints); zero-work-product try ⇒ lane skipped, `zero_work_product` reason intact.
2. RED. 3. Wire `runAttributionLane(...)` into the build gate-miss branch in
   `conductor.ts` (after `applyDerivedCompletion`, before the no-evidence counter
   block). 4. GREEN.
5. Commit: "feat(engine): semantic attribution lane wired into build gate"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/attribution-lane.ts
- src/conductor/src/engine/attribution-lane.test.ts

**Dependencies:** 8, 10, 11

### Task 13: Judged retry hints
**Story:** Story 7 (all paths)
**Type:** happy-path

**Steps:**
1. Failing tests: `unsatisfied` reasons enter `pendingRetryHints` for the build step
   naming the task ids; `no-verdict` tasks excluded; invalidated verdict contributes
   nothing (mechanical hint unchanged).
2. RED. 3. Implement hint merge in the gate-miss branch. 4. GREEN.
5. Commit: "feat(attribution): unsatisfied verdicts sharpen retry hints"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/attribution-lane.test.ts

**Dependencies:** 12

### Task 14: Deterministic spot-audit sampler
**Story:** Story 8 (hash selection; reproducibility; pct 0; judged-form exclusion)
**Type:** happy-path

**Steps:**
1. Failing tests: fixed slug/ids ⇒ exact expected subset via
   `sha1(slug + ':' + taskId) mod 100 < pct`, stable across runs; pct 0 ⇒ empty;
   `semantic-verified` stamps excluded from the universe.
2. RED. 3. Implement `selectAuditSample(evidence, slug, pct)`. 4. GREEN.
5. Commit: "feat(attribution): deterministic spot-audit sampler"

**Files:**
- src/conductor/src/engine/attribution-audit.ts
- src/conductor/src/engine/attribution-audit.test.ts

**Dependencies:** 11

### Task 15: Post-green non-blocking audit dispatch
**Story:** Story 8 (fire-and-forget after gate verdict persisted; lost samples)
**Type:** happy-path

**Steps:**
1. Failing tests: audit dispatch occurs only after the build gate verdict file is
   written; audit session failure/timeout/unparseable verdict leaves build outcome
   files untouched and fabricates no `agree` row; empty sample ⇒ no dispatch.
2. RED. 3. Implement `runSpotAudit(...)` reusing the verifier dispatch (Task 7) with
   the sampled task set as residue. 4. GREEN.
5. Commit: "feat(attribution): post-green spot-audit dispatch"

**Files:**
- src/conductor/src/engine/attribution-audit.ts
- src/conductor/src/engine/attribution-audit.test.ts
- src/conductor/src/engine/conductor.ts

**Dependencies:** 14, 7

### Task 16: Accuracy ledger appends
**Story:** Story 9 (agree rows; concurrent line-atomic appends)
**Type:** happy-path

**Steps:**
1. Failing tests: audited task appends `{ts, feature, taskId, fastLaneForm,
   fastLaneSha, auditVerdict, agree, citations?, reason?}` to
   `.daemon/attribution-accuracy.jsonl`; two parallel appends yield two complete
   lines (no interleave/truncation).
2. RED. 3. Implement append-only ledger writer (O_APPEND single-write per line).
4. GREEN.
5. Commit: "feat(attribution): accuracy ledger"

**Files:**
- src/conductor/src/engine/attribution-audit.ts
- src/conductor/src/engine/attribution-audit.test.ts

**Dependencies:** 15

### Task 17: `attribution_divergence` event — signal, never revocation
**Story:** Story 9 (event on disagree; stamps/state untouched; no halt)
**Type:** negative-path

**Steps:**
1. Failing tests: `agree: false` emits `attribution_divergence` with feature+taskId
   through the event stream (persisted by `event-persister`); post-divergence the
   task's stamp, feature state files, and halt/park markers are byte-identical/absent.
2. RED. 3. Add the event type to the `ConductorEvent` union and `ALL_EVENT_TYPES`;
   emit from the audit recorder. 4. GREEN.
5. Commit: "feat(events): attribution_divergence signal"

**Files:**
- src/conductor/src/types/index.ts
- src/conductor/src/engine/event-persister.ts
- src/conductor/src/engine/attribution-audit.ts
- src/conductor/src/engine/attribution-audit.test.ts

**Dependencies:** 16

### Task 18: Daemon status agreement rate
**Story:** Story 9 (rolling agreement surfaced)
**Type:** happy-path

**Steps:**
1. Failing test: `daemon status` output includes rolling agreement rate (and sample
   count) computed from the ledger; absent/empty ledger ⇒ line omitted (no fake 100%).
2. RED. 3. Implement ledger summarizer + status line in the daemon status path.
4. GREEN.
5. Commit: "feat(daemon): attribution agreement rate in status"

**Files:**
- src/conductor/src/engine/daemon-command.ts
- src/conductor/src/engine/attribution-audit.ts
- src/conductor/src/engine/daemon-command.test.ts

**Dependencies:** 16

### Task 19: `conduct-ts evidence` command group + resolution errors
**Story:** Story 10 (unknown feature error; command surface)
**Type:** infrastructure

**Steps:**
1. Failing CLI tests: `conduct-ts evidence judge <slug>` routes to the new handler;
   unknown feature/worktree ⇒ non-zero exit, clear message, zero writes;
   `conduct-ts evidence` alone prints usage.
2. RED. 3. Add the `evidence` group to the CLI dispatcher + feature→worktree/branch
   resolution in a new `evidence-cli.ts`. 4. GREEN.
5. Commit: "feat(cli): evidence command group + judge resolution"

**Files:**
- src/conductor/src/cli.ts
- src/conductor/src/engine/evidence-cli.ts
- src/conductor/src/engine/evidence-cli.test.ts

**Dependencies:** none

### Task 20: CLI judge end-to-end (cutover bypass, validation identical)
**Story:** Story 10 (manual run works with cutover unset; before/after JSON;
validation refusals identical to gate lane)
**Type:** happy-path (integration point)

**Steps:**
1. Failing tests: on an unattributed fixture feature, the CLI runs the full lane
   (assembly → dispatch → parse → validate → stamp), re-derives, prints before/after
   unresolved counts as JSON; runs with cutover unset; a validation-refused fixture
   yields the same refusal output as the gate lane on the identical fixture.
2. RED. 3. Implement the handler over `runAttributionLane`. 4. GREEN.
5. Commit: "feat(cli): evidence judge end-to-end"

**Files:**
- src/conductor/src/engine/evidence-cli.ts
- src/conductor/src/engine/evidence-cli.test.ts

**Dependencies:** 19, 12

### Task 21: CLI `--dry-run` and active-build refusal
**Story:** Story 10 (dry-run sidecar untouched; active build refusal)
**Type:** negative-path

**Steps:**
1. Failing tests: `--dry-run` prints would-be stamps, sidecar byte-identical;
   `.pipeline/build-step-active` present ⇒ non-zero exit naming the active build,
   zero writes; a FULLY-resolved halted/parked fixture gets HALT-clear + REKICK
   sentinel dropped (daemon re-pick path), while PARTIAL resolution leaves halt state
   untouched and names the remaining tasks.
2. RED. 3. Implement the guards + recovery tail in the handler. 4. GREEN.
5. Commit: "feat(cli): evidence judge dry-run, active-build refusal, recovery tail"

**Files:** same as Task 20

**Dependencies:** 20

### Task 22: `attribution_verify` model-table row
**Story:** Story 11 (opus/high; generated table drift-clean)
**Type:** infrastructure

**Steps:**
1. Failing check: `bin/generate-model-table` output includes `attribution_verify`
   opus/high with rationale; drift check against HARNESS.md fails before the change.
2. RED. 3. Add to `DEFAULT_STEP_MODELS`/`DEFAULT_STEP_EFFORT` in `resolved-config.ts`
   + rationale in `model-table-metadata.ts`; regenerate HARNESS.md table. 4. GREEN
   (drift check + `test/test_harness_integrity.sh` table sections).
5. Commit: "feat(config): attribution_verify model-table row (opus/high)"

**Files:**
- src/conductor/src/engine/resolved-config.ts
- src/conductor/src/engine/model-table-metadata.ts
- HARNESS.md

**Dependencies:** none

### Task 23: Escape fixture corpus — provenance-drift shapes
**Story:** Story 12 (#417 variant, #485 paragraph-split, #477 no-trailers)
**Type:** happy-path (acceptance)

**Steps:**
1. Build three minimal fixture repo states (helper-constructed in-test, nested mkdtemp
   parent per repo convention): id-grammar variant `Task: task-07`; paragraph-split
   trailer bodies; no trailers at all — each with real satisfying diffs.
2. Failing acceptance tests: gate + lane converge each fixture to green via
   `semantic-verified` stamps with zero manual stamps.
3. Implement any fixture plumbing needed; GREEN.
4. Commit: "test(attribution): escape corpus — grammar drift, split trailers, unstamped"

**Files:**
- src/conductor/src/engine/attribution-corpus.test.ts

**Dependencies:** 12

### Task 24: Escape fixture corpus — bypass and bundle shapes
**Story:** Story 12 (#505 inline, #501 residue, #519/#492 bundle split)
**Type:** happy-path (acceptance)

**Steps:**
1. Four more fixtures: inline-committed unattributed work; work re-committed without
   trailers after hook rejection (#501 residue); 15 commits all trailered `Task: 1`
   spanning a 16-task plan (#492 shape); rebase-rewritten history with no usable
   pre-hook provenance (#390 shape).
2. Failing acceptance tests: each converges without operator action; the #492 fixture
   asserts split attribution across the satisfied tasks.
3. GREEN. 4. Commit: "test(attribution): escape corpus — inline, hook-residue, bundle split, rebase-rewritten"

**Files:** same as Task 23

**Dependencies:** 23

### Task 25: Negative acceptance — refusal in both invokers
**Story:** Story 12 negatives; Story 5 (all-refused ladder intact)
**Type:** negative-path (acceptance)

**Steps:**
1. Fixtures: #492 shape with tasks 15–16 diffs removed; empty commit with forged
   `Evidence: satisfied-by` citing an unreachable SHA.
2. Failing acceptance tests: tasks 15–16 stay unresolved through BOTH the gate lane
   and `conduct-ts evidence judge` (sidecar asserted, ladder counters advance, park
   threshold reachable); forged-citation fixture stamps nothing.
3. GREEN. 4. Commit: "test(attribution): unimplemented residue refused in both invokers"

**Files:**
- src/conductor/src/engine/attribution-corpus.test.ts
- src/conductor/src/engine/evidence-cli.test.ts

**Dependencies:** 24, 21

### Task 26: Docs, CHANGELOG + Migration block, integrity suite
**Story:** Story 11 (release obligations)
**Type:** infrastructure

**Steps:**
1. Update `README.md` + `src/conductor/README.md` (lane, config keys, CLI, ledger,
   status line). Add CHANGELOG `[Unreleased]` Added entries + `## Migration` block
   (CLI subcommand + both config keys; absent keys = inert).
2. Run `test/test_harness_integrity.sh` and the full conductor suite from
   `src/conductor`; fix any drift.
3. Post-merge operational note (documented in the PR body, executed by the operator,
   not this build): replay worktree COPIES of the three preserved stranded builds
   (#492, #486, #390) through `conduct-ts evidence judge` — the live acceptance
   corpus; production success = all three ship with zero operator evidence work.
   Close #467 as subsumed (CLI ADR) once verified.
3. Commit: "docs(attribution): README/CHANGELOG/migration for judged attribution"

**Files:**
- README.md
- src/conductor/README.md
- CHANGELOG.md

**Dependencies:** 22, 25

## Task Dependency Graph

```
1 ──► 2
1 ──► 3
1 ──► 9 ──► 10 ─────────┐
4 ──► 5 ──► 6 ──► 7 ──► 8 ──► 12 ──► 13
11 ─────────────────────┘│    (12 also ◄── 10, 11)
11 ──► 14 ──► 15 ◄── 7   │
       15 ──► 16 ──► 17  │
              16 ──► 18  │
19 ──► 20 ◄──────────────┘ (20 ◄── 12)
       20 ──► 21
12 ──► 23 ──► 24 ──► 25 ◄── 21
22 ──► 26 ◄── 25
```

Acyclic; independent roots: 1, 4, 11, 19, 22.

## Integration Points

- After Task 12: gate-red → judged stamps → gate-green demonstrable end-to-end in an
  engine test build.
- After Task 20: the same lane runnable by hand against a fixture feature.
- After Task 25: the full #520 acceptance corpus (outcome f) green in CI.

## Coverage Map

| Story | Tasks |
|---|---|
| 1 lane trigger | 12 |
| 2 memoization | 8 |
| 3 starved inputs/dispatch | 4, 5, 6, 7 |
| 4 fail-closed parse | 1, 2, 3 |
| 5 citation validation | 9, 25 |
| 6 stamping/split/counter | 10, 12 |
| 7 retry hints | 13 |
| 8 sampler | 14, 15 |
| 9 ledger/divergence | 16, 17, 18 |
| 10 CLI | 19, 20, 21 |
| 11 config/table/release | 11, 22, 26 |
| 12 escape corpus | 23, 24, 25 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (2, 3, 9, 17, 21, 25)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies explicit and acyclic
- [ ] Plan header ids are the `Task:` trailer ids (numeric, H9 grammar)
