**Status:** Accepted

# Stories: Ownership across harness GitHub operations

Track: technical
Source: jstoup111/ai-conductor#2516
Governing architecture: adr-2026-09-11-github-operation-ownership, D1-D7 (APPROVED).
Scope: all supported harness GitHub operations and remote Git mutations. Local Git consolidation remains separate (#2517).

## Story 1: Identify the operator and exact mutation target

**Requirement:** D1, D2

As an operator, I want authorization tied to my identity and the actual target so another checkout or repository cannot supply permission for my work.

### Acceptance Criteria

#### Happy Path
- Given a machine-configured operator and a matching committed feature owner, when a mutation targets that feature in its canonical repository, then it proceeds using the configured identity even if the ambient GitHub login differs.
- Given no configured operator and an available authenticated login matching the committed owner, when that operator requests a feature mutation, then it proceeds.

#### Negative Paths
- Given another owner, unresolved identity, missing ownership, or conflicting owner records, when a feature mutation is requested, then it is refused with the distinct reason and no remote write.
- Given shared project configuration claims another operator identity, when authorization runs, then that value never supplies permission.
- Given a malformed or ambiguous repository/target, or an ownership lookup that fails or times out, when authorization runs, then no mutation occurs.
- Given identical branch names in two repositories with different owners, when authorization was obtained for one, then it cannot authorize a write to the other.
- Given relevant committed records contain contradictory duplicate owner lines, when authorization runs, then no first-match interpretation permits the write.

### Done When
- [ ] A mutation result identifies its canonical target and either succeeds under matching identity or reports the specific refusal.
- [ ] The remote write recorder stays empty for every denied identity, evidence, and target case.

**Coverage disposition:** Focused authorization integration with real identity/target/provenance collaboration and fake transports; pure normalization/decision permutations stay at unit level.

## Story 2: Reconcile only the operator's feature PRs

**Requirement:** D2, D6

As an operator, I want my daemon to maintain my PRs without reversing another operator's manual actions.

### Acceptance Criteria

#### Happy Path
- Given an owned halted PR missing the required label or draft state, when reconciliation runs, then its halt presentation is restored.
- Given an owned PR with committed shipment evidence, when reconciliation runs, then its stale halt presentation is cleared and its halt comment updated as intended.

#### Negative Paths
- Given another operator's marked PR missing a label or draft state, when reconciliation runs, then its labels, body, comments, and draft state remain unchanged.
- Given another operator's marked PR with shipment evidence, when cleanup runs, then no label, comment, body, or draft mutation occurs.
- Given an unauthorized PR alongside an authorized PR in the same sweep, when reconciliation runs, then the former is refused and the latter is still processed.
- Given a PR whose owner cannot be resolved from authoritative evidence, when reconciliation runs, then a body marker, branch naming convention, or shipment record alone never grants permission.

### Done When
- [ ] A two-operator reconciliation fixture reproduces #2516 and records mutations only for the current operator's authorized PR.
- [ ] Healing and cleanup both produce their expected owned-resource effects and zero effects for foreign resources.

**Coverage disposition:** Reconciliation entry-point integration with fake GitHub state; no full conductor run required.

## Story 3: Keep all existing-resource updates inside ownership authorization

**Requirement:** D1, D2, D6, D7

As an operator, I want publication, rehabilitation, labels, comments, and issue updates to apply the same ownership rule.

### Acceptance Criteria

#### Happy Path
- Given an authorized existing resource and a supported mutation, when the harness updates its presentation or lifecycle state, then the intended change succeeds through the guarded operation.
- Given ordinary repository discovery or ownership reads, when the operator does not own the returned resources, then the read succeeds without granting mutation permission.

#### Negative Paths
- Given a supported mutation against a foreign-owned resource, when requested through any migrated entry point, then it is refused, including labels, comments, body/title edits, state changes, and applicable remote API mutations.
- Given an unknown operation or missing required context, when submitted to the GitHub interface, then it is refused rather than assumed to be a read.
- Given a linked issue owned by another operator, when an owned feature attempts issue writeback, then the issue is not mutated merely because it is referenced by that feature.
- Given a refusal caught by a best-effort handler, when the workflow continues, then it neither reports a successful mutation nor sends an escalation comment to that unauthorized resource.

### Done When
- [ ] Every supported mutation family in the operation inventory has an authorized and denied production-entry-point proof.
- [ ] Read-only discovery returns results while unauthorized mutation recorders stay empty.

**Coverage disposition:** Adapter and caller integration grouped by actual production mutation families; lower-layer classification tests cover unknown/malformed operation permutations.

## Story 4: Authorize intake before a spec exists

**Requirement:** D3

As an operator, I want assigned intake to work before spec creation while ambiguous assignments remain protected.

### Acceptance Criteria

#### Happy Path
- Given a pre-spec issue assigned exclusively to the resolved operator, when the harness performs an intake update, then it succeeds without changing assignees.
- Given a pre-spec issue otherwise lacking permission and explicit authorization for its exact repository, issue, and operation, when that operation is requested, then it succeeds within that authorization.

#### Negative Paths
- Given no assignee, another assignee, or multiple distinct assignees, when no explicit authorization exists, then the intake mutation is refused and assignees remain unchanged.
- Given explicit authorization for a different issue, repository, or operation, when it is presented for the target issue, then mutation is refused.
- Given assignment evidence changes or becomes unavailable before a retry, when the retry authorizes again, then stale permission does not permit mutation.
- Given an owned feature references an intake issue whose independent authorization fails, when writeback runs, then the issue remains unchanged.

### Done When
- [ ] Intake entry-point fixtures distinguish exclusive assignment, ambiguity, and exact explicit authorization.
- [ ] Before/after issue state proves that refusal and successful intake updates preserve existing assignees.

**Coverage disposition:** Intake writeback/CLI integration with fake assignment and approval evidence; policy permutations below that layer.

## Story 5: Create new resources without granting blanket future permission

**Requirement:** D2, D3

As an operator, I want new intake and feature publication to work before the new remote resource has a history.

### Acceptance Criteria

#### Happy Path
- Given an identified operator making an explicit intake request or acting in an authorized feature workflow, when a new issue is created in the authorized repository, then its immediate labels and dependency metadata can be written to the returned issue.
- Given a not-yet-merged spec with matching committed spec-branch ownership, when its feature branch and PR are first published, then publication succeeds without requiring a default-branch marker that cannot yet exist.

#### Negative Paths
- Given unresolved identity or an unauthorized destination, when creation/publication is requested, then no remote resource is created or pushed.
- Given a creation response cannot identify the newly created issue unambiguously, when follow-up metadata is attempted, then no other issue is guessed or modified and partial completion is reported.
- Given an earlier creation context is reused in a later run or for a different target, when a mutation is requested, then current ownership or explicit authorization is required.
- Given dependency metadata on the new issue refers to another operator's issue, when the dependency is linked, then the referenced issue receives no independent mutation.
- Given creation succeeds but a metadata write fails, when the result is reported, then it distinguishes the created resource from failed metadata and does not claim complete success.

### Done When
- [ ] Creation fixtures record the new URL and restrict transaction follow-ups to that exact new resource.
- [ ] Initial spec publication succeeds with branch provenance, while a later run cannot reuse creation context as ownership.

**Coverage disposition:** One bounded creation-through-follow-up integration flow and publication integration; failure permutations at adapter level.

## Story 6: Protect shared repository resources

**Requirement:** D4

As an operator, I want shared repository changes to require explicit permission rather than one feature's ownership.

### Acceptance Criteria

#### Happy Path
- Given explicit authorization for an exact shared repository resource and operation, when the supported administration operation runs, then the requested change succeeds.
- Given an existing shared label and an owned issue or PR, when the label is applied, then it is applied without changing the label's shared definition.

#### Negative Paths
- Given an owned feature but no shared-resource authorization, when a daemon tries to create or modify a label definition or perform supported repository/workflow administration, then that shared mutation is refused.
- Given a missing shared label, when automatic label creation lacks explicit authorization, then it is reported as requiring authorization rather than silently created or force-updated.
- Given permission for a different shared resource or operation, when it is reused, then the requested mutation is refused.
- Given an authorized administration request encounters transport failure, when the harness reports its result, then it does not report the shared mutation as successful.

### Done When
- [ ] Shared-resource tests show exact authorized mutations and zero changes without matching authorization.
- [ ] Applying an existing label leaves its color and description unchanged.

**Coverage disposition:** Shared-resource operation integration with fake GitHub; label helper integration covers application versus definition changes.

## Story 7: Authorize all remote Git targets before writing

**Requirement:** D5, D6, D7

As an operator, I want remote Git publication and deletion to protect ownership without disrupting local Git work.

### Acceptance Criteria

#### Happy Path
- Given matching ownership for every explicit destination ref, when an otherwise permitted push runs, then it updates only those refs.
- Given matching ownership and existing deletion permission, when a named remote branch deletion runs, then only that named ref is deleted.
- Given ordinary local status, diff, commit, or worktree operations, when executed, then this remote ownership gate does not change their existing behavior.

#### Negative Paths
- Given any unauthorized ref in a multi-target request, when publication is attempted, then no remote write is invoked for any target.
- Given an ambiguous implicit destination or broad/mirror push request, when publication is attempted, then it is refused before remote execution.
- Given a force-with-lease push whose lease is rejected, when publication fails, then no unleased force fallback is attempted.
- Given a foreign remote branch targeted for deletion or update, when the request originates in an owned worktree, then worktree ownership does not authorize that foreign ref.
- Given a refusal in halt-record, escalation, composer, or repair publication, when its caller reports progress, then it does not record the push as successful or retry outside authorization.

### Done When
- [ ] Remote Git recorder and fixture refs show zero writes on any unauthorized or ambiguous request.
- [ ] Owned push/deletion paths work, existing lease protection remains observable, and local Git regression proofs remain valid.

**Coverage disposition:** Publication caller integration plus fixture-owned local Git ref tests where Git semantics matter; no third-party remote.

## Story 8: Preserve refusals and detect bypasses across supported entry points

**Requirement:** D6, D7

As a maintainer, I want omissions to fail verification and operators to see accurate refusal results.

### Acceptance Criteria

#### Happy Path
- Given an ownership refusal, when a daemon or standalone command reports it, then the result names the target and actionable reason; daemon evidence is available through the existing event spine.
- Given supported engine and skill-directed publication operations on either supported host, when invoked, then they use the same authorization behavior.
- Given production calls confined to approved boundaries, when the invocation audit runs, then it passes.

#### Negative Paths
- Given a new direct GitHub call or remote Git write outside those boundaries, when validation runs, then it fails identifying that bypass.
- Given a historical documentation mention or a permitted local Git call, when the audit runs, then that non-bypass does not fail validation.
- Given authorization changes between attempts, when retry runs, then it cannot reuse the previous decision as blanket permission.
- Given an event/reporting failure after a refused operation, when the result is handled, then no remote write is performed as a fallback and the caller still receives a refusal.
- Given tests exercise a denied operation with the production guard absent, when the test runs, then a fixture-owned fake process boundary still prevents any real third-party call.

### Done When
- [ ] Invocation audit fixtures fail for bypasses and pass for approved transports and local/read-only examples.
- [ ] Refusal integration produces the operator result and canonical event, with no success record or fallback mutation.
- [ ] Both host workflow paths have guarded command coverage without relying on a host-specific hook.

**Coverage disposition:** Audit fixture tests, event/result integration, and bounded guarded-CLI dispatch tests. Test-boundary isolation is verified before destructive arguments are exercised.

## Negative-category evaluation

Invalid inputs, identity/permission failures, unavailable evidence, timeouts, retries, partial failure, conflicting data, and alternate error handlers are covered above. Concurrent changes are tested at reauthorization/remote lease boundaries; no cross-API transaction is promised. Resource exhaustion is represented by failed evidence/transport/reporting dependencies, not unbounded stress tests. This feature adds no cascading local deletion, domain-record immutability model, or duplicate-creation guarantee. Existing dedup/idempotency behavior must not be weakened; creation authorization is not a new dedup mechanism.

## Verify-claims ledger

All expected behavior derives from the operator-approved D1-D7 and scope. No additional ownership fallback, administrative exemption, local Git refactor, or security guarantee is introduced. Existing behavior claims are grounded in the architecture review's source inventory.

Verdict: CLEAR

## Review state

Operator approved these stories in chat on 2026-09-11. No implementation is part of this session.

