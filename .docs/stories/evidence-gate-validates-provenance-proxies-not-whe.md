**Status:** Accepted

# Stories: Semantic Attribution Verification (two-lane evidence gate, #520)

**Track:** technical (no PRD — criteria derive from intake #520 + the four APPROVED
2026-07-11 attribution ADRs)
**Tier:** L
**Traceability:** each story cites its governing ADR section instead of an FR.

---

## Story 1: Judged lane triggers only on gate residue with cutover armed

**Requirement:** lane ADR Decision 1

As the conductor engine, I want the semantic verification lane to run only when the
mechanical lane leaves residue and the cutover is armed, so that green builds and
un-armed fleets pay zero judge cost and the gate is byte-identical to today when inert.

### Acceptance Criteria

#### Happy Path
- Given `attribution_judge_cutover` is set to a past timestamp and a build gate
  evaluation ends with 3 of 7 tasks unresolved after `deriveCompletion` +
  `applyDerivedCompletion`, when the gate records its miss, then the lane dispatches one
  verifier session whose residue set is exactly the 3 unresolved task ids.
- Given the same evaluation resolves all 7 tasks mechanically, when the gate goes green,
  then no verifier session is dispatched.

#### Negative Paths
- Given `attribution_judge_cutover` is unset, when a gate evaluation leaves residue,
  then no verifier is dispatched, no `.pipeline/attribution-verdict.json` is created,
  and the gate verdict, retry hint, `noEvidenceAttempts` increment, and auto-park
  behavior are identical to a control run without the feature code.
- Given `attribution_judge_cutover` is a future timestamp, when a gate evaluation leaves
  residue, then the lane stays inert (same assertions as unset).
- Given the try's `detectZeroWorkProduct` fired (dispatch count 0 or HEAD unchanged),
  when the gate misses, then the lane is skipped and the existing `zero_work_product`
  kickback path runs unchanged.

### Done When
- [ ] Engine test: residue + armed cutover ⇒ exactly one verifier dispatch with the
      correct residue ids; green gate ⇒ zero dispatches.
- [ ] Engine test: unset AND future cutover ⇒ gate outputs byte-identical to a feature-
      absent control (verdict JSON, sidecar, hints all compared).
- [ ] Engine test: zero-work-product try ⇒ no dispatch, `zero_work_product` reason still
      recorded in `noEvidenceReasons`.

---

## Story 2: (HEAD, residue) memoization never re-judges an unchanged state

**Requirement:** lane ADR Decision 2

As the operator paying for opus dispatches, I want verdicts memoized by
`(HEAD sha, sorted residue ids)`, so that a retry that produced no new commits costs
zero judge tokens.

### Acceptance Criteria

#### Happy Path
- Given try 2 dispatched the verifier at HEAD `abc…` with residue `{7,9}` and the
  verdict abstained, when try 3 evaluates at the same HEAD with the same residue, then
  no new verifier session is dispatched and the prior abstention is reused.
- Given try 3 adds one commit (new HEAD), when the gate misses with residue `{7,9}`,
  then a fresh verifier session IS dispatched.

#### Negative Paths
- Given the residue set shrinks from `{7,9}` to `{9}` at the same HEAD (task 7 resolved
  mechanically on re-derive), when the gate misses, then a fresh dispatch occurs (the
  key changed) — a stale verdict for `{7,9}` is never replayed onto `{9}`.
- Given the memo record references a HEAD that is no longer reachable (branch rewritten),
  when the gate misses, then the memo is discarded and a fresh dispatch occurs.

### Done When
- [ ] Engine test: same (HEAD, residue) across two tries ⇒ one dispatch total.
- [ ] Engine test: HEAD change, residue change, and unreachable-HEAD memo each force a
      fresh dispatch.

---

## Story 3: Verifier session is input-starved and engine-assembled

**Requirement:** lane ADR Decision 3

As the gate's integrity owner, I want the verifier's entire input assembled by the
engine — residue task definitions, uncited candidate commits with diffs, declared
Files:/test lines — so that the judge sees evidence, not the builder's narrative.

### Acceptance Criteria

#### Happy Path
- Given a residue of 2 tasks and 5 branch commits of which 3 are already cited by
  existing stamps, when the lane assembles inputs, then the prompt contains the 2 task
  definitions verbatim from the plan, the 2 uncited commits' SHAs/subjects/diffs, the
  tasks' declared Files: lines, and an instruction to run the tasks' scoped tests.
- Given the dispatch, when the session is created, then it is a fresh uuid session
  (`resume: false`) via the model-availability ladder under step id `attribution_verify`.

#### Negative Paths
- Given task-status.json contains a forged `completed` row and the maker's summary text
  exists in the transcript, when inputs are assembled, then neither appears in the
  verifier prompt (starvation: plan text, commits, and file lists only).
- Given all branch commits are already cited by stamps, when the lane would assemble
  inputs, then it records an immediate `no-verdict` for the residue without dispatching
  (nothing to judge).
- Given engine bookkeeping commits (`CONDUCT_ENGINE_COMMIT` exemption class) exist on
  the branch, when candidates are collected, then they are excluded from the prompt.

### Done When
- [ ] Unit test on the input assembler: prompt contains exactly the specified sections;
      transcript/task-status content asserted absent.
- [ ] Unit test: zero uncited candidates ⇒ no dispatch, recorded abstention.
- [ ] Dispatch test: fresh session id, `attribution_verify` model/effort resolved.

---

## Story 4: Fail-closed verdict parsing and whitewash coercion

**Requirement:** verdict ADR (schema, coercion)

As the gate, I want every verdict parsed fail-closed with `satisfied` requiring
citations + passing test evidence, so that a malformed or lazy verdict can never
complete a task.

### Acceptance Criteria

#### Happy Path
- Given a schema-1 verdict file with a `satisfied` result carrying one full-SHA citation
  and `testEvidence.exit: 0`, when the engine parses it, then the result survives as
  `satisfied` with its citations intact.

#### Negative Paths
- Given a `satisfied` result with an empty `citations` array, when parsed, then it is
  coerced to `no-verdict` and no stamp is written for that task.
- Given a `satisfied` result with citations but `testEvidence.exit: 1` (or missing
  `testEvidence`), when parsed, then it is coerced to `no-verdict`.
- Given an unparseable file (truncated JSON), a missing file, an unknown `schema`
  version, or an unknown verdict string (`"maybe"`), when the lane reads the verdict,
  then every residue task is treated as `no-verdict` and the try proceeds down the
  existing failure path.
- Given the verdict's `anchor.head` differs from the branch HEAD at validation time
  (HEAD moved mid-judge), when parsed, then the entire file is invalidated (all
  `no-verdict`) and the memo is not populated with it.
- Given a task id present in the plan but absent from `results`, when parsed, then that
  task is `no-verdict`.

### Done When
- [ ] Pure-function parser tests covering: valid satisfied; empty citations; failing/
      missing testEvidence; truncated JSON; missing file; unknown schema; unknown
      verdict string; stale anchor; missing task id — each yielding the specified
      coercion and zero stamps.

---

## Story 5: Engine-side citation validation refuses unprovable satisfied verdicts

**Requirement:** lane ADR Decision 5

As the gate's sole-authority guarantee, I want the ENGINE to mechanically validate every
citation before stamping — SHA reachability, non-empty non-bookkeeping diffs, path
overlap where declared — so a judge cannot whitewash by citing plausible-looking SHAs.

### Acceptance Criteria

#### Happy Path
- Given a parsed `satisfied` verdict citing two reachable SHAs whose combined diff
  touches the task's declared paths, when validation runs, then the task is cleared for
  stamping with `citedShas` recording both.

#### Negative Paths
- Given a citation whose SHA does not exist in the repository or is not an ancestor of
  the branch HEAD, when validated, then NO stamp is written for that task and a
  validation-refusal reason is recorded.
- Given a citation resolving to an empty commit (no diff), when validated, then the task
  is refused (empty commits satisfy nothing in the judged lane).
- Given a citation resolving to an engine bookkeeping commit, when validated, then the
  task is refused.
- Given a task with declared `**Files:**` paths and citations whose diffs touch none of
  them under the segment-anchored suffix rule, when validated, then the task is refused.
- Given validation refuses every residue task, when the lane completes, then the sidecar
  is untouched, `noEvidenceAttempts` increments exactly as today, and daemon auto-park
  still fires at the existing threshold.

### Done When
- [ ] Validator tests: unreachable SHA, non-ancestor SHA, empty commit, bookkeeping
      commit, and zero path overlap each refuse the task with a recorded reason.
- [ ] Integration test: all-refused lane run leaves sidecar byte-identical and ladder
      counters advancing as without the feature.

---

## Story 6: Validated verdicts stamp as `semantic-verified` and the gate re-derives

**Requirement:** lane ADR Decision 6; verdict ADR (stamp)

As the evidence gate, I want validated judged verdicts written by the engine as
`semantic-verified` stamps that the normal derivation then consumes, so completion
authority never leaves the gate.

### Acceptance Criteria

#### Happy Path
- Given tasks 7 and 9 pass validation, when the engine stamps them, then
  `task-evidence.json` gains stamps with `form: "semantic-verified"`, `citedShas`,
  `verdictAnchor`, and `testEvidence`, and the immediate gate re-evaluation reports both
  resolved.
- Given judged stamps resolved new tasks this evaluation, when the durable no-evidence
  counter runs, then `resolvedTasksAfter > resolvedTasksBefore` holds and
  `noEvidenceAttempts` resets to 0 via the existing progress branch.
- Given one SHA whose diff satisfies tasks 3, 4, and 5 (bundled commit), when all three
  validate, then three distinct stamps cite the same SHA (split attribution).

#### Negative Paths
- Given existing mechanical stamps for other tasks, when judged stamps are written, then
  no existing stamp's `sha`/`form` is mutated (additive-only, asserted byte-level on the
  untouched entries).
- Given the verifier session itself attempts to write `task-evidence.json` or
  `task-status.json`, when the session runs, then the write does not reach the sidecar
  consumed by the gate (engine-only stamping; the lane reads only the verdict file).
- Given a partial validation (task 7 passes, task 9 refused), when stamping runs, then
  exactly task 7 is stamped and task 9 remains unresolved.

### Done When
- [ ] Integration test: residue → judged stamps → gate green in the same evaluation
      cycle; counter reset asserted.
- [ ] Split-attribution test: one SHA, three tasks, three stamps.
- [ ] Immutability test: pre-existing stamp entries byte-identical after a judged pass.

---

## Story 7: `unsatisfied` verdicts sharpen the next retry

**Requirement:** lane ADR Decision 8

As the build retry ladder, I want judged `unsatisfied` findings fed into the retry hint,
so the next try names exactly the tasks whose work is genuinely absent.

### Acceptance Criteria

#### Happy Path
- Given the verdict marks task 9 `unsatisfied` with reason "no candidate diff touches
  the CLI surface", when the next build try is dispatched, then its prompt's retry hint
  names task 9 and carries that reason.

#### Negative Paths
- Given a task judged `no-verdict` (ambiguous), when hints are built, then it is NOT
  listed as confirmed-missing (abstention must not masquerade as a finding).
- Given the verdict file was invalidated (stale anchor), when hints are built, then no
  judged content enters the hint (the existing mechanical hint runs unchanged).

### Done When
- [ ] Test: `unsatisfied` reasons appear in `pendingRetryHints` for the build step;
      `no-verdict` tasks absent from the hint.

---

## Story 8: Deterministic spot-audit sampling of fast-lane stamps

**Requirement:** spot-audit ADR Decisions 1–2

As the accuracy measurement, I want a deterministic sample of mechanically-attributed
tasks re-verified post-gate-green without blocking anything, so fast-lane accuracy is
measured, not assumed.

### Acceptance Criteria

#### Happy Path
- Given `attribution_audit_sample_pct: 10` and a green gate with 8 mechanically-stamped
  tasks, when the sampler runs, then exactly the tasks with
  `sha1(featureSlug + ':' + taskId) mod 100 < 10` are selected — and re-running the
  sampler reproduces the identical selection.
- Given a non-empty sample, when the audit dispatches, then it uses the same verifier
  prompt/parse path in one fresh session, after the gate verdict is already persisted.

#### Negative Paths
- Given `attribution_audit_sample_pct: 0` (or the key absent with default overridden to
  0), when a gate goes green, then no audit session is dispatched and no ledger writes
  occur.
- Given the audit session times out or its verdict file is unparseable, when the audit
  concludes, then the build's recorded outcome is unchanged, no retry is triggered, and
  the sample is recorded as lost (no `agree` row fabricated).
- Given only `semantic-verified` stamps exist (nothing mechanically attributed), when
  the sampler runs, then it selects nothing (the audit measures the fast lane only).

### Done When
- [ ] Sampler unit test: fixed slug/task ids ⇒ exact expected subset, stable across runs.
- [ ] Test: pct 0 ⇒ zero dispatches; audit failure ⇒ build outcome files untouched.
- [ ] Test: judged stamps excluded from the sample universe.

---

## Story 9: Accuracy ledger and divergence signal — never a revocation, never a halt

**Requirement:** spot-audit ADR Decisions 3–4

As the operator, I want every audited task appended to
`.daemon/attribution-accuracy.jsonl` with an `agree` boolean, and disagreement to emit
an `attribution_divergence` event, so false positives become visible without
destabilizing shipped builds.

### Acceptance Criteria

#### Happy Path
- Given an audited task where the judge cites the same satisfying work, when the audit
  records, then a JSONL line with `agree: true` and the fast-lane form/sha is appended.
- Given the judge finds a mechanically-completed task's diff does NOT satisfy it, when
  the audit records, then the line carries `agree: false` and an
  `attribution_divergence` event is emitted with feature + task id.

#### Negative Paths
- Given a divergence, when the event fires, then the task's stamp in
  `task-evidence.json` is unmodified, the build/feature state files are unmodified, and
  no HALT/park marker is written.
- Given two concurrent green builds in different worktrees of the same repo, when both
  audits append, then the ledger contains both complete lines (line-atomic appends — no
  interleaved/truncated JSON).

### Done When
- [ ] Test: agree and disagree rows both append with the specified fields; divergence
      emits the event.
- [ ] Test: post-divergence, stamp + state files byte-identical; no halt marker exists.
- [ ] Concurrency test: parallel appends yield 2 valid JSONL lines.

---

## Story 10: `conduct-ts evidence judge` — the operator's recovery entry

**Requirement:** CLI ADR Decision 1

As an operator facing an evidence halt, I want `conduct-ts evidence judge <feature>` to
run the identical lane manually and show me before/after, so recovery stops requiring
hand-authored trailer grammar (#467).

### Acceptance Criteria

#### Happy Path
- Given a parked feature whose work is real but unattributed, when I run
  `conduct-ts evidence judge <feature>`, then the same lane (assembly → verifier →
  parse → validation → engine stamping) runs against its worktree/branch, the gate
  re-derives, and stdout prints before/after unresolved counts as JSON.
- Given `--dry-run`, when the command completes, then stdout shows what WOULD be
  stamped and `task-evidence.json` is unmodified.
- Given a halted/parked feature whose residue the manual run FULLY resolves, when the
  command completes, then it clears the HALT and drops the REKICK sentinel so the
  daemon re-picks the feature; given only PARTIAL resolution, halt state is untouched
  and the output says which tasks remain.
- Given the cutover flag is unset, when I invoke the command manually, then it still
  runs (explicit operator invocation is the authorization).

#### Negative Paths
- Given the feature's build step is active (`.pipeline/build-step-active` present),
  when I invoke the command, then it refuses with a non-zero exit and a message naming
  the active build (single-writer discipline).
- Given the judge's verdict for a task fails citation validation, when the CLI run
  completes, then that task is NOT stamped — manual invocation bypasses the cutover,
  never the validation (identical refusal output to the gate lane).
- Given a feature slug that resolves to no worktree/branch, when invoked, then a clear
  non-zero error (no partial state written).

### Done When
- [ ] CLI test: end-to-end judge run resolves an unattributed fixture feature; JSON
      before/after printed.
- [ ] Test: `--dry-run` leaves sidecar byte-identical.
- [ ] Test: active-build marker ⇒ refusal exit; unknown feature ⇒ error; validation
      refusal identical to gate lane's for the same fixture.

---

## Story 11: Config keys, model-table row, and inert-by-default rollout

**Requirement:** CLI ADR Decisions 2–4

As the fleet operator, I want the lane governed by committed config keys and the model
table, defaulting to inert, so the feature merges dark and arms by config commit.

### Acceptance Criteria

#### Happy Path
- Given `attribution_judge_cutover` and `attribution_audit_sample_pct` in committed
  `.ai-conductor/config.yml`, when the engine starts, then both are read once at startup
  (restart applies changes), matching the `attribution_enforcement_cutover` precedent.
- Given the model table generator runs, when `attribution_verify` is resolved, then it
  is opus/high with a rationale row, and `bin/generate-model-table` output matches the
  committed HARNESS.md section (CI drift check green).

#### Negative Paths
- Given a config with neither key, when the engine runs a full build, then no judge or
  audit dispatch occurs anywhere (inert default), and `test/test_harness_integrity.sh`
  passes.
- Given `attribution_audit_sample_pct: 150` or `-5`, when config is read, then the value
  is clamped or rejected with a clear startup warning — never an out-of-range modulo
  comparison silently sampling everything/nothing.

### Done When
- [ ] Config tests: keys read at startup; absent keys ⇒ zero dispatches across a full
      engine test build.
- [ ] Model-table regeneration committed in the same diff; integrity suite green.
- [ ] Out-of-range pct test: clamped/rejected with warning.
- [ ] CHANGELOG `[Unreleased]` entry + `## Migration` block covering the CLI subcommand
      and both config keys; README + `src/conductor/README.md` document them.

---

## Story 12: Escape-corpus replay — the six shapes plus #519 resolve without operator hands

**Requirement:** intake #520 outcome (f); architecture-review condition 3

As the harness owner, I want the recorded proxy-escape shapes replayed as fixtures
against the finished lane, so the class — not just the instances — is provably closed.

### Acceptance Criteria

#### Happy Path (one fixture per shape; each build's work is real, provenance broken)
- Given commits trailered with an id-grammar variant outside both the exact grammar and
  the guarded `task-N` alias (e.g. `Task: task-07` for plan id `7` — the #417 drift
  class), when the gate + lane run, then the task completes via a `semantic-verified`
  stamp with no operator action.
- Given commits whose `Task:` line sits in a paragraph-split body invisible to
  `git interpret-trailers` (#485 shape), when the gate + lane run, then the affected
  tasks complete via judged stamps.
- Given a build whose commits carry NO Task trailers at all (#477 shape), when the gate
  + lane run, then tasks whose diffs satisfy them complete via judged stamps.
- Given inline work committed outside dispatch hooks, unattributed (#505 shape), when
  the gate + lane run, then satisfying tasks complete via judged stamps.
- Given a worktree where the numeric-id commit-msg hook rejected the valid trailers and
  the work was re-committed WITHOUT `Task:` trailers (#501 incident residue — the
  mechanical hook bug itself stays unfixed here and is tracked separately), when the
  gate + lane run, then the satisfying tasks still complete via the judged lane
  (symptom absorbed).
- Given the #492 build's shape: 15 real commits all trailered `Task: 1` spanning 16
  plan tasks (#519/#520 shape 6), when the gate + lane run, then the verifier splits
  attribution across the satisfied tasks and the build converges without manual
  stamps.
- Given a build whose history was rewritten by rebase so pre-hook commits carry no
  usable provenance (the #390 stranded-build shape), when the gate + lane run, then
  satisfying tasks complete via judged stamps — commit metadata is an input signal,
  never a requirement.
- Given worktree COPIES of the three real stranded builds preserved as the live
  acceptance corpus (operator decision, issue #520 comments: #492 mono-attributed
  bundle, #486 zero-evidence 16/16, #390 rebase-rewritten), when each copy is processed
  by `conduct-ts evidence judge`, then each resolves with zero operator evidence work
  (the originals stay untouched until the shipped lane processes them live —
  production success is observed there, per merged ≠ loaded ≠ exercised).

#### Negative Paths
- Given the same #492-shaped fixture but with the diffs for tasks 15–16 removed
  (genuinely unimplemented), when the gate + lane run, then tasks 15–16 remain
  unresolved (`unsatisfied`), no stamp exists for them in any form, and the retry/park
  ladder proceeds — replayed through BOTH invokers (gate lane and
  `conduct-ts evidence judge`).
- Given a fixture where the only "work" is an empty commit with a forged
  `Evidence: satisfied-by` citing an unreachable SHA, when the lane runs, then nothing
  stamps and the existing gate refusal stands.

### Done When
- [ ] A committed fixture corpus (one minimal repo state per shape) exercised by an
      acceptance suite; every happy-path shape converges with zero manual stamps.
- [ ] The unimplemented-residue negative fixture refused in both invokers, asserted on
      sidecar contents and exit/halt behavior.
- [ ] Suite runs in CI (vitest, from `src/conductor`).

---

## Coverage map (review condition 3)

| Escape shape | Story |
|---|---|
| #417 id grammar | 12 |
| #485 paragraph-split trailers | 12 |
| #477/#494 stamping skipped | 12 |
| #505/#509 inline bypass | 12 |
| #501 numeric-vs-string (symptom) | 12 |
| #519/#520 mono-stamp bundle / split | 6, 12 |
| No-whitewash negative (both invokers) | 4, 5, 10, 12 |
| Measurement / false-positive detection | 8, 9 |
