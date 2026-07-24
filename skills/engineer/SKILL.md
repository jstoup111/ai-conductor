---
name: engineer
description: "Interactive, phone-drivable idea→spec loop. The operator hands the host agent a raw idea; the agent routes it to the right repo, runs the FULL DECIDE phase (explore [track] → complexity → prd [product track] → architecture-diagram → architecture-review → stories → conflict-check → plan, tier-aware) in that repo, opens a spec PR there, and nudges that repo's daemon. Runs independently of any build/execution loop. Use when capturing and routing new work, NOT when building inside one repo (that's plain conduct)."
enforcement: advisory
phase: decide
standalone: true
requires: []
model: fable
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

**How it starts.** The operator runs `conduct-ts engineer` (no subcommand) in a terminal; that launches
an interactive `claude /engineer` session and drops them here. Inside an existing session, the
operator invokes `/engineer` directly. Either way, this skill is now driving.

**Two independent loops.** This skill is the *idea→plan* loop. It does NOT build. The *execution*
loop is the per-repo daemon, which scans **merged** spec PRs and builds them. The only coupling is
the spec PR you merge plus a fire-and-forget `ensureRunning` nudge. The engineer never drives,
waits on, or owns the daemon.

**Why this is a host-agent skill and not a CLI REPL (ADR-008).** The loop must run your *real*
skills, agent personas, and hooks (`/explore`, `/prd`, `/stories`, `/plan` with their clarity loops).
Those exist only inside a live Claude Code session. A Node REPL or a `claude -p` subprocess cannot
run them interactively — so the engineer **is** the host agent, calling deterministic conduct-ts
primitives for the mechanical parts (registry read, path-guarded commit, PR open, daemon nudge)
and running the DECIDE skills directly in chat for the reasoning parts.

## Boundaries

- **Never build, never merge.** The engineer opens spec PRs; the operator merges them; the daemon
  builds them. This skill MUST NOT run `/pipeline`, `/tdd`, `conduct` (build mode), or `gh pr merge`.
- **Route artifacts to the target repo, never the engineer's cwd.** Every artifact and the spec
  branch land inside the resolved target repo, enforced by `AuthoringGuard`.
- **Author in a per-idea worktree, never the primary checkout.** All authoring, `land`, and
  `handoff` happen inside `<target>/.worktrees/engineer-<slug>`; the target's primary working tree
  is never mutated. If the worktree can't be created, abort the idea — never fall back to the
  shared checkout.
- **One idea at a time, operator-gated at every fork** — routing target, create-on-no-fit, and the
  DECIDE step outputs all require explicit operator confirmation. Never assume.

## The Loop

**Handle exactly ONE idea per session, then end.** The launcher (`conduct-ts engineer`) relaunches you
in a **fresh session with clean context** for the next idea — so do NOT loop over multiple ideas
in-chat (that bloats and degrades context). Durable state (registry, lessons, processed markers)
is file-backed, so the next fresh session picks up everything that matters. For this one idea:

### 1. Capture the idea
The idea can arrive from **three** sources — resolve them in this order:

1. **GitHub intake.** First run `conduct-ts engineer claim`. It dequeues the oldest pending intake
   idea and prints JSON. On `{ "kind": "claim", "text": "...", "sourceRef": "owner/repo#N" }`, use
   `text` as the idea and **carry `sourceRef`** — you'll pass it back in steps 3–5 so the originating
   issue gets commented + labelled. On `{ "kind": "claim", "empty": true }`, fall through.
2. **Launch argument / chat.** If the launch prompt already carried an idea (`conduct-ts engineer
   "<idea>"` or `--idea "<idea>"`), use it. Otherwise take the operator's raw idea from the chat.

Empty/whitespace from all three → re-prompt, do not proceed. There is **no `sourceRef`** for ideas
that came from the CLI arg or chat — omit `--source-ref` in steps 3–5 for those.

> The bare `conduct-ts engineer` launcher pre-polls GitHub issues before this session starts, so a
> `claim` here returns work captured at launch. You do not poll yourself — just claim.

**Hypothesis reframing for embedded solution content.** If the captured idea embeds solution content
(e.g., "Fix direction", "Design sketch", "Proposal", named seams/functions — template-shaped or not):

- Treat the sketch as the **filer's hypothesis**, not the requirement.
- Carry it into DECIDE and `/explore` **labeled explicitly as a candidate, not the chosen approach**.
- Frame the idea for routing and discovery by its **problem statement + desired outcomes**, not the sketch.

The target shape (Observed / Impact / Desired outcome / Hypotheses) and its quality bar are defined
by the `/intake` skill. This step *consumes* ideas already in the queue; when instead **filing** an
intake issue on the operator's behalf (`gh issue create`), author it with `/intake`.

**Pure-sketch case (no stated problem or outcomes).** If the idea is a design sketch with no stated
problem or outcomes:

- Do **not** spec the sketch verbatim as the requirement.
- Derive the WHAT (problem + outcomes) from the sketch or ask the operator to state it.
- Confirm the WHAT with the operator before proceeding to step 2 (routing).

### 2. Route to a target repo
Read the registry: `conduct-ts engineer projects` (JSON: `{name, path, description, tags}` per project).
Reason **in chat** about the best-fit project — this is your own judgment over the registry, not a
spawned `claude`. Present the proposed target and your rationale, then **confirm with the operator**.

- **Redirect:** if the operator names a different project, switch to it. The originally-proposed
  repo is left byte-for-byte untouched.
- **No fit:** offer to scaffold a new project (`conduct-ts create <path>`). On decline, drop the idea
  with zero side effects. On accept, create it, then continue with it as the target.

### 3. Create the per-idea worktree, then run the REAL DECIDE skills inside it
**Author in an isolated per-idea worktree — never the target's primary checkout.** First create it:

`conduct-ts engineer worktree --project <name> --idea "<idea>" [--source-ref <ref>]` → prints JSON
`{ slug, branch, worktreePath, reconcile }`. For **intake-claimed ideas**, pass the `sourceRef`
carried from step 1 as `--source-ref <ref>` — the claim record it resolves lets a later `land`
auto-resolve the intake body without having to re-thread it by hand. `--source-ref` can be omitted
for chat/CLI ideas, which have no claim record. This creates a dedicated worktree at
`<target>/.worktrees/engineer-<slug>` checked out on a fresh `spec/<slug>` branch (based on the
repo's derived default branch), disjoint from the daemon's own worktrees. **`worktreePath` is your
working directory for all authoring, `land`, and `handoff`** for this idea.

- **Strict abort (never fall back):** if the worktree cannot be created (e.g. a detached/unborn
  HEAD with no derivable default branch), the command exits non-zero and makes **zero** changes to
  the target's primary tree. Do **not** author in the primary checkout — surface the error and stop.
- **reconcile** reports how a leftover from a prior failed run was resolved (`created` / `reused` /
  `attached`); a **dirty** leftover is refused (recreate it). Report the decision to the operator.

With **`worktreePath` as the working directory**, run the genuine skills **in canonical conduct
order**, honoring each skill's own clarity loops and human gates. The engineer owns the WHOLE
DECIDE phase — the daemon only builds — so produce the complete, build-ready artifact set (every
`.docs/` artifact is written **inside the worktree**, never the primary checkout):

1. `/explore` → Pass the **problem statement + desired outcomes** as primary framing; if an embedded
   hypothesis exists from step 1, pass it explicitly marked as "a candidate, not the chosen approach".
   Run discovery and confirm the **track** (product/technical) → `.docs/track/<stem>.md`. Ephemeral
   notes only (no `.docs/` design doc).
2. **Complexity assessment** → classify the feature **S / M / L** (same signals conduct uses:
   models, integrations, auth, state machines, story count). Write the tier to
   `.docs/complexity/<plan-stem>.md` with a `Tier: <S|M|L>` line (plus rationale). The stem
   **MUST** match the `.docs/plans/<stem>.md` filename so the daemon resolves it.
3. `/prd`       → an approved product-only PRD in the target's `.docs/specs/` — **product track
   only; skip on technical** (acceptance criteria live in stories there).
4. `/architecture-diagram`  → `.docs/architecture/` — **skip for Small**
5. `/architecture-review`   → `.docs/decisions/` (review report + ADRs) — **skip for Small;
   lightweight for Medium; full for Large.** Every ADR must be **APPROVED** (no `Status: DRAFT`)
   before landing. Runs **before** stories.
6. `/stories`   → stories in the target's `.docs/stories/` (must end **Status: Accepted**)
7. `/conflict-check`        → `.docs/conflicts/` — **skip for Small**
8. `/plan`      → an implementation plan in the target's `.docs/plans/`
9. `/coherence-check` → the committed traceability mapping (outcomes → FRs → stories → tasks) in
   the target's `.docs/coherence/` — **skip for Small; Medium and Large only.**

These produce **Status:Accepted** artifacts via your real harness (agents + hooks). Do NOT
hand-write stub stories, DRAFT artifacts, or shell out to `claude -p`. If the operator rejects a
step, loop within that skill until accepted or abandon the idea — never carry a DRAFT forward.

### 4. Land the already-authored spec — from within the worktree
`conduct-ts engineer land --project <name> --idea "<idea>" --worktree <worktreePath>` (the
`worktreePath` from step 3; append `--source-ref <ref>` when the idea came from GitHub intake — this
comments "Routed to `<repo>`" on the originating issue, commits a `.docs/intake/<slug>.md` marker
carrying `Source-Ref: <ref>` so the issue origin travels with the spec, and advances the intake
ledger; write-back is advisory and never blocks the land). This is a **deterministic primitive** — it
does NOT author; the real DECIDE skills in step 3 already wrote the artifacts into the worktree's
`.docs/`. `land`:
- operates **entirely inside `--worktree`** — it commits in place on the worktree's `spec/<slug>`
  branch and **never touches the target's primary working tree** (no `git checkout` there),
- asserts the `.docs/specs|stories|plans` artifacts (plus `.docs/complexity/` and, for a
  non-Small tier, `.docs/conflicts|architecture|decisions`) exist **inside** the worktree
  (`AuthoringGuard`) and are real — **rejects** a stub string, any `Status: DRAFT` artifact, empty
  content (C2 guard), a **DRAFT ADR**, a **tier/artifact mismatch** (tier ≠ S but architecture
  artifacts missing), or a **dirty worktree**,
- stages only `.docs` (no `add -A`) so the commit is strictly this idea's set — no cross-idea bleed.

On failure it leaves the worktree in place for inspection (**keep-on-failure**). It prints JSON
`{ slug, branch, repoPath }` — pass `branch` and the same `--worktree` to step 5.

### 5. Open the spec PR + nudge the daemon — remove the worktree on success
`conduct-ts engineer handoff --project <name> --branch <branch> --worktree <worktreePath>` (the
`branch` from step 4 and the same `worktreePath`; append `--source-ref <ref>` when the idea came from
GitHub intake — on a real PR this comments the PR URL on the originating issue, adds a non-closing
`Refs <ref>` to the spec PR body (links the issue without closing it; the daemon's implementation PR
is what closes it on merge), applies the `engineer:handled` label, and advances the ledger to `done`).
It runs `gh pr create` **from the worktree** (so the PR opens for `spec/<slug>`), opens a spec PR to
the target repo (no-remote → local-commit fallback), records the authored-ledger entry, and calls
`ensureRunning(repoPath)` fire-and-forget so that repo's daemon is alive to pick the spec up **after
you merge it**. On success it **removes the per-idea worktree** (the `spec/<slug>` branch + commit
persist and stay reachable); a removal failure is reported, not swallowed. It never merges and never
builds.

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
- **Per-idea worktree isolation:** author/land/handoff run inside the per-idea worktree; the
  target's primary tree is invariant (branch + cleanliness unchanged). Remove-on-success,
  keep-on-failure, strict-abort if it can't be created.
- **No spec lands with a DRAFT ADR** — all ADRs must be APPROVED before `land`.
- The **complexity tier is recorded** (`.docs/complexity/<plan-stem>.md`) and drives the daemon's
  BUILD-phase step skipping; a non-Small spec must carry conflict-check + architecture artifacts.

## Verification

- [ ] Idea captured from the right source (`claim` first; CLI arg / chat fallback) — `sourceRef` carried only for intake ideas
- [ ] Idea routed with explicit operator confirmation (redirect + no-fit + decline all handled)
- [ ] For intake ideas: `--source-ref` threaded into `worktree` (to resolve the claim record's body) + `land` + `handoff` so the originating issue is commented + labelled, the `.docs/intake/<slug>.md` marker is committed, and the spec PR is linked with `Refs <ref>` (the daemon adds `Closes <ref>` to the implementation PR, auto-closing the issue on merge)
- [ ] DECIDE ran the real skills in canonical order — `/explore` → complexity → `/prd` (product) →
      `/architecture-diagram` → `/architecture-review` → `/stories` → `/conflict-check` → `/plan` →
      `/coherence-check` (M/L only, skipped for S) (not stubs, not DRAFT, no `claude -p`)
- [ ] Complexity tier recorded at `.docs/complexity/<plan-stem>.md`; for Small, conflict-check + architecture were skipped
- [ ] All ADRs are APPROVED (no `Status: DRAFT`) before landing
- [ ] Authoring + `land` + `handoff` ran inside the per-idea worktree (`--worktree`); the target's
      primary tree was never checked out or dirtied
- [ ] Worktree creation strict-aborted (no primary-tree mutation) if it could not be made
- [ ] All artifacts + the `spec/<slug>` branch landed inside the resolved target repo only
- [ ] Spec is discovery-build-ready: stories end `Status: Accepted` (no DRAFT) and the plan
      carries a task dependency tree (`**Dependencies:**` lines or a Task Dependency Graph) —
      discovery warn-skips merged specs missing either, permanently until fixed on main
- [ ] Spec branch pushed to origin BEFORE `handoff` (`git push -u origin spec/<slug>` from the
      worktree — `gh pr create` fails on an unpushed branch and handoff falls back to a
      local-commit result that opens no PR)
- [ ] Spec PR opened to the target repo; nothing built, nothing merged
- [ ] On success the per-idea worktree was removed and `spec/<slug>` stayed reachable; on failure it
      was kept for inspection
- [ ] `ensureRunning` nudged the target daemon fire-and-forget (no lifecycle ownership)
- [ ] Sibling repos left byte-for-byte unchanged
