# Architecture Review: Phase 9.3 — Engineer Redesign

**Date:** 2026-06-26
**Tier:** Large (full review)
**PRD:** `.docs/specs/2026-06-26-phase-9.3-engineer-redesign.md` (24 FRs, Status: Approved)
**Stories reviewed:** `.docs/stories/phase-9.3-engineer-redesign.md` (24 stories, FR-1…FR-24)
**Diagrams:** `.docs/architecture/2026-06-26-phase-9.3-engineer-redesign.md`
**Conflict report:** `.docs/conflicts/2026-06-26-phase-9.3-engineer-redesign.md` (clean — 1 blocking resolved)
**Verdict:** APPROVED WITH CONDITIONS

## Summary

The redesign reworks the **execution model** of the Phase 9.3 engineer from a Node TTY REPL that
spawns `claude -p` (and writes non-buildable stub stories) to an **agent-hosted, in-chat,
human-gated** loop that runs the real DECIDE skills and emits `Status: Accepted` artifacts. It adds a
hexagonal **intake port** (claude-session adapter only this phase) and a **pidfile-`O_EXCL`** daemon
liveness / 1-per-repo mutex with a fire-and-forget `ensure-running`, plus the `launchDaemonDetached`
`cwd: repoPath` fix. The control plane (engineer) and data plane (per-repo daemon) remain coupled
**only** by the human-merged spec PR.

The architecture is sound and consistent with the 9.0/9.1/9.2 substrate and the Phase 9 program
decisions. It is APPROVED **with conditions**, the principal one being that cross-repo isolation moves
from a kernel-enforced process boundary to a guard-enforced path-prefix confinement (ADR-008) — a
real reduction in isolation strength that must be backed by the guard + test, not prose.

## Feasibility

| FR group | Check | Finding |
|---|---|---|
| A — loop (FR-1…12) | Stack compat | Feasible. Removing the spawned `claude -p` substrate **reduces** surface; the loop runs in the host agent. No new runtime deps. |
| B — intake port (FR-13…16) | Integration surface | Feasible. One port interface + one adapter; Envelope is a plain typed record validated at the boundary. github-issues/inbox/write-back deferred to 9.3b — additive. |
| C — liveness (FR-17…23) | Prerequisites | Feasible. `O_EXCL` create + `process.kill(pid,0)` are stdlib; `.daemon/daemon.pid` is new per-repo state. No external service. |
| C — launch fix (FR-22) | Bug | `launchDaemonDetached` currently passes a non-existent `--project` flag; fix is `cwd: repoPath`. Low-risk, well-scoped. |
| D — handoff (FR-24) | Data implication | Build-ready predicate verified against `daemon-backlog.ts` (`isStoriesApproved` + `planHasDependencyTree` + `!isProcessed`). No divergence. |

No migrations, no schema/data backfills, no new infrastructure. Worktree isolation unaffected (the
engineer is interactive; the daemon's per-repo `.daemon/` state is repo-local).

## Complexity

Large, correctly tiered. The genuine complexity is concentrated in two places, each isolated behind a
module boundary: (1) the agent-hosted authoring/isolation trade-off (ADR-008), (2) the
pidfile-lock concurrency primitive (ADR-010, flagged by the PRD as expected to change). Both are
deliberately confined so the flagged rework and any isolation escalation stay local.

## Alignment

- **Control/data-plane split** matches the handoff §3 and the diagram: the only cross-plane coupling
  is the merged spec PR (`==>` heavy edges). The engineer never builds, never merges.
- **Non-autonomy (ADR-005)** holds unchanged and **explicitly covers `ensure-running`**: "engineer
  may *launch*, never *manage*" (FR-8 revised) is exactly fire-and-forget spawn-iff-not-alive with no
  lifecycle ownership, no retained handle/IPC, no supervision-state write. No change to ADR-005.
- **Routing** retains the ADR-007 discriminated union (`confirmed | redirected | create | declined`)
  with exhaustive switch and type-enforced zero-writes-on-decline — carried forward by ADR-008.
- **Registry/store reuse** is read-mostly: 9.2 registry for routing canonical paths (+ a
  non-authoritative `daemonState` mirror), 9.1 store for flywheel reads. No new authoritative writer
  to shared state.
- **Default-branch discovery** (`git symbolic-ref refs/remotes/origin/HEAD`, never hardcode `main`)
  is preserved in ADR-008 authoring.
- **No ad-hoc rebase**: ensure-running adds no rebase; the only sanctioned rebase remains 9.0's
  daemon finish-time mechanism. Consistent.

## Domain Integrity

- **Envelope** is a typed record validated at the port boundary (empty/whitespace text → field-named
  rejection, never silent drop; bad status → reject). Idempotency keys on `source+sourceRef`, not
  `text` (no false-positive blocking of a re-stated idea). Good — parse-don't-validate at the seam.
- **Routing union** keeps invalid states unrepresentable: `declined` carries no project, so
  zero-writes-on-decline is type-enforced, not checked. Exhaustive switch, no catch-all default.
- **Liveness** is a small state machine (NoLock → Owned → Dead → Reclaiming) with explicit
  transitions; `EPERM`→alive and `ESRCH`→stale are exhaustive over `kill(pid,0)` outcomes. The
  registry mirror is explicitly non-authoritative (the pidfile decides) — no ambiguous dual source.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Cross-repo write leak now guard-enforced, not kernel-enforced | Security | Low | **High** | ADR-008: canonical-path resolution (no cwd fallback) + absolute-path operation + path-prefix write guard + test (A untouched by B). Escalation: author in a dedicated worktree of the target. |
| Engineer regresses to stub/DRAFT stories or spawns `claude -p` | Knowledge | Low | High | Regression guards: tests reject the stub string, any DRAFT story, and any authoring subprocess. |
| FR-20 single-winner model changes in a future iteration | Technical | **High (expected)** | Medium | ADR-010: lock primitive confined behind one module boundary (acquire/isLive/reclaim/ensureRunning); routing/authoring/daemon call only that boundary → swap is localized. |
| Stale pidfile after `kill -9` permanently refuses a repo | Data | Low | High | ADR-010: `ESRCH` → reclaim via `O_EXCL`; test stale pidfile + half-built worktree → reclaim + respawn, never permanent refusal. |
| Duplicate daemons from two concurrent ensure-running | Integration | Medium | Medium | `O_EXCL` atomic create = single winner; loser no-ops/exit 0; test 2 concurrent boots → exactly one owns. |
| pid reuse misidentifies a foreign process as the daemon | Technical | Low | Medium | `uuid` stored in the pidfile guards reuse; `EPERM` treated as alive (never reclaim a lock we can't prove dead). |
| No-remote (fresh local-only `create`) breaks PR handoff | Integration | Low | Low | ADR-008: commit on branch + non-fatal PR-skip. |

## ADRs

| ADR | Title | Status | Note |
|---|---|---|---|
| 004 | Engineer authoring + cross-repo isolation | **SUPERSEDED by 008** | Canonical-path-no-cwd-fallback retained; subprocess substrate removed |
| 005 | Non-autonomy + read-only governor | **APPROVED (holds, unchanged)** | Explicitly covers `ensure-running` (launch≠manage); no edit |
| 007 | Interactive loop — routing + PR handoff | **SUPERSEDED by 008** | Routing union + PR-machinery reuse retained; REPL/subprocess removed |
| **008** | Agent-hosted loop + in-chat human-gated authoring | **DRAFT** | Execution model; isolation without a subprocess (key trade-off) |
| **009** | Intake adapter port + Envelope contract | **DRAFT** | Hexagonal seam; claude-session adapter only; bidirectional-ready |
| **010** | Pidfile-lock liveness + 1-per-repo mutex + ensure-running | **DRAFT** | `O_EXCL` over registry-heartbeat; launch cwd fix; FR-20 isolated |

## Conditions (tracked into the plan; verified at code-review / `/finish`)

1. **C1 — Isolation is structurally enforced.** A path-prefix write guard rejects any authoring write
   outside the resolved target root, and a test proves authoring repo A leaves sibling repo B and the
   engineer's own repo byte-unchanged. (ADR-008)
2. **C2 — Regression guards exist and fail loudly.** Tests reject (a) the stub story string, (b) any
   `Status: DRAFT` authored story, (c) any spawned authoring subprocess (`claude -p`). (ADR-008)
3. **C3 — Lock primitive is swappable.** The pidfile lock/liveness lives behind one module boundary;
   routing/authoring/daemon import only that boundary. A test asserts 2 concurrent boots → exactly one
   owner, and stale-pidfile reclaim never permanently refuses a repo. (ADR-010)
4. **C4 — Mirror is non-authoritative.** No control decision reads `registry.daemonState`; on
   disagreement the pidfile wins. (ADR-010)
5. **C5 — Port purity.** The engineer core imports only the intake port interface (no concrete
   adapter); empty Envelope text is rejected with a field-named error, never silently dropped. (ADR-009)

## Gate

**HARD GATE:** ADR-008, ADR-009, ADR-010 are **DRAFT**. They must reach **APPROVED** (operator review)
before `/writing-system-tests` / BUILD. No feature proceeds past architecture-review with DRAFT ADRs.
ADR-004 and ADR-007 are now SUPERSEDED; ADR-005 remains APPROVED and binding.
