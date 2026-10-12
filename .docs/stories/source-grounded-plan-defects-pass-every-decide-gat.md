**Status:** Accepted

# Stories: Source-grounded adversarial plan review before land (#3038)

**Track:** technical (no PRD). **Tier:** M.
**Design:** `.docs/decisions/adr-2026-10-10-source-grounded-adversarial-plan-review-step.md` (D1–D10),
`.docs/decisions/architecture-review-2026-10-10-source-grounded-plan-defects-pass-every-decide-gat.md`.

Terms used below:
- **Plan review:** the `plan_review` step, reached by `ai-conductor compose plan-review` in a composer
  session or by the step runner under interactive `conduct`.
- **Review artifact:** `.docs/plan-review/<plan-stem>.md`.
- **Blocking finding:** a finding with severity `blocking`.

---

## Story 1: An existing test a plan task would turn red is reported before land

As an operator authoring a Medium or Large spec, I want plan review to report any existing test that a planned task would break without updating, so that the red `test_suite` surfaces in DECIDE instead of BUILD.

### Acceptance Criteria

#### Happy Path
- Given an M-tier plan whose task adds a reference to `stacked_prs` in `land-spec.ts` and a target test that asserts only `engine/config.ts` and `types/config.ts` reference `stacked_prs`, and no task lists that test, when plan review runs, then the review artifact records a test-impact finding naming that test file with its `file:line` and naming the task id.
- Given the same plan with a task whose files list includes that test file and whose Done-when updates the assertion, when plan review runs, then the review artifact records no test-impact finding for that test.

#### Negative Paths
- Given an existing test that references a planned file path only in a comment or an unrelated string and that no task change can affect, when plan review runs, then no blocking test-impact finding is recorded for it, because a candidate that the reviewer rules not to be a defect is never reported as blocking.
- Given a target repository with no test files at all, when plan review runs, then it completes with zero test-impact findings and does not fail.

### Done When
- [ ] A fixture plan reproducing the #3036 `stacked_prs` case yields a test-impact finding citing the test's `file:line` and the task id.
- [ ] A fixture plan that updates the test yields no test-impact finding for it.

---

## Story 2: A new export with no production caller is reported before land

As an operator, I want plan review to report any newly introduced export or primitive that has no named production caller, so that an as-built unreachable-rung BLOCK at SHIP is caught in DECIDE.

### Acceptance Criteria

#### Happy Path
- Given an M-tier plan that introduces an exported function whose only named reader is a future ticket and no task wires it into a production entry point, when plan review runs, then the review artifact records a reachability finding naming the export, the introducing task id, the `file:line` of the plan line that introduces it, and the source paths that were searched for a caller.
- Given a plan that introduces an export and a task whose Done-when observes it through an existing CLI command or step runner caller in source, when plan review runs, then no reachability finding is recorded for that export.

#### Negative Paths
- Given a plan whose architecture review lists a Wiring Surface item that already has a production caller in the target source, when plan review runs, then no reachability finding is recorded for that item.
- Given an architecture review with no `## Wiring Surface` section, when plan review runs, then reachability candidates are still derived from the plan's own exported identifiers and plan review does not fail for the missing section.

### Done When
- [ ] A fixture reproducing the #3036 `projectChildOwnership` case yields a reachability finding naming the export and the introducing task.
- [ ] A fixture whose export is wired by a planned task yields no reachability finding.

---

## Story 3: A Done-when that cannot pass at its dependency position is reported before land

As an operator, I want plan review to report any task whose Done-when relies on something only a task outside its dependency chain creates, so that ordering defects do not halt BUILD.

### Acceptance Criteria

#### Happy Path
- Given a plan where Task 7's Done-when asserts an export that only Task 8 creates and Task 8 depends on Task 7, when plan review runs, then the review artifact records a dependency-order finding naming both Task 7 and Task 8.
- Given a plan where Task 12 needs a config key that Task 4 introduces and Task 12's Dependencies line omits Task 4 directly and transitively, when plan review runs, then a dependency-order finding names Task 12 and Task 4.

#### Negative Paths
- Given a task whose Done-when cites an identifier introduced by a task reachable through its transitive Dependencies closure, when plan review runs, then no dependency-order finding is recorded for it.
- Given a task whose Dependencies line is malformed or cites an unknown task id, when plan review runs, then plan review reports the malformed Dependencies line naming the task instead of silently treating the task as having no dependencies.

### Done When
- [ ] A fixture reproducing #3036's Task 7 and Task 8 ordering yields one dependency-order finding naming both tasks.
- [ ] The dependency graph used by plan review is the same exported parser that `validatePlanSlices` uses, and existing plan-slices behavior is unchanged.

---

## Story 4: Every finding carries severity, location, reference, and evidence

As an operator, I want every plan-review finding to name its severity, the artifact and the task, story or decision it concerns, and evidence from the real source, so that I can act on it without re-investigating.

### Acceptance Criteria

#### Happy Path
- Given plan review produces findings, when the review artifact is written, then each finding shows an id, a severity of blocking or significant or advisory, a lens, the artifact path, a reference written as `task <id>` or a story id or `<adr-stem>#D<n>`, a summary, and its evidence.
- Given any finding, when the review artifact is written, then its evidence includes at least one `file:line` in the worktree, which is a source file outside `.docs/` for a test-impact or feasibility finding; and a contradiction finding's evidence also quotes both opposing passages verbatim.

#### Negative Paths
- Given the reviewer returns a finding with no `file:line` evidence, or a test-impact or feasibility finding whose only `file:line` is not a source file outside `.docs/`, when the engine validates the result, then that finding is rejected and is not written as a finding.
- Given the reviewer's response does not satisfy the findings schema at all, when the engine validates it, then the response counts as a failed dispatch that falls through to the next provider candidate and is not counted as a review round.

### Done When
- [ ] The findings schema is accepted unchanged by the claude, codex strict-mode, and pi structured-output paths.
- [ ] A reviewer response missing required evidence is rejected with a message naming the finding id and the missing field.

---

## Story 5: Feasibility and contradiction are judged against real source by one reviewer

As an operator, I want one fresh reviewer that reads the real source to judge feasibility and every contradiction lens, so that defects like a wrong config source or a refusal that wipes state are caught, and contradiction checking has a single owner at Medium and Large tier.

### Acceptance Criteria

#### Happy Path
- Given a plan that says a runner reads config from a directory that is the feature worktree in the daemon (per the source), when plan review runs, then a feasibility finding cites the source `file:line` that shows the directory passed in production.
- Given a plan whose task's Done-when contradicts an accepted story criterion or an in-scope ADR decision, when plan review runs, then a contradiction finding names the task and the criterion text or `<adr-stem>#D<n>` and quotes both passages.
- Given two tasks where fully completing one invalidates the other's Done-when, when plan review runs, then a contradiction finding names both tasks and quotes both Done-when passages.

#### Negative Paths
- Given a story criterion that is merely uncovered by any task, when plan review runs, then no contradiction finding is recorded for it.
- Given the reviewer session attempts to write or edit a file in the worktree, when the dispatch runs, then the write is refused by the provider's read-only mode and no worktree file has changed when the dispatch returns, before the engine writes the review artifact.

### Done When
- [ ] The reviewer is dispatched in a fresh session with read-only review mode, never in the authoring chat.
- [ ] The reviewer brief enumerates the static contradiction, oscillation, task-versus-task, preserved-behavior, and criterion-conflict lenses.

---

## Story 6: The reviewer runs on a different provider than the author whenever possible

As an operator, I want the reviewer to run on a provider other than the one authoring the spec, so that the review is genuinely adversarial, and I want a missing second provider never to block land.

### Acceptance Criteria

#### Happy Path
- Given a composer session launched by `ai-conductor compose` with Claude as host and codex also configured, when plan review runs with no `steps.plan_review.llm_provider` set, then the reviewer runs on codex and the review artifact records authoring host claude, reviewer provider codex, and independence cross-provider.
- Given `steps.plan_review.llm_provider` is set to pi, when plan review runs, then the reviewer runs on pi regardless of the authoring host.
- Given a session started without the launcher but whose environment carries a host session marker, when plan review runs, then the authoring host is resolved from that marker.

#### Negative Paths
- Given only the authoring host's provider is configured, when plan review runs, then the review runs in a fresh session of that provider, the artifact records independence same-provider, the operator sees a one-line notice, and land is not blocked on that ground.
- Given the other provider fails or is unavailable at dispatch time, when plan review runs, then it falls back to a fresh same-provider session and records same-provider independence.
- Given neither the launcher variable nor any host marker resolves the authoring host, when plan review runs, then the reviewer runs on the first configured provider and the artifact records independence unknown-host.

### Done When
- [ ] `ai-conductor compose` exports `AI_CONDUCTOR_AUTHORING_PROVIDER` into the session it spawns.
- [ ] The review artifact always records the authoring-host, reviewer-provider, and independence fields.

---

## Story 7: Review effort is bounded and remaining findings go to the operator

As an operator, I want plan review limited to one full review plus one re-check, after which I decide what remains, so that review cost per spec has a fixed ceiling.

### Acceptance Criteria

#### Happy Path
- Given round 1 recorded blocking findings and the author changed the plan, when plan review runs again, then round 2 re-checks only the prior blocking and significant findings and the tasks, stories, and ADR decisions whose text changed since round 1, and marks each prior finding resolved or still standing.
- Given round 2 left a blocking finding standing, when the operator runs `ai-conductor compose plan-review --accept <finding-id> --reason "<text>"`, then the review artifact records the acceptance with its reason and that finding no longer blocks land.
- Given round 1 records no blocking findings, when plan review completes, then no operator prompt or decision is requested.

#### Negative Paths
- Given two review rounds have already run, when plan review is invoked again, then no reviewer is dispatched and the command reports that the bound is reached and lists each standing blocking finding for operator disposition.
- Given an `--accept` invocation with an empty reason or an unknown finding id, when the command runs, then it refuses with a message naming the problem and the review artifact is unchanged.
- Given an author hand-edits the review artifact to mark a finding accepted, when land runs, then land refuses because the artifact no longer matches what the primitive wrote.
- Given the bound is reached and the operator edits the plan to fix a standing finding, when the operator runs `ai-conductor compose plan-review --acknowledge --reason "<text>"`, then no reviewer is dispatched and the artifact's reviewed digest is re-stamped over the current plan, stories, and in-scope ADRs.

### Done When
- [ ] No more than two counted review rounds can occur for one plan stem, as recorded in the review artifact's round count; a dispatch whose response fails the schema is not a counted round.
- [ ] Operator acceptances are written only by the plan-review primitive.

---

## Story 8: Land refuses a Medium or Large spec with a missing, stale, or blocking review

As an operator, I want land to refuse a spec whose plan review is missing, out of date, or still blocking, so that blocking defects stop the spec in DECIDE.

### Acceptance Criteria

#### Happy Path
- Given an M-tier spec whose review artifact matches the current plan, stories, and in-scope ADRs and has no unresolved blocking finding, when `ai-conductor compose land` runs, then the plan-review rung passes and land proceeds.
- Given an M-tier spec whose review artifact has a standing blocking finding, when land runs, then land refuses with a plan-review error naming each blocking finding's id, reference, and summary.

#### Negative Paths
- Given an M-tier spec with no review artifact, when land runs, then land refuses with a plan-review error stating that plan review has not run.
- Given the plan was edited after the final review round and the operator recorded no acknowledgement, when land runs, then land refuses naming the changed artifact.
- Given a review artifact that cannot be parsed, when land runs, then land refuses rather than treating it as clean.
- Given land evaluates the plan-review rung, when it runs, then no provider or model is invoked by land.

### Done When
- [ ] Land refusals for plan review use one gate id and name each blocking finding.
- [ ] The review artifact is committed by land with the rest of the spec's `.docs/` set.

---

## Story 9: Clean specs, Small specs, and legacy specs see no added friction

As an operator, I want plan review to add no interaction for clean specs, no change for Small specs, and no halt for specs merged before this feature, so that the new step only costs effort where it finds something.

### Acceptance Criteria

#### Happy Path
- Given an S-tier spec, when the DECIDE steps run and land runs, then plan review is skipped, no review artifact is required, and land behaves exactly as before this feature.
- Given an M-tier merged spec whose `.docs/plan-review/` artifact is absent and whose build is dispatched by the daemon, when the daemon walks DECIDE, then `plan_review` is fast-forwarded as skipped with reason `landed-before-plan-review` and the build proceeds.
- Given an M-tier spec with a clean review artifact merged and dispatched by the daemon, when the daemon walks DECIDE, then `plan_review` is fast-forwarded as done.

#### Negative Paths
- Given an M-tier spec run under interactive `conduct` with no review artifact, when the forward walk reaches `plan_review`, then the step runs plan review rather than skipping it.
- Given an M-tier spec authored before this feature but landed after it, when land runs without a review artifact, then land refuses through the plan-review rung, because the rung has no legacy disengagement.
- Given an S-tier spec whose worktree happens to contain a review artifact, when land runs, then the plan-review rung neither requires nor evaluates it.
- Given a merged M-tier spec whose review artifact is present but still has a standing unaccepted blocking finding, when the daemon walks DECIDE, then `plan_review` is not fast-forwarded and the run halts naming the step.

### Done When
- [ ] `plan_review` is registered after `coherence_check` and skipped for tier S.
- [ ] The daemon legacy fast-forward ships in the same change as, or before, the step registration.

---

## Story 10: Retired judge passes no longer run at Medium and Large tier

As an operator, I want the duplicated contradiction passes removed where plan review now owns them, so that each M/L spec pays for one independent contradiction review instead of several.

### Acceptance Criteria

#### Happy Path
- Given an M-tier spec, when `/plan` completes, then it dispatches the §7a coverage judge and does not dispatch the §7b contradiction judge.
- Given an S-tier spec, when `/plan` completes, then it still dispatches the §7b contradiction judge with the same inputs, conflict rule, and round limit as before this feature.
- Given an M-tier spec, when `/coherence-check` runs, then it records coverage verdicts without re-running the plan §7a coverage judge and without running any contradiction or oscillation sweep.

#### Negative Paths
- Given an M-tier coherence artifact recorded under the new instructions, when the land coherence gate runs, then it accepts the artifact without requiring `CONTRADICTS:` notes or contradiction-derived fail rows.
- Given an M-tier plan that skipped §7b, when plan review has not yet run, then land refuses via the plan-review rung, so no M/L spec lands with no contradiction review at all.

### Done When
- [ ] `skills/plan/SKILL.md` restricts §7b to tier S and names plan review as the M/L owner.
- [ ] `skills/coherence-check/SKILL.md` no longer contains the §4a coverage-judge re-run or §4d, and its `covered` definition and FR tie-out no longer point to §4d.
- [ ] `skills/conflict-check/SKILL.md`, `skills/coherence-check/SKILL.md`, and `skills/plan-review/SKILL.md` carry the same layer-ownership statement: story versus story to conflict-check; cross-layer and task versus task to plan review at M/L and plan §7b at S.

---

## Story 11: Plan-review occurrences are visible on the event spine

As an operator watching a composer or conduct session, I want plan-review dispatches, completions, and acceptances emitted as events, so that the existing event consumers see them without a new log.

### Acceptance Criteria

#### Happy Path
- Given plan review dispatches a reviewer under `ai-conductor compose`, when the dispatch starts and completes, then a `plan_review_dispatched` event carrying round, reviewer provider, and independence and a `plan_review_completed` event carrying those fields plus finding counts by severity are appended to the composer event ledger.
- Given plan review runs under interactive `conduct`, when it completes, then the same event variants are persisted to that run's `.pipeline/events.jsonl`.
- Given the operator accepts a finding, when the acceptance is recorded, then a `plan_review_finding_accepted` event names the finding id.

#### Negative Paths
- Given the event ledger cannot be written, when plan review completes, then the review artifact is still written and the command reports the event-write failure rather than failing the review.
- Given plan review completes, when the worktree's changed and untracked files are listed, then the only files plan review created or changed are the review artifact and the existing event ledgers, with no other log or sidecar file.

### Done When
- [ ] The three event variants are members of the `ConductorEvent` union and pass the existing event schema checks.
