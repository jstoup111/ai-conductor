**Status:** Accepted

# Stories: Runtime values remain literal data

Source: jstoup111/ai-conductor#1478
Track: technical. Tier: M.
Governing input: operator-approved architecture-review-2026-09-06-handle-runtime-values-as-literal-data-across-inter and the same-stem track boundary.

Operator accepted these stories in chat on 2026-09-06. This is a specification; BUILD remains subject to operator merge and daemon dispatch.

## Story 1: Commit-hook task lookup treats values literally

As a harness operator, I want supplied task trailers and repository paths to be treated as data so unusual characters cannot change task lookup or execute unintended code.

### Acceptance Criteria

#### Happy Path
- S1.1: Given a local repository whose path contains spaces, single/double quotes, backslashes, or interpreter-looking text, and a status file containing a matching supplied single-line Task trailer value, when the generated commit-msg hook validates it, then lookup succeeds, without a syntax failure or unintended sentinel side effect. Exercise the trailer variants separately from repository-path variants; preserve Git's existing trailer parsing rather than defining multiline trailer values.
- S1.2: Given a numeric ID or its string equivalent in a valid task-status file, when the matching trailer is validated, then the same match succeeds. Given an existing exemption or a missing trailer/status file, when the hook runs, then its existing pass-through behavior remains intact.

#### Negative Paths
- S1.N1 (S1.1): Given an absent task ID containing quotes, backslashes, or interpreter-looking text, when the hook validates it, then it rejects as an ordinary non-match and no sentinel side effect occurs. The ID must not become a different existing ID through source interpretation.
- S1.N2 (S1.1): Given a present status file that is malformed or unreadable, or an unavailable/failing Node interpreter, when lookup is required, then the hook rejects with a contextual processing-error diagnostic distinguishable from an ordinary non-match; it never prints a successful match or hides the error behind a not-found fallback.
- S1.N3 (S1.2): Given a task-N trailer or a genuinely absent numeric/string ID, when validation is required, then existing rejection behavior remains. Missing evidence trailers do not become a new rejection condition, and advisory scope-check results do not become blockers.

### Done When
- [ ] The rendered hook accepts matching unusual literal values and numeric/string IDs in a real temporary Git fixture.
- [ ] Non-match, processing failure, and naming rejection have distinguishable asserted outcomes; harmless execution sentinels remain absent.
- [ ] Existing exemption, missing-input, and advisory-scope behavior is covered by current sufficient tests or explicit scoped integration cases.

### Coverage Disposition

S1.1/S1.N1/S1.N2: lower-layer integration of the actual generated hook with temporary Git/status files and a controlled scope-check launcher. S1.2/S1.N3: retain sufficient existing hook integration proof and extend only uncovered cases. No full daemon or new end-to-end flow is needed.

## Story 2: Installer configuration preserves literal paths and reports failures

As an installer user, I want permissions and hooks to be configured at the exact supplied paths while retaining existing settings, so valid path characters do not corrupt configuration.

### Acceptance Criteria

#### Happy Path
- S2.1: Given settings, temporary-file, and harness-directory paths containing quotes, backslashes, spaces, newlines, or interpreter-looking text supported by the filesystem, when either configuration helper runs, then it reads/writes the exact intended paths and preserves literal hook-directory strings in settings. No unintended sentinel side effect occurs. This criterion covers configuration serialization, not new support for every downstream shell command-path grammar.
- S2.2: Given pre-existing unrelated settings and custom hook/permission entries, when the helpers configure settings and repeat the same operation, then unrelated values remain unchanged and managed entries are not duplicated.

#### Negative Paths
- S2.N1 (S2.1): Given an unavailable/failing Python interpreter, unreadable input, malformed settings JSON, or unwritable target, when either helper runs, then that helper returns nonzero and reports which configuration operation failed, with no success message. The existing installation caller continues with its incomplete-configuration warning policy.
- S2.N2 (S2.2): Given malformed settings that cannot be parsed, when configuration fails, then the original settings bytes remain unchanged rather than being replaced with a new default document. For write failures, no atomic rollback guarantee beyond current behavior is introduced; the failure must be surfaced.
- S2.N3 (S2.1/S2.2): Given a valid path containing text that resembles Python or shell operations, when either helper runs, then only its intended configuration effects occur and existing unrelated settings survive.

### Done When
- [ ] Both existing configuration functions pass literal-path and repeated-merge cases against temporary settings files.
- [ ] Both functions return a failure status for each scoped failure class, with no false success report.
- [ ] Unrelated settings and malformed-input bytes are preserved as specified, and no full installation or third-party call is needed to prove it.

### Coverage Disposition

S2.1/S2.2/S2.N1/S2.N2/S2.N3: lower-layer integration through the existing installer functions and real temporary JSON files. Fake unrelated installation/process boundaries; invoke no dependency installer. Missing-interpreter and write/read failure cases use controlled process/file conditions, not assumptions about permissions under a privileged test runner.

## Story 3: Session-start summary reports processing failures without blocking

As a Claude harness user, I want the existing pipeline summary to remain accurate and non-blocking while failures are visible.

### Acceptance Criteria

#### Happy Path
- S3.1: Given valid existing pipeline state with string-valued steps plus unrelated non-string fields, when the actual session-start hook runs, then it reports the same done/skipped count over string-valued steps and continues the remaining context output.
- S3.2: Given no pipeline state file, when the hook runs, then it omits the pipeline summary quietly and continues normal context output.

#### Negative Paths
- S3.N1 (S3.1): Given malformed/unreadable state or an unavailable/failing Python interpreter while state is present, when the hook runs, then it emits a contextual stderr warning, emits no fabricated successful summary, continues its remaining output, and exits according to its existing non-blocking summary policy.
- S3.N2 (S3.1/S3.2): Given interpreter-looking or quoted text in state keys/values, when the hook reads the JSON, then it only contributes according to the existing string-value/count rules and causes no unintended execution or additional state mutation. An absent file is not misreported as a parsing error.

### Done When
- [ ] The real hook produces the expected count from a fixed fixture and completes its remaining output.
- [ ] Missing state is quiet; processing failures are visible without turning this summary into a blocking hook.
- [ ] State content cannot cause unintended execution, and no new configurable state-path override is introduced for testing.

### Coverage Disposition

S3.1/S3.2/S3.N1/S3.N2: lower-layer integration of the actual session-start script in a temporary project, using real local state and controlled interpreter failures. The fixed-path source-expansion cleanup is also covered by Story 4's static rule; it is not represented as a currently exploitable arbitrary-path bug.

## Story 4: Repository validation rejects unsafe interpreter-source construction

As a harness maintainer, I want validation to catch recurrence in shipped shell code and generated hooks before a change lands.

### Acceptance Criteria

#### Happy Path
- S4.1: Given shipped scripts and rendered hook assets using fixed Python or Node source with separately supplied data, when the repository interpreter-source validation entrypoint runs, then it succeeds. Quoted heredocs, literal dollar characters protected from shell expansion, multiline constant source, and argv/stdin/environment data transport are accepted.
- S4.2: Given a new shipped shell script or new rendered hook asset in the declared inventory, when validation runs, then that input is included automatically or an unclassified generated export makes the inventory check fail visibly; it cannot be silently omitted. Scope includes bin entrypoints and shell libraries, hooks, and rendered git/session hook assets; test fixtures and documentation examples are not production inputs.

#### Negative Paths
- S4.N1 (S4.1): Given a direct Python -c/heredoc or Node -e/--eval source containing shell parameter expansion, command substitution, or backticks, including multiline variants, when validation runs, then it exits nonzero and identifies the source asset and location. Unsafe fixture text is inspected without being executed.
- S4.N2 (S4.2): Given a newly added unsafe shipped script or unsafe rendered hook, when validation runs through its real entrypoint, then it rejects that addition. An empty inventory, required input read failure, render failure, or unclassified generated hook export is a validation failure, not success over partial inputs.
- S4.N3 (S4.1/S4.2): Given an unsafe specimen only in a documentation example or test fixture, when the production inventory scan runs, then that out-of-scope specimen does not fail the production scan; it still remains available as explicit checker test input.

### Done When
- [ ] Classification fixtures prove rejection and acceptance across the declared Python/Node forms without executing specimen code.
- [ ] The checker entrypoint demonstrates failure on a new unsafe shell input and rendered hook input, including inventory/read/render failure paths.
- [ ] The repository integrity suite invokes the checker so ordinary validation cannot omit it.

### Coverage Disposition

S4.1/S4.N1: unit classification fixtures. S4.2/S4.N2/S4.N3: narrow entrypoint integration over a controlled source tree and rendered-asset inventory, plus the integrity caller wiring. No recursive aggregate-suite invocation from tests and no third-party service calls.

## Negative-category assessment

Invalid input, dependency unavailability, read/write permissions, partial failure, and data integrity are explicitly covered above. Concurrency introduces no new shared-state writer or locking contract; existing installer write semantics remain unchanged. Resource exhaustion is represented by write/process failures without a new retry/rollback design. Network/authentication, database cascades, immutable models, and exception hierarchies have no new in-scope production boundary. Repeated settings configuration has explicit idempotency proof. Alternate no-file/exempt/advisory paths preserve their existing behavior and never claim work succeeded when processing failed.

## Verify-Claims Ledger

Verified source basis and original lookup probe are recorded in the approved architecture review. The fixed session-state path is preventive cleanup, not a demonstrated arbitrary-input path bug. The operator approved literal argument transport, surviving-site scope, Medium technical track, and the architecture review. These proposed criteria preserve that boundary and explicitly avoid arbitrary multiline Git trailers, downstream hook command-path expansion, Python removal, and new rollback/concurrency guarantees. No unconfirmed factual assumption is used. Verdict: CLEAR. Operator story acceptance received in chat on 2026-09-06.
