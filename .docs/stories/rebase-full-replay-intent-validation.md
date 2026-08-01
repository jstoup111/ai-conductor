**Status:** Accepted

# Stories: Full-replay rebase intent validation

**Track:** Technical
**Architecture:** `adr-2026-08-01-rebase-full-replay-intent-validation`

## Story 1: Validate the complete replay before continuing

**Requirement:** TI-1

As an operator of unattended rebases, I want the resolver to validate the complete replayed commit against its source intent before continuing, so unrelated or invented changes are not accepted merely because conflict markers disappeared.

### Acceptance Criteria

#### Happy Path

- Given a paused replay whose source commit and upstream change have compatible intent, when the resolver prepares a resolution, then it inspects the source commit, its parent context, the upstream change, and the complete staged diff before running continue.
- Given a staged resolution in which every change is attributable to source intent or a necessary upstream adaptation, when validation completes, then the resolver may continue and inspects the resulting replay commit before advancing or reporting success.

#### Negative Paths

- Given a staged resolution containing content attributable to neither the source commit nor a necessary upstream adaptation, when full-replay validation runs, then the resolver does not continue and returns an unsafe-resolution result naming the unexplained change.
- Given the conflict markers are removed but the resolver has not inspected the complete staged diff, when it evaluates readiness to continue, then it treats the replay as unverified and stops rather than inferring correctness from a clean index.
- Given post-continue inspection finds that the replayed commit differs from the validated intent, when the resolver evaluates the completed replay, then it reports failure and does not report `resolved: true`.
- Given a proposed resolution strips an EOF newline, changes a file mode, or edits an unrelated file without an intent-based reason, when the complete replay is reviewed, then the side effect is treated as unexplained and resolution stops.

### Done When

- [ ] The shipped rebase contract explicitly requires source/parent/upstream inspection, complete staged-diff review, and post-continue replay inspection.
- [ ] Third-party-free contract tests fail if any of those three obligations disappear from the delivered semantic skill boundary.
- [ ] No ordinary test launches a real LLM, GitHub command, registry request, or other third party.

## Story 2: HALT with actionable ambiguity evidence

**Requirement:** TI-2

As an operator recovering a conflicted branch, I want ambiguous replay intent to HALT with precise evidence, so I can decide the conflict without rediscovering which commit or change was unsafe.

### Acceptance Criteria

#### Happy Path

- Given the resolver cannot confidently attribute every staged change, when it declines resolution, then its final structured result is `resolved: false` and the reason identifies the replay commit, affected file or region, competing intentions, and missing decision whenever each fact is available.
- Given the resolver returns that specific false reason, when the existing bounded resolution flow settles, then the resulting HALT preserves the reason and does not replace it with a generic conflict-only message.

#### Negative Paths

- Given ambiguity exists but the resolver can name only some evidence, when it returns failure, then it includes all available evidence and explicitly identifies what context is missing rather than inventing the absent facts.
- Given the resolver returns malformed output or claims success while the rebase remains active, when the engine evaluates the attempt, then the existing fail-safe path rejects success and HALTs without losing the parse/completion failure reason.
- Given the first attempt returns a semantic cannot-resolve decision, when the cap permits more attempts, then the flow short-circuits immediately rather than asking another attempt to guess at the same ambiguity.

### Done When

- [ ] A fake-provider acceptance test drives the real result parser and HALT writer and asserts the specific replay evidence survives end to end.
- [ ] Existing malformed-output, active-rebase, cap, currency, and commit-preservation safety behaviors remain green.
- [ ] The operator-visible HALT distinguishes semantic ambiguity from a generic unresolved marker conflict.

## Story 3: Preserve legitimate coordinated resolution freedom

**Requirement:** TI-3

As a maintainer resolving semantic conflicts, I want necessary supporting edits outside the immediate conflict surface to remain allowed, so a safe resolution is not rejected merely because functionality moved across files.

### Acceptance Criteria

#### Happy Path

- Given a source commit's behavior must be adapted across an additional file after upstream refactoring, when the resolver can explain and validate that coordinated edit against source intent, then the contract permits the edit and allows the normal continue path.

#### Negative Paths

- Given a cross-file edit has no demonstrated connection to source intent or upstream adaptation, when validation runs, then cross-file permission does not excuse it and the resolver returns semantic ambiguity.
- Given an implementation proposes a file allowlist, conflict-hunk-only write restriction, whole-patch equality requirement, or deterministic resolver as the acceptance boundary, when architecture conformance is reviewed, then the implementation is rejected as inconsistent with the APPROVED ADR.
- Given the same semantic skill is invoked through different supported provider adapters, when each adapter dispatches rebase resolution, then neither adapter weakens the full-replay validation or ambiguity-HALT contract.

### Done When

- [ ] Contract coverage contains both a legitimate coordinated cross-file example and an unexplained cross-file negative example.
- [ ] Architecture conformance asserts that no mechanical edit-surface restriction was introduced.
- [ ] Provider-boundary tests prove the same semantic contract is delivered without calling a real provider.
