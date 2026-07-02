# Architecture Review: Background Auto-Intake on the Conduct Loop

**Date:** 2026-06-30
**Mode:** Lightweight (complexity tier M — Feasibility + Alignment)
**Stories reviewed:** `.docs/stories/background-intake-conduct-loop.md` (FR-1…FR-12)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | High. Reuses existing `github-issues` adapter (poll/ledger/queue/source-ref), the daemon's idle-poll loop pattern, the tmux supervisor hosting port, and an existing push-notification path. No new external service. |
| Prerequisites | None blocking. The brain loop needs a host (existing tmux supervisor) and a config key for the interval. |
| Integration surface | Brain loop ↔ registry, `gh`, ledger/inbox, notifier; launcher ↔ brain-loop liveness. Bounded; no DB. |
| Data implications | None. No schema; reuses `ledger.json` + inbox files. |
| Performance risk | Low. Poll is `gh issue list` per repo on an interval; failure-isolated; zero-token. |
| Worktree isolation | N/A to product DBs; the loop writes only the shared engineer state (single-writer by ADR `…-brain-loop`). |

## Alignment

- **Brain≠daemon (Phase 9):** honored — intake is hosted in a brain/supervisor loop, not the build
  daemon, which is left unchanged (a stated Non-Goal). See `adr-2026-06-30-background-intake-brain-loop`.
- **ADR-008 (agent-hosted, human-gated DECIDE):** honored — the loop is mechanical and never spawns
  `claude`, runs DECIDE, or opens a PR (FR-9/FR-11). Routing only *seeds a proposal*; the human gate
  is retained (see `adr-2026-06-30-origin-seeded-intake-routing`).
- **ADR-012 (ledger = sole dedup authority, exactly-once pull):** honored and extended — FR-2/4/12
  delegate all dedup to the ledger; the new ADR adds the single-writer concurrency boundary ADR-012
  did not address, without weakening it.
- **intake-issue-pr-link-autoclose chain:** FR-8 reuses it end-to-end; auto-captured ideas now feed
  it a source reference so the `Refs`→`Closes` chain engages (fixes the `honeydew#49` class).
- **State management:** no new boolean flags; lifecycle uses the existing ledger states.

## Domain Integrity
Deferred to TDD per-cycle domain review (tier M). No primitive-obsession or invalid-state concerns
introduced — the feature wires existing typed primitives (envelope, source-ref, ledger entry).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Launcher pre-poll + brain loop both write ledger | Data | Low | Medium | Launcher defers to a live brain loop; atomic temp+rename writes; exactly-once pull collapses any dup (ADR `…-brain-loop`) |
| Duplicate notifications across restarts | Integration | Low | Low | Notify keys off *newly captured* ideas only; durable-ledger dedup prevents re-capture → re-notify (FR-12) |
| Brain loop dies silently → intake stalls | Technical | Low | Medium | Reuse supervisor liveness/observability (pidfile/tmux status), same as the build daemon |
| Notification transport failure | Integration | Low | Low | Non-fatal: captures persist, status surface still reflects work (FR-5 negative) |

No High-impact risks.

## ADRs Created (both APPROVED)
- `adr-2026-06-30-background-intake-brain-loop` — Q1 (single brain/supervisor loop hosts the
  cross-repo poll) + Q2 (ledger single-writer by construction; launcher defers; atomic writes).
  Amends `adr-012`.
- `adr-2026-06-30-origin-seeded-intake-routing` — origin seeds the routing proposal for GitHub-intake
  ideas; ADR-008 human gate preserved. Amends `adr-008` (ADR-007 is already superseded).

## Verdict
**APPROVED.** Proceed to `/plan`. Both ADRs are APPROVED; no DRAFT carried forward. The two
degrading conflicts from the conflict report are resolved by these ADRs.
