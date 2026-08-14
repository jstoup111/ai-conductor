**Status:** Accepted

# Stories: Move wiring judgement into build_review

Track: technical. Source: jstoup111/ai-conductor#1496, `adr-2026-08-11-wiring-judged-in-build-review` (APPROVED) and `adr-2026-08-11-deprecated-no-op-step-retirement` (APPROVED).

## Story ST-1496-1: build_review judges wiring reachability

**Requirement:** TI-1 — the reachability judgement moves to `build_review` as a fifth rubric item, gating at every complexity tier.

As the build reviewer, I want to judge whether the diff's new production surface is actually reached from a production entry point so that unwired code fails the build without any plan-authored contract.

### Acceptance Criteria

#### Happy Path

- Given `config.wiring.entry_points` is set, when `build_review`'s prompt is built, then those entry points are rendered into it verbatim as the definition of "production entry point" — the grader is told them, never left to infer them.
- Given a diff whose new exported symbols are each called from a path reaching one of those configured entry points, when `build_review` grades it, then the `wiring` rubric item passes and the verdict is unaffected by wiring.
- Given a diff that adds an exported symbol referenced nowhere outside its own defining file, when `build_review` grades it, then the `wiring` rubric item fails, the verdict is FAIL, and `findings.wiring` names the unreached symbol and the paths searched.
- Given a Small-tier feature, when BUILD runs, then `build_review` still executes and its `wiring` item is judged — the item is never skipped by tier.
- Given the wiring item fails, when the gate kicks back, then it routes to `build` through the existing `build_review` kickback path with no new route.

#### Negative Paths

- Given a symbol is composed within its own defining file by a function that is itself reached from a production entry point, when the wiring item is judged, then it passes — same-file composition is not treated as unwired.
- Given a symbol is referenced only from test files, when the wiring item is judged, then it fails and the finding states that test-only references do not establish production reachability.
- Given the diff adds no new production surface at all, when the wiring item is judged, then it passes rather than failing for absence of evidence.
- Given the wiring item fails, when the finding is written, then it never instructs the reader to edit plan notation, and never cites a `**Wired-into:**` line.
- Given `config.wiring.entry_points` is absent or empty, when the wiring item is judged, then it reports "not judged" and does not fail the build — the item never passes or fails on an undefined premise.

> **Amended 2026-08-13 by #1542:** the observable not-judged state above is represented as
> `skipped: missing-entry-points` and does not dispatch the Wiring rubric branch. It remains visible
> as reduced coverage and is neither a pass nor a failure.
- Given a plan task states in its own Steps that it intentionally ships scaffolding a later task or feature will consume, when the grader judges that task's symbols, then the plan-stated intent is honored and the wiring item does not fail on them — the approved plan is already a grader input, so the committed plan text is the reviewable record of what was left unwired and why.
- Given a symbol is unwired but no plan task states that intent, when the wiring item is judged, then it fails — silence is never an implicit waiver.

### Done When

- [ ] `build_review`'s prompt carries a fifth rubric item phrased as a static property of the diff, not runtime behavior, and does not contradict the existing disclaimer at `build-review-prompt.ts:42-44`.
- [ ] The configured entry points are rendered into the prompt; with the key unset the item is not-judged rather than failing.
- [ ] The all-or-FAIL rule covers five items; a wiring-only failure produces an overall FAIL.
- [ ] An acceptance test drives an unwired export through `build_review` and observes FAIL with the symbol named.

---

## Story ST-1496-2: wiring_check runs as a deprecated no-op

**Requirement:** TI-2 — the `wiring_check` step is retained with all machinery removed, always passing and never failing.

As the conductor, I want `wiring_check` to complete unconditionally so that every existing reference to the step name keeps resolving while its machinery is gone.

### Acceptance Criteria

#### Happy Path

- Given any feature at any tier, when `wiring_check` runs, then it completes successfully without reading a plan, computing a diff, or dispatching an agent.
- Given `wiring_check` runs, when it completes, then a `ConductorEvent` deprecation variant is emitted naming the step and referencing `adr-2026-08-11-wiring-judged-in-build-review`.
- Given that event is emitted, when the daemon renders its log, then the deprecation notice appears through the existing `renderDaemonEvent` switch — no bespoke log line and no sidecar file.
- Given `build_review` declares `prerequisites: ['wiring_check', 'test_suite']`, when the pipeline resolves prerequisites, then both still resolve and the BUILD parallel group keeps both branches.

#### Negative Paths

- Given a repository with no plan, an undeterminable diff base, or an unreadable `.pipeline/`, when `wiring_check` runs, then it still passes — there is no input whose absence can fail it.
- Given a stale `.pipeline/wiring-evidence.json` is present from a prior run, when `wiring_check` runs, then it neither reads nor validates the file and the step still passes.
- Given `wiring_check` runs many times across retries, when the deprecation event is emitted, then the pipeline is not stalled or kicked back by it — the notice is informational only.

### Done When

- [ ] `wiring_check` produces no gaps, no kickbacks, and no evidence artifact under any input.
- [ ] The new `ConductorEvent` variant is persisted to `.pipeline/events.jsonl` by the existing `EventPersister`.
- [ ] No `wiring_check → build` kickback can be emitted by any code path.

---

## Story ST-1496-3: Plans author and land with no wiring contracts

**Requirement:** TI-3 — no DECIDE gate rejects a plan over wiring notation, and the `**Wired-into:**` convention is removed from authoring guidance.

As a plan author, I want to write and land a plan without declaring per-task wiring contracts so that no land is rejected for contract notation.

### Acceptance Criteria

#### Happy Path

- Given a plan carrying no `**Wired-into:**` lines, when `landSpec` runs, then it lands with no wiring-related rejection.
- Given a plan carrying legacy `**Wired-into:**` lines from an earlier feature, when `landSpec` runs, then the lines are ignored as ordinary prose and the land succeeds.
- Given `skills/plan/SKILL.md`, when an author reads it, then it contains no instruction to author, derive, or validate `**Wired-into:**` lines, and its verification checklist has no wiring item.

#### Negative Paths

- Given a plan whose `**Wired-into:**` line is malformed by the old grammar, when `landSpec` runs, then it still lands — malformed wiring notation is no longer a rejection reason.
- Given `conduct-ts validate-wired-into <plan>` is invoked, when the CLI resolves the subcommand, then it reports an unknown subcommand rather than executing, and the subcommand is absent from help output.
- Given `landSpec`'s other gates (protected targets, ADR approval, coherence), when a plan violates one, then it is still rejected — only the wiring anchor gate is removed.

### Done When

- [ ] `land-spec.ts`'s 4b-ii anchor gate and its `validateWiredIntoPlan` import are deleted.
- [ ] `conduct-ts validate-wired-into` is removed from the CLI command table and from `docs/reference/cli.md`.
- [ ] An acceptance test lands a plan containing legacy `**Wired-into:**` text without rejection.

---

## Story ST-1496-4: The wiring machinery is deleted without residue

**Requirement:** TI-4 — the probe and contract modules are removed with no dangling references and a green suite.

As a maintainer, I want the wiring modules gone entirely so that no dead code, vestigial input path, or unreachable branch survives the change.

### Acceptance Criteria

#### Happy Path

- Given the repository after the change, when the project is type-checked and built, then `wiring-probe.ts`, `wired-into.ts`, and `validate-wired-into.ts` are absent and nothing imports them.
- Given `build-review-inputs.ts`, when `build_review` inputs are assembled, then the `BuildReviewGateInstruction` wiring feed is removed rather than left returning an always-empty list.
- Given `artifacts.ts`, when artifacts are resolved, then `WIRING_EVIDENCE`, `validateWiringEvidence`, and the `.pipeline/wiring-evidence.json` glob are absent.
- Given the full test suite, when it runs, then it passes with the six wiring-specific test files deleted.

#### Negative Paths

- Given `plan-task-parse.ts`, when the change is complete, then only `WIRED_INTO_LINE` is removed from it and the documented ESM cycle with `wired-into.ts` is gone — `parsePlanTaskPaths` and `TASK_ID_PATTERN` are untouched.
- Given `types/config.ts`'s `WiringConfig` and the `wiring:` block in `.ai-conductor/config.yml`, when the change is complete, then both are **retained** — the deleted code is the import-graph walk that consumed `entry_points`, not the declaration of what counts as a production entry point.
- Given any remaining module, when searched for `Wired-into`, `wiredInto`, `orphanBackstop`, `checkExportReachability`, or `evaluatePlanWiringDisposition`, then no production reference remains.
- Given `src/index.ts`, when its exports are enumerated, then no deleted symbol is re-exported.

### Done When

- [ ] The three modules and six test files are deleted.
- [ ] No production file references any deleted symbol.
- [ ] Type-check, lint, and the full suite are green.

---

## Story ST-1496-5: Verdict compatibility for the new rubric key

**Requirement:** TI-5 — a verdict artifact lacking the `wiring` key reads as "not judged", never as a pass.

As the conductor, I want older verdicts to be unambiguous so that a pre-change artifact cannot silently satisfy the new rubric item.

### Acceptance Criteria

#### Happy Path

- Given a `.pipeline/build-review.json` written after the change, when it is parsed, then `rubric.wiring` is present as a boolean and `findings.wiring` is present whenever the item failed.
- Given a verdict whose five rubric items all pass, when the all-or-FAIL rule is evaluated, then the overall verdict is PASS.

#### Negative Paths

- Given a `.pipeline/build-review.json` written before the change, with no `wiring` key, when it is parsed, then it is treated as not judged — the step is not considered complete on the strength of that artifact, and it is never read as a wiring pass.
- Given a verdict where `rubric.wiring` is false but `findings.wiring` is missing or empty, when it is validated, then validation fails closed naming the missing findings rather than accepting the verdict.

> **Amended 2026-08-12 by operator recovery:** The criterion above has reversed polarity.
> Each `rubric` boolean marks whether that item failed, so the fail-closed requirement applies
> when `rubric.wiring` is `true`; `false` is the passing value and requires no failure finding.

- Given a verdict where `rubric.wiring` is present but not a boolean, when it is validated, then validation fails closed.

### Done When

- [ ] The verdict schema and its validator carry `wiring` in `rubric` and `findings`.
- [ ] A test asserts a pre-change verdict lacking `wiring` does not satisfy the gate.

---

## Story ST-1496-6: Per-task Files declarations are untouched

**Requirement:** TI-6 — `parsePlanTaskPaths` and the `**Files:**` convention are out of scope and must not regress.

As the protected-artifact seal and the autoheal evidence path, I want per-task file declarations to keep working exactly as before so that removing wiring does not change how plan paths are resolved.

### Acceptance Criteria

#### Happy Path

- Given a plan task with a `**Files:**` line, when `parsePlanTaskPaths` parses it, then `hasFilesLineByTaskId` is true for that task and its declared paths resolve exactly as before the change.
- Given `scanPlanProtectedTargets`, when it runs from any of its four call sites, then it reports the same violations for the same input as before the change.
- Given a commit with no `Task:` trailer, when autoheal's path-fallback runs, then it attributes the commit by declared-path overlap exactly as before.

#### Negative Paths

- Given a plan task with no `**Files:**` line, when the seal scans it, then the existing prose-backtick fallback behavior is unchanged — this change neither widens nor narrows it.
- Given `remediation-append.ts`'s rendered task blocks, when they are parsed, then they still parse via `parsePlanTaskPaths` unchanged.
- Given the diff for this feature, when it is reviewed, then it contains no change to the `**Files:**` grammar, `parsePlanTaskPaths`'s resolution logic, or the seal's branching.

### Done When

- [ ] The existing `parsePlanTaskPaths` and protected-target tests pass unmodified.
- [ ] The diff touches `plan-task-parse.ts` only to remove `WIRED_INTO_LINE`.

---

## Story ST-1496-7: Documentation reflects the new gate placement

**Requirement:** TI-7 — every page describing the wiring gate is updated in the same change.

As a reader of the harness documentation, I want no page to describe a gate that no longer exists so that the docs are not stale on merge.

### Acceptance Criteria

#### Happy Path

- Given `docs/explanation/gates.md`, `docs/reference/steps.md`, `docs/reference/cli.md`, `docs/reference/skills.md`, and `docs/contributing/validation.md`, when each is read, then none describes the `**Wired-into:**` convention, the wiring probe, or `conduct-ts validate-wired-into` as live.
- Given `docs/reference/steps.md`, when it is read, then it documents `wiring_check` as deprecated and no-op, and states the two-phase step-retirement contract from `adr-2026-08-11-deprecated-no-op-step-retirement`.
- Given `HARNESS.md`, when it is read, then it describes wiring reachability as a `build_review` rubric item.
- Given `skills/architecture-review/SKILL.md` §12, when it is read, then the as-built reachability sweep is unchanged in behavior and cites `adr-2026-08-11-wiring-judged-in-build-review` for its relationship to the BUILD-time judgement.

#### Negative Paths

- Given the harness integrity suite, when it runs, then every cross-skill and template reference still resolves after the `skills/plan/SKILL.md` edits.
- Given `skills/plan/SKILL.md`, when its section numbering is validated, then removing §5c leaves no duplicate or dangling section numbers.

### Done When

- [ ] All seven documentation surfaces are updated in the same PR.
- [ ] `test/test_harness_integrity.sh` passes.
