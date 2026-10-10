**Status:** Accepted

# Stories: ADRs carry a machine-checked assumption ledger (#542)

Technical track, tier M. Source: jstoup111/ai-conductor#542. Governing design:
`adr-2026-10-10-adr-assumption-ledger-contract` (APPROVED) and
`architecture-review-2026-10-10-adrs-lock-without-a-machine-checkable-assumption-l` (conditions
C1-C3). Scope: ADRs a spec newly adds, plus changed ADRs already carrying the section, enforced at
`ai-conductor compose land` and at the `/conduct` `architecture_review` gate. No daemon-discovery rung.

## Story 1: A well-formed assumption ledger is recognized and a malformed one is diagnosed

**Requirement:** #542 outcome 1 — structured section with confidence, basis, and impact-if-wrong,
presence and shape checked mechanically; outcome 3 — explicit empty statement.
(ADR decisions 1 and 4.)

As a DECIDE author, I want one authority to judge an ADR's `## Assumptions` section so that every
gate agrees on what a valid ledger is and tells me exactly which entry is wrong.

### Acceptance Criteria

#### Happy Path
- Given an ADR whose `## Assumptions` section holds a table whose header has exactly the seven columns `#`, `Assumption`, `Basis`, `Confidence`, `Load-bearing`, `Impact if wrong`, `Approval` in that order, and rows each with a unique `A<n>` id, non-empty Assumption and Impact, Basis in {verified, inferred, unverified}, Confidence an integer 0-100 followed by `%`, and Load-bearing in {yes, no}, when the ledger is parsed, then the result is `ok`.
- Given an ADR whose `## Assumptions` section contains only the line `No load-bearing assumptions.`, when the ledger is parsed, then the result is `ok`.
- Given an ADR whose section holds `No load-bearing assumptions.` followed by a table whose every row has Load-bearing `no`, when the ledger is parsed, then the result is `ok`.

#### Negative Paths
- Given an ADR with no `## Assumptions` heading, when the ledger is parsed, then the result is a diagnostic with rule `missing-section`.
- Given an ADR whose only `## Assumptions` heading appears inside a fenced code block, when the ledger is parsed, then the result is a diagnostic with rule `missing-section`.
- Given an ADR whose `## Assumptions` heading is followed directly by the next `##` heading, when the ledger is parsed, then the result is a diagnostic with rule `empty-section`.
- Given a ledger table whose header omits the `Load-bearing` column or orders columns differently, when the ledger is parsed, then the result is a diagnostic with rule `malformed-header`.
- Given a ledger with rows `A1` (Basis `guessed`), `A2` (Confidence `high`), and `A3` (empty Impact if wrong), when the ledger is parsed, then the result carries three `malformed-entry` diagnostics naming `A1`, `A2`, and `A3`, not only the first.
- Given a ledger where two rows both use id `A1`, when the ledger is parsed, then the result is a `malformed-entry` diagnostic naming the duplicated id `A1`.
- Given a ledger row with Confidence `140%`, when the ledger is parsed, then the result is a `malformed-entry` diagnostic naming that row.
- Given a section holding `No load-bearing assumptions.` and a table with a row whose Load-bearing is `yes`, when the ledger is parsed, then the result is a diagnostic with rule `contradictory-empty-statement`.

### Done When
- [ ] `parseAdrAssumptionLedger` is exported from `src/conductor/src/engine/artifacts.ts` and returns `ok` or a list of diagnostics, each carrying a rule from {`missing-section`, `empty-section`, `malformed-header`, `malformed-entry`, `missing-approval`, `contradictory-empty-statement`} and, where applicable, the entry id.
- [ ] Unit tests cover every happy and negative scenario above against literal ADR text fixtures.

## Story 2: Load-bearing assumptions that are not verified need a recorded operator approval

**Requirement:** #542 outcome 2 — explicit per-entry operator approval marker recorded in the ADR.
(ADR decision 2; operator decision 2026-10-10: approval applies to `inferred` and `unverified`.)

As the operator, I want each unconfirmed load-bearing assumption to carry my approval in the ADR
itself so that anyone reading the artifact can see what I signed off, without session logs.

### Acceptance Criteria

#### Happy Path
- Given a ledger row with Load-bearing `yes`, Basis `inferred`, and Approval `APPROVED by operator 2026-10-10`, when the ledger is parsed, then that row raises no diagnostic.
- Given a ledger row with Load-bearing `yes`, Basis `verified`, and Approval `—`, when the ledger is parsed, then that row raises no diagnostic.
- Given a ledger row with Load-bearing `no`, Basis `unverified`, and an empty Approval cell, when the ledger is parsed, then that row raises no diagnostic.

#### Negative Paths
- Given a ledger row `A2` with Load-bearing `yes`, Basis `unverified`, and Approval `—`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A2`.
- Given a ledger row `A3` with Load-bearing `yes`, Basis `inferred`, and Approval `PENDING`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A3`.
- Given a ledger row `A4` with Load-bearing `yes`, Basis `inferred`, and Approval `APPROVED by operator 2026-02-30`, when the ledger is parsed, then the result is a `missing-approval` diagnostic naming `A4`, because the date is not a valid calendar date.
- Given a ledger row with Load-bearing `yes`, Basis `inferred`, and Approval `approved`, when the ledger is parsed, then the result is a `missing-approval` diagnostic, because the marker lacks the `by operator YYYY-MM-DD` form.

### Done When
- [ ] `parseAdrAssumptionLedger` emits `missing-approval` for every load-bearing, non-verified row lacking a valid `APPROVED by operator YYYY-MM-DD` marker, and for no other row.
- [ ] Unit tests cover each scenario above, including the invalid-calendar-date case.

## Story 3: Composer land refuses a spec whose new ADR lacks a valid ledger

**Requirement:** #542 outcomes 1-3 at the land boundary. (ADR decisions 3, 5, and 7; review
condition C3.)

As the operator, I want `ai-conductor compose land` to refuse a spec whose newly authored ADR has no
valid assumption ledger so that an unledgered design can never reach a spec PR, while the existing
ADR corpus keeps working untouched.

### Acceptance Criteria

#### Happy Path
- Given a spec worktree that adds an APPROVED ADR with a valid ledger, when `compose land` runs, then the ADR rung passes and the spec commits as before.
- Given a spec worktree that adds an APPROVED ADR whose section is `No load-bearing assumptions.`, when `compose land` runs, then the ADR rung passes.
- Given a spec that changes a pre-existing ADR with no `## Assumptions` heading (for example, flipping its status to `SUPERSEDED by …`), when `compose land` runs, then no ledger is required of that ADR and the rung passes.
- Given a repository whose untouched pre-existing ADRs carry no `## Assumptions` section, when `compose land` runs for a spec that adds none, then no ledger diagnostic is raised for any of them.

#### Negative Paths
- Given a spec worktree that adds an ADR with no `## Assumptions` section, when `compose land` runs, then landing is refused with reason `adr-assumption-ledger`, the message names the ADR path and rule `missing-section`, and nothing is committed.
- Given a spec that adds two ADRs, one missing its section and one with a `missing-approval` row `A2`, when `compose land` runs, then a single refusal names both ADRs, `missing-section`, `missing-approval`, and `A2`.
- Given a spec that changes a pre-existing ADR which already carries an `## Assumptions` section and introduces a malformed row `A5`, when `compose land` runs, then landing is refused with reason `adr-assumption-ledger` naming that ADR and `A5`.
- Given a spec already merged to the default branch whose ADR has no ledger, when daemon discovery evaluates the backlog, then the spec is not blocked or skipped for the missing ledger.

### Done When
- [ ] `landSpec` throws `landGateError('adr-assumption-ledger', …)` when any in-scope ADR fails `parseAdrAssumptionLedger`, listing every offending ADR, rule, and entry id in one message.
- [ ] `'adr-assumption-ledger'` is a member of the land gate reason union.
- [ ] Land tests drive real temporary git repositories covering added, changed-with-section, changed-without-section, and untouched ADRs.
- [ ] `daemon-backlog.ts` contains no call to `parseAdrAssumptionLedger`, and a discovery test pins that a merged unledgered ADR does not block its spec.

## Story 4: The /conduct architecture review blocks on an invalid ledger instead of skipping

**Requirement:** #542 outcome 1 on the in-run DECIDE path. (ADR decisions 3 and 6; review conditions
C1 and C2; assumptions A3-A5.)

As the operator running `/conduct`, I want the architecture-review step to refuse to complete while a
newly authored ADR lacks a valid ledger so that the in-run path is held to the same contract as land,
including in unattended auto mode.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose newly added ADR (committed or uncommitted) has a valid ledger, when the `architecture_review` gate is evaluated, then it is satisfied.
- Given a feature worktree whose ADRs all already exist in the merge-base tree (the shape of a daemon build of a merged spec), when the `architecture_review` gate is evaluated, then it is satisfied without reading any ledger.
- Given a tier-S feature, when the conductor reaches `architecture_review`, then the step is still skipped for the tier as before.

#### Negative Paths
- Given an auto-mode run whose feature worktree adds an ADR with no `## Assumptions` section, when `architecture_review` finishes, then the gate verdict is unsatisfied with a reason naming the ADR and `missing-section`, and the run halts for a human instead of recording the step as skipped.
- Given an interactive run whose feature worktree adds an ADR with a `missing-approval` row `A3`, when `architecture_review` finishes, then the step is not marked done and the failure reason names the ADR and `A3`.
- Given a feature worktree that adds an ADR which is still uncommitted and lacks the section, when the gate is evaluated, then it is unsatisfied, because the check reads the working tree and does not wait for a commit.
- Given a worktree with no reachable `origin/«default»` ref, when the gate is evaluated, then it falls back to the local default branch for the merge base, as `coverage-binding-decide-set.ts` does. If no merge base can be determined, it is unsatisfied with a reason saying the merge base could not be resolved, rather than passing.

### Done When
- [ ] `GATE_ONLY_PREDICATES` in `artifacts.ts` has an `architecture_review` entry that applies `parseAdrAssumptionLedger` to in-scope ADRs.
- [ ] `architecture_review` in `steps.ts` declares `enforcement: 'gating'` and keeps `skippableForTiers: ['S']` and `kickbackTarget: true`.
- [ ] A conductor-level test drives an auto-mode run with an unledgered added ADR and asserts a halt (no `skipped` status for `architecture_review`). This proves assumption A3, and the gate-verdict path is wired for the step if the test shows it was not.
- [ ] A test pins that a worktree with no added ADRs satisfies the gate (assumption A5).

## Story 5: New ADRs are authored with the ledger the gates require

**Requirement:** #542 outcomes 1-3 at the authoring source. (ADR decision 8.)

As a DECIDE author, I want the shipped ADR template and architecture-review / verify-claims skills to
produce the exact ledger shape the gates check so that a correctly followed skill never trips the
gate.

### Acceptance Criteria

#### Happy Path
- Given the shipped `skills/architecture-review/templates/adr.md.template`, when it is read, then it contains an `## Assumptions` section whose table header is exactly the column header the parser requires, and it shows the `No load-bearing assumptions.` alternative.
- Given an ADR produced from the template with its placeholder rows replaced by real values meeting Story 1 and Story 2, when the ledger is parsed, then the result is `ok`.
- Given `skills/architecture-review/SKILL.md` and `skills/verify-claims/SKILL.md`, when an author reads the ADR-authoring and ledger-recording practices, then both name the `## Assumptions` table as required in every new ADR and state the approval-marker form `APPROVED by operator YYYY-MM-DD`.

#### Negative Paths
- Given an ADR copied from the template with its placeholder row left unfilled, when the ledger is parsed, then it is rejected with `malformed-entry` (placeholder values are not valid Basis, Confidence, or Load-bearing values), so an untouched template cannot pass the gate.
- Given the template's `## Assumptions` header is edited so that a column is renamed or reordered, when the template-drift test runs, then it fails and names the column that no longer matches the parser's required header.

### Done When
- [ ] `adr.md.template` carries the `## Assumptions` section with the exact header and the empty-statement option.
- [ ] A test parses the template's section header with `parseAdrAssumptionLedger`'s header rule and fails if the two drift apart.
- [ ] `skills/architecture-review/SKILL.md` and `skills/verify-claims/SKILL.md` reference the ADR ledger table and the approval-marker form.
