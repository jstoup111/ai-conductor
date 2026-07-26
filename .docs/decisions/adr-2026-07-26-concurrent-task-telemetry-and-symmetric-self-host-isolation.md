# ADR: Concurrent task telemetry and symmetric self-host isolation

**Date:** 2026-07-26
**Status:** APPROVED
**Feature:** Claude hook and self-host sandbox assumptions have no Codex parity (#907)
**Decider:** James Stoup (operator)
**Approval:** Approved during conflict resolution on 2026-07-26: concurrent tasks are required;
task stamping is telemetry, and strict self-host isolation applies equally to Claude and Codex.
**Supersedes:** `adr-2026-07-25-provider-neutral-safety-authority`
**Related:** `adr-2026-07-21-demote-task-stamping-to-telemetry`,
`adr-2026-07-22-phase-scoped-docs-write-guard`,
`adr-2026-06-30-sandbox-build-isolation`,
`adr-2026-07-08-main-checkout-leak-triage-and-write-fence`, and
`adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness` from #905

## Context

The superseded design promoted `.pipeline/current-task` from telemetry into a singular mutation
lease. That is incompatible with the accepted pipeline contract: independent implementation tasks
may mutate one feature worktree concurrently. The current overlap hook proves the mismatch by
removing the singular stamp whenever a second task starts. The prepare-commit-msg hook can also
replace an explicit task trailer with the workspace-global stamp, so a racing stamp can make
telemetry less accurate rather than more accurate.

Task stamping was already demoted by #773: judgment gates own completeness and wiring, while task
trailers and status rows are progress and attribution telemetry. Mutation safety therefore does
not need a task stamp. Protected-artifact sealing and self-host workspace isolation can enforce
their own policies without asking which task owns a mutation.

The superseded design also preserved Claude's existing sandbox verbatim while requiring strict
unrelated-state isolation only for Codex. Existing Claude provisioning copies operator
`settings.json`, preserves personal hooks, propagates workspace trust, and performs a live global
skill relink before self-host dispatch. That does not satisfy the operator-selected outcome that
both built-in providers behave the same and inherit no unrelated provider configuration.

## Options Considered

### Option A: Keep the singular lease and serialize mutating tasks

- **Pros:** retains automatic workspace-global commit stamping.
- **Cons:** removes accepted concurrency; conflates attribution telemetry with authorization; the
  operator rejected this trade-off.

### Option B: Keep concurrency, make task attribution task-local telemetry, and isolate both providers

- **Pros:** preserves parallel implementation and judgment work; aligns with #773's authority
  boundary; removes the global-stamp race; gives Claude and Codex the same isolation outcome.
- **Cons:** task agents must carry explicit task identity in their dispatch and commits; Claude
  self-host no longer inherits personal settings/hooks; several historical stories need amendments.

### Option C: Give every task a separate worktree or provider process solely for attribution

- **Pros:** mechanical per-task identity with strong filesystem separation.
- **Cons:** redesigns pipeline batching, commit integration, retries, and evaluation well beyond
  #907; unnecessary because attribution is advisory.

## Decision

Choose **Option B**.

### 1. Task identity is task-local, non-authoritative telemetry

Every implementation dispatch retains the exact validated plan-task id carried in its prompt.
Multiple task rows may be `in_progress` concurrently. Terminal handling retires only the matching
task's active telemetry and never clears another task.

`.pipeline/current-task` is removed as a required engine surface and as a source of mutation
authorization. A workspace-global singular value cannot accurately answer task ownership while
multiple agents are active. Operator displays derive active tasks from task-status rows; they show
a set when concurrency exists.

Each task authors its own `Task: <id>` commit trailer. The commit hook validates a supplied trailer
against seeded plan ids but does not require one, manufacture one from shared mutable state, or
replace a valid explicit trailer. Missing attribution is reported as telemetry loss and cannot
block mutation, completion, or acceptance. Judgment gates remain the sole completeness and wiring
authorities.

Dispatch marker grammar and known-plan-id validation remain fail-closed at the scheduling boundary:
an invalid claimed id is not recorded or guessed. That validation controls truthful telemetry, not
permission to mutate project files.

### 2. Mutation safety is independent of task attribution

The provider-neutral safety authority owns the durable protected-artifact seal and self-host
boundary, not a task lease. Protected BUILD/SHIP artifacts are checked against their approved
baseline before and after every relevant dispatch. Self-host work is constrained to its feature
workspace and audited against the live checkout. Provider-local hooks remain early feedback only.

Concurrent implementation tasks may mutate non-overlapping files in the same feature worktree.
Existing pipeline overlap and dependency rules continue to decide safe scheduling. Concurrent
audits, architecture reviews, and other judgments remain permitted; their scoped verdict artifacts
belong to their judgment authority rather than task attribution.

### 3. Claude and Codex receive equivalent minimal self-host homes

The self-host coordinator resolves the provider, then provisions a fresh minimal throwaway provider
home before skill lookup and substantive dispatch:

- Claude receives a throwaway `CLAUDE_CONFIG_DIR` containing only engine-owned settings/guards,
  the selected Claude authentication representation, and worktree-owned harness skills/hooks.
- Codex receives a throwaway `CODEX_HOME` containing only engine-owned run configuration/adapters,
  the #905-selected authentication representation, and worktree-owned harness assets required by
  the run.

Neither provider home copies or symlinks unrelated live preferences, personal hooks, extensions,
plugins, histories, sessions, caches, logs, or mutable provider state. Existing live provider
configuration is fingerprinted and remains byte-identical except for documented provider-owned
behavior of the selected authentication source.

For Codex API-key authentication, the selected key remains a child-only environment value. For
cached login, the self-host isolation adapter may make an **opaque, temporary handoff of only the
selected native credential artifact** into the throwaway `CODEX_HOME`. The adapter copies bytes
without parsing, serializing, hashing, logging, or persisting credential-derived metadata; it never
symlinks back to live state, creates the home/file with restrictive permissions, verifies the
source is unchanged, and removes the copy on every terminal path. Provider-owned keyring access is
acceptable only when it exposes the selected credential without broad unrelated account state.
This narrowly supersedes #905's no-copy/no-relocation rule for self-host isolation only; normal
#905 readiness and invocation continue using the provider's native ambient credential behavior.

Claude self-host no longer copies operator `settings.json`, preserves personal hooks, or propagates
the operator's general state file. Engine-owned minimal settings provide the required write fence,
lifecycle adapters, permissions, and worktree trust behavior without importing personal state.
The self-host path also stops relinking live global skills: the isolated home's worktree-owned skill
surface makes that mutation unnecessary. Non-self-host install behavior is unchanged.

Issue #904 installs Codex skills for ordinary sessions under `$HOME/.agents/skills`, which is
outside `CODEX_HOME`. A Codex self-host child therefore also receives a throwaway discovery home
whose `.agents/skills` entries point only to the feature worktree's canonical `skills/` and
`HARNESS.md`. Repository `AGENTS.md` continues to load from the feature worktree. The live
user-scoped #904 catalog is neither discovered nor modified; normal #904 install/update/check/
uninstall behavior is unchanged. Executable resolution occurs before the child-only home override
so version-manager shims cannot force access back to the operator home.

If a selected authentication source cannot be exposed without unrelated state, provisioning fails
closed before model work. Both provider homes and child-only environment changes are removed in a
bounded `finally` path on success, failure, cancellation, interruption, timeout, retry exhaustion,
or provider replacement.

### 4. Retry, resume, and provider replacement keep the same boundaries

Initial, grouped, retried, resumed, auxiliary, and replacement-provider dispatches all pass through
the same protected-artifact and provider-home boundary. A retry cannot restore global stamping,
inherit live provider settings, relink live globals, or invoke a raw provider beneath the wrapper.

## Consequences

### Positive

- Concurrent implementation tasks and parallel judgments remain available.
- A singular global stamp can no longer erase or overwrite concurrent task attribution.
- Task telemetry cannot accidentally become a second completion or mutation gate.
- Claude and Codex self-host runs have the same isolation outcome.
- Protected artifacts and the live checkout retain independent deterministic enforcement.

### Negative

- Automatic `Task:` injection from `.pipeline/current-task` is retired; task-local commit trailers
  are best-effort telemetry and may be absent.
- Active-task UI and progress code must handle a set rather than a singular current task.
- Claude self-host intentionally stops inheriting personal settings/hooks and stops live global
  skill relinking, changing prior compatibility expectations.
- Minimal Claude settings and auth exposure require explicit provider-specific provisioning tests.

## Evidence and Assumptions

| Claim | Basis | Confidence |
|---|---|---:|
| The overlap hook removes `.pipeline/current-task` when a different task starts | Current `session-hook-assets.ts` and accepted overlap stories | 100% verified |
| prepare-commit-msg replaces an explicit trailer from the global stamp | Current `git-hook-assets.ts` and accepted reconciliation story | 100% verified |
| Task stamps do not own completion | #773 ADR/stories and current build-review completion path | 100% verified |
| Existing Claude sandbox inherits operator settings and personal hooks | Current `sandbox-build-env.ts`, write-fence code, and accepted self-host stories | 100% verified |
| Existing self-host relink mutates live global skill links | Accepted self-host relink stories and installer contract | 100% verified |
| #905 owns Codex auth selection and readiness | Approved #905 artifacts inspected in its inflight worktree | 100% verified dependency contract |

There are no unconfirmed load-bearing assumptions. Unsupported authentication isolation fails closed.

## Required Amendments

- [ ] Remove `.pipeline/current-task` from dispatch integrity and mutation-gate requirements.
- [ ] Preserve and validate explicit `Task:` trailers without global replacement; missing trailers
      remain non-blocking telemetry loss.
- [ ] Retain concurrent `in_progress` task rows and derive active-task display from them.
- [ ] Keep protected-artifact and live-boundary audits independent of task attribution.
- [ ] Replace Claude settings/state copying with minimal engine-owned sandbox configuration.
- [ ] Stop live global skill relinking for self-host dispatch; resolve worktree skills inside the
      isolated provider home before invocation.
- [ ] Apply isolation, cleanup, retry/resume, and confidentiality tests to both providers.
- [ ] Add cached-login opaque-handoff tests covering restrictive permissions, byte opacity,
      unchanged source, no symlink, every terminal cleanup path, and zero secret-bearing output.
- [ ] Add a Codex self-host discovery-home test proving `$skill` resolves the worktree catalog while
      the live `$HOME/.agents/skills` catalog and unrelated home state are unavailable for inheritance.
- [ ] Amend landed #905's no-copy and "Claude unchanged" self-host expectations during integration.
- [ ] Preserve #904's normal user-scope installation contract while overriding discovery only in
      the isolated self-host child.
