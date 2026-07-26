# ADR: Engine-owned safety authority with provider-local early guards

**Date:** 2026-07-25
**Status:** Superseded by `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
**Feature:** Claude hook and self-host sandbox assumptions have no Codex parity (#907)
**Deciders:** James Stoup (operator), architecture review for issue #907
**Approval:** Approved by James Stoup on 2026-07-26.
**Related:** `adr-2026-07-10-session-hook-task-stamping`,
`adr-2026-07-21-demote-task-stamping-to-telemetry`,
`adr-2026-07-22-phase-scoped-docs-write-guard`,
`adr-2026-06-30-sandbox-build-isolation`,
`adr-2026-07-08-main-checkout-leak-triage-and-write-fence`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`, and
`adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness` from #905

## Context

The conductor currently gets three safety outcomes from Claude-specific lifecycle
and configuration mechanisms:

1. `PreToolUse`/`PostToolUse` hooks maintain `.pipeline/current-task` around
   in-session subagent dispatches;
2. a Claude write hook blocks protected `.docs/` changes during BUILD and SHIP; and
3. a throwaway `CLAUDE_CONFIG_DIR` plus a write fence isolates harness self-builds
   from the live checkout and operator configuration.

Task stamping is only current-work telemetry. It does not determine task completion;
the existing judgment gates remain the completion authority. Issue #907 must preserve
that boundary while producing the same safety outcomes for built-in Claude and Codex.

Codex 0.145.0 now exposes stable lifecycle hooks, including `PreToolUse`,
`PostToolUse`, and `Agent` matching for `spawn_agent`. However, the official Codex
manual explicitly says specialized tool paths can bypass the default hook path and
that hooks are a guardrail rather than a complete enforcement boundary. Non-managed
hooks also require trust, can be disabled, and matching hooks run concurrently. A
design whose correctness depends only on exact hook parity would therefore recreate
the same provider coupling under another filename. Evidence:

- local `codex features list` reports `hooks` as stable in Codex 0.145.0;
- [Codex hooks](https://learn.chatgpt.com/docs/hooks) documents lifecycle events,
  trust, tool coverage, and the incomplete-boundary warning; and
- local `codex --help` and `codex exec --help` establish the current unattended
  configuration flags used below.

The approved #905 design separately establishes Codex auth-source selection and the
explicit unattended policy (`workspace-write`, `on-request`, `auto_review`). #907 may
consume the selected auth source, but must not inherit or mutate unrelated operator
preferences, extensions, lifecycle customizations, sessions, logs, or mutable provider
state.

## Options Considered

### Option A: Reproduce every Claude hook in Codex configuration

- **Pros:** smallest conceptual diff; immediate rejection at the tool boundary; reuses
  existing scripts.
- **Cons:** hooks are not a complete enforcement boundary; Claude and Codex payloads,
  trust, disablement, and coverage differ; self-host isolation remains unresolved;
  correctness would vary by provider version and operator configuration.

### Option B: Engine-owned authority with provider-local early guards

- **Pros:** one policy and one fail-closed result across providers; hooks improve feedback
  without defining correctness; composes with #905 provider routing and auth readiness;
  preserves Claude behavior; retries and resumes share the same wrapper.
- **Cons:** requires durable pre/post-dispatch manifests and audits; an early guard may be
  weaker on one provider even though the terminal safety verdict remains equivalent;
  task-mutating subagents must be serialized while the current-task identity is singular.

### Option C: Move every plan task into a separate engine-spawned provider session

- **Pros:** the engine directly owns every task boundary; no nested lifecycle adapter is
  needed.
- **Cons:** rewrites the pipeline orchestration, task decomposition, evaluator batching,
  retry context, and subagent model; far beyond the Medium #907 scope and unnecessary for
  the requested safety outcomes.

## Decision

Choose Option B.

### 1. The engine owns policy and terminal acceptance

Add one provider-neutral safety authority around every BUILD/SHIP provider dispatch.
It owns three typed, fail-closed state machines:

- a **task lease** containing exactly one validated current task id or no task;
- a **protected-artifact seal** containing the frozen DECIDE artifact manifest and the
  phase/step allowlist; and
- a **self-host boundary** containing the canonical feature worktree, live checkout,
  selected auth-source exception, isolated provider home, and terminal cleanup state.

Provider integrations may normalize lifecycle events into these operations, but may not
define validation rules, authorize an unknown state, or decide whether the dispatch is
accepted. Missing, corrupt, stale, mismatched, or unverifiable state is a rejected safety
verdict and stops forward progress with sanitized diagnostics.

### 2. Current-task stamping is a singular lease, not completion evidence

Claude and Codex lifecycle adapters call the same task-start/task-end operations. Start
validates the exact plan task id, rejects an existing different lease, transitions the
known task row to `in_progress`, and writes the current-task stamp atomically. End clears
only the matching lease on success, failure, cancellation, or replacement. Neither path
writes `completed`; the existing build review and judgment skills retain that authority.

The provider hook is the immediate integration point. A missing or skipped hook cannot
authorize work: the dispatch acceptance audit rejects durable mutations that were not
enclosed by a valid task lease. The pipeline retains an explicit task CLI only for the
same normalized transition and recovery, never as a separate policy implementation.

Because the contract answers “what task am I on?” with one value, concurrent mutating
task dispatches are not representable. While task-mutation enforcement is active, the
pipeline serializes mutation-bearing tasks. `Task: none` judgment/read-only work may run
concurrently only when its execution boundary cannot mutate the feature workspace.

### 3. Protected DECIDE artifacts use a durable seal plus early hooks

At the first BUILD entry, the engine seals the approved, committed DECIDE artifact tree.
The seal records every protected `.docs/` path and content identity plus the existing
phase/step allowlist. It is durable across retries and resumes and is never refreshed from
an already-mutated workspace.

Before and after every BUILD/SHIP dispatch, the engine compares the workspace to the seal.
A changed, deleted, or newly created protected target outside the allowlist rejects the
dispatch and halts; unknown protected paths default to deny. The engine does not silently
restore or bless the drift. Claude and Codex `PreToolUse` guards remain useful for immediate,
actionable rejection of covered file tools, but the seal audit is the correctness boundary
for Bash writes, specialized tools, disabled hooks, and resumed sessions.

### 4. Self-host isolation is provider-aware behind one guardrail seam

The existing self-host coordinator resolves the actual provider before provisioning its
environment.

- **Claude** retains the approved throwaway `CLAUDE_CONFIG_DIR`, retargeted harness hooks,
  and existing write fence unchanged.
- **Codex** receives a fresh, throwaway `CODEX_HOME` for the self-host run. It contains only
  engine-generated run configuration/lifecycle adapters and the minimum representation of
  the auth source selected by #905. File-backed auth is copied, never symlinked; environment
  keys remain per-child values; keyring access is permitted only as the selected auth source.
  No unrelated user `config.toml`, profiles, rules, hooks, plugins, skills, logs, histories,
  sessions, caches, or mutable state are copied.

Every Codex self-host invocation uses `--ignore-user-config` (whose CLI contract states that
auth still uses `CODEX_HOME`), `--ephemeral`, the explicit bounded #905 approval/sandbox
policy, `-C <feature-worktree>`, and no writable `--add-dir` for the live checkout. The
throwaway home and child environment are created before dispatch, reused only for the same
self-host run where required, and removed/restored in `finally` on success, failure,
cancellation, timeout, retry exhaustion, or provider replacement.

The native Codex filesystem sandbox is the preventive boundary for the live checkout. A
2026-07-25 Codex 0.145.0 probe using the `:workspace` permission profile from the #907
feature worktree successfully wrote inside the worktree and received `Read-only file
system` when writing the parent live checkout. The engine also fingerprints the live
checkout and unrelated operator configuration before dispatch and verifies no residual
drift on every terminal path. The selected auth source itself is the sole explicit live
state exception.

If #905 cannot expose a selected auth source in the isolated home without copying unrelated
state, the self-host build fails closed before model work; #907 does not invent a second auth
selection or credential broker.

### 5. Initial, retry, resume, and diagnostics use the same boundary

The provider-aware step runtime invokes this safety wrapper for the initial attempt, every
same-step retry, resumed execution, grouped build branch, and provider replacement. No retry
path may call the raw provider beneath the wrapper. Safety failures consume no speculative
fallback path: work stops with provider, phase, failed protection, and remediation, while
auth material, hook payloads, raw config, and sensitive paths remain filtered.

## Consequences

### Positive

- Claude and Codex receive one safety verdict even when their early lifecycle coverage differs.
- Current-task telemetry stays narrowly scoped and cannot become a second completion gate.
- Protected artifacts are checked against a durable approved baseline, including after crashes.
- Codex can self-test worktree edits without inheriting the operator's unrelated Codex state.
- Claude's established hook and self-host behavior remains intact.

### Negative

- Enforcement adds durable manifests, task-lease transitions, and pre/post-dispatch audits.
- A provider with missing hooks may discover a violation only at dispatch completion.
- Mutating plan tasks cannot run concurrently while the identity remains singular.
- Codex self-host provisioning must support file, environment, and keyring-selected auth
  without generalizing into credential storage.

## Evidence and Assumptions

| Claim | Basis | Confidence |
|---|---|---:|
| Current engine starts one provider session for the build while tasks are nested subagent dispatches | Current `conductor.ts`, provider runner, and `skills/pipeline/SKILL.md` | 100% verified |
| Task start/done already implement validated atomic stamp transitions and do not own completion | Current `task-cli.ts` and approved task-stamping/demotion ADRs | 100% verified |
| Codex hooks cover `PreToolUse`, `PostToolUse`, and `Agent`, but are not complete enforcement | Current official hooks manual and Codex 0.145.0 feature list | 100% verified |
| Codex can ignore user config, keep auth rooted at `CODEX_HOME`, and avoid session persistence | Local Codex 0.145.0 `exec --help`; official config/state manual | 100% verified |
| A Codex workspace rooted at the feature worktree cannot write its parent live checkout | Direct `codex sandbox -P :workspace` probe on 2026-07-25 | 100% verified on supported Linux host |
| #905 owns auth-source selection and bounded unattended policy | Approved #905 PRD/ADR and current in-flight implementation | 100% verified as dependency contract |
| Exact Codex hook payload compatibility with the existing Claude scripts | Not assumed; adapters are provider-local and the engine audit remains authoritative | Non-load-bearing unknown |
| Every selected cached-auth representation can be copied into an isolated home | Not assumed; unsupported isolation fails closed before dispatch | Non-load-bearing unknown |

There are no unconfirmed load-bearing assumptions.

## Follow-up Actions

- [ ] Introduce the provider-neutral task-lease, protected-seal, self-host-boundary, and safety-verdict types.
- [ ] Route Claude and Codex lifecycle adapters through the shared task transition policy.
- [ ] Add durable protected-artifact sealing and pre/post-dispatch validation for every BUILD/SHIP attempt.
- [ ] Serialize mutation-bearing tasks while task-mutation enforcement is active.
- [ ] Add Codex throwaway-home provisioning on top of #905's selected auth source and bounded policy.
- [ ] Verify live-checkout/config fingerprints and teardown on every terminal path.
- [ ] Add initial/retry/resume/provider-replacement, disabled-hook, Bash-write, unknown-target,
      confidentiality, and Claude-regression coverage.
- [ ] Document the provider-neutral authority and ship the required hook/config migration note.
