**Status:** Accepted

# Stories: Maintain documentation

Technical track. These stories cover the repository-local workflow, its gate behavior, and its
shipping contract. Migrating existing human-facing documentation is outside this implementation.
The active flat `docs/*.md` relocation may land first; the approved purpose-based taxonomy governs
new placement and the explicitly deferred final migration.

## Story: Discover and run one canonical repository-local skill

As a maintainer, I want both supported coding clients and the conductor to resolve the same local
documentation skill so that its policy has one source of truth and does not affect other projects.

### Acceptance Criteria

#### Happy Path

- Given this repository's configuration, when the SHIP sequence completes `rebase`, then
  `maintain-documentation` is the next step and `finish` follows only after it passes.
- Given either supported client's repository skill discovery, when `maintain-documentation` is
  invoked directly, then both clients load the same canonical skill content.

#### Negative Paths

- Given another project without the custom-step configuration, when its SHIP sequence completes
  `rebase`, then it proceeds directly to its existing `finish` behavior without requiring this
  skill or its artifacts.
- Given the configured canonical skill file is missing, when configuration is validated, then the
  run fails with the missing path instead of silently dispatching a different or global skill.

### Done When

- [ ] The resolved step order for this repository is `rebase → maintain-documentation → finish`.
- [ ] Claude and Codex repository discovery resolve byte-identical skill content.
- [ ] A configuration without the custom step retains the prior step order and completion behavior.

## Story: Configure an opt-in custom-step completion artifact

As an operator, I want a custom judgment step to declare its own completion evidence so that a
successful model return cannot bypass a blocking verdict.

### Acceptance Criteria

#### Happy Path

- Given a custom step with a valid repository-relative completion artifact under `.pipeline/`,
  when configuration loads, then the step is recognized as completion-checked.
- Given a custom step without a completion artifact, when configuration loads, then its existing
  completion behavior is unchanged.

#### Negative Paths

- Given an empty, absolute, traversal-containing, glob-containing, or directory-only completion
  artifact, when configuration loads, then validation rejects the exact invalid field.
- Given a built-in step declares a completion artifact, when configuration loads, then validation
  rejects the custom-only key.

### Done When

- [ ] Valid custom completion configuration round-trips through the typed config.
- [ ] Every invalid path class fails validation with a field-specific message.
- [ ] Existing built-in and unconfigured custom-step tests pass unchanged.

## Story: Require fresh pass evidence before advancing

As an operator, I want each documentation review attempt to prove its own PASS so that old evidence
or a blocked report cannot advance to finish.

### Acceptance Criteria

#### Happy Path

- Given the configured completion artifact is written during the current attempt, when the
  completion gate evaluates it, then the custom step completes and `finish` may run.
- Given completion is evaluated outside an active attempt but within the current conductor session,
  when the artifact is newer than the session start, then the current session may accept it.

#### Negative Paths

- Given the completion artifact is absent or predates the applicable freshness floor, when the gate
  evaluates it, then the step remains incomplete with an actionable reason.
- Given no attempt or session freshness floor is available, when a configured custom completion
  artifact is evaluated, then the gate fails closed.
- Given a review report says BLOCKED while an older pass marker remains on disk, when the gate runs,
  then the stale marker does not satisfy completion.

### Done When

- [ ] Unit tests cover fresh, missing, stale, and no-freshness-floor results.
- [ ] A gate-loop test proves a blocked custom step retries or halts before `finish`.
- [ ] A gate-loop test proves a fresh pass advances exactly once to `finish`.

## Story: Produce a scoped documentation impact verdict

As a maintainer, I want each implementation reviewed against its reader-visible effects so that
documentation changes are neither missed nor invented.

### Acceptance Criteria

#### Happy Path

- Given changed code affects an installation, CLI, workflow, configuration, artifact, state,
  behavior, recovery, extension, code-organization, or architecture surface, when the skill runs,
  then it updates the affected canonical human-facing documentation and records the evidence.
- Given changed code affects no documented surface, when the skill runs, then it records an
  evidence-backed no-op review without creating a documentation commit.
- Given a manual audit or documentation-only invocation, when the skill runs, then it produces the
  requested scoped result; documentation-only changes do not create a changelog entry or an
  implementation verdict.

#### Negative Paths

- Given an implementation claim conflicts with code, tests, generated help/schema, or observed
  behavior, when the skill cannot resolve the conflict from evidence, then it blocks and omits the
  pass marker rather than documenting intent as fact.
- Given historical `.docs/` artifacts are relevant context, when the skill reads them, then it does
  not create, edit, move, or delete any `.docs/` file.
- Given an obsolete human-facing page is removed, when the skill commits the remediation, then no
  dangling canonical link remains; if safe remediation is not possible, the review blocks.

### Done When

- [ ] The skill defines pre-finish, documentation-only, and manual-audit modes.
- [ ] Every invocation overwrites `.pipeline/maintain-documentation-review.md`.
- [ ] PASS writes `.pipeline/maintain-documentation-pass`; BLOCKED omits it.
- [ ] The skill contains a hard rule that `.docs/` is read-only.

## Story: Apply a reader-centered documentation system

As a reader, I want each document to have one purpose and a predictable location so that I can find
the shortest correct path for my task.

### Acceptance Criteria

#### Happy Path

- Given content is required, when the skill selects its destination, then it chooses among quick
  start, guide, reference, explanation, runbook, contributor documentation, or changelog according
  to the content's purpose and proposes any new category for operator approval.
- Given README onboarding is affected, when the skill updates it, then the concise landing page
  preserves project value, requirements, installation, the shortest working quick start, a doc map,
  and contribution/support links; the quick start highlights `conduct-ts --interactive`, daemon
  operation, and multi-provider use.
- Given reader-visible behavior changes without changing the README landing-page contract, when the
  skill updates the canonical affected guide or reference, then it leaves README unchanged.
- Given a claim or example is changed, when verification is possible, then the skill validates the
  affected links, paths, commands, configuration, examples, artifacts, and code-organization
  explanations against authoritative implementation evidence.

#### Negative Paths

- Given the same fact already has a canonical document, when another page needs it, then the skill
  links to the canonical source and repeats only the minimum quick-start commands.
- Given proposed text contains narrative, marketing outside the single README value section,
  conversational filler, repetition, or speculative commentary, when the review runs, then the text
  is revised or blocked; dry humor survives only when it does not reduce clarity.
- Given a required claim cannot be verified, when the skill reaches its verdict, then it blocks
  instead of weakening the statement or documenting a guess.
- Given a consumer project does not configure this repository-local skill, when its documentation
  workflow runs, then the global harness documentation convention remains unchanged.

### Done When

- [ ] The skill defines audience priority: new users, operators, contributors, maintainers.
- [ ] The skill defines destination, writing, source-of-truth, troubleshooting, and verification
  rules for every approved documentation type.
- [ ] The skill explicitly keeps inline comments, JSDoc, and docstrings outside its write scope
  while allowing contradictory source comments to be flagged.
- [ ] The skill declares its README destination rule as this repository's local refinement of the
  global harness convention.

## Story: Add only notable implementation changelog entries

As a release reader, I want concise changelog entries tied to shipped implementation so that the
log reports meaningful behavior rather than specification activity.

### Acceptance Criteria

#### Happy Path

- Given an implementation introduces a notable reader-visible change, when the documentation skill
  updates `CHANGELOG.md`, then it adds one present-tense sentence led by the reader outcome, includes
  an optional spec PR link when known, and includes the exact implementation-PR token.
- Given a breaking change requires a migration block, when the changelog is updated, then the
  existing runnable migration-block contract is preserved separately from the one-sentence entry.
- Given an implementation is non-notable, when the skill completes its review without a changelog
  entry, then the review may pass and the later release workflow treats empty `[Unreleased]` as no
  release pending.

#### Negative Paths

- Given a change is specification-only, documentation-only, internal and non-notable, or has no
  implementation change, when the skill reviews it, then it does not add a changelog entry.
- Given an entry has no implementation-PR token, spans multiple sentences, uses future tense, or
  leads with internal mechanics instead of reader outcome, when the review runs, then it blocks
  rather than issuing a pass marker.
- Given an implementation is notable but its required changelog entry is missing, when the review
  runs, then it blocks rather than classifying the change as non-notable to satisfy the gate.

### Done When

- [ ] The skill defines the final link shape as `[implementation PR #N](URL)`.
- [ ] The pre-finish entry uses exactly `{{IMPLEMENTATION_PR}}` once.
- [ ] Spec-only and documentation-only exclusions are explicit.
- [ ] Non-notable implementation changes are explicitly allowed to pass without an entry.

## Story: Finalize the changelog link without weakening finish

As a maintainer, I want finish to resolve the implementation PR token mechanically so that the
final changelog is complete while unrelated projects retain their current finish path.

### Acceptance Criteria

#### Happy Path

- Given `CHANGELOG.md` contains exactly one implementation-PR token and `/pr` returns a canonical
  GitHub pull request URL, when finalization runs, then the token becomes a link labeled with that
  PR number.
- Given finalization changes the changelog, when finish continues, then the focused change is
  committed and pushed before the existing shipped-record and finish-record sequence.
- Given no token exists, when finalization runs, then it succeeds without changing any file or
  adding any commit.

#### Negative Paths

- Given the PR URL is invalid, the changelog is unreadable, or more than one token exists, when
  finalization runs, then it exits non-zero without a partial replacement.
- Given finalization or its follow-up push fails, when finish handles the failure, then it writes no
  shipped record and no finish choice in that pass.
- Given a project never configured `maintain-documentation`, when finish runs and no token exists,
  then no documentation dependency is introduced.

### Done When

- [ ] Unit tests cover replacement, absent-token no-op, invalid URL, duplicate tokens, and atomic
  failure behavior.
- [ ] A real CLI-dispatch test proves the production command reaches the finalizer.
- [ ] Finish verification asserts finalization occurs before shipped-record and finish-record.

## Story: Release only when notable changelog content is pending

As a maintainer, I want notable changelog content to trigger releases so that non-notable merges do
not create empty releases or fail after merge.

### Acceptance Criteria

#### Happy Path

- Given `[Unreleased]` contains notable content, when a merge reaches the release workflow, then the
  existing changelog rewrite, version bump, tag, release commit, and GitHub Release sequence runs.
- Given `[Unreleased]` is substantively empty, when a merge reaches the release workflow, then the
  workflow succeeds without changing the repository, bumping `VERSION`, creating a tag, or creating
  a GitHub Release.
- Given a self-host build has passed the configured documentation gate, when its release-artifact
  checks run, then an empty `[Unreleased]` section does not block finish.

#### Negative Paths

- Given `CHANGELOG.md` or its `[Unreleased]` header is missing, when repository integrity runs, then
  it still fails rather than treating malformed structure as an empty valid release.
- Given a breaking surface changes without a runnable migration block or valid waiver, when the
  self-host release-artifact gate runs, then it still halts even if no ordinary changelog entry is
  present.
- Given the no-release path runs, when it completes, then none of the release mutation commands are
  executed after the empty-content decision.

### Done When

- [ ] Workflow tests cover non-empty release and empty successful no-op paths.
- [ ] Self-host release-gate tests prove empty content passes while integrity and migration checks
  remain fail-closed.
- [ ] Repository instructions and the PR template require changelog entries only for notable
  implementation changes.
