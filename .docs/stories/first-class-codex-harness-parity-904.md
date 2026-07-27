**Status:** Accepted

# Stories: First-Class Codex Harness Skills and Guidance (#904)

**Source:** Approved PRD `2026-07-25-first-class-codex-harness-parity-904`
**Architecture:** Approved ADR
`adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`
**Track:** Product
**Complexity:** Medium

## Traceability

| Story | Requirement |
|---|---|
| ST-904-1 Discover the complete harness catalog in Codex | FR-1 |
| ST-904-2 Receive Codex skills as built-in harness behavior | FR-2 |
| ST-904-3 Activate the current catalog after update | FR-3 |
| ST-904-4 Keep Codex discovery singular and idempotent | FR-4 |
| ST-904-5 Load durable Codex repository guidance | FR-5 |
| ST-904-6 Keep mixed-provider guidance consistent | FR-6 |
| ST-904-7 Scope host-specific workflow instructions | FR-7 |
| ST-904-8 Exclude unscoped Claude-only assumptions from Codex | FR-8 |
| ST-904-9 Activate every Codex-eligible daemon workflow | FR-9 |
| ST-904-10 Advance unattended work without syntax translation | FR-10 |
| ST-904-11 Preserve workflow outcomes during direct Codex use | FR-11 |
| ST-904-12 Stop before an unsupported capability is used | FR-12 |
| ST-904-13 Preserve accepted Claude workflows | FR-13 |

## Story ST-904-1: Discover the complete harness catalog in Codex

**Requirement:** FR-1

As a Codex operator, I want a normal harness installation to expose every supported workflow to
Codex so that I can select any lifecycle skill without copying it into place.

### Acceptance Criteria

#### Happy Path

- Given a current harness installation and a fresh Codex session, when Codex enumerates its
  user-scoped skills, then every supported harness skill is discoverable exactly once with its
  current name and description.
- Given an installed harness skill with linked supporting files, when Codex loads that skill, then
  the linked workflow instructions and required resources are readable from the installed view.

#### Negative Paths

- Given one supported skill is absent or not readable from Codex's documented user scope, when
  installation checking runs, then checking fails and names the missing or unreadable skill rather
  than reporting the catalog ready.
- Given a skill entry exists but its linked target or required `SKILL.md` is broken, when Codex
  discovery is verified, then verification fails for that skill and does not count the broken name
  as available.

### Done When

- [ ] An automated catalog comparison proves every source skill appears once in Codex discovery.
- [ ] A real Codex load probe reads a representative installed skill and one linked resource.
- [ ] Missing, unreadable, and broken-link fixtures produce skill-named check failures.

## Story ST-904-2: Receive Codex skills as built-in harness behavior

**Requirement:** FR-2

As a project operator, I want Codex workflow availability included in the normal harness setup so
that I do not maintain a second package or repeat setup in each session.

### Acceptance Criteria

#### Happy Path

- Given the operator performs the supported harness installation or update, when a later Codex CLI
  or IDE session begins, then the supported harness skills are available without a plugin install,
  individual skill copy, or workflow text injected into the session prompt.

#### Negative Paths

- Given no plugin has been installed and no per-session workflow preamble is supplied, when the
  installed catalog is verified in Codex, then verification still succeeds; a dependency on either
  extra action fails the acceptance check.
- Given an operator chooses Codex as an execution provider after the harness is already installed,
  when the next Codex session starts, then it does not require a second provider-specific
  installation step before discovering the catalog.

### Done When

- [ ] A clean-home acceptance scenario reaches Codex skill discovery using only normal harness
      installation.
- [ ] The scenario contains no plugin installation, manual skill copy, or prompt-injection setup.
- [ ] Switching execution selection to Codex does not introduce an additional installation action.

## Story ST-904-3: Activate the current catalog after update

**Requirement:** FR-3

As a harness operator, I want an update to replace stale harness skill views with the current
catalog so that Codex never continues running an earlier workflow revision.

### Acceptance Criteria

#### Happy Path

- Given an installed Codex skill points to an earlier harness checkout, when the operator updates
  through the supported path, then Codex loads the skill content from the current installed harness
  revision.
- Given a skill was added or removed between supported harness revisions, when update completes,
  then Codex discovery matches the current supported catalog.

#### Negative Paths

- Given a legacy harness-owned skill link still resolves to an older checkout after update, when
  installation checking runs, then it fails and reports the stale skill and target.
- Given an entry at the migration location is a regular file, directory, or foreign symlink, when
  update runs, then that entry is preserved and reported rather than replaced as if harness-owned.

### Done When

- [ ] An old-to-current update fixture proves changed skill content resolves from the current
      harness revision.
- [ ] Added and removed skill fixtures leave discovery equal to the current catalog.
- [ ] Stale harness targets fail checking, while foreign files, directories, and links remain
      byte-for-byte or target-for-target unchanged.

## Story ST-904-4: Keep Codex discovery singular and idempotent

**Requirement:** FR-4

As a harness operator, I want repeated install and update operations to converge on one Codex-visible
copy of each harness skill so that skill selection is unambiguous.

### Acceptance Criteria

#### Happy Path

- Given a clean installation, when install or update is repeated any number of times, then each
  supported harness skill remains discoverable once and every harness-owned target stays current.
- Given a recognized harness-owned entry exists at the legacy Codex location, when migration
  completes, then only the current discovery location remains active for that skill.

#### Negative Paths

- Given the same harness skill is visible through both current and legacy harness-owned locations,
  when checking runs, then it fails with both locations identified rather than accepting ambiguous
  discovery.
- Given two update processes encounter the already-current target in sequence, when both complete,
  then neither creates a duplicate, corrupts the link, or removes unrelated entries.

### Done When

- [ ] A repeated-operation matrix proves stable targets and one discovery result per skill.
- [ ] A duplicate current/legacy fixture is reconciled or reported deterministically.
- [ ] Sequential-update and unrelated-entry fixtures prove idempotency and content preservation.

## Story ST-904-5: Load durable Codex repository guidance

**Requirement:** FR-5

As a project maintainer, I want initialization to establish Codex-recognized repository guidance so
that later sessions inherit the harness operating rules automatically.

### Acceptance Criteria

#### Happy Path

- Given a project without Codex repository guidance, when harness initialization completes and a
  later Codex session starts in that project, then Codex automatically loads a durable reference to
  the current harness guidance.
- Given a project already has operator-authored `AGENTS.md` content without the harness reference,
  when initialization runs, then the reference is appended and all prior content is preserved.

#### Negative Paths

- Given initialization is repeated after the harness reference exists, when the resulting guidance
  is inspected, then the reference appears once and the existing content is unchanged.
- Given an existing `AGENTS.md` cannot be safely updated, when initialization runs, then it reports
  the affected file and leaves its original content intact rather than truncating or partially
  rewriting it.

### Done When

- [ ] A later-session Codex probe reports the initialized repository guidance as loaded.
- [ ] Fresh, existing-content, and repeated-initialization fixtures preserve content and contain one
      current harness reference.
- [ ] An unwritable/failing-update fixture proves no partial guidance file is produced.

## Story ST-904-6: Keep mixed-provider guidance consistent

**Requirement:** FR-6

As a mixed-provider operator, I want initialization to produce durable guidance valid for Claude
and Codex so that the same project has no contradictory lifecycle instructions.

### Acceptance Criteria

#### Happy Path

- Given a project uses both built-in providers, when initialization completes, then later Claude
  and Codex sessions each load their host-recognized project guidance and both references lead to
  the same lifecycle outcomes and gates.
- Given existing operator-authored guidance for both hosts, when initialization adds missing harness
  references, then neither file's unrelated content is overwritten.

#### Negative Paths

- Given one generated guidance file instructs its host to use the other host's skill syntax or
  contradicts the other file about a required lifecycle gate, when guidance validation runs, then
  it fails and identifies both the host and conflicting instruction.
- Given only one host's harness reference is already present, when initialization runs, then it
  adds only the missing reference and does not duplicate or normalize away either file's existing
  content.

### Done When

- [ ] Mixed-provider initialization tests prove both host guidance files load and reference the
      shared harness contract.
- [ ] A contradiction fixture fails with a host- and instruction-specific diagnostic.
- [ ] Partial-existing and operator-content fixtures prove independent, non-destructive updates.

## Story ST-904-7: Scope host-specific workflow instructions

**Requirement:** FR-7

As a harness maintainer, I want shared workflows to distinguish universal rules from host-specific
instructions so that one canonical catalog remains correct for both providers.

### Acceptance Criteria

#### Happy Path

- Given a shared workflow rule applies to both built-in providers, when either host loads the skill,
  then the same required outcome, artifact, and lifecycle gate is stated without host-specific
  reinterpretation.
- Given a workflow instruction depends on host-native invocation, models, tools, delegation, or
  interaction, when either host loads the skill, then the instruction clearly identifies the host
  to which it applies and supplies a valid path for the selected host.

#### Negative Paths

- Given provider-specific prose is presented as an unconditional shared instruction, when the
  compatibility audit runs, then it fails with the skill, instruction category, and missing host
  scope identified.
- Given a compatibility edit scopes host-specific prose but removes or weakens a shared artifact or
  gate, when contract validation runs, then it fails rather than accepting provider compatibility
  at the cost of workflow integrity.

### Done When

- [ ] Every supported skill and `HARNESS.md` passes a deterministic host-scope compatibility audit.
- [ ] Fixtures cover invocation, model, tool, delegation, and interactive instruction categories.
- [ ] Existing artifact, gate, frontmatter, reference, and model-policy integrity checks remain
      green.

## Story ST-904-8: Exclude unscoped Claude-only assumptions from Codex

**Requirement:** FR-8

As a Codex operator, I want Codex-selected workflows to receive only valid Codex instructions so
that unattended work does not attempt Claude-only contracts.

### Acceptance Criteria

#### Happy Path

- Given Codex is the actual provider for a supported workflow, when the effective instructions are
  loaded, then explicit skill invocation, model references, tool use, and delegation behavior are
  Codex-valid or explicitly marked as inapplicable to Codex.

#### Negative Paths

- Given a shared skill contains an unscoped Claude slash invocation, Claude-only model identity,
  Claude-specific tool contract, or Claude-only delegation imperative, when Codex compatibility is
  evaluated, then the affected skill fails with the assumption category identified.
- Given a Claude-specific instruction is correctly enclosed in an explicit Claude-only branch,
  when Codex compatibility is evaluated, then it is not falsely interpreted as an instruction for
  Codex and the shared workflow still loads.

### Done When

- [ ] Positive Codex fixtures cover valid invocation, model, tool, and delegation instructions.
- [ ] One negative fixture per Claude-only assumption category fails with a skill-specific result.
- [ ] Explicitly Claude-scoped fixtures remain allowed and preserve their Claude contract.

## Story ST-904-9: Activate every Codex-eligible daemon workflow

**Requirement:** FR-9

As a daemon operator, I want every eligible lifecycle step to invoke its corresponding Codex skill
so that Codex can execute the complete supported lifecycle.

### Acceptance Criteria

#### Happy Path

- Given Codex is the actual provider candidate, when any Codex-eligible daemon lifecycle step is
  dispatched, then the explicit prompt names the corresponding Codex-recognized skill and preserves
  required arguments.
- Given a preferred provider is unavailable and fallback selects another built-in provider, when
  that candidate is invoked, then the skill mention is resolved again for the actual provider while
  retaining the same semantic step.

#### Negative Paths

- Given the daemon step matrix contains an eligible step with no Codex-recognized mapping or with
  lost arguments, when dispatch-contract validation runs, then it fails and names the unmapped step
  or mismatched arguments.
- Given Codex falls back to Claude or Claude falls back to Codex, when invocation options are
  inspected, then the fallback prompt contains only the fallback provider's native skill syntax;
  reused primary-provider syntax fails the scenario.

### Done When

- [ ] A table-driven test covers every eligible daemon step and exact expected Codex skill mention.
- [ ] Argument-bearing steps, including as-built architecture review, retain their arguments.
- [ ] Scalar Codex, scalar Claude, Codex-to-Claude, and Claude-to-Codex scenarios assert exact
      candidate-local prompts.

## Story ST-904-10: Advance unattended work without syntax translation

**Requirement:** FR-10

As a daemon operator, I want Codex-selected runs to cross lifecycle boundaries without a human
translation handoff so that unattended execution remains unattended.

### Acceptance Criteria

#### Happy Path

- Given a representative Codex-selected feature has satisfied one lifecycle gate, when the daemon
  advances to the next supported skill-driven step, then Codex activates that workflow without
  requesting that an operator translate a slash command or restate the skill instructions.
- Given multiple consecutive supported lifecycle steps use Codex, when each completes its existing
  artifact gate, then the daemon continues using provider-native skill mentions without adding a
  syntax-related HALT or review marker.

#### Negative Paths

- Given a Codex-selected step receives a Claude-only invocation and therefore cannot activate the
  intended skill, when the run result is evaluated, then the acceptance scenario fails rather than
  treating operator translation as normal recovery.
- Given a step's required artifact gate is unsatisfied for a reason unrelated to invocation syntax,
  when the daemon evaluates completion, then it still stops through the existing gate; syntax
  parity does not bypass or auto-satisfy incomplete work.

### Done When

- [ ] A representative unattended Codex run crosses at least two skill-driven lifecycle boundaries
      with no translation prompt, syntax HALT, or manual workflow injection.
- [ ] The run produces and validates the expected boundary artifacts.
- [ ] A missing-artifact scenario remains incomplete even when skill activation itself succeeds.

## Story ST-904-11: Preserve workflow outcomes during direct Codex use

**Requirement:** FR-11

As a Codex operator, I want direct skill invocation to preserve the harness workflow contract so
that interactive use produces the same required results as daemon-managed use.

### Acceptance Criteria

#### Happy Path

- Given an operator explicitly invokes a supported installed harness skill in Codex, when the skill
  completes, then it produces the same required outcome, artifact shape, and lifecycle-gate evidence
  as the corresponding daemon-managed workflow.
- Given the direct invocation loads provider-scoped instructions, when it reaches a shared gate,
  then the gate criteria remain identical to those used by daemon execution.

#### Negative Paths

- Given direct Codex invocation omits a required artifact or gate solely because no daemon wrapper
  is present, when completion is evaluated, then the workflow is incomplete and the missing
  contract is identified.
- Given direct invocation uses Codex-specific wording, when outputs are compared, then wording
  differences are allowed but a changed required outcome, artifact, or gate fails parity.

### Done When

- [ ] A representative directly invoked Codex skill and daemon-invoked counterpart pass the same
      artifact and gate assertions.
- [ ] A missing-artifact direct invocation is rejected with the unsatisfied contract named.
- [ ] Comparison tolerates host-native wording while remaining strict about outcomes and gates.

## Story ST-904-12: Stop before an unsupported capability is used

**Requirement:** FR-12

As a Codex operator, I want a workflow with a genuinely unsupported dependency to fail before using
it so that the run does not silently execute another provider's assumptions.

### Acceptance Criteria

#### Happy Path

- Given a required workflow capability is unavailable in the actual provider, when the workflow
  reaches that dependency, then it stops before incompatible work begins and reports the provider,
  unavailable capability, and concrete operator action needed to continue.
- Given the unsupported path stops, when the lifecycle gate is evaluated, then the step remains
  incomplete and no success artifact falsely claims the unsupported work occurred.

#### Negative Paths

- Given a capability has a documented Codex-valid path, when the workflow reaches it, then the
  workflow does not fail merely because the equivalent Claude mechanism differs.
- Given a required capability is unavailable, when failure handling runs, then it does not silently
  substitute Claude syntax, tools, delegation, credentials, or a success result.

### Done When

- [ ] A representative unsupported-capability fixture halts before an incompatible action and emits
      provider, capability, and recovery fields.
- [ ] Artifact-gate assertions prove the stopped step remains incomplete without a false success
      artifact.
- [ ] A supported-but-different Codex capability fixture completes without a false rejection.

## Story ST-904-13: Preserve accepted Claude workflows

**Requirement:** FR-13

As an existing Claude operator, I want Codex parity changes to leave Claude workflows intact so
that adding a built-in provider does not regress established behavior.

### Acceptance Criteria

#### Happy Path

- Given an accepted Claude-only installation and project, when the #904-compatible harness is
  installed and a Claude workflow runs, then Claude discovers the same supported skills, receives
  native slash-form invocations, and satisfies the same artifacts and gates as before.
- Given a mixed-provider run actually invokes a Claude candidate, when the attempt executes, then
  existing Claude model policy, tool/delegation contract, retry behavior, and session isolation are
  preserved.

#### Negative Paths

- Given shared skill content is edited for Codex compatibility, when existing Claude integrity and
  lifecycle suites run, then any removed model pin, weakened gate, invalid frontmatter, missing
  reference, or changed accepted outcome fails the change.
- Given a prior Codex attempt falls back to Claude, when Claude receives its prompt, then it does not
  receive a `$skill` mention or other Codex-native value from the failed candidate.

### Done When

- [ ] Existing accepted Claude installation, integrity, workflow, provider, retry, and session suites
      remain green.
- [ ] Focused assertions prove Claude skill discovery and slash-form daemon prompts are unchanged.
- [ ] Codex-to-Claude fallback coverage proves no prompt, model, effort, or session value crosses
      the provider boundary.

## Functional-Requirement Traceability

| Functional requirement | Covered by |
|---|---|
| FR-1 | ST-904-1 |
| FR-2 | ST-904-2 |
| FR-3 | ST-904-3 |
| FR-4 | ST-904-4 |
| FR-5 | ST-904-5 |
| FR-6 | ST-904-6 |
| FR-7 | ST-904-7 |
| FR-8 | ST-904-8 |
| FR-9 | ST-904-9 |
| FR-10 | ST-904-10 |
| FR-11 | ST-904-11 |
| FR-12 | ST-904-12 |
| FR-13 | ST-904-13 |
