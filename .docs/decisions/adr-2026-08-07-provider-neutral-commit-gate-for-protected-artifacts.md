# ADR: Provider-neutral commit gate for protected DECIDE artifacts

**Date:** 2026-08-07
**Status:** APPROVED
**Feature:** Codex lacks preventive hook parity; protected artifact mutation is caught too late (#1254)
**Deciders:** James Stoup (operator), architecture review for issue #1254
**Approval:** Approved by James Stoup on 2026-08-07.
**Related:** `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`,
`adr-2026-07-25-provider-neutral-safety-authority`,
`adr-2026-07-22-phase-scoped-docs-write-guard`

## Context

Preventive enforcement of protected DECIDE artifacts is delivered today by a single Claude-only
channel: the `docs-guard.sh` `PreToolUse` hook, wired per worktree into
`<worktree>/.claude/settings.local.json` (`worktree-prepare.ts:216-227`) with matcher
`Edit|Write|NotebookEdit`. Three consequences follow, each verified:

1. **Codex receives nothing.** `grep -cn "PreToolUse|hooks.json|settings.local|hooksPath"` over
   `src/conductor/src/execution/codex-provider.ts` returns `0`.
2. **The matcher omits `Bash`**, so a heredoc, `tee`, `sed -i`, or inline-interpreter write to
   `.docs/` bypasses the guard even on Claude.
3. **The terminal seal is detect-and-halt, not prevention.** It is evaluated at BUILD/SHIP step
   entry (`conductor.ts:5191-5228`), and its loud HALT is written only at `attempt >= 2`
   (`:5267-5273`), so the first offending attempt fails silently.

In #1254 a Codex BUILD session committed `.docs/specs/2026-07-04-operator-park.md` because plan
Task 16 instructed it to. Recovery consumed repeated build/review/remediation cycles. The cost is
amplified by the kickback accounting: `MAX_KICKBACKS_PER_GATE = 2` (`kickback-ledger.ts:22`), but
the count resets to 1 on any progress (`:138`), so a re-offending build is bounded only by
`MAX_GATE_SELECTIONS = 6` (`conductor.ts:459-462`).

The governing constraint is `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation:87`
(**APPROVED**): *"Provider-local hooks remain early feedback only."* Its predecessor explicitly
rejected reproducing every Claude hook in Codex configuration, on the grounds that hooks are *"a
guardrail rather than a complete enforcement boundary"* and that depending on hook parity *"would
recreate the same provider coupling under another filename."*

The tension to resolve: #1254 demands equivalent prevention on both providers, while the approved
architecture forbids making a provider-local hook load-bearing.

## Decision

**Place preventive protected-artifact enforcement in a git `pre-commit` hook installed into the
engine-owned `.pipeline/git-hooks/` directory**, which is already wired worktree-scoped via
`core.hooksPath` (`worktree-prepare.ts:453-457`) and already carries `prepare-commit-msg` and
`commit-msg`.

This resolves the tension without amending the approved ADR. Correctness does not move to a second
provider-local hook; it moves to a channel that is not provider-local at all. Provider `PreToolUse`
hooks remain exactly what `adr-2026-07-26` requires them to be — early feedback — and the terminal
seal remains the acceptance authority.

### 1. The commit is the correct granularity

The seal's own violation condition is a *committed* content change (`Protected artifact changed`,
`protected-artifact-seal.ts:697`). Gating the commit therefore matches the authority it protects,
and yields method-blindness for free: an editor tool, a `Bash` heredoc, and an inline interpreter all
converge on the same commit.

### 2. The gate is an early guard, not an unbypassable boundary

Two escapes exist and are accepted:

- `git commit --no-verify` skips the channel entirely.
- `CONDUCT_ENGINE_COMMIT=1` is the established engine-bookkeeping escape, already honored by
  `commit-msg` (`git-hook-assets.ts:140`) for rebase mechanics, quarantine, shipped records, and
  spec landing. The new hook honors the same convention.

A commit made outside the prepared worktree also escapes, since `core.hooksPath` is worktree-scoped.
Every such path lands on the terminal seal. This is the division of labor `adr-2026-07-26`
prescribes, and #1254 anticipates it verbatim: *"a provider-neutral terminal check still rejects
bypassed, disabled, unsupported, or otherwise uncovered mutation paths."*

The claim this feature makes is therefore **equivalent observable early rejection in the normal path
on every provider, with an unchanged terminal authority against bypass** — not unbypassable
prevention.

### 3. The wiring must fail closed

`writeGitHooksAndWire` (`worktree-prepare.ts:389-396`) currently swallows every error and logs
`git hooks: skipped`. Correct for attribution telemetry; wrong once the same directory carries a
required preventive control, and a direct inversion of #1254's requirement that a missing or
disabled integration cannot produce a passing verdict. Wiring failure must fail the step.

### 4. Authorization is closed at the plan gate

The runtime gate is the safety net; the primary fix is that no plan task should ever be authorized to
mutate a protected artifact. `scanPlanProtectedTargets` already exists and blocks at `engineer land`
(`land-spec.ts:242-251`), but harvests paths only from `**Files:**` lines and dedicated bullets
(`plan-task-parse.ts:138-197`). Verified by reproduction: the guilty Task 16, whose target appears in
a prose paragraph, passes clean (`EXIT=0`), while the whole-plan scan trips only on the innocent Task
18 via a mis-attributed `## Integration Points` bullet. The scanner must harvest prose-embedded
paths, cover `.docs/decisions`, and the remediation redirect must inspect `gap.rationale` as well as
`gap.tasks[].title` (`conductor.ts:9098-9102`).

> **Amended 2026-08-07 by #1254:** the scanner does **not** harvest prose-embedded paths. Conflict
> check C1 measured that mechanism against the corpus: 92 of 261 plans cite another feature's
> protected artifact in prose, so harvesting would have rejected roughly 35% of plans at the land
> gate. The `**Files:**` line is instead treated as the *disambiguator*, giving three cases — a task
> that declares `**Files:**` is scanned on its declared targets exactly as today; a task with no
> `**Files:**` and no protected path in its body passes as today; and a task with no `**Files:**`
> **and** a foreign protected path in its body is rejected as *ambiguous*, directing the author to
> declare its targets. A glob over a protected directory is rejected fail-closed as indeterminate.
> Measured impact: 7 ambiguous tasks out of 3,099 (0.23%) across 5 already-merged plans, with the
> #1254 Task 16 among them. The requirements to cover `.docs/decisions` and to extend the remediation
> redirect to `gap.rationale` are unchanged. Rationale: this enforces the contract
> `skills/plan/SKILL.md:108` already declares authoritative (*"The `**Files:**` line is authoritative
> for the build evidence gate"*) rather than adding a natural-language heuristic, per `CLAUDE.md`'s
> deterministic-where-possible Design Principle.

### 5. Scope boundaries

Deferred, each filed with its own evidence: Codex `PreToolUse` early feedback (#1353); destructive-git
relocation (#1354); TDD-phase enforcement, dormant because nothing writes `.pipeline/tdd-phase`
(#1009).

## Options Considered

### Option A: Replicate Claude's hooks in Codex configuration

- **Pros:** smallest conceptual diff; rejection at the tool boundary; visible symmetry.
- **Cons:** already rejected by `adr-2026-07-25` and forbidden by `adr-2026-07-26:87`; makes a
  provider-local hook load-bearing; leaves the `Bash` bypass open on both providers; correctness
  varies by provider version and operator configuration.

### Option B: Provider-neutral commit gate (chosen)

- **Pros:** one policy, one channel, every provider and run mode; method-blind by construction;
  reuses an already-wired seam; honors the approved ADR without amendment; the seal keeps final
  authority.
- **Cons:** bypassable by `--no-verify`; scoped to the prepared worktree; does not cover uncommitted
  mutation; blocks later than a tool-boundary hook would.

### Option C: OS-level sealing (read-only protected artifacts during BUILD/SHIP)

- **Pros:** true write-time prevention on every provider and every write method, including
  uncommitted mutation.
- **Cons:** interacts badly with engine-driven git operations (rebase, checkout, stash); risks
  leaving artifacts unwritable after a crash. Deferred to #1352 rather than discarded.

## Consequences

- Protected-artifact enforcement becomes provider-neutral and method-blind for the committed case,
  closing #1254's observed failure on both providers.
- A violation fails once, loudly, at the commit, instead of consuming build/review/remediation
  cycles.
- Hook wiring changes, a canonical breaking surface, so the implementation PR carries a real
  `## Migration` block rather than a waiver.
- `docs-guard.sh` and `block-destructive-git.sh` are reclassified as early feedback; neither is
  removed.
- The control inventory records that three shipped controls currently do nothing — both TDD gates
  (#1009) and `rate-limit-wait.sh` (#1019).

## Assumptions

- [verified] `reference-transaction` can abort a ref update — tested on git 2.53.0; a `prepared`-stage
  non-zero exit produced `fatal: ref updates aborted by hook` and the branch survived. Relevant to
  #1354, not to this decision.
- [verified] `core.hooksPath` drives hook execution and is set worktree-scoped.
- [~90%, inferred] A blocked commit produces an actionable enough diagnostic that the agent routes
  the amendment to DECIDE rather than retrying. Confirm by acceptance test; mitigated by the message
  naming the artifact and owning phase.
