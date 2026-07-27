# Components: Full-suite verification gate (#940)

**Last updated:** 2026-07-25
**Scope:** One reusable, fail-closed full-suite proof shared by the TypeScript
conductor, direct-Claude workflow, earlier broad-test fallbacks, and finish.

## Diagram

```mermaid
graph TD
    subgraph PROJECT["Project declaration"]
        CFG[".ai-conductor/config.yml<br/>NEW: test_suite.command<br/>optional working_directory,<br/>timeout, inputs, environment"]
        TREE["Working tree inputs<br/>source, tests, config, dependencies,<br/>migrations, test infrastructure"]
        ENV["Declared execution-environment inputs"]
    end

    subgraph CORE["Shared TypeScript verification core"]
        SERVICE["NEW: FullSuiteVerifier<br/>resolve aggregate command, calculate<br/>input fingerprint, reuse or execute"]
        EXEC["NEW: bounded command executor<br/>timeout + exit status + actionable output"]
        EVIDENCE[(".pipeline/test-suite-evidence.json<br/>NEW: atomic PASS/FAIL record,<br/>command + fingerprint + timestamps<br/>+ bounded failure evidence")]
        FRESH["NEW: freshness classifier<br/>current / stale / indeterminate<br/>with visible reason"]
    end

    subgraph AUTO["Automated conductor flow"]
        STEPS["steps.ts ALL_STEPS<br/>MODIFIED: test_suite BUILD gate<br/>after wiring_check, before manual_test"]
        ENGINE["Conductor engine<br/>MODIFIED: native test_suite execution<br/>and failure kickback to build"]
        RESUME["complete-verifier<br/>MODIFIED: recheck current suite proof<br/>when resuming completed state"]
        FINISH["finish verification<br/>MODIFIED: reuse current PASS;<br/>invoke verifier only if missing/stale"]
    end

    subgraph DIRECT["Direct-Claude flow"]
        SKILL["NEW: /test-suite skill<br/>after BUILD, before /manual-test"]
        HOST["Host verification interface<br/>configured verifier + shared proof"]
    end

    subgraph EARLY["Earlier broad fallback"]
        FALLBACK["pipeline/TDD guidance<br/>MODIFIED: scoped by default;<br/>full fallback invokes same CLI"]
    end

    PR["/pr guidance<br/>MODIFIED: no local suite"]
    CI["CI full suite<br/>UNCHANGED: independent authority"]

    CFG --> SERVICE
    TREE --> FRESH
    ENV --> FRESH
    FRESH --> SERVICE
    SERVICE --> EXEC
    SERVICE <--> EVIDENCE

    STEPS --> ENGINE
    ENGINE --> SERVICE
    RESUME --> SERVICE
    ENGINE -- "FAIL / unavailable / timeout" --> BUILD["BUILD remediation"]
    ENGINE -- "current PASS" --> SHIP["SHIP validation group"]
    FINISH --> SERVICE

    SKILL --> HOST
    HOST --> SERVICE
    FALLBACK --> HOST

    SHIP --> FINISH
    FINISH --> PR
    PR --> CI
```

## Responsibilities and boundaries

- `test_suite` is a built-in, non-disableable, mechanical BUILD gate. It runs
  after `wiring_check` and before `manual_test`, so a failure can use the
  existing gate loop to reopen `build` before any SHIP validator runs.
- The verification core, not an LLM step, owns command execution and proof
  creation. Direct Claude and any earlier full-suite fallback use the host's
  repository-configured verifier interface; all callers therefore make the
  same run-versus-reuse decision. The interface is not a repository-specific
  command and may use an internal adapter.
- A project declares one authoritative aggregate operation in
  `.ai-conductor/config.yml` under `test_suite.command`. The project—not the
  conductor—owns how that command composes unit, acceptance, and any other test
  categories. The block may also declare a working directory, timeout,
  additional input paths/globs, and environment variable names whose values
  affect verification.
- The input fingerprint covers the suite declaration, resolved executable,
  tracked and untracked non-documentation project inputs, declared additional
  inputs, and declared environment values. Documentation-only changes are
  excluded. Failure to enumerate, resolve, or hash a required input is
  `indeterminate`, which fails closed.
- Evidence is an atomic, gitignored sidecar. Only a successful aggregate result
  whose fingerprint equals the current fingerprint is reusable. A failure
  record is retained for routing and diagnosis but never satisfies the gate.
- `finish` calls the same verifier. In the normal flow it reuses the BUILD-gate
  proof; when invoked standalone or after a relevant mutation, it executes the
  suite and records a replacement proof.
- Completed-state resume checks call the verifier too, so persisted step
  completion cannot make stale suite evidence current.
- `/pr` performs no local suite execution. CI remains a separate run against
  the pushed revision and never trusts local evidence.
- Automated conflict resolution and CI repair retain their current
  post-mutation checks; they are outside this shared-proof optimization.

## Configuration shape

```yaml
test_suite:
  command: "npm test"
  working_directory: "src/conductor"
  timeout_seconds: 1800
  inputs:
    - "test-support/**"
  environment:
    - "CI"
    - "DATABASE_URL"
```

`command` is required and non-empty. Optional keys narrow no defaults:
`inputs` adds project-specific verification inputs, and `environment` names
values to include in the fingerprint. Missing configuration, an unresolved
command, an unreadable input, launch failure, timeout, or non-zero exit all
produce a blocking result with a visible reason.

For this repository, `npm test` resolves to `vitest run`, whose checked-in
configuration includes `test/**/*.test.ts`. That single project command already
contains ordinary unit/integration tests and `test/acceptance/**`; the conductor
does not need a second suite-composition DSL.

## Evidence contract

The sidecar is versioned and records at least:

- outcome (`PASS` or `FAIL`) and reason (`executed`, `reused`, `stale`,
  `missing_config`, `unlaunchable`, `timeout`, or `nonzero_exit`);
- exact resolved command, working directory, start/end times, duration, and
  exit code when available;
- current commit plus a content-derived `inputFingerprint` that also represents
  relevant dirty/untracked inputs;
- the declared environment variable names with values hashed, never stored in
  plaintext; and
- bounded stdout/stderr evidence that retains the beginning and end of output
  so test names and terminal errors remain actionable.

## Legend

- **NEW / MODIFIED** marks components changed by issue #940.
- The direct-Claude path is not a raw-command fallback: `/test-suite` uses the
  same configured verifier and proof contract through the host interface.
- The test runner's own internal caches are opaque. Reuse here means reusing a
  conductor proof for an identical verification fingerprint, not claiming how
  the underlying framework executed its tests.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | DECIDE phase for issue #940 |
| 2026-07-25 | Added completed-state resume verification and bound the diagram to plan Tasks 10–20 | Plan-update architecture pass |
| 2026-07-25 | Replaced direct-command wording with the portable host verifier interface | ADR amendment for issue #940 |
