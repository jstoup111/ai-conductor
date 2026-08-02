**Status:** Accepted

# Stories: Scoped invocation cannot expand to the aggregate suite

**Track:** technical (no PRD — these stories are the acceptance-criteria artifact)
**Tier:** Medium
**Intake:** jstoup111/ai-conductor#1173
**Binding ADRs:** `adr-2026-08-01-engine-owned-scoped-test-invocation`,
`adr-2026-08-01-scoped-run-verb-release-surface`

## Technical requirements

Technical-track traceability anchors. Each maps an intake desired outcome or an approved ADR
decision to the stories that satisfy it.

| ID | Requirement | Source |
|---|---|---|
| TR-1 | A scoped run executes only the caller's selection, with the engine assembling the invocation | ADR-1 D1, D2 |
| TR-2 | A configured scoped-run template that would ignore the caller's selection is rejected at config load | ADR-1 D3 |
| TR-3 | An empty selection is refused, never executed | ADR-1 D4 |
| TR-4 | Selectors reach the runner intact | ADR-1 D5 |
| TR-5 | An unconfigured scoped-run key is explicit, never a silent aggregate run | ADR-1 D6 |
| TR-6 | Aggregate verification semantics are unchanged | ADR-1 D7, D8 |
| TR-7 | No invocation form in this repository silently expands a scoped request | ADR-1 D9 |
| TR-8 | Call sites request scoped runs through the interface rather than hand-assembling a command | ADR-1 D10 |

**Intake outcome coverage.** "A scoped BUILD or review command cannot silently expand into the
aggregate suite" is satisfied by TR-1 through TR-5, TR-7, and TR-8. "Missing, stale, or failed
aggregate evidence still causes the authoritative suite to run and block progression on failure" is
preserved, not extended, by TR-6. The intake's remaining outcomes (evidence reuse across gates,
review size/duration targets, model-tier shadow calibration) are **out of scope by operator
decision** and are owned by #1176 and #1205.

---

## Story 1: Scoped run executes only the selected tests

**Requirement:** TR-1

As the engine, I want to own assembly of the scoped test invocation so that a caller's selection
reaches the runner without passing through a package-manager script whose argument handling I do not
control.

### Acceptance Criteria

#### Happy Path
- Given a project whose scoped-run template is configured and whose test suite contains both a
  selected and an unselected test file, when a scoped run is requested with only the selected file
  as its selector, then only the selected file's tests execute and the unselected file's tests do
  not appear in the run.
- Given a scoped-run request with three selectors, when the run is invoked, then all three selectors
  are present in the executed command in the position the template's placeholder occupies.
- Given a scoped run whose selected tests all pass, when the run completes, then the interface exits
  zero and reports the scoped result.
- Given a scoped run in which one selected test fails, when the run completes, then the interface
  exits non-zero and the failure is attributable to the selected test.
- Given a template whose placeholder appears mid-command rather than at the end, when a scoped run
  is invoked, then the selectors are substituted at the placeholder's position and the trailing
  portion of the template is preserved.

#### Negative Paths
- Given a configured template, when the underlying runner exits non-zero because a selected test
  failed, then the interface reports a test failure and does **not** retry with a broader selection.
- Given a configured template whose command cannot be launched at all (binary not found), when a
  scoped run is requested, then the interface reports a launch failure naming the command, and does
  **not** fall back to the aggregate command.
- Given a scoped run whose runner exceeds the configured timeout, when the timeout elapses, then the
  interface terminates the run and reports a timeout, without escalating to an aggregate run.
- Given a scoped run request, when it completes for any reason, then no write occurs to
  `.pipeline/test-suite-evidence.json` — a scoped run never produces aggregate proof.

### Done When
- [ ] `conduct-ts <scoped-run verb> <selectors...>` runs and exits zero on an all-passing selection
      and non-zero on a failing one.
- [ ] A test asserts that a two-file project given one selector executes exactly one file's tests.
- [ ] A test asserts the executed command string contains all supplied selectors at the placeholder
      position, including a mid-template placeholder case.
- [ ] A test asserts `.pipeline/test-suite-evidence.json` is unmodified after a scoped run.
- [ ] The verb is registered in the `conduct-ts` dispatch under `src/conductor/`, and `bin/conduct`
      is unmodified in the diff.

---

## Story 2: A scoped-run template that ignores the caller's selection is rejected

**Requirement:** TR-2

As an operator, I want a scoped-run template that omits the selector placeholder to be rejected when
configuration loads so that I cannot ship a template which silently runs the whole suite on every
scoped request.

### Acceptance Criteria

#### Happy Path
- Given a scoped-run template containing the selector placeholder, when configuration is loaded,
  then validation succeeds and the template is available to the interface.
- Given a configuration with no scoped-run key at all, when configuration is loaded, then validation
  succeeds — the key is optional and its absence is not an error.
- Given an existing configuration that predates this feature and declares only the aggregate
  `test_suite` keys, when configuration is loaded, then validation succeeds unchanged.

#### Negative Paths
- Given a scoped-run template with no selector placeholder, when configuration is loaded, then
  validation fails with a `validation_error` whose message names the key and the required
  placeholder, and the engine does not treat the template as usable.
- Given a scoped-run template that is present but an empty or whitespace-only string, when
  configuration is loaded, then validation fails with a `validation_error`.
- Given a scoped-run template that is a non-string value (number, list, object), when configuration
  is loaded, then validation fails with a `validation_error` rather than coercing the value.
- Given an unknown key alongside the scoped-run key inside the `test_suite` block, when
  configuration is loaded, then the existing unknown-key rejection still fires — adding this key
  does not widen the allowed set beyond itself.

### Done When
- [ ] Loading a config whose scoped-run template lacks the placeholder returns a `validation_error`
      naming both the key and the placeholder.
- [ ] Loading a config with the key absent succeeds, proving the key is additive and optional.
- [ ] A regression test loads a pre-feature `test_suite` block verbatim and asserts it still
      validates, proving no existing consumer configuration is invalidated.
- [ ] Empty-string, whitespace-only, and non-string template values each produce a
      `validation_error`.
- [ ] `docs/reference/configuration.md`'s `test_suite` table lists the new key with its validation
      rule.

---

## Story 3: An empty selection is refused, never executed

**Requirement:** TR-3

As the engine, I want to refuse a scoped run whose selector list is empty so that the substitution
cannot produce the bare command — which for every runner means "run everything" and is precisely the
accidental aggregate run this feature exists to prevent.

### Acceptance Criteria

#### Happy Path
- Given a configured template and a selector list with at least one entry, when a scoped run is
  requested, then the run proceeds normally.

#### Negative Paths
- Given a configured template, when a scoped run is requested with zero selectors, then the
  interface refuses, exits non-zero, and executes **no** test command at all.
- Given a scoped run refused for an empty selection, when the caller reads the result, then the
  message states that an empty selection is an aggregate run and directs the caller to the shared
  aggregate verifier, matching broad-fallback trigger 3.
- Given a scoped run requested with selectors that are all empty or whitespace-only strings, when
  the interface evaluates the selection, then it is treated as empty and refused — an
  all-whitespace list must not substitute into a command that runs everything.
- Given an empty selection is refused, when the refusal completes, then no test process is spawned,
  verifiable by the absence of any runner invocation.

### Done When
- [ ] A scoped run invoked with zero selectors exits non-zero and spawns no child process.
- [ ] A test asserts the refusal message names the aggregate verifier as the correct route.
- [ ] A test asserts a selector list of `["", "  "]` is refused identically to a zero-length list.
- [ ] A test asserts that no runner command is executed on the refusal path, not merely that the
      exit code is non-zero.

---

## Story 4: Selectors reach the runner intact

**Requirement:** TR-4

As the engine, I want each selector delivered to the runner without shell-splicing ambiguity so that
a selector containing a space is not split into two, and a selector containing shell metacharacters
cannot alter the command that runs.

### Acceptance Criteria

#### Happy Path
- Given a selector containing a space, when the scoped run executes, then the runner receives it as
  one argument and the corresponding tests run.
- Given selectors containing characters ordinary to test paths and filters — `-`, `_`, `.`, `/`,
  `~`, `:` — when the scoped run executes, then each arrives unaltered.
- Given a selector that is a filter expression rather than a path, when the scoped run executes,
  then it is passed through unchanged and uninterpreted by the engine.

#### Negative Paths
- Given a selector containing a shell metacharacter sequence such as `; rm -rf .` or `$(id)`, when
  the scoped run executes, then the sequence is passed as literal argument text and no additional
  command is executed.
- Given a selector containing a double quote or single quote, when the scoped run executes, then
  quoting is preserved and the command does not fail to parse.
- Given a selector beginning with a hyphen, when the scoped run executes, then it is delivered
  without being silently dropped by the substitution.

### Done When
- [ ] A test runs a scoped selection whose path contains a space and asserts exactly one selector
      arrives at the runner (condition C3).
- [ ] A test supplies `; echo INJECTED` as a selector and asserts the marker never appears in
      output and no extra process runs.
- [ ] A test asserts quote-bearing and hyphen-leading selectors survive substitution unaltered.

---

## Story 5: An unconfigured scoped-run key is explicit, never a silent aggregate run

**Requirement:** TR-5

As an agent running a BUILD or review step, I want an unavailable scoped path to say so plainly so
that I route to the aggregate verifier deliberately instead of discovering later that I ran the
whole suite by accident.

### Acceptance Criteria

#### Happy Path
- Given a project with the scoped-run key configured, when a scoped run is requested, then it
  executes and no unavailability message appears.

#### Negative Paths
- Given a project with no scoped-run key configured, when a scoped run is requested, then the
  interface reports scoped running unavailable, names the configuration key required to enable it,
  and exits non-zero.
- Given a project with no scoped-run key configured, when a scoped run is requested, then the
  aggregate `test_suite.command` is **not** executed — verifiable by asserting no runner process is
  spawned.
- Given a project with no configuration file at all, when a scoped run is requested, then the
  interface reports the missing configuration rather than throwing an unhandled error.
- Given a project whose scoped-run key is configured but whose `test_suite` block is absent, when a
  scoped run is requested, then behavior is determined by the scoped key alone and does not depend
  on aggregate configuration being present.

### Done When
- [ ] A scoped run in a project without the key exits non-zero with a message naming the key
      (condition C4).
- [ ] A test asserts no child process is spawned on the unavailable path — proving the absence of a
      silent aggregate fallback.
- [ ] A test covers a project with no config file and asserts a handled, described failure.

---

## Story 6: Aggregate verification semantics are unchanged

**Requirement:** TR-6

As the operator, I want the aggregate verifier's behavior to be provably untouched by this feature
so that adding a scoped path cannot weaken the gate that blocks progression on a failing suite.

### Acceptance Criteria

#### Happy Path
- Given an unchanged tree with current aggregate evidence, when the aggregate verifier is invoked,
  then it still reports reuse without executing the suite, exactly as before this feature.
- Given a tree whose source has changed since the last aggregate proof, when the aggregate verifier
  is invoked, then it still executes the suite and writes fresh evidence.
- Given an aggregate command that ignores any arguments appended to it, when the aggregate verifier
  invokes it, then this remains valid — no argument-forwarding constraint is applied to
  `test_suite.command`.

#### Negative Paths
- Given a failing aggregate suite, when the aggregate verifier runs, then it still fails closed and
  still blocks progression — the scoped path provides no route around it.
- Given a scoped run has just completed successfully, when the aggregate gate is subsequently
  evaluated, then the scoped result does **not** satisfy it; aggregate proof is still required.
- Given aggregate evidence that is missing, corrupt, or records a failure, when the aggregate
  verifier is invoked, then it still executes the suite rather than treating any scoped result as a
  substitute.

### Done When
- [ ] Existing `full-suite-verifier`, `full-suite-evidence`, and `full-suite-fingerprint` test
      suites pass unmodified.
- [ ] A test asserts a successful scoped run leaves the `test_suite` gate unsatisfied.
- [ ] The diff contains no semantic change to `test_suite.command` validation and no change to
      `FullSuiteVerifier`'s execution, locking, or evidence paths.

---

## Story 7: No invocation form in this repository silently expands a scoped request

**Requirement:** TR-7

As a developer or agent working in this repository, I want the package scripts to forward arguments
to the test runner so that the legacy hand-assembled form is not a trap that runs 9,329 tests while
appearing scoped.

### Acceptance Criteria

#### Happy Path
- Given the repaired `test` script, when it is invoked with forwarded test-file arguments, then the
  runner receives those arguments and executes only the named tests.
- Given the repaired `test` script, when it is invoked with no arguments, then it still runs the
  full aggregate suite exactly as the `test_suite.command` gate requires.
- Given the repaired `test:changed` script, when it is invoked with forwarded arguments, then those
  arguments reach the runner rather than a trailing shell command.

#### Negative Paths
- Given the repaired `test` script invoked with forwarded arguments, when the run completes, then
  the argument values do not appear as echoed output — proving they reached the runner and not a
  trailing `echo`.
- Given the aggregate success sentinel that downstream tooling relies on, when the repaired script
  completes successfully with no arguments, then the sentinel is still emitted.
- Given the repaired script invoked with arguments that select a failing test, when the run
  completes, then the script exits non-zero and the sentinel is not emitted.

### Done When
- [ ] `npm test -- <one test file>` in `src/conductor` executes only that file's tests, verified by
      the reported test count being far below the full-suite count.
- [ ] `npm test` with no arguments still runs the full suite and still emits the aggregate sentinel
      on success.
- [ ] `test:changed` is repaired with the same shape and verified the same way.
- [ ] A test or check asserts forwarded arguments never appear as echoed output.

---

## Story 8: Call sites request scoped runs through the interface

**Requirement:** TR-8

As the harness, I want the BUILD and review contracts to name the scoped-run interface rather than
describe a hand-assembled command so that the machinery and the instructions agree and agents stop
reinventing the invocation.

### Acceptance Criteria

#### Happy Path
- Given the `build_review` grader prompt, when it instructs the grader to run scoped tests, then it
  names the scoped-run interface rather than a package-manager command.
- Given the pipeline and TDD skill contracts, when they describe scoped verification, then they
  direct the reader to the interface for invocation while leaving selection derivation unchanged.
- Given the HARNESS intermediate test execution policy, when it describes the four broad-fallback
  triggers, then it still routes broad fallback to the aggregate verifier and now routes scoped runs
  to the interface.

#### Negative Paths
- Given the updated call sites, when they are searched for the hand-assembled form, then no call
  site instructs an agent to append test files to a package-manager script.
- Given the grader prompt after the change, when its structural isolation is checked, then it still
  receives only the diff and plan body — no scoped-test summary, command output, or maker narrative
  is introduced, preserving the existing isolation contract.
- Given the updated skill contracts, when the four broad-fallback triggers are checked, then all
  four remain present and unmodified — this feature changes how a scoped run is invoked, not when a
  broad run is permitted.

### Done When
- [ ] The grader prompt names the interface, and the existing grader-prompt and grader-isolation
      tests still pass, proving inputs were not widened.
- [ ] `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md` describe invocation via the interface.
- [ ] `HARNESS.md`'s intermediate test execution policy reflects the interface and retains all four
      fallback triggers verbatim.
- [ ] A repository search confirms no remaining instruction to append test files to a
      package-manager script.

---

## Scope exclusions

These are deliberately absent and must not be added to this feature (condition C5):

| Excluded | Owner |
|---|---|
| Reusing one aggregate result across multiple gates for an unchanged tree | #1176 (and already built in `FullSuiteVerifier`'s reuse path) |
| Reducing BUILD post-task tail latency or removing fixed cooldowns | #1176 |
| Reducing review output size or duration against a measured baseline | #1176 |
| Model-tier or reasoning-effort reduction, shadow-evaluated | #1176 |
| Partial sibling BUILD-verification capability after rebase | #1205 |
