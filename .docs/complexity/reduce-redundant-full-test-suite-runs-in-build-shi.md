# Complexity: reduce-redundant-full-test-suite-runs-in-build-shi

Tier: S

Rationale: Issue #588 asks the pipeline to stop re-running the FULL conductor test suite
multiple times per feature (redundant with CI's authoritative `conductor` job), scoping
intermediate steps to mapped/affected tests and keeping at most ONE full in-pipeline run
at finish. Investigation shows this is a small, mechanical set of text edits to existing
step instructions plus one test-wording update — no architecture, no new subsystem, no
gate-semantics change.

The redundant full-suite runs are exactly three prompt/skill instructions plus one
authoritative CI run (kept):

1. **build_review grader** — `src/conductor/src/engine/build-review-prompt.ts:34-36`
   instructs the grader "Before judging, run the project's test suite yourself". The
   grader receives the full feature diff (`build-review-inputs.ts:70`, `git diff
   mergeBase..HEAD`), so the diff's own/changed test files are derivable — scope the run
   to those. The build_review *gate* is the verdict JSON predicate
   (`CUSTOM_COMPLETION_PREDICATES.build_review`, ADR-2026-07-07 point 4/§52) and its
   rubric is diff-honesty judged **statically from the diff** (ADR §54-56, which itself
   labels counterfactual execution "a future dial"). Narrowing the observation from the
   whole suite to the diff's mapped tests changes no verdict semantics and weakens no
   completion derivation.

2. **TDD per-cycle** — `skills/tdd/SKILL.md:78` (GREEN step 4 "Run the full test suite")
   and `:118` (COMMIT hard-gate item 1 "Full test suite passes"). These already
   CONTRADICT the same file's Verification checklist at `:312-313` ("Scoped affected-test
   set passes before commit (the full suite runs at the feature's final verification
   task, not per-task)"). Reconciling `:78`/`:118` to the already-stated scoped policy is
   a drift fix, not a new decision.

3. **finish (KEEP)** — `skills/finish/SKILL.md:45` ("Full test suite — Run it fresh") is
   the ONE genuine pre-push full-suite gate before ship. It stays; add a one-line note
   that it is the single in-pipeline full-suite checkpoint complementing CI's
   authoritative run. Not weakened.

4. **manual_test (no change)** — `skills/manual-test/SKILL.md` runs the app and exercises
   endpoints/UI (curl/browser) and SKIPs for no-endpoint projects; it does NOT invoke the
   unit suite. The issue's inclusion of manual_test was a filer guess ("Filer's
   guesses"). Nothing to scope there — recorded for completeness.

5. **CI (authoritative, unchanged)** — `.github/workflows/ci.yml` `conductor` job runs
   `npx vitest run` on every PR. This is the authoritative full-suite gate; a ship cannot
   merge on a red CI.

No gate weakening: build_review still gates on its verdict; finish still runs the full
suite; CI is still authoritative on red. No architecture decisions, no conflicts, no new
schema/CLI/hook surface. Estimated 4 tasks (build_review prompt+test; ADR doc-sync line;
TDD reconcile; finish clarify), each a targeted text edit with a real assertion anchor.
Tests under `src/conductor/test/…` (#538 lesson).
