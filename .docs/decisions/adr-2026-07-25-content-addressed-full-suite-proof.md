# ADR: Content-addressed full-suite proof at the BUILD-to-SHIP boundary

**Date:** 2026-07-25
**Status:** SUPERSEDED in part by `adr-2026-07-29-deterministic-build-verification-fanout` (BUILD-tail ordering and skill surface); previously superseded in part by `adr-2026-07-25-direct-claude-configured-verifier-interface`
**Deciders:** James Stoup (operator), Codex architecture review for issue #940
**Relates to:** `adr-2026-07-12-wiring-check-gate.md`,
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md`, and
`adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`

## Context

The workflow currently asks several independent actors to run a project's full
local test suite. The later callers cannot determine that an earlier successful
run covered the same verification inputs, so an unchanged tree can pay for the
same result repeatedly.

The new proof must satisfy competing constraints:

- fail before SHIP validators so automated delivery can return a regression to
  BUILD;
- remain reusable through re-dispatch, direct-Claude progression, finish, and a
  byte-identical rebase;
- become stale for source, test, config, dependency, migration, test
  infrastructure, relevant environment, and dirty/untracked input changes;
- preserve on documentation-only changes;
- work in heterogeneous consumer projects rather than assuming this repo's
  TypeScript test layout; and
- fail closed when the authoritative suite or its freshness inputs cannot be
  resolved.

Existing `codeStamp` gate evidence is a useful provenance precedent but is not
sufficient here. A SHA-only identity reruns after a byte-identical rebase and
cannot see uncommitted working-tree or declared environment changes.

## Options Considered

### Option A: Keep the full suite in finish

- **Pros:** smallest engine change; standalone finish remains safe.
- **Cons:** failure arrives after SHIP validators and cannot use the normal
  pre-SHIP BUILD kickback; earlier full runs are still invisible to finish.

### Option B: Run the suite inside `build_review`

- **Pros:** failure occurs before SHIP.
- **Cons:** `build_review` is an LLM judgement step, not deterministic engine
  execution; it conflates scoped evaluator evidence with project-wide
  verification and cannot serve direct Claude or standalone finish through one
  shared primitive.

### Option C: First-class mechanical gate with a content-addressed proof

- **Pros:** fails at the right boundary, gives every flow one run/reuse
  decision, survives SHA churn when verification content is identical, and
  observes dirty/untracked inputs.
- **Cons:** adds a configuration contract, content hashing, evidence schema,
  command runner, CLI adapter, and explicit migration for existing projects.

## Decision

> **Ordering and interface amendment (2026-07-29):** The deterministic fan-out
> ADR places `test_suite` beside `wiring_check` immediately after `build`, with
> `build_review` starting only after their joined pass. The engine and
> standalone CLI use `FullSuiteVerifier` directly; there is no test-suite skill.
> All proof, configuration, fingerprint, execution, evidence, and failure
> semantics below remain authoritative.

Choose **Option C**.

1. Add a non-disableable, mechanical `test_suite` BUILD step after
   `wiring_check` and before `manual_test`. It is a gate-loop member. A blocking
   outcome writes actionable evidence and kicks back to `build`; no SHIP
   validation member dispatches first.
2. Add one TypeScript `FullSuiteVerifier` used by:
   - the engine-native `test_suite` step;
   - a thin `conduct-ts test-suite` command used by `/test-suite`;
   - any earlier BUILD fallback that must broaden from scoped tests to the full
     suite; and
   - finish's missing/stale fallback.
3. Require a project-level `.ai-conductor/config.yml` `test_suite` block with a
   non-empty aggregate `command`. The project owns how that command composes
   unit, acceptance, and other categories. Support an optional working
   directory, timeout, additional input globs, and names of environment
   variables whose values affect verification. No inferred default satisfies
   the gate.
4. Calculate a content fingerprint from:
   - the normalized suite declaration;
   - the resolved execution working directory and command;
   - the path, mode, and content of tracked and non-ignored untracked
     non-documentation project inputs;
   - explicit additional inputs, including ignored files when declared; and
   - the names and current values (including unset state) of declared
     environment variables.
5. Record the current commit for provenance, but do **not** include its SHA in
   the reuse identity. The content fingerprint is the reuse key, so an
   identical tree after rebase remains current while a dirty relevant edit
   becomes stale.
6. Write a versioned `.pipeline/test-suite-evidence.json` atomically after every
   execution or fail-closed preflight result. Only `PASS` plus an identical
   current fingerprint satisfies the gate. Record status, reason, command,
   timings, exit code, provenance SHA, and bounded diagnostic output. Secret
   environment values contribute only to the combined fingerprint and are
   never written to evidence.
7. Recalculate freshness at every engine, CLI, and finish entry. Missing
   config, invalid config, unresolved required input, launch failure, timeout,
   or non-zero exit blocks. Indeterminate freshness never reuses evidence.
8. Add `test_suite` to rebase and kickback invalidation/routing surfaces. The
   verifier may immediately preserve it when content is identical; a changed
   fingerprint causes execution before the validation group is allowed to run
   again.
9. Direct Claude gains `/test-suite` between BUILD and `/manual-test`. It calls
   the TypeScript CLI directly. The legacy Bash conductor is unchanged.
10. Remove independent full-suite requirements from ordinary TDD cycles, batch
    boundaries, parallel joins, `build_review`, conduct progression, and `/pr`.
    Scoped/impacted tests remain. Autoresolve and CI-repair post-mutation checks
    remain outside this proof, and CI remains independently authoritative.

## Verified Claims and Assumptions

| Claim | Confidence | Basis / consequence |
|---|---:|---|
| A built-in gate can occupy the requested seam and reopen BUILD. | 98% | **Verified** in `steps.ts`: `wiring_check` is already a gating loop member immediately before `manual_test`; existing conductor wiring handles its BUILD kickback. |
| A step can execute natively without an LLM skill. | 98% | **Verified** by the engine-native `rebase` step and deterministic wiring probe/completion patterns. |
| Direct Claude and finish can call the same TypeScript primitive. | 96% | **Verified** by existing thin CLI adapters such as `manual-test-record` and `finish-record`, both dispatched from `src/index.ts`. |
| The implementation needs no new package or external service. | 95% | **Verified**: Node filesystem, crypto, and child-process APIs plus the existing Git runner cover hashing, atomic evidence, and execution. |
| SHA identity would violate byte-identical-rebase reuse. | 99% | **Verified** conceptually and against the existing SHA-stamped gate model: rebases replace commit IDs even when file content is unchanged. |
| One project-owned aggregate command can include unit and acceptance suites without engine-owned orchestration. | 99% for this repo | **Verified** in `src/conductor/package.json` and `vitest.config.ts`: `npm test` runs `vitest run`, which includes `test/**/*.test.ts`, including `test/acceptance/**`. Other projects declare their own aggregate command. |
| Broad default hashing plus explicit ignored inputs/env names can represent heterogeneous suite inputs. | 90% | **Grounded design constraint**, not an inference about every project. Under-declaration is mitigated by broad non-doc defaults, explicit config, documentation, and fail-closed enumeration. Projects remain responsible for declaring ignored files and environment variables their aggregate suite reads. |
| Existing projects can adopt a required declaration without a silent compatibility fallback. | 93% | **Verified product direction** from FR-9/FR-10. Operational consequence is an intentional migration gate, addressed with bootstrap/migration docs and this repo's own declaration in the same change. |

There is no unconfirmed load-bearing external behavior. The only project-specific
variable—what operation and ignored/environment inputs constitute its
authoritative suite—is made an explicit configuration responsibility instead of
being assumed by the engine.

The operator explicitly aligned with the design and delegated the
single-versus-multiple-command choice to repository evidence. The checked-in
Vitest configuration proves this repository's existing aggregate command
already includes both ordinary and acceptance tests, so the approved boundary
keeps suite composition project-owned.

## Consequences

### Positive

- The normal unchanged flow executes the local full suite once after the last
  relevant mutation and reuses that proof through finish and PR preparation.
- Failures arrive before SHIP and carry deterministic BUILD routing evidence.
- Earlier broad fallbacks become useful proof instead of sunk work.
- Re-dispatch, documentation commits, and byte-identical rebases do not
  invalidate the result merely because time or SHA changed.
- Automated and direct-Claude flows apply the same config, runner, evidence,
  and freshness semantics.

### Negative

- Existing projects must add `test_suite` configuration before they can cross
  the new gate; an upgraded engine intentionally blocks rather than guessing.
- Hashing the relevant working tree adds an O(project-input-size) preflight.
  This should remain small relative to a full suite but needs bounded,
  deterministic tests.
- Project maintainers must declare suite-relevant ignored files and environment
  variables. An omitted dependency can make a proof appear current; docs and
  configuration examples must make that responsibility explicit.
- The `test_suite` step touches central step registries and tail routing, where
  parallel feature work is common. The overlap scan is advisory and planning
  must keep edits narrowly staged.

### Follow-up Actions

- [ ] Add the config schema, validation, documentation, bootstrap/migration
      guidance, and this repository's suite declaration.
- [ ] Implement and unit-test the fingerprint, aggregate-command executor,
      evidence contract, and TypeScript CLI adapter.
- [ ] Insert `test_suite` into step registries, completion/routing, rebase
      invalidation, status events, and prerequisite chains.
- [ ] Add `/test-suite` and update direct/conduct/pipeline/TDD/finish/PR guidance
      to remove independent full runs and use the shared primitive for fallback.
- [ ] Add acceptance coverage for aggregate unit-plus-acceptance execution,
      run, reuse, all invalidation categories,
      docs-only preservation, failures, direct flow, finish fallback, and
      independent CI semantics.
- [ ] Track the harness-integrity-before-every-commit rule as a separate custom
      pre-finish step; it is not part of this suite proof.
