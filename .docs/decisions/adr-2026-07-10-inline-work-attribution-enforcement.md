# ADR: Inline build work attribution enforcement — fail-closed commit gate, dispatch-shaped execution, zero-work kickback

**Date:** 2026-07-10
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for intake #505

## Context

The merged attribution stack (#452 git hooks, #494 dispatch session hooks, #481
evidence-stamps-as-sole-currency) attributes commits **only** when work flows through an
Agent-tool dispatch: the PRE hook stamps `.pipeline/current-task`, `prepare-commit-msg`
copies it into a `Task:` trailer, and the evidence gate derives completion from trailers.
Work an agent performs **inline** — committing directly in the orchestration session —
never triggers a PreToolUse event, so no stamp exists, `prepare-commit-msg` abstains
(unless exactly one `in_progress` row disambiguates), `commit-msg` validates only
trailers already present, and the commit lands unattributed. Under #481 that task reads
incomplete → burned retries → auto-park → operator evidence repair.

Observed 2026-07-11 (tmux-leak-guard canary): 1 of the first 2 commits unattributed.
Same-family: three consecutive #459-build sessions produced prose "work assessments"
with zero commits and zero dispatches — invisible to hooks and gate, feature burned to
auto-park. Shipped #459 remediation covers only sessions that deliberately write a
stall marker; the zero-work-product class writes nothing.

The pipeline SKILL already forbids inline implementation — **by prose only**
(skills/pipeline/SKILL.md "Claude MUST dispatch subagents … must NOT implement
directly"). Per the deterministic-first principle, prose discipline that keeps failing
becomes machinery. The #494 ADR's only named follow-up net (#485) covers amend +
parallel-abstain windows and explicitly not inline work.

## Options Considered

### Option A-only: fail-closed commit gate
- **Pros:** one choke point catches every commit-producing shape; smallest surface.
- **Cons:** fires after the inline work is already done (work strands in a dirty tree);
  blind to `--no-verify`; does nothing for zero-commit sessions.

### Option B-only: dispatch-shaped execution enforcement
- **Pros:** redirects at attempt time, before work is wasted; deterministic message.
- **Cons:** session-hook layer only — a Bash file write bypasses a tool matcher; without
  A there is no backstop at the commit boundary.

### Option C: gate-time detect-and-fast-fail (no creation-time blocking)
- **Pros:** no new blocking machinery.
- **Cons:** violates the intake's desired outcome 1 ("rejected at creation"); still burns
  a try; post-hoc auto-attribution contradicts the merged "a wrong stamp is worse than no
  stamp" rationale. **Rejected.**

### Option: engine-driven per-task sessions
Already rejected by `adr-2026-07-10-session-hook-task-stamping` (build-phase rewrite
colliding with the deferred `conductor.run()` refactor). Not re-opened.

## Decision

**Adopt A + B + net (operator-approved), all gated on one deterministic activation
predicate.**

### 0. Activation predicate: engine-written build-step marker + cutover flag

- The engine writes `.pipeline/build-step-active` when it spawns the **build** step's
  session (`step.name === 'build'` seam, alongside `seedTaskStatus` at conductor build
  entry) and removes it when the step's session ends (success, failure, or throw —
  removal in a `finally`). The marker file is the *per-session* "a build is active"
  signal readable from inside both git hooks and session hooks.
- A repo-level config cutover `attribution_enforcement_cutover` (ISO-8601, validated
  exactly like `owner_gate_cutover`, config.ts precedent) gates the whole feature:
  absent/future cutover → all three surfaces stay in today's advisory/abstain behavior.
- Enforcement applies ONLY when marker present AND cutover passed. Sessions for other
  steps — stories/plan authoring, `/rebase` conflict resolution (finish-time),
  remediation, finish — run with no marker and are untouched. Engineer worktrees
  (`engineer-<slug>`) never get the marker (the daemon writes it, and only around build).

### 1. Surface A — fail-closed `commit-msg` branch (backstop)

Extend the worktree `commit-msg` hook (`git-hook-assets.ts`): when the activation
predicate holds and the commit is **content-bearing** (non-empty diff) and carries **no
`Task:` trailer**, reject (exit 1) with an actionable message: work must be dispatched
via the Agent tool (`Task: <id>` line 1), or the commit must carry an explicit trailer.

**Exemptions (never rejected):** merge commits (`MERGE_HEAD` present), amend
(`COMMIT_SOURCE == commit`) and rebase-in-progress (existing detections in
`prepare-commit-msg`, mirrored here), empty commits carrying `Evidence:` (existing
rule unchanged), and engine bookkeeping commits (engine sets a
`CONDUCT_ENGINE_COMMIT=1` env guard on its own `git commit` invocations — same
kill-switch pattern as the test env guard).

Ordering note: `prepare-commit-msg` still stamps first when it can — A only fires on
commits that reach `commit-msg` trailer-less, i.e. today's silent escapes.

### 2. Surface B — dispatch-shaped execution via session PreToolUse mutation gate

A new session hook script (embedded engine asset, `session-hook-assets.ts` pattern)
wired by `wireSessionHookSettings` with matcher `Edit|Write|NotebookEdit`: when the
activation predicate holds and `.pipeline/current-task` is **absent**, exit 2 with the
redirect message ("implementation happens inside a stamped Agent dispatch — dispatch
with `Task: <id>` line 1, or use `Task: none` for non-implementation work"). Stamp
present (i.e. inside a dispatched implementer) → pass through instantly.

Additionally, the same gate matches `Bash` and blocks **only** commands that invoke
`git commit` when unstamped (precedent: `block-destructive-git.sh` command scanning).
This closes the `--no-verify` bypass at build time — the session layer fires even when
git hooks are skipped. All other Bash commands pass (the orchestrator's status/query
commands are unaffected).

Residual known bypass: file writes via arbitrary Bash (e.g. `sed -i`). Accepted — the
work products still can't be *committed* unattributed (A + the Bash commit gate), which
is the outcome the intake demands.

### 3. Surface net — zero-work-product step-end kickback

Engine-side, at build-step session end (same seam as the marker removal): if the step's
session produced **zero dispatches** (PRE hook increments a `.pipeline/dispatch-count`
sentinel; count unchanged) **and zero new commits** (HEAD unchanged from step entry)
**and no halt marker** was written, the engine records a deterministic
`zero_work_product` kickback event with the reason, injects an explicit corrective
preamble into the next attempt's prompt, and counts the attempt via the existing
`noEvidenceAttempts` ledger so the auto-park threshold still bounds loops. The failure
cause becomes visible (event + ledger reason) instead of a silent burned retry.

### Fail-open provisioning (unchanged constraint)

All new hook installation follows #452/#494: provisioning failure degrades to today's
behavior — enforcement machinery must never block worktree provisioning. Blocking
happens only inside sessions/commits when the machinery is verifiably installed.

## Consistency with merged ADRs

- `adr-2026-07-09-deterministic-evidence-attribution-enforcement`: abstain-not-misstamp
  governs **stamping** (never guess an id). A/B **reject without guessing** — no wrong
  stamp is ever written; the gate remains sole completion authority (this ADR adds no
  completion currency). Not contradicted; the ADR's acknowledged `--no-verify` gap is
  narrowed at build time.
- `adr-2026-07-10-session-hook-task-stamping`: line-1 dispatch contract unchanged;
  fail-closed-on-parsed / fail-open-on-unparseable is preserved by B (an unparseable
  hook payload passes through — only a parsed mutation attempt with a verified-absent
  stamp blocks).
- `adr-2026-07-10-retire-migration-grandfather` / evidence-range ADR: untouched.
- #485 (body-embedded trailer normalization) stays a separate spec; A's rejection
  message tells the agent the trailer forms `commit-msg` accepts, which #485 widens.

## Evidence (verify-claims ledger)

| Claim | Basis | Confidence |
|---|---|---|
| PreToolUse `Edit\|Write\|NotebookEdit` matcher fires in headless `claude -p`, loads from `.claude/settings.local.json`, exit 2 blocks the mutation and surfaces the message | **verified** — live probe this session (scratchpad `probe-edit-hook`): `probe.log` shows `PROBE-FIRED tool=Write`, `probe-result.txt` never created, model relayed the block message | 100% |
| No existing layer rejects a trailer-less content commit | verified — `git-hook-assets.ts` read: `prepare-commit-msg` abstains on absent stamp / ambiguous rows; `commit-msg` validates only present trailers | 100% |
| Engine has a deterministic build-step entry/exit seam for the marker | verified — conductor.ts `step.name === 'build'` branches (:1494, :1787, :1845), `seedTaskStatus` at :818 | 98% |
| Build sessions are headless `claude -p` per step (so #477 probe transfers) | verified — session-hook ADR context + claude-provider.ts | 95% |
| `MERGE_HEAD` presence identifies merge commits inside commit-msg | verified git semantics (existing rebase/amend detections shipped in same script) | 95% |
| PRE-hook dispatch counting (`.pipeline/dispatch-count`) is a reliable zero-dispatch signal | inferred — PRE hook fires on 100% of Agent dispatches (merged ADR claim); counting is a trivial append | 90% |
| Zero-commit detection via HEAD comparison at step entry/exit | verified git semantics | 98% |

## Consequences

### Positive
- Desired outcomes 1–4 of #505 hold mechanically: unattributed task commits are
  impossible to create silently during a build; inline implementation is refused at
  attempt time; prose-victory sessions surface with a recorded cause; canary tally
  reads N/N.
- Zero new LLM steps; all three surfaces are pure machinery (deterministic-first).

### Negative
- Two new blocking surfaces mean two new ways a mis-scoped predicate could block
  legitimate work; mitigated by the engine-written marker (scoped to the build step
  only), the cutover flag (opt-in instant), and fail-open provisioning.
- The Bash `git commit` matcher is command-string scanning — inherently best-effort;
  exotic quoting may slip past it (backstopped by A for hook-honoring commits).
- Hook wiring is a breaking-adjacent surface → CHANGELOG Migration block required
  (consumer worktrees gain a new session hook + git-hook branch on update).

### Follow-up Actions
- [ ] Stories must cover the full negative-path matrix (merge/amend/rebase/`Task:
      none`/empty+Evidence/engine bookkeeping/other-step sessions) adversarially.
- [ ] A real-session probe test (per #477 recipe) for the mutation gate ships WITH the
      feature (injected-runner argv tests alone are insufficient — real-binary smoke).
- [ ] Migration block in CHANGELOG for the hook-wiring surface.
