**Status:** Accepted

# Stories: Budgeted, mode-aware test_suite verification (#2021)

Technical track — acceptance criteria derive from issue #2021's desired outcomes
(`outcome-1` … `outcome-9`, staged in `.pipeline/intake-outcomes.md`) and APPROVED
`adr-2026-08-28-test-suite-drift-budget-and-verification-mode` (D1–D8). The companion
amendment to the #588 story ships in a separate main-based PR and is out of scope here.

## Story 1: The verification config contract is validated at load, fail-closed

**Requirement:** outcome-4, outcome-9 (#2021)

As a project operator, I want the `test_suite.verification` block parsed and rejected at
config load with a message naming the exact problem, so that a misconfiguration never
silently degrades to the wrong verification behavior.

### Acceptance Criteria

#### Happy Path
- Given a config with `verification.mode: aggregate` and no `drift_budget`, when config loads, then loading succeeds and the resolved verification settings are zero tolerance in every category with the aggregate command
- Given a config with `verification.drift_budget` naming only budgetable categories with values `none`, a positive integer, or `unlimited`, when config loads, then loading succeeds and each category resolves to exactly the declared bound
- Given a config with `verification.mode: scoped` and a valid `scoped_command` containing `{selectors}`, when config loads, then loading succeeds with scoped mode active

#### Negative Paths
- Given a config with `verification.mode: scoped` and no `scoped_command`, when config loads, then loading fails with a validation error naming `test_suite.scoped_command` as the missing key
- Given a config whose `drift_budget` names an unknown category key, when config loads, then loading fails with a validation error naming the unknown key and listing the valid category names
- Given a config whose `drift_budget` names an unbudgetable category (`dependencies`, `migrations`, `environment`, or `project_config`), when config loads, then loading fails with a validation error naming that category as unbudgetable
- Given a config whose `drift_budget` value is zero, negative, or a non-integer string other than `none`/`unlimited`, when config loads, then loading fails with a validation error naming the offending key and value
- Given a config with `verification.mode` set to any value other than `aggregate` or `scoped`, when config loads, then loading fails with a validation error naming the allowed values
- Given an unknown key inside the `verification` block, when config loads, then loading fails with a validation error naming the unknown key

### Done When
- [ ] `loadConfig` over a fixture with each invalid shape above returns `{ok: false}` with a message containing the named key/category
- [ ] `loadConfig` over the three valid fixtures returns resolved verification settings matching the declaration
- [ ] Both new keys (`test_suite.verification.mode`, `test_suite.verification.drift_budget`) have entries in the documented-config-key consumer registry and the registry coverage test passes

## Story 2: Within-budget drift preserves a recorded PASS without running the suite

**Requirement:** outcome-1, outcome-8, outcome-9 (#2021)

As a project operator, I want a recorded `test_suite` PASS to survive later in-feature drift
that stays inside my declared per-category budget, so that the feature reaches SHIP having
run the full suite once.

### Acceptance Criteria

#### Happy Path
- Given a recorded PASS and a budget of `source: 20`, when 3 source files change and the gate is re-evaluated, then the fingerprint is recomputed, the PASS is preserved without launching the suite command, and the preservation records the drifted category and path count
- Given a recorded PASS and budgets on `source` and `tests`, when both categories drift within their bounds, then the PASS is preserved and both categories appear in the drift record
- Given a preservation has already tolerated 15 source-path changes since the attested PASS, when 4 more source paths change, then drift is measured cumulatively from the attested PASS (19 total) and the PASS is preserved

#### Negative Paths
- Given a recorded PASS whose evidence carries an unresolvable provenance commit, when the gate is re-evaluated after drift, then the suite re-runs and the stale reason names the indeterminate drift measurement
- Given a recorded PASS and a git failure during drift measurement, when the gate is re-evaluated, then the suite re-runs rather than preserving
- Given a prior-version evidence file (before the schema bump), when the gate is re-evaluated, then the evidence is treated as stale and the suite re-runs
- Given a preservation has tolerated 19 cumulative source paths under a budget of 20, when 2 more source paths change (21 total), then the suite re-runs — repeated small preservations cannot ratchet past the bound

### Done When
- [ ] A verifier test proves the within-budget path never spawns the suite command process
- [ ] A verifier test proves cumulative-from-attested-PASS measurement (no per-evaluation reset)
- [ ] A verifier test proves each fail-closed branch (unresolvable provenance, git error, old evidence version) resolves to re-run

## Story 3: Exceeded or unbudgetable drift re-runs, naming the exhausted category

**Requirement:** outcome-8 (#2021)

As a project operator, I want the gate to re-run exactly when my budget is exceeded or an
always-invalidating input changed, with the run's records naming which part of the budget was
exhausted, so that re-verification is bounded and explainable.

### Acceptance Criteria

#### Happy Path
- Given a recorded PASS and a budget of `source: 5`, when 6 source paths change, then the suite re-runs and the recorded stale reason names `source` as the exhausted category with its measured count and bound
- Given a recorded PASS and any drift budget, when a path classified `dependencies` changes, then the suite re-runs and the recorded reason names `dependencies` as unbudgetable
- Given a recorded PASS and any drift budget, when a `migrations`, `environment`, or `project_config` input changes, then the suite re-runs and the recorded reason names that category
- Given a re-run after exhaustion records a new PASS, when subsequent drift occurs, then drift measurement restarts from the new PASS's provenance state

#### Negative Paths
- Given drift in both a within-budget category and an exceeded category, when the gate is re-evaluated, then the suite re-runs (one exceeded category defeats preservation) and the reason names the exceeded category
- Given drift in a category with no declared budget entry, when the gate is re-evaluated, then the default `none` applies and the suite re-runs

### Done When
- [ ] Verifier tests cover exhausted-budget, each unbudgetable category, mixed within/exceeded drift, and the post-re-run measurement reset
- [ ] The recorded stale reason in evidence names the category (and count versus bound for an exhausted budget)

## Story 4: Foreign drift within budget cannot consume a BUILD kickback

**Requirement:** outcome-2 (#2021)

As a project operator, I want an unrelated main-side or foreign code change to stop burning
my feature's two BUILD kickbacks, so that an already-green feature is not halted by someone
else's flake.

### Acceptance Criteria

#### Happy Path
- Given a recorded PASS and a budget tolerating source drift, when a foreign main-side source change lands within budget and the gate is re-evaluated, then no suite process runs, no failure can occur, and the kickback ledger for `test_suite` is unchanged
- Given a within-budget preservation, when the pipeline proceeds to later steps, then no `kickback` event for `test_suite` is emitted for that evaluation

#### Negative Paths
- Given foreign drift that exceeds the budget, when the re-run executes and fails with a non-zero exit, then the existing kickback path applies unchanged (one kickback consumed, kickback event emitted)
- Given foreign drift in an unbudgetable category, when the re-run times out or fails to launch, then the existing non-kickback halt path applies unchanged (no kickback consumed)

### Done When
- [ ] An engine-level test proves a within-budget evaluation leaves the `test_suite` kickback ledger entry byte-identical
- [ ] Existing kickback-path tests still pass unchanged for genuine re-run failures

## Story 5: Absent configuration keeps today's behavior exactly

**Requirement:** outcome-6 (#2021)

As an existing project owner who sets neither new key, I want verification behavior identical
to today, so that upgrading the engine changes nothing for me.

### Acceptance Criteria

#### Happy Path
- Given a config with a `test_suite` block and no `verification` key, when config loads, then loading succeeds and the resolved settings are aggregate mode with zero drift tolerance
- Given no `verification` config and a recorded PASS, when any code or test path changes and the gate is re-evaluated, then the suite re-runs exactly as today with the existing per-category stale reason
- Given no `verification` config and a fingerprint-identical tree, when the gate is re-evaluated, then the existing reuse path applies (no run, evidence reused)

#### Negative Paths
- Given no `verification` config, when a foreign main-side change drifts one source path, then the suite re-runs (zero tolerance — no implicit budget is inferred)
- Given no `verification` config, when the evidence is inspected after any drift, then no drift-ledger preservation entry is ever appended

### Done When
- [ ] A regression test locks the absent-config resolution to aggregate mode + zero tolerance
- [ ] The existing full-suite-verifier test suite passes without modification to its behavioral assertions

## Story 6: Scoped verification mode satisfies the gate with a recorded identity

**Requirement:** outcome-3 (#2021)

As a project operator who opts into scoped verification, I want the gate to execute my
`scoped_command` against the feature's changed tests and record exactly what selection ran,
so that I trade coverage for speed knowingly and auditably.

### Acceptance Criteria

#### Happy Path
- Given `verification.mode: scoped` and a feature surface containing changed test paths, when the gate executes, then the engine-owned scoped interface runs `scoped_command` with those selectors and a passing exit records a PASS that satisfies the gate
- Given a scoped PASS, when the recorded evidence is read, then it names the mode as scoped and lists the exact selector set that ran
- Given a scoped PASS, when the feature's changed-test selection changes, then the recorded PASS reads stale (the selector set is part of the evidence identity)

#### Negative Paths
- Given `verification.mode: scoped` and a feature surface with no changed test paths, when the gate executes, then the evaluation routes to the aggregate verifier and the evidence and events record that the aggregate route was taken (never a silent scoped no-op)
- Given `verification.mode: scoped` and a selector containing a space or shell metacharacter, when the gate executes, then the selector is delivered intact to the runner (no splitting or injection)
- Given `verification.mode: aggregate` and a valid `scoped_command`, when the gate executes, then the aggregate command runs and no scoped invocation can satisfy the gate

### Done When
- [ ] A verifier test proves a scoped PASS satisfies the gate only when mode is scoped
- [ ] A verifier test proves the empty-selection aggregate route is recorded in evidence and events
- [ ] A fingerprint test proves the scoped identity covers `scoped_command` and the selector set

## Story 7: Evidence and events make the mode, attested tree, and tolerated drift auditable

**Requirement:** outcome-3, outcome-7 (#2021)

As an operator reading `.pipeline/` after a run, I want to determine which mode verified the
feature, which commit the PASS attested, and every drift increment tolerated since, without
reading engine code.

### Acceptance Criteria

#### Happy Path
- Given any recorded PASS, when the evidence file is read, then it contains the mode, the attested provenance commit, and (for scoped) the selector set
- Given one or more within-budget preservations, when the evidence file is read, then an append-only drift ledger lists each preservation with its head commit and per-category path counts
- Given a within-budget preservation, when `.pipeline/events.jsonl` is read, then a verification event records the preserved-within-budget outcome, the mode, and the drifted categories
- Given a budget-exceeded re-run, when `.pipeline/events.jsonl` is read, then a verification event names the exhausted or unbudgetable category that forced the run
- Given a post-rebase evaluation preserved within budget, when events are read, then the existing rebase-preserved event carries a budget basis and no gate-invalidation refund is granted for that gate

#### Negative Paths
- Given a run with no `verification` config, when events are read, then existing event shapes are unchanged and parse with existing consumers (additive fields only)
- Given a new PASS after a re-run, when the evidence is read, then the drift ledger from the previous PASS epoch is not carried forward into the new PASS's ledger

### Done When
- [ ] Event-schema tests cover the extended verification event fields on preservation, exhaustion, and the rebase-preserved budget basis
- [ ] An evidence round-trip test proves mode, selectors, provenance commit, and drift ledger survive write/read
- [ ] A convergence-refund test proves a budget-preserved rebase evaluation grants no refund while a genuine invalidation still does

## Story 8: Bootstrap records an explicit verification answer via the config CLI

**Requirement:** outcome-5 (#2021)

As an operator bootstrapping a new project, I want to be asked how suite verification should
behave and have my answer written into the generated config by the CLI, so that the project
carries an explicit recorded decision instead of an unstated default.

### Acceptance Criteria

#### Happy Path
- Given `conduct-ts config init` invoked with a mode flag and a budget preset flag, when it writes the config, then the generated file contains a `test_suite.verification` block matching the flags
- Given the bootstrap skill running interactively, when it reaches config generation, then it asks the operator the mode and budget questions and passes the answers as `config init` flags
- Given bootstrap running in auto mode, when it reaches config generation, then it records the strict preset (today's behavior) without prompting

#### Negative Paths
- Given `config init` invoked with flags in a repo whose config already exists, when it runs, then it refuses to clobber exactly as today and the existing config is unchanged
- Given `config init` invoked with an unknown preset or invalid mode value, when it runs, then it exits non-zero naming the allowed values and writes nothing
- Given `config init` invoked with no verification flags, when it writes the config, then the generated file matches today's template output (no verification block invented)

### Done When
- [ ] `config init` flag tests cover both presets, refuse-to-clobber, invalid values, and the flagless byte-identical output
- [ ] The generated block from each preset passes `loadConfig` validation
- [ ] `skills/bootstrap/SKILL.md` documents the two questions and the auto-mode default
