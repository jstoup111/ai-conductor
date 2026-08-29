---
name: composer
disable-model-invocation: true
description: "Interactive, phone-drivable idea→spec loop: hands a raw idea to the right repo, runs the full DECIDE phase there, and opens a spec PR. Use when capturing and routing new work, NOT when building inside one repo (that is plain conduct)."
enforcement: advisory
phase: decide
standalone: true
requires: []
model: opus
---

## Purpose

The **composer** is the agent-hosted control plane for turning raw ideas into routed, approved
specifications — without ever building. It is the interactive front half of the flywheel:

```
operator idea ─▶ [COMPOSER: route → DECIDE → spec PR → nudge]
                          │ merged spec PR
                          ▼
                 [DAEMON: build the merged spec]
```

Inside a live supported host-agent session, Claude Code invokes `/composer`; Codex invokes
`$composer`. The `ai-conductor compose` terminal launcher is a **Claude-only launcher**: it opens
an interactive `claude /composer` session. Native persistent-session launch and recovery for other
hosts is deferred to **#759**; do not imply that this launcher creates a Codex session.

This is the idea→plan loop, not the execution loop. The per-repo daemon scans **merged** spec PRs
and builds them; the only coupling is the merged spec PR and a fire-and-forget `ensureRunning`
nudge. The composer never drives, waits on, or owns the daemon.

The loop needs real skills, agent personas, and hooks (`/explore`, `/prd`, `/stories`, `/plan`), so
the composer is the supported host agent: it calls deterministic `ai-conductor compose` primitives
for registry reads, guarded commits, PR opening, and daemon nudges, and runs DECIDE skills in chat.

## Boundaries

- **Never build, never merge.** The composer opens spec PRs; the operator merges them; the daemon
  builds them. Do not run `/pipeline`, `/tdd`, `conduct` (build mode), or `gh pr merge`.
- **Route artifacts to the target repo, never the composer's cwd.** `AuthoringGuard` enforces this.
- **Author in a per-idea worktree, never the primary checkout.** Authoring, `land`, and `handoff`
  use `<target>/.worktrees/engineer-<slug>`; never fall back to the shared checkout.
- **One idea at a time, operator-gated at every fork.** Confirm routing, create-on-no-fit, and each
  DECIDE output. Never assume.

## The Loop

**Handle exactly ONE idea per session, then end.** File-backed registry, lessons, and processed
markers let the next fresh supported host-agent session recover the durable state. The Claude-only
launcher (`ai-conductor compose`) relaunches Claude Code with clean context; other-host persistent
session launch/recovery remains deferred to #759.

### 1. Capture the idea

Resolve sources in order:

1. **GitHub intake.** Run `ai-conductor compose claim`. If it returns a claim, use `text` and carry
   `sourceRef` through `worktree`, `land`, and `handoff`; if it returns `empty`, continue. Never
   change the originating GitHub issue's assignees during claim, land, handoff, verification, or
   cleanup.
2. **Launch argument / chat.** Use the existing `ai-conductor compose "<idea>"` prompt or the
   operator's chat idea. Omit `--source-ref` for non-intake ideas.

Re-prompt for empty input. Treat any embedded implementation sketch as the filer's hypothesis, not
the requirement: carry it to `/explore` as a candidate and confirm the problem plus desired outcomes
before routing. When filing a new intake issue, author it with `/intake` rather than embedding a design.

### 2. Route to a target repo

Read `ai-conductor compose projects` and reason in chat about the best registry match; present the
target and rationale, then obtain explicit operator confirmation. Honor redirects. With no fit,
offer `ai-conductor create <path>`; decline leaves every repo untouched.

### 3. Create the per-idea worktree and run DECIDE

Create it first:

`ai-conductor compose worktree --project <name> --idea "<idea>" [--source-ref <ref>]`

It prints `{ slug, branch, worktreePath, reconcile }` and creates the isolated
`<target>/.worktrees/engineer-<slug>` on `spec/<slug>`. Use `worktreePath` for every authoring,
`land`, and `handoff` action. If creation fails, strict-abort with zero mutation to the primary tree;
report `reconcile` (`created`, `reused`, or `attached`) and refuse a dirty leftover.

From `worktreePath`, run the genuine skills in canonical conduct order, honoring each skill's gates
and writing the complete build-ready `.docs/` set only inside the worktree:

1. `/explore` → confirm product/technical track at `.docs/track/<stem>.md`.
2. Assess S/M/L and record `Tier: <S|M|L>` plus rationale in `.docs/complexity/<plan-stem>.md`.
3. `/prd` for product track only.
4. `/architecture-diagram` for Medium/Large only.
5. `/architecture-review` for Medium/Large only; every ADR is **APPROVED** before landing.
6. `/stories` with **Status: Accepted**.
7. `/conflict-check` for Medium/Large only.
8. `/plan` in `.docs/plans/`.
9. `/coherence-check` for Medium/Large only in `.docs/coherence/`.

Do not hand-write stub or DRAFT artifacts and do not shell out to `claude -p`. If the operator
rejects a step, stay within that skill until accepted or abandon the idea.

### 4. Land the authored spec

Run `ai-conductor compose land --project <name> --idea "<idea>" --worktree <worktreePath>`, adding
`--source-ref <ref>` for intake ideas. This deterministic primitive authors nothing: it commits only
the already-authored `.docs/` inside `--worktree`, never touches the primary checkout, and rejects
stubs, DRAFT artifacts or ADRs, missing tier-required artifacts, empty content, and a dirty worktree.
It prints `{ slug, branch, repoPath }`; retain the worktree on failure for inspection.

### 5. Open the spec PR and nudge the daemon

Run `ai-conductor compose handoff --project <name> --branch <branch> --worktree <worktreePath>`,
again passing `--source-ref` for intake work. It creates the PR from the worktree (or records a
local-commit fallback), records the ledger, applies the existing `engineer:handled` label, calls
`ensureRunning(repoPath)` fire-and-forget, and removes the per-idea worktree on success. It never
merges or builds; the `spec/<slug>` branch remains reachable.

### 6. Deliver, then end the session

Report `✅ Spec delivered for <slug> → <PR url / branch>.` Do not ask for another idea. In a Claude Code session, tell the operator: `Type /quit to start the next idea in a fresh session.` In every other supported host session, tell the operator to end or close the session with that host's normal control.
**Claude Code only:** the session cannot terminate itself, so `/quit` remains the user-controlled boundary.

## Non-negotiable gates

- No idea reaches a build without an operator-merged spec PR.
- No authoring subprocess or Node readline REPL; routing stays in chat.
- Cross-repo isolation: authoring repo A never mutates repo B.
- Per-idea worktree isolation: remove on success, keep on failure, and strict-abort if unavailable.
- No spec lands with a DRAFT ADR; non-Small specs include the required conflict and architecture work.

## Verification

- [ ] Claim-first intake or chat/CLI fallback carried the correct `sourceRef` behavior.
- [ ] Routing was explicitly confirmed and no-fit/redirect outcomes were handled.
- [ ] Real DECIDE skills produced accepted, non-DRAFT artifacts in canonical order.
- [ ] Complexity and tier-dependent artifacts are present in the target worktree.
- [ ] `land` and `handoff` ran only from the isolated per-idea worktree.
- [ ] The spec branch was pushed, the spec PR (or local fallback) was delivered, and nothing built or merged.
- [ ] The daemon received only the fire-and-forget `ensureRunning` nudge.
