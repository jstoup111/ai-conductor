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

> **Amended 2026-09-23 by #158:** adds D9. An operator may configure an optional bot identity,
> and this decision separates the credential that performs an authorized write from the actor
> that D1–D5 authorize. Operator decisions for #158, confirmed in chat on 2026-09-23: the bot is
> optional; it uses a machine-user token; every remote write, including pushes, uses it; reads
> stay on the operator's credential; the rule covers daemon and operator-run CLIs; an
> unambiguous bot auth failure falls back to the operator's credential with a warning.
>
> **D9 — Write credential is a transport property, distinct from the authorization actor.**
> 1. *Actor unchanged.* The actor for D1–D5 is still the machine-resolved operator. A bot
>    credential performs an already-authorized write on the operator's behalf. It is never a
>    second owner, never an authorization input, and never widens what D2–D5 permit.
> 2. *Machine-scoped, optional credential.* The bot is declared only in user config
>    (`~/.ai-conductor/config.yml`) as a reference to a token file, never as an inline token
>    value. `validateConfig` rejects the block in a committed project config, using the same
>    fail-closed guard as `spec_owner` (adr-2026-07-01-machine-scoped-operator-identity D2). It
>    is not the reserved per-project `tracker.credentials` reference of
>    adr-2026-07-22-canonical-tracker-client-seam item 3. With no bot declared, every call keeps
>    today's ambient `gh` and git credential, byte for byte.
> 3. *Selection by access class, inside the private transport.* The guarded GitHub runner asks
>    for the write credential on every non-`read` access class (`feature-write`,
>    `intake-write`, `create`, `shared-write`). The remote Git adapter asks for it on every
>    authorized `remote-ref-write`. Reads, including `gh api user` identity resolution and
>    `--assignee @me` intake capture, always use the operator's ambient credential. The token
>    goes only into the environment of that one `gh` or `git` child. It is never set on
>    `process.env`, never passed to provider, reviewer, or build children, never embedded in a
>    remote URL, and never printed in logs, events, or errors. A request with no operation
>    context resolves to neither credential and fails closed (D7).
> 4. *Pushes use the gh credential helper explicitly.* A bot push injects the token and, through
>    child-only environment git config, the `gh auth git-credential` helper for github.com. The
>    operator's configured helper therefore cannot silently substitute its own credential. A
>    non-HTTPS destination (such as SSH) cannot carry the token. It pushes with the operator's
>    credential and emits the D9.5 warning.
> 5. *Loud credential fallback, not a retry.* A typed bot-auth refusal is raised at the runner
>    boundary as a result kind, never matched downstream on text (adr-2026-09-05 D5,
>    adr-2026-08-18 D1). Its triggers are: the token file is missing or unreadable, `gh`
>    reports 401, 403, or bad credentials, or git reports an authentication or permission
>    denial. Each trigger uses conservative patterns backed by verbatim fixtures
>    (adr-2026-07-22-auth-failure-classification-observed-401-patterns D1). On that refusal,
>    and only then, the same authorized invocation runs once more with the operator's
>    credential, and a warning event is emitted on the ConductorEvent spine. Because the
>    operation, target, actor, and payload do not change, this is a substitution within one
>    authorized call, not a D1 retry. It uses no retry budget and triggers no escalation
>    (adr-2026-07-04 D2). Ambiguous failures, such as timeouts and transport errors, never fall
>    back, so an external effect is never repeated (adr-2026-08-01-engine-owned-resumable-finish-publication
>    D3). An ownership-policy refusal (D6) is a different type and never reaches this path. A
>    failed marker edit falls back only as an edit, never as a create (D8). This departs on
>    purpose from the fail-closed rule of adr-2026-07-07-daemon-owned-build-credential D3,
>    because this fallback is loud (a spine event), changes no authorization, and only changes
>    the displayed author. The bot token is not part of the daemon-level missing-credential
>    gate.
> 6. *Warning event.* The fallback event is a closed, structured `ConductorEvent` variant. It
>    carries the operation, the target, and a closed reason (`token-unavailable`,
>    `auth-refused`, `unsupported-remote-transport`). It carries no raw stderr, no token, and
>    no token path. It is emitted through the same emitter that carries
>    `github_operation_refused` for that call, and it declares its `EVENT_SINKS` routing
>    exactly as that variant does.
> 7. *Real-binary proof.* The claims that `GH_TOKEN` in a child environment takes precedence
>    in `gh`, and that `gh auth git-credential` returns it during a git push, are proven
>    against the installed binaries by a smoke test (adr-2026-09-05 D8,
>    adr-2026-07-07-daemon-owned-build-credential D5).

## Consequences

### Positive

Ownership is checked at the remote mutation boundary across supported harness workflows. Read access remains available for discovery. Existing shared transports and the event spine remain canonical.

### Negative

Unassigned legacy intake and shared repository administration can require explicit authorization. A missing shared label cannot be force-created by a daemon without such authorization. Extra evidence reads add latency. The cooperative committed-provenance model does not provide cryptographic forgery resistance or a transaction spanning GitHub and Git.

### Follow-up Actions

- Implement the approved boundary through behavior-owning plan tasks, including scoped tests and affected consumer documentation.
- Evaluate general local Git consolidation separately in #2517.
