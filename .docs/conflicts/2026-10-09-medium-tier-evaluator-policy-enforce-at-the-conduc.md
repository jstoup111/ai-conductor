# Conflict Check: build_review implementation-quality rubric (#475)

**Date:** 2026-10-09
**New stories:** `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md` (Stories 1–6)
**ADR corpus:** `repo_wide`, narrowed to build_review, rubric, config-default, adjudication, model-table, per-child, and skill-catalog subjects
**Result:** PASS after resolution. 2 blocking and 4 degrading conflicts found; all were resolved with operator approval (2026-10-09).

## Conflict: Re-judges story says every runnable rubric is off by default

**Stories involved:** build-review-re-judges Story 1 and Story 2 vs Story 1 (default-on registration)
**Files:** `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The existing story says "every runnable rubric is a registry member that is off by
default". It also says "Given build_review is on with only `test-quality` on, when the step runs,
then exactly one reviewer runs". A default-on `implementationQuality` falsifies both.

**Resolution (applied):** both stories were edited in place. Every member except `implementationQuality`
is off by default, and the one-reviewer case now has every other member disabled.

## Conflict: Security story's no-rubrics PASS now dispatches a grader

**Stories involved:** grade-the-diff-for-security Story 1 vs Story 1
**Files:** `.docs/stories/grade-the-diff-for-security-defects-before-ship-vi.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** state-conflict
**Severity:** blocking

**Description:** "Given an enabled gate with `security` and `testQuality` both disabled, when the lap
runs, then the verdict is PASS with reason `build_review_no_rubrics` and no grader is dispatched."
With `implementationQuality` at its default, this precondition dispatches one grader.

**Resolution (applied):** the criterion was edited in place to require all three members disabled. The plan
carries a task that updates the `build_review_no_rubrics` fixtures in `build-review-coordinator.test.ts`
and `step-runners.test.ts` to disable `implementationQuality` explicitly.

## Conflict: Declared pattern replication would be flagged as duplication

**Stories involved:** ADR declared-pattern-replication D5 vs Stories 2 and 6
**Files:** `.docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** oscillating
**Severity:** degrading
**ADR filename stem:** adr-2026-08-09-declared-pattern-replication-in-build
**Story ID:** 6
**ADR opposing sentence (verbatim):** "A declared replication suppresses the reflex
   duplication flag"
**Story opposing sentence (verbatim):** "Given a diff that adds a block of logic duplicating an existing block in a changed file, when the rubric judges it, then it returns one `duplication` finding anchored to the added hunk, with the existing block named in `evidenceLocations`."

**Description:** Story 2 keeps plan content out of the diff-only projection, so the grader cannot see a
`Pattern-source:` declaration and flags the declared copy. A repair that extracts would undo the
planned copy, and the next lap would re-litigate it until the cumulative cap halts the build.

**Resolution (applied, option: engine suppression):** after judging, the engine suppresses and records
`duplication` findings anchored in a declared target whose evidence names only the declared source.
The projection stays diff-only. Story 6 gained two negative criteria and a Done When item. ADR D5
carries a #475 amendment.

## Conflict: Off-plan quality findings could be graded `beyond`

**Stories involved:** ADR review-bound-by-plan D3 vs Story 4
**Files:** `.docs/decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** contradiction
**Severity:** degrading (latent: no `boundTo` path is live in engine source)
**ADR filename stem:** adr-2026-08-21-review-bound-by-plan-done-when-criteria
**Story ID:** 4
**ADR opposing sentence (verbatim):** "A lap whose only findings are `beyond` resolves PASS, consumes no kickback"
**Story opposing sentence (verbatim):** "Given a lap where `implementationQuality` returns one finding at or above `min_confidence`, when the lap is aggregated, then the outer verdict is FAIL and the finding is passed to the adjudicator as a raw source."

**Resolution (applied):** D3 carries a #475 amendment on the same terms as #2034's `security` amendment.
Implementation-quality findings are never graded `beyond`.

## Conflict: Per-child criterion depends on the unbuilt #3050

**Stories involved:** build-loop child-by-child (#3050, landed, not built) vs Story 2
**Files:** `.docs/stories/build-loop-cannot-complete-a-feature-child-by-chil.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** sequencing
**Severity:** degrading

**Description:** The behaviours are compatible: only `security` gets a `leaf-only` skip. But if #475 builds
first, its per-child Done When item cannot be proven against code that does not exist yet.

**Resolution (applied):** Story 2's per-child criterion is now conditional on #2942 being implemented. If
#475 builds first, the proof belongs to #2942.

## Conflict: Daemon end-to-end fixtures get an unscripted dispatch

**Stories involved:** ci-needs-a-daemon-end-to-end-smoke-step vs Story 1
**Files:** `.docs/stories/ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md` vs `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`
**Type:** overlap
**Severity:** degrading

**Description:** The fixture provider fake (`daemon-e2e-fixture.e2e.test.ts`) and the live tier
(`test/fixtures/live-e2e-run-body.ts`) only account for `testQuality`. A default-on member gets an
unscripted call (a mechanical fault, then a halt), which breaks the story's requirement that the run
is "never a halt and never a park".

**Resolution (applied):** the plan carries a task that disables `implementationQuality` in, or scripts a PASS
payload for, both fixtures.

## Migration note (not a conflict)

`adr-2026-09-10-portable-build-review-policy` D1 rejects built-in ids as custom rubric ids. A consumer
that already declares a custom rubric named `implementationQuality` fails config load after upgrade.
The PR's migration block names this.

## Examined and compatible

- `render-build-review-rubric-events-in-the-daemon-lo.md`: covers the generic no-dispatch case, not defaults.
- The post-join adjudicator and remediation stories: their never-append rule matches Story 4.
- `projects-cannot-add-portable-non-competing-build-r.md`: generic over built-ins.
- `generated-model-table.md` and the two-way risk routing story: a new row fits. The stale build_review `STEP_RATIONALE` text is carried to the plan.
- `build-dispatches-every-plan-task-through-a-full-ge.md` Story 7: governs the batch-boundary (`simplify`) review, which keeps its extraction judgement. Engine suppression applies only to this rubric.
- `adr-2026-07-21-s-tier-pipeline-knobs` D4: S-tier pays one medium-effort dispatch, consistent with the ADR.
- Interim double ownership of duplication (`/pipeline` evaluator and `simplify`): acknowledged and deferred to #3056.

## ADRs

- **Examined:**
  - `adr-2026-08-22-build-review-opt-in-rubric-container`
  - `adr-2026-08-22-one-owner-per-review-question`
  - `adr-2026-10-07-per-child-build-region`
  - `adr-2026-09-10-portable-build-review-policy`
  - `adr-2026-08-21-review-bound-by-plan-done-when-criteria`
  - `adr-2026-08-16-closed-build-review-finding-vocabularies`
  - `adr-2026-08-09-declared-pattern-replication-in-build`
  - `adr-2026-07-21-s-tier-pipeline-knobs`
  - `adr-2026-10-03-stacked-child-plans-identity-and-state`
  - `adr-2026-10-03-per-feature-step-applicability`
  - `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`
- **Narrowed out:**
  - `adr-2026-07-21-completeness-as-build-review-rubric` (fully SUPERSEDED)
  - Default-off-flag ADRs on unrelated subjects (repo-wide ADR sweep, coverage-binding judge, coherence gate, task-stamping demotion, ADR contradiction detection)

## Re-check

After resolution, the six pairs were re-tested in both directions. Engine suppression is applied after
judging, so it is consistent with Story 2's diff-only projection. Suppressed findings are recorded and
never fail a lap, which is consistent with Story 4's FAIL rule for unsuppressed findings. No new conflict
was introduced. **Zero blocking conflicts remain.**
