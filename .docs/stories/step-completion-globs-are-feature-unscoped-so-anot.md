**Status:** Accepted

# Stories: Feature-aware step artifact resolution (#993)

Technical track (no PRD). Source: issue #993, approved architecture
`adr-2026-07-28-feature-aware-artifact-resolution`.

## Traceability

| Story | Technical outcome |
|---|---|
| TS-993-1 | Artifact scope is explicit and mechanically complete at the declaration site. |
| TS-993-2 | Only the current feature's artifact can satisfy a feature-scoped step, with safe legacy compatibility. |
| TS-993-3 | Completion, interactive review, and dashboard status agree on the current feature's files. |
| TS-993-4 | Intentional repository/run scope and stronger custom predicates retain their existing behavior. |

## Story TS-993-1: Make artifact lifecycle scope explicit

**Requirement:** Technical outcome 1

As a harness maintainer, I want every declared artifact pattern to state whether it belongs to a feature, repository, or run so that scope is reviewable and a newly added step cannot silently inherit unsafe directory-wide behavior.

### Acceptance Criteria

#### Happy Path

- Given the complete built-in step registry, when artifact declarations are inspected, then every pattern has an explicit lifecycle scope and every feature-scoped pattern has an explicit identity strategy.
- Given existing callers that consume the legacy step-to-glob view, when the typed declarations are projected, then they receive the same ordered pattern strings as before.
- Given a step with differently-scoped output patterns, when its declaration is inspected, then each pattern's scope is visible independently rather than inferred from the step as a whole.

#### Negative Paths

- Given a new or modified artifact pattern with no lifecycle scope, when type-checking and contract tests run, then the change fails rather than defaulting to feature- or repository-wide behavior.
- Given a feature-scoped pattern with no identity strategy, when contract validation runs, then it is rejected rather than falling back to an unscoped glob.
- Given a mixed-output step, when one supplemental pattern is intentionally broader than its primary feature report, then the broader pattern is not silently relabeled as feature-scoped by the step's other entries.

### Done When

- [ ] A registry contract test accounts for every built-in `StepName` and every declared pattern.
- [ ] A compatibility test proves the projected ordered glob map is identical to the pre-change map.
- [ ] Compile-time or deterministic contract validation rejects missing scope and missing feature identity strategy.

## Story TS-993-2: Resolve feature artifacts without accepting a neighbor's output

**Requirement:** Technical outcome 2

As a feature owner, I want completion evidence associated with my active plan so that another in-flight or historical feature cannot make my unfinished step report complete.

### Acceptance Criteria

#### Happy Path

- Given feature A and feature B artifacts in the same declared directory and an active identity for B, when B's feature-scoped step is checked, then only B's associated artifact can satisfy it.
- Given B's artifact is newly changed or untracked in B's isolated worktree, when resolution runs before land, then that artifact is recognized as B's even when a historical file has a newer mtime.
- Given B's artifact uses a supported historical dated or step-prefixed naming shape, when its normalized identity matches B's active plan, then it is recognized without requiring a new manifest.
- Given a legacy repository has exactly one candidate for a feature-scoped pattern, when no stronger identity evidence is available, then the singleton remains recognized.

#### Negative Paths

- Given only A's artifact exists and B has no associated artifact, when B's step is checked, then it remains incomplete and the diagnostic names the missing/foreign feature evidence.
- Given several candidates exist and none can be associated with B, when resolution runs, then it returns an actionable ambiguous result and does not choose alphabetically, by newest mtime, or by first glob result.
- Given a changed file is outside the declared patterns, when B's feature change set is considered, then that file cannot satisfy the step merely because it belongs to B's branch.
- Given a historical filename normalizes to a different active plan, when B is checked, then the normalized match remains foreign and cannot satisfy B.

### Done When

- [ ] A two-feature integration test proves A-complete/B-missing is a failure and A-complete/B-complete selects only B.
- [ ] Tests cover changed/untracked worktree evidence, dated/prefixed historical names, and singleton compatibility.
- [ ] Ambiguity tests assert both `done: false` and a diagnostic that identifies why no current-feature artifact was selected.

## Story TS-993-3: Give every generic consumer the same feature-scoped file set

**Requirement:** Technical outcome 3

As a harness operator, I want the completion gate, interactive artifact review, and dashboard to agree about a feature's artifacts so that one surface cannot display or approve evidence another surface rejects.

### Acceptance Criteria

#### Happy Path

- Given B's current artifact is resolvable, when generic completion, interactive review, and dashboard status run for B, then all three consume the same B-scoped file set.
- Given a terminal or create dashboard already knows the feature description, when it collects artifact status, then that identity participates in resolution and the displayed file paths belong to that feature.
- Given a caller explicitly needs the whole declared corpus, when it invokes the raw pattern matcher, then repository-wide discovery remains available without weakening the three generic consumers.

#### Negative Paths

- Given A and B files coexist, when B's review prompt opens, then A's file is not included among B's review candidates.
- Given B's resolution is ambiguous, when the dashboard renders, then it does not show a satisfied checkmark backed by A's file; the ambiguity remains visible/unsatisfied.
- Given one consumer is migrated while another still reads raw globs, when production-reachability tests inspect the three call sites, then the incomplete migration fails rather than shipping split behavior.

### Done When

- [ ] Completion, conductor review, terminal renderer, and create renderer tests assert the same scoped paths for the same feature context.
- [ ] A negative review test proves a foreign artifact is never presented for approval.
- [ ] A dashboard regression test proves ambiguity cannot render as satisfied.
- [ ] Production call-site assertions cover all three generic consumer paths.

## Story TS-993-4: Preserve intentional broad scope and stronger gate evidence

**Requirement:** Technical outcome 4

As a harness maintainer, I want repository/run-scoped artifacts and step-specific predicates to retain their stronger semantics so that feature scoping fixes false positives without creating false failures or weakening existing gates.

### Acceptance Criteria

#### Happy Path

- Given an artifact contract explicitly classified as repository-wide, when its step is inspected for a feature, then the declared repository corpus remains eligible without plan-stem filtering.
- Given run-local evidence whose completion is governed by freshness or semantic content, when its custom predicate runs, then that predicate remains the authority and the typed contract supplies no shortcut around it.
- Given project-declared acceptance-spec globs, when acceptance completion and review paths run, then those configured patterns remain included under their existing contract.
- Given a project-configured completion artifact with a valid freshness floor, when its step is checked, then the existing exact-file and freshness behavior remains unchanged.

#### Negative Paths

- Given a stale, malformed, or failing run-local verdict file that happens to match its pattern, when the step is checked, then matching alone cannot turn the custom predicate into a pass.
- Given a legitimate repository-wide artifact whose filename does not resemble the active plan, when the step is checked, then it is not rejected by feature-name normalization.
- Given an acceptance-spec corpus already contains unrelated tests but the required RED evidence is missing or invalid, when completion runs, then the stronger acceptance predicate still fails.
- Given a configured completion artifact exists but predates its required floor, when completion runs, then it remains incomplete even though the file matches exactly.

### Done When

- [ ] A deterministic inventory accounts for every custom completion predicate and proves generic resolution does not replace it.
- [ ] Regression tests cover repository scope, run-local stale/invalid evidence, configured completion artifacts, and project-declared acceptance globs.
- [ ] No test requires every artifact family to share a plan-stem naming convention.
