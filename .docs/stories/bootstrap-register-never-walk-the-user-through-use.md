**Status:** Accepted

# Stories: Guided setup walks the operator through project and operator configuration

Source: jstoup111/ai-conductor#2218

Approved by James Stoup in composer chat, 2026-09-14.

Scope boundary: Bootstrap-time guided setup of every decidable project-scoped setting, with the ability to record non-default answers; operator identity established as a machine-scoped setting; in-place explanations for settings the walkthrough does not ask about; non-destructive re-runs; unattended paths unchanged. Excludes cross-project reconfiguration during updates and any prompt during project registration or creation.

## Story 1: Ask every decidable project setting with enough guidance to choose

**Requirement:** FR-1, FR-2, FR-13

As a new operator onboarding a project, I want each project setting I must decide asked one at a time with a real explanation so I can choose a value without reading a reference manual.

### Acceptance Criteria

#### Happy Path
- Given an operator is present and the project has no configuration yet, when onboarding reaches configuration, then every project-scoped setting the operator is expected to decide is asked, one question at a time, and no such setting is silently defaulted without being asked.
- Given a question is asked, when it is presented, then it states what the setting controls, which values are permitted, which value applies if the operator answers nothing, and what a non-default value changes.

#### Negative Paths
- Given a question with a closed set of permitted values, when the operator answers with a value outside that set, then the answer is rejected with the permitted values restated, the same question is asked again, and nothing is recorded for it.
- Given a question whose answer is free text, when the operator answers with an empty or multi-line value, then the answer is rejected, the question is re-asked, and nothing is recorded for it.

### Done When
- [ ] The onboarding instructions enumerate every decidable project setting as a question carrying the four guidance elements, and a fixture-driven check confirms no decidable setting is absent from the question list.
- [ ] Rejected answers are observable as a re-ask with nothing written, for both closed-set and free-text questions.

## Story 2: Record the operator's answers, default or not

**Requirement:** FR-3, FR-4, FR-14

As an experienced operator, I want the value I chose during onboarding to be what the project actually uses so departing from a default is not a follow-up file edit.

### Acceptance Criteria

#### Happy Path
- Given the operator answers a question with a permitted non-default value, when onboarding records configuration, then the project configuration carries that value and the harness reads it back as the effective value on its next run.
- Given the operator accepts the offered value at every question, when onboarding records configuration, then the resulting project configuration parses to the same effective settings onboarding produced before this change, except that the aggregate test command is the offered project-specific default Story 3 establishes rather than the former fixed literal, and every line it adds to the pre-change output is a comment or blank line.

#### Negative Paths
- Given a value that would fail configuration validation, when recording is attempted with it, then recording refuses before any file is written, names the rejected value, and the project has no partially written configuration.
- Given recording is invoked with a value for a setting it does not accept, when it runs, then it refuses with a message naming the unsupported setting and writes nothing.

### Done When
- [ ] A round-trip test proves a non-default answer is written and read back as the effective value.
- [ ] An effective-identity test proves the all-defaults path parses equal to the pre-change output apart from the Story 3 project-specific aggregate test command and adds only comment or blank lines, and refusal cases leave no file behind.

## Story 3: Establish the real test command, never an ecosystem guess

**Requirement:** FR-5

As an operator onboarding a project that is not run by the assumed ecosystem command, I want the recorded test command to be the one my project uses so the pre-ship gate runs my suite rather than failing on a command that does not exist.

### Acceptance Criteria

#### Happy Path
- Given an operator is present, when onboarding asks for the project's test command, then the operator's answer is recorded verbatim as the aggregate test command and is the value the pre-ship gate invokes.
- Given the project's tooling makes a candidate command evident, when the question is asked, then that candidate is offered as the default answer rather than a fixed single-ecosystem literal.

#### Negative Paths
- Given no candidate can be inferred and the operator answers nothing, when the question resolves, then onboarding re-asks rather than recording a command the project cannot run.
- Given the operator answers with a command containing shell metacharacters, when it is recorded, then it is stored as a single literal value and is not executed, expanded, or split at recording time.

### Done When
- [ ] A test proves an operator-supplied test command is recorded and read back unchanged, with no fixed single-ecosystem literal present in the recorded configuration.
- [ ] A test proves recording never executes the supplied command.

## Story 4: Establish operator identity during onboarding

**Requirement:** FR-6, FR-7

As a new operator, I want onboarding to establish which operator authored work is attributed to so I never reach the fail-closed identity stop after a setup that appeared to succeed.

### Acceptance Criteria

#### Happy Path
- Given no operator identity is established on this machine, when onboarding runs with an operator present, then it asks for the identity, offering the authenticated hosting-service login as the default when one is available, and records the answer as a machine-scoped setting without the operator editing any file.
- Given operator identity is already established on this machine, when onboarding runs, then it reports the established identity and does not ask again.

#### Negative Paths
- Given the operator submits an empty value to the identity question rather than explicitly declining it, when the answer is processed, then it is rejected, the question is re-asked with the decline option restated, and no identity is recorded.
- Given onboarding records operator identity, when the project's committed configuration is inspected afterwards, then it contains no operator identity, and a committed configuration that does carry one is still rejected at load exactly as before.

### Done When
- [ ] A test proves identity is written to the machine-scoped configuration only, and that the project-scope rejection of a committed identity is unchanged.
- [ ] A test proves an already-established identity is reported and not re-asked.

## Story 5: Say plainly when identity cannot be established

**Requirement:** FR-8

As an operator without an authenticated login and no identity yet, I want onboarding to tell me what will not work so the first failure is not a cryptic stop hours later.

### Acceptance Criteria

#### Happy Path
- Given no identity is established, no authenticated login is available, and the operator declines to supply one, when onboarding finishes configuration, then it states that operator identity is unresolved and names the actions that will refuse until it is established.

#### Negative Paths
- Given identity is unresolved at the end of onboarding, when onboarding completes, then it does not report a fully successful setup and does not invent or record a placeholder identity.

### Done When
- [ ] A test proves the unresolved-identity outcome is reported with the named blocked actions and that no placeholder value is written.

## Story 6: Re-running onboarding changes nothing already chosen

**Requirement:** FR-9, FR-10

As a returning operator, I want to re-run onboarding on a configured project without losing or silently changing any value I chose before.

### Acceptance Criteria

#### Happy Path
- Given a project whose configuration already exists, when onboarding runs again, then every previously set value is preserved byte-for-byte and the operator is told which settings are already established rather than being asked to decide them again.
- Given operator identity is already established, when onboarding runs again, then it is reported and preserved.

#### Negative Paths
- Given a project whose configuration already exists, when the recording step is invoked again with different answers, then it refuses to overwrite, reports that the configuration already exists, and the file is unchanged.
- Given a project configuration that has been hand-edited since it was recorded, when onboarding runs again, then the hand-edited values are preserved and reported, not replaced with defaults.

### Done When
- [ ] A test proves a second onboarding run leaves an existing project configuration and an existing identity byte-identical.
- [ ] A test proves the re-run reports established settings instead of re-asking them.

## Story 7: Explain unasked settings where they are recorded

**Requirement:** FR-11

As an operator changing a setting later, I want the recorded configuration itself to explain each setting the walkthrough did not ask about so I can change it without consulting separate documentation.

### Acceptance Criteria

#### Happy Path
- Given onboarding has recorded a project configuration, when the operator opens it, then every setting the walkthrough did not ask about is accompanied by an explanation stating what it controls, its permitted values, its default, and the consequence of changing it.

#### Negative Paths
- Given the recorded configuration, when its explanations are compared with the keys the harness accepts, then no explained key is unknown to the harness and no decidable-but-unasked key lacks an explanation.

### Done When
- [ ] A test proves the recorded configuration's explanatory text covers every unasked, operator-settable key at every nesting depth the harness accepts and references no key the harness rejects.

## Story 8: Unattended onboarding asks nothing

**Requirement:** FR-12

As the daemon or a continuous-integration job, I want onboarding to complete with defaults when no operator is present so no question ever blocks an automated run.

### Acceptance Criteria

#### Happy Path
- Given onboarding runs with no operator present, when it reaches configuration, then it asks no question, records today's defaults, and completes.

#### Negative Paths
- Given onboarding runs with no operator present and no identity is established, when it reaches the identity step, then it neither asks nor records an identity, and the existing fail-closed behavior on later identity-dependent actions is unchanged.
- Given onboarding runs with no operator present, when its output is compared with the pre-change unattended output, then the recorded project configuration parses to the same effective settings and differs only by added comment or blank lines.

### Done When
- [ ] A test proves the unattended path records configuration with zero questions and effective settings identical to the pre-change output with only comment or blank lines added, and writes no identity.
