---
name: engineer
description: "Interactive, phone-drivable idea→spec loop. The operator hands the host agent a raw idea; the agent routes it to the right repo, runs the REAL DECIDE skills (brainstorm→stories→plan) in that repo, opens a spec PR there, and nudges that repo's daemon. Runs independently of any build/execution loop. Use when capturing and routing new work, NOT when building inside one repo (that's plain conduct)."
enforcement: advisory
phase: decide
standalone: true
requires: []
---

## Purpose

The **engineer** is the agent-hosted control plane for turning raw ideas into routed, approved
specifications — without ever building. It is the interactive front half of the Phase 9 flywheel:

```
operator idea ─▶ [ENGINEER: route → DECIDE → spec PR → nudge]      (this skill, interactive)
                          │ merged spec PR
                          ▼
                 [DAEMON: build the merged spec]                    (separate, independent loop)
```

**How it starts.** The operator runs `conduct engineer` (no subcommand) in a terminal; that launches
an interactive `claude /engineer` session and drops them here. Inside an existing session, the
operator invokes `/engineer` directly. Either way, this skill is now driving.

**Two independent loops.** This skill is the *idea→plan* loop. It does NOT build. The *execution*
loop is the per-repo daemon, which scans **merged** spec PRs and builds them. The only coupling is
the spec PR you merge plus a fire-and-forget `ensureRunning` nudge. The engineer never drives,
waits on, or owns the daemon.

**Why this is a host-agent skill and not a CLI REPL (ADR-008).** The loop must run your *real*
skills, agent personas, and hooks (`/brainstorm`, `/stories`, `/plan` with their clarity loops).
Those exist only inside a live Claude Code session. A Node REPL or a `claude -p` subprocess cannot
run them interactively — so the engineer **is** the host agent, calling deterministic conduct-ts
primitives for the mechanical parts (registry read, path-guarded commit, PR open, daemon nudge)
and running the DECIDE skills directly in chat for the reasoning parts.

## Boundaries

- **Never build, never merge.** The engineer opens spec PRs; the operator merges them; the daemon
  builds them. This skill MUST NOT run `/pipeline`, `/tdd`, `conduct` (build mode), or `gh pr merge`.
- **Route artifacts to the target repo, never the engineer's cwd.** Every artifact and the spec
  branch land inside the resolved target repo, enforced by `AuthoringGuard`.
- **One idea at a time, operator-gated at every fork** — routing target, create-on-no-fit, and the
  DECIDE step outputs all require explicit operator confirmation. Never assume.

## The Loop

**Handle exactly ONE idea per session, then end.** The launcher (`conduct engineer`) relaunches you
in a **fresh session with clean context** for the next idea — so do NOT loop over multiple ideas
in-chat (that bloats and degrades context). Durable state (registry, lessons, processed markers)
is file-backed, so the next fresh session picks up everything that matters. For this one idea:

### 1. Capture the idea
Take the operator's raw idea from the chat. Empty/whitespace → re-prompt, do not proceed.

### 2. Route to a target repo
Read the registry: `conduct engineer projects` (JSON: `{name, path, description, tags}` per project).
Reason **in chat** about the best-fit project — this is your own judgment over the registry, not a
spawned `claude`. Present the proposed target and your rationale, then **confirm with the operator**.

- **Redirect:** if the operator names a different project, switch to it. The originally-proposed
  repo is left byte-for-byte untouched.
- **No fit:** offer to scaffold a new project (`conduct create <path>`). On decline, drop the idea
  with zero side effects. On accept, create it, then continue with it as the target.

### 3. Run the REAL DECIDE skills, in the target repo
With the target repo as the working directory, run the genuine skills in order, honoring each
skill's own clarity loops and human gates:

1. `/brainstorm` → an approved PRD in the target's `.docs/specs/`
2. `/stories`   → stories in the target's `.docs/stories/`
3. `/plan`      → an implementation plan in the target's `.docs/plans/`

These produce **Status:Accepted** artifacts via your real harness (agents + hooks). Do NOT
hand-write stub stories, DRAFT artifacts, or shell out to `claude -p`. If the operator rejects a
step, loop within that skill until accepted or abandon the idea — never carry a DRAFT forward.

### 4. Land the already-authored spec on a branch in the target repo
`conduct engineer land --project <name> --idea "<idea>"`. This is a **deterministic primitive** — it
does NOT author; the real DECIDE skills in step 3 already wrote the artifacts to the target's
`.docs/`. `land`:
- resolves the canonical target path from the registry (no cwd fallback),
- asserts the `.docs/specs|stories|plans` artifacts exist **inside** the target prefix (`AuthoringGuard`)
  and are real — **rejects** a stub string, any `Status: DRAFT` artifact, or empty content (C2 guard),
- creates a `spec/<slug>` branch and commits exactly those artifacts.

It writes nothing outside the target repo and never touches a sibling repo. It prints JSON
`{ slug, branch, repoPath }` — pass `branch` to step 5.

### 5. Open the spec PR + nudge the daemon
`conduct engineer handoff --project <name> --branch <branch>` (the `branch` from step 4). This opens a
spec PR **to the target repo** (no-remote → local-commit fallback), records the authored-ledger entry,
and calls `ensureRunning(repoPath)` fire-and-forget so that repo's daemon is alive to pick the spec up
**after you merge it**. It never merges and never builds.

### 6. Deliver, then end the session
The spec PR (or local-commit fallback) is the **final artifact**. Once step 5 reports it, tell the
operator plainly: **"✅ Spec delivered for `<slug>` → `<PR url / branch>`. Type `/quit` to process the
next idea in a fresh session."** Then stop — do **not** ask for another idea in this session. The
launcher regains control when the operator quits and relaunches you clean for the next idea.

> Why `/quit` and not automatic: an interactive Claude Code session cannot terminate itself (slash
> commands are user-only). The operator's single `/quit` is the session boundary that guarantees the
> next idea starts with fresh context.

## Non-negotiable gates

- No idea reaches a build without a **merged** spec PR — and only the operator merges.
- Zero `claude -p` / authoring subprocess; zero Node readline REPL substrate; routing is in-chat.
- Cross-repo isolation: authoring repo A never mutates repo B.

## Verification

- [ ] Idea routed with explicit operator confirmation (redirect + no-fit + decline all handled)
- [ ] DECIDE ran the real `/brainstorm`→`/stories`→`/plan` skills (not stubs, not DRAFT, no `claude -p`)
- [ ] All artifacts + the `spec/<slug>` branch landed inside the resolved target repo only
- [ ] Spec PR opened to the target repo; nothing built, nothing merged
- [ ] `ensureRunning` nudged the target daemon fire-and-forget (no lifecycle ownership)
- [ ] Sibling repos left byte-for-byte unchanged
