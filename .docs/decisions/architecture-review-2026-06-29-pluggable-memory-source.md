# Architecture Review: Pluggable Memory (per-project, LLM-driven retrieval)

**Date:** 2026-06-29
**Tier:** L (Large) — full review
**Stories reviewed:** `.docs/stories/pluggable-memory.md` (FR-1 … FR-13, incl. FR-13a/13b)
**Inputs:** PRD `.docs/specs/2026-06-29-pluggable-memory-source.md`; conflict-check
(reconcile-on-reconnect, engineer-store Non-Goal); current-state diagrams
`.docs/architecture/2026-06-29-memory-subsystem-current-state.md` and
`.docs/architecture/sequences/memory-recall-persist.md`.
**Verdict:** APPROVED WITH CONDITIONS — **all 7 ADRs APPROVED by operator 2026-06-29**
(ADR-016, 018, 019 revised per operator feedback before approval; see notes in each ADR)

## Summary

The feature establishes a per-project pluggable memory model where **the LLM owns all retrieval**
(FR-3 invariant), the default platform is today's local-file store made durable/shared across
worktrees, and non-default platforms integrate as agent-queried MCP servers. The design reuses three
mechanisms the harness already ships — the **plugin-kind model**, **`claude mcp add` registration**,
and the **skill-override mechanism** — so the net new surface is small. Seven ADRs (015–021) resolve
the PRD's 6 open questions plus the FR-13 resilience contract. Conditions below must be met during
BUILD; they are tracked into the plan and checked at code review / `/finish`.

## Feasibility

| Story / FR | Feasible? | Notes |
|---|---|---|
| FR-1 selection | Yes | `memory_provider` field in `.ai-conductor/config.yml`, mirrors `llm_provider`/`ui_renderer` (ADR-016). |
| FR-2 bad/unavailable → default | Yes | Total resolver, fallback-to-`local` (ADR-016). |
| FR-3 LLM owns retrieval | Yes (invariant) | Agent↔MCP integration; harness is resolve-and-expose only (ADR-015). Verifiable: grep shows no search/rank/embed. |
| FR-4 per-platform guidance | Yes — **dep** | Skill-override mechanism (ST-060/061) carries it (ADR-019). Depends on that mechanism being available; transport fallback noted. |
| FR-5 durable/shared | Yes | Canonical `~/.ai-conductor/memory/<key>/harness/`, `.memory/` symlink (ADR-017). `.memory/` already gitignored → low-risk. |
| FR-6/7 adopt/remove | Yes | `conduct memory adopt|remove|status`, idempotent via `claude mcp get` + targeted config write (ADR-018). **Breaking CLI → Migration block.** |
| FR-8 zero-dep default | Yes | `local` provider, no MCP/service/creds (ADR-015/017). |
| FR-9/10 parity | Yes | `.memory/` path preserved as symlink; base skill unchanged for default. |
| FR-11 migration | Yes | Copy-verify-swap + one-time backup, non-destructive on failure (ADR-020). |
| FR-12 new project no migration | Yes | Detect-and-skip (ADR-020). |
| FR-13/13a/13b resilience | Yes | Default store as write-fallback sink; idempotent one-way reconcile (ADR-021). |

No new runtime stack is required for Phase 1 (default path is files + symlink). Non-default providers
require an MCP server (Phase 2 platforms), which is the established Serena-style integration.

## Complexity

**High** (consistent with the L tier): touches config schema, bootstrap/`bin/conduct` memory setup,
the `/memory` skill, a new CLI subcommand group, the plugin model, and a migration path — but each
piece extends an existing mechanism rather than introducing a novel subsystem. No splitting required;
sequence the work so the **default-provider durability + migration** (ADR-017/020) lands before the
**non-default MCP provider** plumbing (ADR-015/018/019), since Phase 1's user-visible win is durable
shared memory with parity.

## Architectural Alignment

- **FR-3 invariant is structural, not disciplinary** (ADR-015): there is no harness code path that
  ranks/searches; the agent queries the platform. A grep-based integrity check enforces it.
- **Reuses existing seams:** plugin kinds + manifest (`memory_provider`), `claude mcp add`/`get`
  (adoption idempotency), `.ai-conductor/config.yml` selection, `~/.ai-conductor/memory/` convention
  (Serena precedent), skill-override (ST-060/061) for guidance. No parallel mechanisms invented.
- **Engineer/retro-signal store is untouched** (PRD Non-Goal; conflict-check): ADRs govern only the
  `/memory` system. They merely share the `~/.ai-conductor/` namespace.
- **Diagrams** (`2026-06-29-memory-subsystem-current-state.md`, `sequences/memory-recall-persist.md`)
  accurately baseline current state and mark the future seams; update them in BUILD as the symlink
  store, resolver, and fallback path land.

## Domain Integrity

- **"Active provider" is a resolved value, not a nullable string** — model the resolution result as a
  total value where `local` is a real provider, not a null/absent case (avoids "default = null"
  primitive-obsession and makes FR-1 "exactly one active" trivially true). *(Condition C1.)*
- **Pending-reconcile state is explicit** — fallback entries carry an explicit pending tag, not an
  inferred/implicit flag, so reconcile is exhaustive and idempotent (FR-13b). *(Condition C2.)*
- **No catch-all on provider resolution** — unknown/unavailable are explicit branches that resolve to
  `local` with a warning, not a silent `else` (FR-2). *(Condition C3.)*

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Project-key derivation keyed to branch/worktree → cross-project bleed or fragmentation | Data | Medium | **High** | Branch/worktree-independent key; negative-path tests for cross-project isolation (ADR-017). |
| Migration turns real `.memory/` into symlink and loses entries | Data | Low | **High** | Copy-verify-swap; abort-and-restore on verify failure; one-time backup (ADR-020). |
| Concurrent dual-worktree writes clobber shared `index.md` | Data | Medium | Medium | File-per-entry; read-modify-write or per-entry index fragments (ADR-017). |
| FR-4 guidance depends on skill-override (ST-060/061) not yet shipped | Knowledge | Medium | Medium | Confirm mechanism availability; conductor-injection transport fallback (ADR-019). |
| New `conduct memory` CLI is a breaking change without a Migration block | Integration | Low | Medium | CHANGELOG `## Migration` block; README + src/conductor/README updates (ADR-018, Release Gate #2). |
| Recall during outage misses not-yet-reconciled fallback entries | Integration | Medium | Low | Accepted bounded gap (FR-13b); document for operators (ADR-021). |

Two **High-impact** data risks (project-key, migration) → review marker is written; both are mitigated
by mandatory negative-path tests carried as conditions.

## ADRs Created (all DRAFT — require approval before BUILD)

| ADR | Open Q / FR | Decision |
|---|---|---|
| **015** | Q1 / FR-3,4,8 | `memory_provider` plugin kind; default=built-in local; non-default=agent-queried MCP; harness resolve-and-expose only. |
| **016** | Q6 / FR-1,2 | `memory_provider` field in the **harness config YAML** (`.ai-conductor/config.yml`), **guaranteed present in every project** (bootstrap seeds it); total resolver; bad/unavailable → `local`. *(revised)* |
| **017** | Q3 / FR-5,9,10 | Canonical `~/.ai-conductor/memory/<key>/harness/`; `.memory/` → symlink; branch-independent; file-per-entry. |
| **018** | Q2 / FR-6,7,8 | **`conduct memory add <provider> \| remove \| status`** (verb is `add`, not `adopt`); idempotent via `claude mcp get` + targeted config write; creds non-committed. *(revised)* |
| **019** | Q5 / FR-4,9 | **A memory-guidance skill per provider (default included); harness selects the skill matching the installed/active provider**; missing skill → safe degradation to `local`. *(revised)* |
| **020** | Q4 / FR-11,12 | Copy-verify-swap + one-time backup; non-destructive on failure; detect-and-skip; one-time reverse. |
| **021** | — / FR-13,13a,13b | Default store as write-fallback sink; idempotent one-way reconcile; bounded warnings; never block. |

## Conditions (APPROVED WITH CONDITIONS — tracked into the plan, checked at code review / finish)

- **C1.** Model the resolved active provider as a total value (`local` is a real provider, not null).
- **C2.** Pending-reconcile is an explicit, durable tag; reconcile is idempotent and one-directional.
- **C3.** Provider resolution has no catch-all `else`; unknown/unavailable are explicit → `local` + warning.
- **C4.** Branch/worktree-independent project-key with a cross-project-isolation negative-path test.
- **C5.** Migration is copy-verify-swap with abort-and-restore on verify failure; backup retained for
  one-time reverse; fresh project performs no migration.
- **C6.** A harness-integrity (grep-based) check asserts FR-3: no memory search/ranking/relevance/
  embedding logic exists in the harness.
- **C7.** New `conduct memory` CLI ships with a CHANGELOG `## Migration` block and README +
  `src/conductor/README.md` updates (Docs-track-features + Release Gate #2).
- **C8.** Concurrent dual-worktree write protocol for the shared `index.md` (no clobber).

## Next Step

All seven ADRs are **APPROVED** (operator, 2026-06-29) — the ADR approval hard gate is satisfied.
ADR-016, ADR-018, and ADR-019 were revised per operator feedback before approval (harness-YAML-always-
present; `add` verb; skill-per-provider selection). Proceed to **`/plan`**, grounded in ADRs 015–021
and carrying conditions C1–C8 into the task plan.
