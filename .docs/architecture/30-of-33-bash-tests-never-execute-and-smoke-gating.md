# Components: Shell-test execution and orphan guard

**Last updated:** 2026-10-10
**Scope:** How every `test/*.sh` script reaches execution in CI. A committed manifest feeds a
sandboxed runner in a new CI job. A new integrity check classifies every script and refuses
orphans. A Vitest structural test asserts that every smoke file declares a `smokeCapability`. Existing
integrity-invoked scripts and the existing default-suite smoke exclusion are unchanged.

## Diagram

```mermaid
graph TD
    PR[Pull request] --> CI[.github/workflows/ci.yml]

    CI --> IJ[integrity job - existing]
    CI --> SJ[shell-tests job - NEW]

    IJ --> INT[test/test_harness_integrity.sh]
    INT --> EXIST[Integrity-invoked scripts - existing checks]
    INT --> GUARD[Orphan classification check - NEW]

    SJ --> RUN[test/run_shell_tests.sh - NEW]
    RUN --> MAN[Shell-test manifest - NEW, committed]
    RUN --> SB[Per-script sandbox: fresh HOME and TMPDIR]
    SB --> KEPT[Manifest-listed scripts - kept or fixed orphans]

    GUARD --> ENUM[Enumerate test/*.sh]
    ENUM --> CLS{Classify each script}
    CLS -->|manifest class shell-runner| OK1[pass]
    CLS -->|class integrity, invocation verified| OK2[pass]
    CLS -->|class invoked-by parent, parent non-orphan| OK3[pass]
    CLS -->|class sourced-helper, reason present| OK5[pass]
    CLS -->|missing, unverified, or empty set| FAIL[fail: script named]
    GUARD --> MAN

    CI --> CJ[conductor job - existing npm test]
    CJ --> STR[test/structural/test-execution-policy.test.ts - existing]
    STR --> SMK[Smoke capability assertion - NEW, reuses smoke-runner declaration parser]
    SMK --> SMF[src/conductor smoke files]
    SMF --> DECL{declares smokeCapability?}
    DECL -->|yes| OK4[pass]
    DECL -->|no| FAIL2[fail: smoke file named]

    TRIAGE[One-time orphan triage] -->|passes or fixed| MAN
    TRIAGE -->|broken, duplicated, or obsolete| DEL[Script deleted]
```

## Legend

- **NEW** marks a component this feature adds; unmarked nodes already exist on `main`.
- **Manifest** is the single committed list of scripts the runner executes. The guard reads the
  same list, so the two cannot disagree.
- **Sandbox** means each script runs with a run-scoped `HOME` and `TMPDIR` that the runner creates
  and removes, so installer tests cannot write operator state.
- **Classes** are declared per script in the manifest: `shell-runner`, `integrity`,
  `invoked-by:«script»`, or `sourced-helper`. Every class other than `shell-runner` carries a
  written reason, and the guard verifies each declaration rather than inferring it.
- **Triage** is the one-time disposition of the ~37 current orphans. It is not runtime behavior.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | Intake #1021 — bash tests never executed |
| 2026-10-10 | Classification declared in the manifest, replacing a separate exemption list | Architecture review condition C1 |
| 2026-10-10 | Smoke capability assertion moved from integrity to the Vitest structural test | Architecture review: reuse the one declaration parser |
