**Status:** Accepted

# Stories: Infrastructure exits can masquerade as test sensitivity (#2051)

Technical track. Acceptance derives from #2051's desired outcomes and
adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.

## Story 1: Completed nonzero counterfactual exits are recorded as neutral facts

As the build_review engine, I want a completed nonzero exit of the counterfactual scoped run
recorded as a descriptive fact (exit code, run kind, bounded excerpt) so that no downstream
consumer can read sensitivity support out of an exit code alone.

### Acceptance Criteria

#### Happy Path
- Given a counterfactual scoped run that completes with exit code 0, when the preflight materializes its result, then the classification is `stayed-green` and the scoped-run evidence carries `exitCode: 0` with an empty failure excerpt
- Given a counterfactual scoped run that completes with a nonzero exit code, when the preflight materializes its result, then the completed result's classification value asserts only that the run exited nonzero and the scoped-run evidence carries the exit code and the bounded head/tail excerpt

#### Negative Paths
- Given a counterfactual run that fails to launch, times out, or dies on a signal, when the preflight materializes its result, then the classification is `infrastructure-failure` with its existing closed reason, exactly as before this change
- Given a completed nonzero exit, when the projection for the testQuality reviewer is built, then no projection field states or implies a sensitivity verdict — the excerpt and exit facts are present and unaltered
- Given a preflight result cached before this change under the old evidentiary `red` value, when the next lap runs against the changed skill digest, then the cache misses and the preflight re-materializes rather than serving the stale classification meaning

### Done When
- [ ] The completed-result union in `build-review-test-quality-preflight.ts` no longer produces an evidentiary `red` from `exitCode !== 0`; the completed nonzero case is a descriptive value with exit code and excerpt preserved
- [ ] The mechanical-fault lane (launch/timeout/signal → `infrastructure-failure`) is byte-for-byte behavior-identical under existing tests
- [ ] Unit tests cover exit 0, nonzero exit, and each infrastructure reason against the new union

## Story 2: The reviewer result carries a validated counterfactualSensitivity field under v3

As the build_review engine, I want the testQuality reviewer's result to include an optional
`counterfactualSensitivity` value from the closed vocabulary `supports | indeterminate |
not-applicable`, validated and persisted by the engine under contract v3, so that the sensitivity
judgement is durable schema-checked state rather than prose.

### Acceptance Criteria

#### Happy Path
- Given a testQuality reviewer result whose `counterfactualSensitivity` is `supports`, `indeterminate`, or `not-applicable`, when the engine validates the stamped envelope, then the result is accepted and the field is persisted with the judged envelope under `contractVersion: v3`
- Given an accepted result with the field present, when the branch verdict is settled and cached, then the persisted artifact and cache entry carry the field unchanged

#### Negative Paths
- Given a reviewer result whose `counterfactualSensitivity` is outside the closed vocabulary, when the engine validates it, then the result is rejected as malformed and the branch reruns as `absent` — no kickback is routed and the convergence cap does not tick
- Given a reviewer result omitting the field entirely, when the engine validates it, then validation accepts the result (the field is optional) and downstream weighing treats the counterfactual as it does today
- Given a stored accepted-risk disposition recorded before this change, when a later lap re-judges under the updated contract, then the disposition still matches its finding — the field is excluded from finding identity and the contract version has not bumped
- Given any reviewer result, when the engine canonicalizes finding identities, then `counterfactualSensitivity` contributes nothing to any finding id

### Done When
- [ ] `build-review-domain.ts` validates the field against the closed vocabulary; out-of-vocabulary or wrong-typed values reject the envelope with a named problem
- [ ] The contract version constant remains `v3` and no cache or disposition migration exists in the diff
- [ ] Unit tests cover: each vocabulary member accepted, out-of-vocabulary rejected → absent rerun, field absent accepted, finding identity unchanged with and without the field

## Story 3: An indeterminate counterfactual supplies no sensitivity evidence and no finding

As an operator, I want a counterfactual whose process died before the intended tests ran to count
for nothing — neither supporting a test's sensitivity nor failing the feature — so that the #1915
failure shapes can never again vouch for a test that never executed.

### Acceptance Criteria

#### Happy Path
- Given a reviewer result with `counterfactualSensitivity: indeterminate` and no findings, when the branch verdict is settled, then the branch passes exactly as an empty-findings result passes today
- Given a reviewer result with `counterfactualSensitivity: indeterminate` and a `test-insensitive` finding citing a concrete stub-passable assertion, when the branch verdict is settled, then the finding stands — indeterminacy never suppresses an independently evidenced finding

#### Negative Paths
- Given an indeterminate counterfactual, when the reviewer weighs evidence per the skill contract, then the nonzero exit is not usable as sensitivity support for any in-scope test
- Given an indeterminate counterfactual, when the branch settles, then no plan task is appended and no route other than the existing pass/fail outcomes is taken
- Given repeated laps each ending indeterminate with findings unresolved, when the cumulative convergence bound is evaluated, then it increments exactly as today and terminates the loop at the existing cap

### Done When
- [ ] `skills/build-review-test-quality/SKILL.md` states the three-state evidence rule: `indeterminate` contributes neither sensitivity support nor a finding; a finding still requires a concrete stub-passable assertion
- [ ] The engine-side vocabulary source is mechanically bound to the skill text and `test/test_harness_integrity.sh` fails on drift between them
- [ ] Tests cover: indeterminate + no findings → pass, indeterminate + evidenced finding → finding stands, convergence counter unaffected by indeterminacy

## Story 4: A genuine reverted-production failure remains creditable sensitivity evidence

As the harness, I want a counterfactual whose excerpt shows the intended tests (or their
collection of reverted production) failing because the reverted code matters to still support test
sensitivity, so that closing #2051 does not reverse #1593.

### Acceptance Criteria

#### Happy Path
- Given a counterfactual excerpt showing assertion or example failures after the intended tests executed, when the reviewer judges it, then `counterfactualSensitivity: supports` is the contract-conformant judgement and the engine accepts and persists it
- Given a counterfactual excerpt showing a collection or load failure caused by reverted production (a removed module or symbol the changed tests require), when the reviewer judges it, then `supports` is the contract-conformant judgement per the skill text's named collection-failure case

#### Negative Paths
- Given a counterfactual excerpt showing only environment failure (database authentication, service boot, network) before any intended test could bear on behavior, when the reviewer judges it per the skill text, then `supports` is not a conformant judgement — the contract names this shape `indeterminate`
- Given any judged `supports` value, when the outer verdict is settled, then `supports` alone raises no finding and blocks nothing — it remains evidence, never a verdict

### Done When
- [ ] The skill text names both `supports` shapes (executed-test failure; reverted-production collection failure) and the `indeterminate` environment shape, with the #1915 examples as the indeterminate exemplar
- [ ] Contract tests assert `supports` is accepted, persisted, and never itself produces a finding or failure
