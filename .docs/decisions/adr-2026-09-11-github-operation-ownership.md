# ADR: Shared ownership authorization for GitHub and remote Git operations

**Date:** 2026-09-11
**Status:** APPROVED
**Deciders:** Operator approval in chat, 2026-09-11
**Source:** jstoup111/ai-conductor#2516
**Supersedes:** adr-2026-07-03-gated-writeback-announcements

## Context

Repository access lets one operator's daemon mutate another operator's work. The halt reconciliation sweep currently performs healing and cleanup without ownership checks. The operator approved comprehensive GitHub operation coverage plus remote Git writes, with local Git refactoring deferred to #2517.

Reuse the canonical tracker-client seam, machine-scoped identity resolver, and committed intake provenance. The existing dispatch gate is not a mutation authorization gate. This decision adds the cross-transport authorization boundary and resource policy absent from those governing ADRs.

## Options Considered

### Shared operation authorization (selected)
- One policy governs GitHub mutations and remote Git writes; supported callers use guarded operations.
- Broad migration is required, but validation can detect omitted invocation paths.

### Checks in individual workflows
- Smaller local edits; repeated checks can drift and new paths can omit them.
- Rejected by operator in favor of the shared gate.

### One interface for every Git and GitHub call
- Could consolidate local Git execution too, but adds unrelated scope.
- Broader evaluation is captured in #2517, not a dependency.

## Decision

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


### D8 — Gated visibility never requires a foreign-resource write

Supersede adr-2026-07-03-gated-writeback-announcements. Operator approved this specific resolution in chat on 2026-09-11. Keep local GATED discovery, dashboard, and status visibility. A foreign-owned PR receives no owner-gated label or comment. An intake source issue is independently authorized; a Source-Ref is not permission. For authorized announcements retain marker-based edit-in-place, reannouncement on reason changes, no duplicate-create fallback after a failed edit, per-surface best-effort handling, and local-state-before-remote ordering. Preserve existing no-target skip verbosity semantics; authorization refusals remain available as typed results and canonical events. Do not invent a remote fallback for a denied announcement.

## Consequences

### Positive

Ownership is checked at the remote mutation boundary across supported harness workflows. Read access remains available for discovery. Existing shared transports and the event spine remain canonical.

### Negative

Unassigned legacy intake and shared repository administration can require explicit authorization. A missing shared label cannot be force-created by a daemon without such authorization. Extra evidence reads add latency. The cooperative committed-provenance model does not provide cryptographic forgery resistance or a transaction spanning GitHub and Git.

### Follow-up Actions

- Implement the approved boundary through behavior-owning plan tasks, including scoped tests and affected consumer documentation.
- Evaluate general local Git consolidation separately in #2517.
