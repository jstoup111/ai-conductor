# ADR: Engine-owned scoped test invocation

**Date:** 2026-08-01
**Status:** APPROVED (operator-approved 2026-08-01)
**Deciders:** James Stoup (operator), engineer session
**Relates to:** intake jstoup111/ai-conductor#1173
**Builds on:** `adr-2026-07-25-content-addressed-full-suite-proof`, `adr-2026-07-29-deterministic-build-verification-fanout`

## Context

BUILD and `build_review` sessions are instructed to run only the tests a diff exercises
(`HARNESS.md:318-343`, `skills/pipeline/SKILL.md:202-234`, `build-review-prompt.ts:58-60`), and to
route any broad fallback through the shared verifier rather than calling the project's aggregate
command directly. The instruction is sound; the mechanism underneath it is not.

Today an agent expresses "run these files" by hand-assembling a shell command, typically
`npm test -- <files>`. In this repository that silently becomes an aggregate run.
`src/conductor/package.json:11` defines:

```
"test": "vitest run --reporter=dot --silent --slowTestThreshold=1800000 && echo 'AGGREGATE_TEST_SUITE_PASS'"
```

npm appends forwarded `--` arguments to the **end of the whole script string**, so the file paths
land on the trailing `echo`, not on `vitest`. The runner receives no file filter and executes all
9,329 tests while the paths are harmlessly echoed. `test:changed` (`package.json:12`) has the
identical shape and the identical defect. Nothing in the output distinguishes this from a correctly
scoped run, which is why it survived two prior corrective passes.

Those prior passes are the decisive context. **#245** shipped the Scoped VERIFY block and explicitly
deferred engine-side scoped re-execution, which never arrived. **#588** narrowed the grader
instruction from "run the project's test suite" to "run only the scoped tests exercised by this
diff". Both were prompt/documentation-only. This is the third occurrence of the same leak, which
puts it squarely under this repository's Design Principle: when an agent repeatedly violates a rule,
the fix is machinery that rejects at the moment of the mistake, not a stronger prompt.

### The reframing this ADR makes

The intake's framing — and the question originally put to this review — was "validate that
`test_suite.command` does not discard forwarded arguments." That is the wrong target.
`test_suite.command` is the **aggregate** command. `FullSuiteVerifier` invokes it through
`executeFullSuite` (`full-suite-executor.ts:307`) as `execa(command, {shell: true})` and never
forwards arguments to it. An aggregate command that ignores arguments is behaving correctly.
Constraining it would validate a property nothing depends on, while leaving the actual defect —
the scoped path — untouched.

The scoped path is a genuinely different command that has never had a home in the configuration
schema or the engine. It has been improvised by agents at each call site. That improvisation is the
defect.

## Options Considered

### Option A: Validate `test_suite.command` for argument forwarding

- **Pros:** matches the intake's literal wording; no new configuration surface.
- **Cons:** targets the wrong command. The aggregate command legitimately ignores arguments, so the
  rule is meaningless where it is applied and absent where it is needed. It would also retroactively
  invalidate existing consumer configurations that are entirely correct — a breaking change that
  buys nothing. **Rejected.**

### Option B: Intercept and reject aggregate-shaped commands at the tool boundary

- **Pros:** prevents rather than detects; catches hand-assembled commands regardless of shape.
- **Cons:** `hooks/codex/` is empty, so provider parity is net-new work against a
  provider-agnostic requirement. More seriously, the `build_review` grader — the session that
  produced the observed incident — is dispatched with `dangerouslySkipPermissions: true`
  (`step-runners.ts:1727`), so a permission-decision hook may never fire for it. The guard would be
  absent from precisely the path it was built for. **Rejected on feasibility.**

### Option C: Make scoped invocation an engine-owned interface

- **Pros:** the engine assembles the runner argv itself, so npm argument forwarding is never
  involved and the failure mode is structurally absent rather than policed. Provider-agnostic — no
  hook surface, and it works identically for a Claude or Codex session. Gives the scoped path the
  first-class configuration home it has always lacked.
- **Cons:** introduces a configuration key and a CLI verb; an agent that deliberately types the
  aggregate command is still not stopped.

## Decision

Choose **Option C**, with the validation rule moved onto the new surface where it is meaningful.

1. **The engine owns scoped argv assembly.** A scoped run is requested through an engine interface
   that receives a set of test files and constructs the runner invocation itself. It never delegates
   to a package-manager script whose argument-forwarding semantics it cannot control.

2. **A new, additive configuration key describes the scoped runner as a template with an opaque
   `{selectors}` placeholder.** The placeholder makes the injection point *declared* rather than
   positional, which is exactly the property whose absence caused the defect. The engine substitutes
   a caller-supplied selector list into it and **never interprets what a selector means**:

   ```yaml
   scoped_command: npx vitest run {selectors}      # path-selecting runner
   scoped_command: go test {selectors}             # selectors are packages, not files
   scoped_command: dotnet test --filter {selectors} # selectors are filter expressions
   ```

   The placeholder is deliberately **not** named `{files}`. Test runners do not agree that the unit
   of selection is a file — see the Verify-Claims ledger — and a file-shaped contract would be a
   dead end for whole ecosystems while offering nothing extra to the ones it fits. Computing the
   selector list stays with the agent that knows the diff, exactly as the scoped-set derivation in
   `skills/pipeline/SKILL.md:202-234` already does.

3. **Validation of the new key is fail-closed, and applies only to the new key.** A configured
   scoped-run template that does not contain `{selectors}` is a `validation_error`, consistent with
   the existing fail-closed style of the `test_suite` validator (`config.ts:1152-1225`). A template
   without the placeholder would ignore the caller's selection entirely and run whatever the bare
   command runs — the defect in a new costume. Because the key is new and optional, **no existing
   consumer configuration becomes invalid**; the compatibility objection that made a fail-closed rule
   uncomfortable in the original framing does not arise.

4. **An empty selector list is refused, never executed.** This is the load-bearing runtime
   invariant. Substituting an empty list into a template yields the bare command, which for every
   runner family means "run everything" — an aggregate run wearing a scoped invocation's clothes.
   The interface therefore rejects an empty selection with an explicit error rather than executing
   it. An empty affected-set is already an enumerated broad-fallback trigger
   (`HARNESS.md:336`, trigger 3), so the correct response is to route to the shared verifier, not to
   let the scoped path widen itself.

5. **Selectors are delivered intact.** They are passed to the runner without shell-splicing
   ambiguity — quoted, or handed over as argv — so a selector containing a space or a shell
   metacharacter can neither be silently split nor injected.

6. **Absence is explicit, never a silent fallback.** When the key is not configured, the scoped-run
   interface reports that scoped running is unavailable in this project and names the key to
   configure. It must not quietly fall back to the aggregate command — a silent fallback would
   reintroduce the exact failure this ADR exists to remove.

7. **A broad fallback routes; it never expands.** When one of the four `HARNESS.md:333-339` fallback
   triggers fires, the caller invokes the shared verifier (`conduct-ts test-suite` →
   `FullSuiteVerifier.ensure()`), which reuses a CURRENT content-addressed proof without executing.
   The scoped command itself is never widened in place.

8. **`test_suite.command` is left semantically unchanged.** No argument-forwarding constraint is
   placed on it, and the aggregate verifier's fingerprint, lock, evidence, timeout, redaction, and
   reuse behavior are untouched.

9. **This repository's own arg-swallowing scripts are repaired** so the legacy hand-assembled form
   is not a trap for a human or an agent that reaches for it. This is a local correction, not a
   substitute for points 1–6.

10. **The call sites are pointed at the interface**: the grader instruction
   (`build-review-prompt.ts:58-60`), `skills/pipeline/SKILL.md`, `skills/tdd/SKILL.md`, and the
   `HARNESS.md` intermediate test execution policy stop describing a hand-assembled command and name
   the interface instead.

## Verify-Claims Ledger

### Claims

- **Verified (98%):** `src/conductor/package.json:11-12` end in `&& echo 'AGGREGATE_TEST_SUITE_PASS'`;
  npm appends forwarded args to the end of the script string, so `npm test -- <files>` passes the
  paths to `echo` and runs the full suite. Read directly from the file.
- **Verified (97%):** `FullSuiteVerifier` never forwards arguments to `test_suite.command` —
  `executeFullSuite` (`full-suite-executor.ts:307`) runs it via `execa(command, {shell: true})`.
- **Verified (95%):** the scoped-test contract has no engine-side implementation; it exists only as
  prose in `HARNESS.md:318-343`, `skills/pipeline/SKILL.md:202-234`, and `build-review-prompt.ts:58-60`.
- **Verified (95%):** `build_review` is dispatched with `dangerouslySkipPermissions: true`
  (`step-runners.ts:1727`), undermining a permission-hook-based guard for that session.
- **Verified (99%):** the `test_suite` validator returns `validation_error` for malformed input
  (`config.ts:1152-1225`), so fail-closed matches the established convention.
- **Verified (92%):** BUILD sessions do run the aggregate suite in practice — `step_completed`
  events for `step=build` in two worktree `.pipeline/events.jsonl` files report `npm test`.
- **Inferred (80%):** the sampled 9,329-test run was this exact argument-forwarding defect. The
  mechanism is verified and sufficient; the specific historical invocation string was not recovered.

### Corrected assumption (A1) — why the placeholder is `{selectors}`, not `{files}`

An earlier draft of this ADR recorded, as operator-confirmed, that "the scoped runner is expressible
as a template with a **file** placeholder." **That was asserted, not verified, and it is false in the
general case.** The operator challenged it; the correction is recorded here rather than silently
patched, because it changed the contract.

Test runners do not agree on the unit of selection (~90% confidence; basis is the tools' documented
CLIs, not this repository):

| Selection unit | Runners | A file-path list works? |
|---|---|---|
| File paths (trailing args) | vitest, jest, pytest, rspec, minitest, phpunit, mocha, `mix test` | Yes |
| Packages / directories | `go test` (`./pkg/a`) | No — files are not selectable |
| Test-name substrings | `cargo test` | No — no file selection exists at all |
| Filter expressions | `dotnet test --filter FullyQualifiedName~X` | No |
| Class names | Gradle `--tests`, Maven `-Dtest=` | No |

A `{files}` contract fits every stack this harness currently detects (`skills/bootstrap/SKILL.md:136`
recognizes RSpec, Minitest, Jest, pytest; the only shipped tech-context is `rails-postgres`), so it
would have worked today. It would also have been a dead end the moment a Go or JVM project appeared,
and — worse — a template author facing an inexpressible mapping is pushed toward writing a bare
command that silently runs everything, which is the defect this ADR exists to remove.

`{selectors}` removes the assumption instead of confirming it. The engine substitutes opaque tokens
and never interprets them, so the contract is runner-agnostic by construction and there is nothing
left to be wrong about.

### Remaining assumptions

- **A2 (accepted, deliberate):** an agent that deliberately types the bare aggregate command is not
  prevented by this decision. Accepted because the observed failure was accidental expansion, not
  deliberate invocation, and Option B's interception is not feasible for the grader session.
- **A3 (accepted, bounded):** a runner whose selection cannot be expressed as N tokens in a single
  invocation — `cargo test`'s single name filter is the concrete case — cannot use a one-shot
  template. Such projects either author a template that loops or leave the key unconfigured and get
  the explicit "scoped running unavailable" path (Decision 6) plus routing through the aggregate
  verifier. Safe and correct, merely not fast. Impact if wrong: none to correctness; a capability
  gap only.

**Verdict:** CLEAR.

## Consequences

### Positive

- A scoped invocation cannot silently become an aggregate one. Two independent guards close it: no
  argument-forwarding step exists between intent and execution (Decision 1), and an empty selection
  is refused rather than run (Decision 4).
- The scoped path gains a declared configuration surface and a single implementation, instead of
  being re-improvised at every call site.
- Runner-agnostic by construction — the engine never interprets a selector, so path-selecting,
  package-selecting, and filter-expression runners are all expressible without a schema change.
- Provider-agnostic: no hook surface, identical behavior under Claude and Codex.
- No existing consumer configuration is invalidated.

### Negative

- One new configuration key and one new CLI verb to document and maintain.
- Projects that want scoped runs must configure the key; until they do, the interface reports scoped
  running as unavailable rather than silently degrading.
- A deliberately-typed aggregate command remains possible (A2).
- Runners that cannot express N selections in one invocation get no scoped path (A3).
- The contract's correctness now rests on the caller supplying meaningful selectors. The engine can
  guarantee they arrive intact and that the list is non-empty; it cannot guarantee they are the
  *right* selectors, because it does not interpret them. That judgement stays with the agent.
