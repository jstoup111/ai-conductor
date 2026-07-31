**Status:** Accepted

# Stories: Contract-aware same-file wiring

Track: technical. Source: jstoup111/ai-conductor#880 and `adr-2026-07-30-contract-aware-same-file-wiring` (APPROVED).

## Story 1: Qualifying same-file composition passes with explicit proof

**Requirement:** TI-1 — accept production-reachable same-file composition without treating absence of a cross-file symbol reference as an orphan.

As the deterministic wiring gate, I want a same-file helper to pass only when its accepted caller contract, exact production reference, and root reachability all agree so that correctly composed modules do not trigger build kickbacks.

### Acceptance Criteria

#### Happy Path

- Given a newly added export is referenced by a declared production caller in the same defining file, the caller resolves to the exact export declaration, and configured Layer 2 reaches that file from a production root, when wiring evidence is computed, then the export contributes no `orphan-export` gap.
- Given that exception passes, when the evidence artifact is persisted, then the owning task carries a typed `same-file-composition` proof naming the export, caller, defining file, and root-reachability chain.
- Given an existing `Wired-into: path#caller` declaration for the qualifying caller, when the exception is evaluated, then the existing grammar is sufficient and no new plan syntax or waiver is required.

#### Negative Paths

- Given the same-file export lacks any one of the declared caller, exact symbol-reference, or applicable root-reachability proofs, when wiring evidence is computed, then the original `orphan-export` gap remains and names the missing proof; the gate never passes on module reachability alone.
- Given an evidence artifact claims the exception but omits a required proof field, supplies an empty root chain, or uses an unknown proof kind, when evidence is validated, then validation fails closed with the owning task and malformed field named.
- Given a plan declares a caller in a different file or a caller that does not resolve in the defining file, when the same-file candidate is evaluated, then the declaration does not authorize the exception and the export remains a named gap.

### Done When

- [ ] A boundary-level fixture matching the #880 shape completes `wiring_check` without an orphan gap.
- [ ] Persisted evidence contains the validated typed proof with export, caller, file, and non-empty root chain.
- [ ] Existing `Wired-into: path#caller` fixtures require no grammar migration or new contract form.

---

## Story 2: False-positive relief does not create false passes

**Requirement:** TI-2 — genuinely orphaned and test-only exports continue to gap.

As an operator, I want the exception to distinguish exact production composition from lookalike text and unreachable code so that relaxing the false-positive case does not weaken the gate's safety floor.

### Acceptance Criteria

#### Happy Path

- Given a declared caller's implementation references the exact new export declaration, when symbol identity is evaluated, then comments, strings, declarations, imports, and unrelated same-name bindings are excluded from that proof.
- Given a module is reachable from a configured production root only through non-test import edges, when the helper's composition is evaluated, then that production chain may satisfy the reachability proof.
- Given a truly unused export exists inside an otherwise reachable module, when wiring evidence is computed, then it remains an `orphan-export` gap because no declared caller-to-export reference exists.
- Given a same-file helper is imported only by tests in addition to its same-file production caller, when the three production proofs hold, then the test import neither creates nor invalidates the exception.

#### Negative Paths

- Given a caller contains only a comment, string, import, declaration, or shadowed local with the export's name, when symbol identity is evaluated, then no exact reference proof is produced and the gap remains.
- Given the defining module is reachable only through a test file, when Layer 2 evaluates it, then no production root chain is produced and the same-file exception is denied.
- Given the module is production-reachable but the new export is not referenced by the declared caller, when the gate runs, then module reachability alone cannot remove the orphan gap.
- Given tests are the only consumers and no same-file production caller references the export, when the gate runs, then it reports the existing test-only orphan gap with the excluded test-reference count.

### Done When

- [ ] Adversarial fixtures cover comments, strings, declaration-only occurrences, imports, and shadowed identifiers without false passes.
- [ ] Orphan-island and test-edge fixtures remain red for the exception and retain named gaps.
- [ ] A reachable-module/dead-helper fixture proves Layer 2 alone cannot pass a symbol.

---

## Story 3: Existing wiring behavior and analysis boundaries remain stable

**Requirement:** TI-3 — preserve current cross-file and unsupported-project behavior while keeping compiler analysis bounded.

As a harness maintainer, I want the exception joined into the existing probe without duplicating compiler work or changing unrelated verdict paths so that the fix remains safe across consumer projects.

### Acceptance Criteria

#### Happy Path

- Given a new export has a non-test reference outside its defining file, when Layer 1 runs, then the existing cross-file success path and evidence remain unchanged without requiring the new exception.
- Given multiple new exports require Layer 2 and same-file evaluation in one probe run, when TypeScript analysis executes, then one lazily loaded program/checker supplies both import reachability and symbol identity for the run.
- Given a non-TypeScript project or a TS/JS project without configured entry points contains a same-file-only export, when wiring evidence is computed, then the project retains its current Layer 1 gap and the exception is unavailable.
- Given the wiring evidence carries no same-file proof because no candidate exists, when it is validated, then existing evidence remains valid and existing gate/kickback behavior is unchanged.

#### Negative Paths

- Given an outside-file reference exists only in a test path, when Layer 1 runs, then the existing test-only gap remains; the new evaluator cannot reclassify it without all three same-file proofs.
- Given the analysis would construct a separate TypeScript program per export or separately for graph and symbol checks, when the focused performance fixture observes program construction, then the test fails because the per-run count exceeds one.
- Given Layer 2 is `not-applicable`, `skipped`, or `bad-root`, when a same-file candidate is evaluated, then none of those states authorizes the exception; `bad-root` also retains its existing scope-undeterminable gap.
- Given optional same-file proof data is absent from legacy/current evidence with no exception claim, when validation runs, then it does not invent a failure or force unrelated features to regenerate otherwise current evidence.

### Done When

- [ ] Existing cross-file, test-only, waiver, contradiction, and kickback suites pass unchanged or with assertion-only extensions for typed proof.
- [ ] A program-factory test proves one TypeScript program/checker per probe run across multiple exports.
- [ ] Non-TS, unconfigured TS/JS, and bad-root fixtures pin the fail-closed boundary.
- [ ] The aggregate harness validation suite passes with no real third-party calls from default tests.

---

## Story 4: BUILD and SHIP agree on production-reachable composition

**Requirement:** TI-4 — the later as-built review must not reject a same-file composition that satisfies the approved safety contract.

As an operator, I want BUILD and SHIP to recognize the same fully proven production chain so that a valid helper does not pass deterministic verification and then fail release review for the identical file boundary.

### Acceptance Criteria

#### Happy Path

- Given shipped source contains an exact same-file caller-to-export reference and the defining module is transitively reached from a real production entry point, when `architecture-review --as-built` performs its production-reachability sweep, then it cites the entry point, module caller, and export locations and counts the primitive as production-reachable.
- Given BUILD persisted a typed `same-file-composition` proof, when the as-built review runs, then it may use that proof as corroborating context but independently verifies the shipped source chain before approving.

#### Negative Paths

- Given an own-module reference exists but no real production entry point reaches the module, when the as-built sweep runs, then it remains a blocking `unreachable rung`; the own-module reference alone never counts.
- Given persisted BUILD evidence claims a same-file proof but the shipped source no longer contains the exact caller-to-export link or root chain, when the as-built sweep runs, then it blocks on current source rather than trusting stale evidence.

### Done When

- [ ] The as-built skill contract states the narrow root-to-caller-to-export exception and retains the default own-module exclusion when that chain is incomplete.
- [ ] Provider-contract and integrity checks pass for the updated provider-neutral skill wording.
- [ ] A review fixture proves qualifying composition is approved and own-module-only or stale-evidence variants remain blocked.
