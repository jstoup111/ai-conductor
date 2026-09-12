# Architecture Review: Support multiple test suites in BUILD

**Date:** 2026-09-11
**Tier:** Medium — lightweight feasibility and architectural alignment review
**Input:** Approved PRD `../specs/2026-09-11-support-multiple-test-suites-in-build.md`, confirmed track/scope, and the two operator-approved diagrams.
**Source:** jstoup111/ai-conductor#2358
**Verdict:** APPROVED WITH CONDITIONS
**Operator approval:** James Stoup approved this contract and its ADR amendments in composer chat on 2026-09-11. Implementation conditions below remain binding.

## Feasibility

The feature fits the current TypeScript engine and existing process-runner seam. It requires no new package, external service, provider adapter, test framework, background worker, or database. The command collection remains one aggregate operation under the current verifier lock.

The integration surface is configuration validation, aggregate execution, fingerprinting, versioned evidence, verifier result construction, CLI diagnostics, BUILD failure routing, and existing event consumers. This is a coordinated extension of an existing boundary, not a second verification subsystem. #658 consumes the capability separately and does not block this work.

Existing isolation is retained: configuration and proof resolve from the caller's project/worktree; processes use project-contained directories; the existing lock and process-tree cleanup cover execution. Tests must replace the process boundary or use controlled local fixtures, never real third-party services or operator tmux sessions.

Performance grows with the declared operations' total execution time and result count. Execution is serial. Each operation receives its own timeout; there is no new collection-wide timeout or parallel scheduler. Diagnostic payloads remain bounded as described below, while result metadata necessarily grows with the number of configured operations.

## Alignment

Governing decisions, in authority order:

- `adr-2026-07-25-content-addressed-full-suite-proof`: retain the single verifier, whole-project input proof, atomic evidence, inspection, and failure semantics. Amend only the single-command restriction and scalar-only execution record for list-form aggregate execution.
- `adr-2026-07-29-deterministic-build-verification-fanout`: preserve engine-owned verification and the existing BUILD boundary. The ordered list is internal to the aggregate member, not a new group of steps.
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode`: retain scoped selection, aggregate fallback, caller-owned drift-preservation recording, and unbudgetable project-configuration changes.
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`: declare production consumers for every accepted new key in the existing registry/test machinery.
- `adr-2026-07-26-event-sink-registry-exhaustiveness`: extend the existing event union/registry and deliberately wire outcome rendering and persistence.

The former single-command choice is no longer sufficient for the approved #2358 outcomes. The existing governing ADR already owns aggregate execution and proof; additive amendments to its decisions 3 and 6 are sufficient. No uncovered service boundary, persistence store, integration mechanism, or foundational technology is introduced, so no new ADR is created.

Local pattern basis: reuse `executeFullSuite`'s injected runner, typed failure classifications, timeout cleanup, and verifier persistence/read-back. These traits are appropriate because each list entry is the same project-owned command operation the scalar path already supports. A bounded variation adds ordered result composition; it must not duplicate process execution, invent runner detection, or parse diagnostics to decide pass/fail. The existing evidence reader is the compatibility boundary, not each downstream consumer.

## Configuration Contract

1. Add optional `test_suite.commands`, a non-empty array of objects with exactly `command`, optional `working_directory`, and optional `timeout_seconds`. `command` is a required non-empty string. Unknown entry keys are rejected. No suite name, runner kind, output grammar, plugin, or registry is required.
2. `command` and `commands` are mutually exclusive aggregate forms. `scoped_command` may coexist with either. Existing scoped-only config-load acceptance remains as it is today, but aggregate verification still requires one aggregate form. The error must mention both supported aggregate alternatives.
3. An entry directory overrides the shared `test_suite.working_directory`; otherwise it inherits that value, then defaults to the project root. Every explicit directory is relative to the project root, never relative to the shared directory or previous entry. An entry timeout overrides the shared timeout; otherwise it inherits that value, then the existing 1800-second default. Shared settings retain their current meaning for `scoped_command`.
4. Validate the entire declaration before executing any entry. Apply existing relative-path, realpath/symlink containment, and finite-positive-timeout checks to each entry, with an indexed key such as `test_suite.commands[1].working_directory` in errors. A missing/unusable execution directory fails preflight with entry context, not after an earlier entry has run. Preserve the existing execution-boundary containment checks and cleanup semantics.
5. A shared resolution function produces ordered effective entry descriptors for execution and fingerprinting. It belongs in a focused engine module (`full-suite-commands.ts` is the candidate), used by production callers. Preserve scalar serialization/fingerprinting on the scalar path rather than forcing legacy proof through list normalization.
6. Use the existing configuration loading and array-replacement merge rules. Do not change project-versus-user precedence or add a special merge policy. Any merged result carrying both aggregate forms fails validation with the same actionable ambiguity error.

Illustrative configuration:

```yaml
test_suite:
  timeout_seconds: 900
  commands:
    - command: ./verify
      working_directory: backend
    - command: ./check
      working_directory: frontend
      timeout_seconds: 300
```

The scripts are examples of project-owned commands, not scripts the harness creates. Any launchable shell command is supported under the existing shell-runner contract.

## Execution and Result Contract

- The existing aggregate executor iterates effective entries in declaration order. It awaits one command and its existing cleanup before starting the next. Every attempt is identified by its zero-based declaration index; operator display also gives an ordinary `Suite 2/3` ordinal and sanitized command/directory.
- The first nonzero exit, timeout, signal, launch failure, or internal execution failure ends the operation. Preserve the current distinction between `nonzero_exit` and infrastructure failures; multiple suites must not change retry budgets or turn a timeout into a semantic code failure.
- Success requires a completed successful result for every declared entry. Store attempted results as a contiguous prefix and the declared count. A failed prefix ends in the failing entry; the remainder is unexecuted, not skipped-success. Preflight failure contains no attempted entry. Never synthesize per-entry passes from an aggregate exit code.
- Each attempted entry carries its index, sanitized command and effective directory, timestamps, duration, success or typed failure, exit code when available, signal when applicable, and bounded diagnostic output. Aggregate duration measures the whole collection; an entry timeout is not an aggregate timeout.
- A later retry reruns the collection under the existing verifier policy. This feature introduces neither partial-pass caching nor resume-from-failed-entry behavior.
- `executeScopedFullSuite` remains on its current runner path. Only the existing empty-selection aggregate fallback runs the full list. It retains its explicit execution-basis marker.

## Evidence and Compatibility

The evidence file remains `.pipeline/test-suite-evidence.json` with atomic replacement and mandatory read-back before success. No separate per-suite ledger is introduced.

Use a versioned reader/writer union:

- **Version 4 remains the scalar/scoped evidence contract.** Existing scalar aggregate configurations continue to write/read v4 and preserve their current fingerprint serialization. Valid, current v4 proof is reusable without a forced upgrade run. Actual scoped execution also keeps its current v4 behavior, including selector and execution-basis checks.
- **Version 5 records list-form aggregate execution.** Keep the existing aggregate envelope fields and add required `plannedEntryCount`, `entries`, and `failedEntryIndex`. For success, `entries` contains exactly the planned count of contiguous successful indices and `failedEntryIndex` is null. For an execution failure, the last attempted entry is the sole failure and its index equals `failedEntryIndex`; later entries are absent. Preflight failure has an empty attempted list and null failed index; use a null planned count when declaration validation prevented resolution.
- On list-form success the aggregate scalar `command` and `workingDirectory` fields are null; per-entry fields are authoritative. On execution failure they identify the failed entry for established diagnostic consumers. Aggregate stdout/stderr contain the bounded summary/failing-entry diagnostic, not a concatenation that can push the failure out of view.
- The reader validates version-specific invariants, nonnegative/finite timing, contiguous indices, declared counts, and typed termination before returning usable proof. A v4 **aggregate** pass cannot satisfy list configuration, including a one-entry list. A v5 partial, contradictory, malformed, unsupported, or unreadable record never satisfies verification. V3 remains unsupported; do not revive obsolete compatibility merely because the reader gains v5.
- In scoped mode with non-empty selection, v4 scoped proof remains eligible under existing selector/basis checks even when the configured aggregate fallback uses a list. The normalized fingerprint still includes that aggregate declaration, so changing it invalidates the proof as project-configuration drift. An empty-selection fallback requires complete v5 list proof.
- Preserve redaction for every persisted or displayed command, path, stdout, stderr, and failure message. Keep the existing per-field 16,384-character ceiling and an additional shared 16,384-character budget for the collection's entry stdout/stderr payload; allocate failing-entry output first, then remaining attempted entries in order, truncating explicitly. Metadata is not discarded to meet the output budget. For large collections the metadata remains linear in declared entries.

Proof must reflect execution, not the renderer's text. Do not compare redacted command strings as proof identity, reconstruct records from logs, or let unsupported evidence through by setting a version number on old content.

## Fingerprinting and Freshness

- Keep scalar normalized configuration and digest behavior unchanged.
- For list configuration, hash the ordered list of effective command, project-relative directory, and timeout descriptors, plus existing shared inputs/environment and scoped-mode fields when applicable. Include declaration shape/order without sorting entries; additions, removals, reordering, or edits invalidate proof.
- Assign list-definition changes to the existing unbudgetable `project_config` category. Existing configured drift budgets must not preserve proof after an entry changes.
- Whole-project tracked and non-ignored untracked input collection already covers every suite directory. Retain this conservative input set and existing explicit ignored-input/environment declarations. Do not narrow it to entry directories or add a second walker.
- Validate every resolved entry directory using the existing fingerprint containment/preflight behavior. Hashing and execution must use the same resolution/default rules.
- Existing tree-attesting callers (`artifacts.ts`, `build-review-inputs.ts`, and `daemon-rekick.ts`) consume the verifier's typed inspection. They must neither accept unsupported list proof nor launch a second suite run to inspect it.

## Reporting and Repair

The verifier constructs one sanitized failure description containing the failed entry ordinal/index, command, directory, duration, termination reason/exit status, and unexecuted remainder count, followed by bounded diagnostic output. The CLI must print this description rather than only generic guidance. The BUILD failure route already carries `verification.message` into the retry hint and gate-repair record; preserve that path and prove the entry context reaches it. Retain existing infrastructure-versus-semantic routing and retry ceilings.

Extend the existing `test_suite_verification` event with optional structured terminal execution summary data for list executions. The summary carries declared/attempted counts and per-attempt index, result, and duration; it does not duplicate raw diagnostic output. `runTestSuiteStep` emits the outcome from the returned result, including execution failures, rather than trying to infer it later from evidence. Freshness-only events retain their existing meaning. A reuse event is not a new execution.

Enable rendering for this event in the existing sink registry, and render the new summary in daemon and inline output. Freshness-only events may remain visually quiet. Persist through the existing `EventPersister`. Audit and OTel destinations may retain their existing explicit disabled declarations; this feature does not add dashboards or a new metrics project. Standalone CLI feedback comes directly from the same typed verifier result; it does not invent a daemon event stream or sidecar.

## Wiring Surface

| Surface / candidate paths | Production caller and responsibility |
|---|---|
| `types/config.ts`, `engine/config.ts`: `test_suite.commands` and nested entry keys | Existing project/merged configuration loaders validate the complete collection and indexed errors before the verifier can execute |
| `engine/full-suite-commands.ts`: effective-entry resolution | Configuration/execution preparation and fingerprint normalization share entry defaults; exported helper is reached from existing verifier/executor paths |
| `engine/full-suite-executor.ts` | `FullSuiteVerifier.ensureLocked` invokes ordered aggregate execution through the existing injected runner and cleanup |
| `engine/full-suite-evidence.ts` | Verifier writes and reads the v4/v5 union; inspection rejects incompatible or incomplete list proof |
| `engine/full-suite-fingerprint.ts` | Verifier inspection hashes all entries and current whole-project inputs; declaration drift is unbudgetable |
| `engine/full-suite-verifier.ts` | Existing BUILD, standalone CLI, and inspection consumers receive consistent collection results and proof eligibility |
| `engine/test-suite-cli.ts` | Existing `ai-conductor test-suite` dispatch prints failed-entry context; the CI repair path already invokes this adapter |
| `engine/conductor.ts` | `runTestSuiteStep` propagates failure details and terminal summary; existing retry/repair branches consume the same typed result |
| `types/events.ts`, `engine/event-sinks.ts`, `daemon-cli.ts`, existing inline renderer | Existing emitter and registered sinks persist/render optional list outcome summary without another channel |
| `test/engine/config-consumer-registry.ts` | Existing registry verification declares resolvable production consumers for the new root and nested keys |
| `docs/reference/configuration.md`, `docs/explanation/gates.md`, `docs/reference/cli.md`, `README.md` | Existing configuration, verification, and CLI guides explain the capability; README's verification description links to the detailed configuration contract |

`artifacts.ts`, `build-review-inputs.ts`, `daemon-rekick.ts`, and `ci-fix.ts` are verified callers to inspect and cover. They need edits only where the evolved verifier/result contract requires one, not parallel reimplementations. The separate autoresolve `suiteCommand` setting and the test-quality scoped preflight remain outside this feature.

## Early Overlap Scan

The required read-only scan completed on 2026-09-11. An initial sandboxed GitHub dependency query failed; a permitted retry completed without that degradation.

- `origin/spec/daemon-self-host-guardrails`: shared paths `types/config.ts`, `engine/config.ts`, and `engine/conductor.ts`.
- `origin/spec/self-host-phase6-wiring`: shared paths `engine/conductor.ts` and `daemon-cli.ts`.
- No issue prerequisite was reported for #2358. The scan notes that renames/name-only differences may be missed; this is advisory, not proof of no future conflicts.

Keep execution/evidence logic in the established verifier modules and restrict the central conductor/renderer edits to integration. The scan does not authorize editing, rebasing, or waiting on those unrelated branches.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Partial or legacy proof incorrectly satisfies a list | Data | Medium | High | Version/route compatibility and complete-prefix invariants checked through production verifier entry points |
| Defaults differ between execution and fingerprinting | Integration | Medium | High | Shared effective-entry resolution; declaration drift tests include overrides and order |
| Failed-entry context is lost in generic CLI or repair wording | Integration | Medium | Medium | Build messages from the typed failure and verify their delivery through CLI and BUILD repair paths |
| Entry diagnostics grow or expose declared secrets | Security | Medium | High | Shared bounded output budget, failure-first allocation, redaction on every persisted and displayed field |
| New list behavior accidentally changes scoped execution | Integration | Medium | High | Preserve the selected scoped path; explicitly cover empty-selection list fallback and scalar compatibility |
| Concurrent features touch the central dispatcher | Integration | Medium | Medium | Advisory scan recorded; narrow integration edits, no new dispatcher-owned executor |

## ADRs Created

None. Structural prerequisite and reuse check applied: this extends the existing aggregate-verification boundary and durable proof shape already governed by the content-addressed-proof ADR. Its decisions 3 and 6 receive additive amendments in this spec; no separate amendment record and no BUILD task to rewrite historical DECIDE artifacts.

## Conditions

1. The operator approved the configuration defaults, scalar/list compatibility boundary, and evidence design on 2026-09-11, before story acceptance.
2. Stories and plan explicitly cover scalar compatibility, scoped selection/fallback, complete proof validation, failure-class preservation, diagnostic bounds/redaction, and production failure-message delivery.
3. New configuration keys and event summary handling are wired into existing registry/consumer machinery, with no runner-specific output parser or parallel telemetry channel.
4. All automatic tests use controlled local execution or an injected process seam and preserve process-guard/tmux isolation even under counterfactual review.

## Verify-Claims Ledger

- **Verified:** `executeFullSuite` has an injected `FullSuiteCommandRunner`, typed exit/timeout/signal/launch failures, and existing process cleanup. No output grammar decides success.
- **Verified:** `FullSuiteVerifier.ensure` owns the lock; `ensureLocked` selects scoped versus aggregate execution and requires evidence persistence/read-back before returning success.
- **Verified:** `normalizeSuiteConfig` currently serializes one command; `fingerprintFullSuiteInputs` enumerates the entire project, not just the configured working directory. The intake's subtree-union hypothesis is therefore unnecessary.
- **Verified:** `readFullSuiteEvidence` accepts current v4 only; v3 is currently unsupported. The v4/v5 compatibility described above is a deliberate new design, not a claim that old compatibility already exists.
- **Verified:** CLI failure output currently omits `result.message`; conductor retry/repair paths already consume that message. Both must expose the new per-entry context.
- **Verified:** `test_suite_verification` currently persists but does not render or export to OTel; enabling rendering and adding optional terminal summary is explicit in this review.
- **Verified:** Configuration consumer declarations are in `src/conductor/test/engine/config-consumer-registry.ts`, with accepted key sets in production `engine/config.ts`; this review does not assume a nonexistent production registry module.
- **Confirmed:** Full scope, suite agnosticism, approach A/product route, requirements, and diagrams were accepted by the operator in this session.
- **Assumptions:** No unverified environment or framework capability is required. The operator approved the defaults and compatibility decisions on 2026-09-11; they are chosen behavior, not claims about the old implementation.

**Verify-claims verdict:** CLEAR. Proposed contract approved by the operator on 2026-09-11.
