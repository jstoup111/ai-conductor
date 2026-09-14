# Architecture Review: Ownership of harness GitHub operations

**Date:** 2026-09-11
**Track:** technical
**Tier:** L
**Input:** Operator-approved scope and diagram for jstoup111/ai-conductor#2516.
**Stories reviewed:** Not yet authored; this is the required pre-stories review.
**Verdict:** APPROVED
**Approval:** Operator approved the full resource authorization policy in chat on 2026-09-11.

## Feasibility

The existing TypeScript engine, injectable GhRunner, GitRunner adapters, machine identity resolver, and committed intake markers provide the needed foundations. No new hosted service, database, or provider dependency is proposed. Authorization must be operation-aware: the current raw argument runner carries neither a target owner nor an authorization decision.

Verified production entry points include daemon reconciliation, engineer-cli composition, standalone intake-file, shipment-evidence CLI, conductor publication, and standalone PR/composer skill commands. Covering only makeProductionGh would miss direct Git pushes and shell commands in supported skills. The feature must migrate those entry points to engine-owned guarded commands and mechanically check shipped production call sites for bypasses.

The guarantee is enforcement across supported harness operations, not protection against a malicious operator executing arbitrary network clients outside the harness. A caller cannot opt out with an unchecked boolean, a supplied owner string, or a raw mutable command forwarded by the interface.

## Complexity

Large: authorization semantics differ between feature resources, pre-spec intake, creation, and shared repository resources. Both GitHub and remote Git transports are affected. Retries and best-effort handlers must retain denied outcomes rather than report success or retry through a fallback.

Local Git execution consolidation is not required; #2517 owns its separate evaluation.

## Alignment

Reuse:
- adr-2026-07-22-canonical-tracker-client-seam: canonical GhRunner/factory and TrackerClient. Its original feature scope excluded migrating PR callers; this feature now extends authorization across those callers without replacing the tracker abstraction.
- adr-2026-06-30-owner-provenance-recording: committed intake marker is feature provenance; Git authors and merge actors do not establish ownership.
- adr-2026-07-01-machine-scoped-operator-identity: machine user configuration, then authenticated login; shared repository configuration must not select the operator identity.
- Existing pr-labels and tracker-client injection boundaries remain useful transport seams.

A new ADR is warranted for the uncovered cross-transport authorization boundary and resource authorization policy. The original dispatch gate is not reused as mutation permission: its current implementation permits unowned specs in some cases. No dispatch eligibility change is proposed here.

## Approved decisions

### D1 — One guarded GitHub boundary and one shared mutation policy

Extend the canonical tracker-client boundary with typed operations and canonical targets. GitHub reads and writes enter the interface; recognized reads may run without target ownership so discovery can resolve evidence. Unknown operations cannot default to read-only. Remote Git mutation adapters invoke the same policy. Raw transports remain internal implementation details, with injectable transport fakes for tests.

Authorization binds actor, repository, target, and operation. Resolve identity and evidence again for a retry or different target; a prior authorized call is not blanket permission for the rest of a workflow.

### D2 — Feature resources use committed ownership

Existing feature PRs and remote feature branches require a single unambiguous committed intake owner matching the machine-resolved operator. Resolve the canonical repository and exact branch/PR identity, not a cwd guess or body marker alone.

For an already-merged spec, committed default-branch provenance is authoritative. For initial spec publication before merge, use its committed spec-branch provenance. Conflicting relevant owner records, duplicate contradictory owner lines, missing evidence, and lookup failures refuse mutation. A shipped record permits cleanup only after ownership passes. Another operator's resources are neither healed nor cleared.

A source issue is a separate mutation target: an owned feature does not authorize arbitrary issues merely because its body links them. Preserve existing issue assignees.

### D3 — Pre-spec intake and creation

Approved policy: an existing intake issue without committed feature provenance is actionable when assigned exclusively to the resolved operator. Multiple distinct assignees, another assignee, or no assignment requires explicit operator authorization for that exact issue and operation. Never reassign an existing issue to manufacture permission.

Creating a new issue is allowed for an identified operator through an explicit intake action or an already-authorized feature workflow. Creation authorization is scoped to the destination repository and operation. The returned resource identity may authorize immediate labels/dependency metadata in that same creation transaction; it is not a durable exemption for later sweeps. A later run must resolve current ownership or obtain explicit authorization.

New feature PRs and branch publication use their committed feature owner before the first remote write. Linking a dependency on an issue does not grant permission to modify the referenced issue.

### D4 — Shared resources require explicit authorization

Approved policy: mutations of resources with no feature owner, such as repository-wide label definitions or workflow administration, require explicit operator authorization bound to that repository, target, and operation. A daemon must skip/refuse these actions rather than infer permission from repository access.

Authorization for a feature does not authorize force-updating shared label colors/descriptions. Existing shared labels may be applied to owned issues/PRs; missing label creation needs the scoped authorization above. Use an existing operator approval mechanism where available; do not introduce a general force/ignore-ownership switch.

### D5 — Remote Git writes carry the same constraints

Resolve actual push destination and all affected refs before authorization. Refuse ambiguous implicit destinations, broad/mirror pushes, or multi-ref writes with any unauthorized target before invoking a mutating transport. Named remote deletion is a write, as is a force-with-lease push. Preserve existing force-push restrictions and leases; ownership is an additional gate, not permission to weaken them.

Local reads, commits, and worktree actions remain on their existing paths. Owned publication may proceed when all affected remote targets are authorized; there is no requirement to centralize every local Git command.

### D6 — Refusal is a first-class result

Return typed reasons for other-owner, unresolved actor, missing/ambiguous provenance, unsupported operation, and explicit authorization required. A refused sweep item must not prevent processing authorized items. A refused publication cannot be recorded as successfully pushed, handed off, or healed. No mutation fallback runs after refusal, including an escalation comment on the same unauthorized resource.

Emit ownership refusal through the existing ConductorEvent union, emitter, persister, and consumers. No new bespoke log schema or sidecar. Standalone commands render the same typed result to the operator through existing output facilities.

### D7 — Completeness is mechanically checked

Maintain a bounded operation inventory and an executable production-boundary audit so a new direct GitHub invocation or remote Git write outside the approved adapters fails validation. Audit should inspect executable invocation sites and known skill/CLI publication commands, not treat arbitrary mentions in historical documentation as operations.

Migrate supported skill-directed writes to guarded CLI operations in both Claude and Codex workflows. A provider-specific hook alone is insufficient. Keep raw transport access private and fail closed when required operation context is absent. This is not a new general-purpose process sandbox.

## Domain integrity

Separate OperatorIdentity from repository owner/name, PR author, assignee, and lock-holding process identity. Represent targets and operation kinds explicitly. Use discriminated authorization results rather than a nullable boolean or caller-supplied owner assertion. Evidence readers return missing, conflicting, failed, and resolved states distinctly.

New-resource authorization cannot accidentally become existing-resource ownership. Read access cannot become an implicit write capability. Sharing a repository is not an ownership relation.

## Wiring Surface

| Production surface | Composition and callers |
|---|---|
| Shared operation authorization and canonical target resolver | tracker-client.ts factory/TrackerClient adapters; owner-gate identity and provenance readers |
| PR and issue mutations | pr-labels.ts; halt-pr-reconciliation.ts; halt-pr-rehabilitation.ts; halt-issues; engineer intake writeback and dependency migration |
| Creation and publication | engineer-cli.ts; engineer/handoff.ts; finish-publication-production.ts; shipment-evidence-cli.ts |
| Remote Git authorization adapter | ship-draft-pr.ts; autoresolve.ts; build-failure-escalation.ts; halt-record.ts; conductor.ts; engineer/handoff.ts |
| Guarded CLI surface for supported skill operations | index.ts command dispatch and shipped pr/composer guidance; scope limited to operations those workflows need |
| Refusal event and rendering | types/events.ts; existing emitter/persister and renderer composition |
| Production invocation audit | repository validation suite and focused fixtures that introduce bypass calls |

These are rediscovery seeds, not an exhaustive frozen path list. BUILD must inventory current production paths before migration, and must not claim full coverage from only the rows above.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Overlooked direct or skill-issued write | Integration | High | High | Closed operation inventory, guarded CLI migration, production boundary audit |
| Wrong repository or branch inferred from cwd | Security | Medium | High | Canonical target resolution and target-bound authorization |
| Over-restricting creation or pre-spec intake | Integration | High | High | Explicit resource policy and approved creation context |
| Shared label helper silently changes global definitions | Data | Medium | High | Treat shared definitions as separately authorized resources |
| A catch handler converts denial into success or another write | Integration | High | High | Typed refusals through orchestration; negative integration tests |
| Evidence becomes stale between authorization and execution | Data | Medium | High | Revalidate per mutation/retry; preserve remote leases; do not promise cross-API atomicity |
| Extra ownership lookups increase sweep cost | Performance | Medium | Medium | Bounded reads within a pass; no indefinite authorization cache |
| Expanding into generic local Git refactoring | Knowledge | Medium | Medium | #2517 separation and explicit scope boundary |

The policy is cooperative ownership enforcement, consistent with existing unsigned committed provenance. It does not claim forgery resistance or atomic authorization across independent remote APIs.

## Validation design

Unit tests inject fake transports. Integration tests exercise real policy, adapters, and entry points with faithful GitHub fakes and fixture-owned local Git repositories. Prove denied calls never reach the process/remote boundary, including when the guard is absent in counterfactual review. Existing real-exec kill-switches are not the test isolation mechanism.

Integration coverage must include both operators in one repository, unresolved identity, ambiguous intake assignment, PR healing and cleanup, fresh creation follow-ups, cross-repository issue links, multi-target pushes, retries, and best-effort exception handlers. Story-level acceptance tests are selected at the lowest sufficient layer during story authoring; no blanket full-stack suite is prescribed.

## Verify-claims ledger

Verified from source: canonical runner and factory (tracker-client.ts); separate Git transport (pr-labels.ts); ungated heal/cleanup (halt-pr-reconciliation.ts); machine identity resolver (owner-gate/machine-identity.ts); committed owner reader (owner-gate/provenance.ts); direct pushes (halt-record.ts); standalone raw publication commands (skills/pr/SKILL.md and skills/composer/SKILL.md).

Approved inputs: shared gate; technical track; comprehensive GitHub and remote Git write scope; local Git follow-up #2517; diagram approved in chat.

D1-D7, including D3 pre-spec intake/creation and D4 shared-resource authorization, were explicitly approved by the operator on 2026-09-11. No unconfirmed load-bearing assumptions remain.

Verdict: CLEAR

## ADRs Created

Advisory overlap scan: completed against GitHub on 2026-09-11; no overlap detected and no open blockers. The scanner cautions that renames or name-only diffs may not be detected.

Repository integrity validation with existing dependencies linked into the isolated worktree: 302 passed, 0 failed, 1 warning. No production code changed. Both architecture diagrams render successfully.

Created adr-2026-09-11-github-operation-ownership.md, Status: APPROVED, recording D1-D7 with operator approval.

## Blocking Issues

None. The operator approved the reviewed architecture and resource policy. Proceed to stories within that scope.

## Scope and event-spine checks

Audience: consumer-facing; the mechanism runs in installed harnesses, overriding scope-check's blanket repo-only daemon heuristic.
Catalog: n/a; no new skill.
Provider: agnostic; shared engine enforcement and both hosts' supported command paths.
Event spine: refusal is an occurrence, extend the existing union; no new telemetry channel. This review is durable design state.
