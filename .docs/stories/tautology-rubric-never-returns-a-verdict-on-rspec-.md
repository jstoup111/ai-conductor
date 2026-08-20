**Status:** Accepted

# Stories: Framework-agnostic tautology scoped-run classification

Track: technical. Source: jstoup111/ai-conductor#1682 and
`adr-2026-08-17-framework-agnostic-tautology-scoped-run` (APPROVED).

## Story 1: The counterfactual is classified by exit code on every test runner

**Requirement:** TI-1 — a non-zero counterfactual scoped run is RED evidence regardless of which
framework produced it, and the engine never reads runner output to decide.

As the Tautology preflight, I want to classify the reverted-tree run from its process outcome alone
so that a project using RSpec, `go test`, JUnit, PHPUnit, or any other runner receives the same
verdict a Vitest or pytest project receives.

### Acceptance Criteria

#### Happy Path

- Given the scoped command exits non-zero on the reverted tree and its output is RSpec's
  `N examples, M failures` summary, when the preflight classifies the run, then the result is
  `classification: red` carrying `runKind: nonzero-exit`, and no infrastructure failure is produced.
- Given the same non-zero exit with output the engine has never seen before — `go test` failure
  output, a JUnit surefire summary, or unstructured text — when the preflight classifies the run,
  then the result is identical: `red`, `runKind: nonzero-exit`.
- Given the scoped command exits 0 on the reverted tree, when the preflight classifies the run, then
  the result is `classification: stayed-green` carrying `runKind: passed` and an empty
  `failureExcerpt`.
- Given a non-zero run, when the scoped-run evidence is assembled, then it carries the bounded
  head+tail `failureExcerpt` of the combined output and the selectors actually executed.

#### Negative Paths

- Given a non-zero run whose output happens to contain the string `AssertionError` and another whose
  output contains no recognizable phrase at all, when both are classified, then they produce the same
  `runKind`, proving no output-derived branch survives.
- Given the changed test paths and reverted production are unchanged, when the preflight runs, then
  the scoped command is invoked exactly once — no control run and no second `test_suite` invocation
  is introduced.
- Given the scoped command template is absent or the selector list is empty, when the scoped run is
  attempted, then it resolves as `launch-error` and the preflight settles as an infrastructure
  failure, unchanged from current behavior.

### Done When

- [ ] `classifyTautologyScopedFailure` no longer exists in the codebase.
- [ ] A table test drives real RSpec, `go test`, Vitest, pytest, and unstructured failure output
      through the classification seam and asserts one identical outcome for all five.
- [ ] The preflight invokes `runScoped` exactly once per materialization.

---

## Story 2: Process-level failures remain infrastructure and the union carries no unfounded claim

**Requirement:** TI-2 — the closed result union admits only outcomes the engine observes directly,
and the conditions that genuinely say nothing about the counterfactual still stop the rubric.

As a harness maintainer, I want the narrowed union to keep launch, timeout, and signal outcomes
distinct from a completed non-zero run so that removing the output-derived buckets does not
mistake a process that never ran for a test that failed.

### Acceptance Criteria

#### Happy Path

- Given the scoped command cannot be spawned, when the preflight classifies the run, then the result
  is an infrastructure failure with reason `scoped-run-launch-failed`.
- Given the abort signal fires while the scoped command is running, when the preflight classifies the
  run, then the result is an infrastructure failure with reason `scoped-run-timeout`.
- Given the child process is terminated by a signal, when the preflight classifies the run, then the
  result is an infrastructure failure with reason `scoped-run-signaled`.
- Given the scoped run throws, when the preflight handles it, then the result is an infrastructure
  failure with reason `scoped-run-failed`.

#### Negative Paths

- Given the narrowed union, when the codebase is searched, then no `no-tests` or `collection-failure`
  result kind and no `scoped-run-no-tests` or `scoped-run-collection-failed` reason remains in
  production code, tests, or documentation.
- Given a non-zero completed run, when the preflight classifies it, then it never resolves to any
  infrastructure reason — a completed run is always a counterfactual verdict.
- Given the preflight's non-scoped-run failure paths — no changed tests, no production changes,
  missing scoped configuration, materialization failure, missing merge-base file, abort, cleanup
  failure, cache read/write failure — when each occurs, then its reason and behavior are unchanged
  by this work.

### Done When

- [ ] The result union and the infrastructure reason union each admit exactly the members named in
      the ADR, with no removed member reachable.
- [ ] Every surviving infrastructure reason has a test that produces it.
- [ ] A repository-wide search for the removed strings returns nothing.

---

## Story 3: A run that executed no test is judged, never silently counted as evidence

**Requirement:** TI-3 — the detection deleted from the engine is replaced by an explicit rule in the
judging skill, so a selector that matched no executable test produces a finding rather than a false
RED or a no-verdict.

As an operator, I want a counterfactual that ran nothing to be reported as a Tautology finding I can
act on so that the deleted mechanical bucket does not become a silent pass, and so that this case
stops producing an unroutable infrastructure stall.

### Acceptance Criteria

#### Happy Path

- Given a scoped-run excerpt showing the runner selected and executed no test for a changed-test
  selector, when the Tautology rubric judges the projection, then it returns a judged result
  containing a finding for that selector rather than treating the `red` classification as proof.
- Given an excerpt showing a genuine assertion or example failure, when the rubric judges the
  projection, then the `red` classification is accepted as expected evidence and no finding is raised
  on that ground.
- Given an excerpt showing the changed test could not load on the reverted tree because it references
  a module the diff adds, when the rubric judges the projection, then `red` is accepted as expected
  evidence, consistent with the `#1593` decision.
- Given any of the above, when the rubric returns, then the result is a judged verdict — pass or fail
  — and never an infrastructure result.

#### Negative Paths

- Given the excerpt is ambiguous about whether any test executed, when the rubric judges it, then it
  does not manufacture a no-test finding from absence of evidence.
- Given the run is classified `stayed-green`, when the rubric judges it, then the no-executed-test
  rule does not apply and the existing `stayed-green` obligations are unchanged.
- Given a selector covered by one of the four closed exceptions, when the rubric judges it, then the
  exception applies as before and the no-executed-test rule does not override it.

### Done When

- [ ] `skills/build-review-tautology/SKILL.md` states the rule, its scope, and that it yields a
      finding rather than an infrastructure result.
- [ ] The skill's documented `runKind` value set matches the narrowed union.
- [ ] The skill's prose passes the provider contract audit.

---

## Story 4: An infrastructure-failed scoped run leaves its output retrievable

**Requirement:** TI-4 — when the preflight settles as an infrastructure failure, the runner output
that explains why is retained on the event spine rather than discarded with the disposable checkout.

As an operator diagnosing a rubric that returned no verdict, I want the scoped run's stdout and
stderr available after the fact so that I am not left with a bare reason label and a deleted
checkout.

### Acceptance Criteria

#### Happy Path

- Given a scoped run that fails to launch, times out, or is signaled, when the preflight returns its
  infrastructure failure, then the result carries a bounded head+tail excerpt of the combined
  stdout and stderr.
- Given that infrastructure failure reaches the rubric coordinator, when the rubric settles, then the
  emitted `build_review_rubric_infrastructure_failure` event carries the excerpt alongside its
  existing rubric, lap, and reason fields.
- Given the event is emitted, when the run's event ledger is read, then the excerpt is present in
  `.pipeline/events.jsonl` through the existing persister with no new file, ledger, or format.
- Given output larger than the excerpt cap, when the excerpt is produced, then it is truncated
  head+tail with the explicit truncation marker and never exceeds the cap.

#### Negative Paths

- Given an infrastructure failure with no runner output — no changed tests, missing merge-base file,
  materialization failure, cache read or write failure — when the result is produced, then the
  excerpt field is absent and nothing is fabricated.
- Given an existing consumer that reads the event without knowing the new field, when it parses an
  event carrying an excerpt, then it continues to parse successfully, because the field is additive
  and optional.
- Given the disposable checkout is removed on every outcome, when an infrastructure failure occurs,
  then no evidence is written into `.pipeline/build-review-preflight/` or any other sidecar path.

### Done When

- [ ] The infrastructure-failure result and the event variant each carry the optional excerpt.
- [ ] A test asserts the excerpt survives to the emitted event for a launch, timeout, and signal
      outcome.
- [ ] A test asserts no excerpt is fabricated for the output-free infrastructure reasons.
