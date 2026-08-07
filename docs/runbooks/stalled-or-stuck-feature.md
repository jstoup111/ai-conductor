---
title: Stalled or stuck feature
parent: Runbooks
nav_order: 4
---

# Stalled or stuck feature

Diagnose and clear a feature that is dispatched but not progressing: no-task-progress stalls,
provider-preparation exhaustion, build-progress ceilings, rate-limit waits, auth parks, and
kickback loops. For operators reading `.pipeline/` state and the daemon log.

> **Not sure this is the right runbook?** Run `/daemon-triage` — it gathers the evidence
> read-only, classifies the failure, and routes to the one runbook that owns it.

## Symptom

Any of these:

- The daemon log shows `▶ start <slug>` and then nothing for a long time.
- `■ done <slug>: halted` or `■ done <slug>: error` appears and the slug stops being dispatched.
- The startup dashboard lists the slug under HALTED instead of IN-PROGRESS or ELIGIBLE.
- The dashboard lists a reason and `remedy:` line for a PARKED, HALTED, or retained slug.
- The same build step retries repeatedly with the same reason.
- A feature is marked complete but the PR never appeared.

## Diagnosis

All per-feature evidence lives in the feature's own worktree: `.worktrees/<slug>/.pipeline/`.
All daemon-level evidence lives at the main repo root: `.daemon/`.

### Blocked merged spec

**Symptom:** A merged plan never dispatches, and `conduct-ts daemon status` lists it in `BLOCKED`
with a reason and remedy. This is a discovery refusal, not a feature HALT: no feature worktree or
`.pipeline/HALT` exists yet. The startup dashboard does not render this state
([#1332](https://github.com/jstoup111/ai-conductor/issues/1332)); use `daemon status`.

**Diagnosis:** Read the `BLOCKED` line. Common reasons are `unresolvable-stories-ref`,
`stories-missing`, `stories-not-approved`, `no-dependency-tree`, and `missing-coherence`. The
snapshot is `.daemon/blocked.json`; a missing or malformed snapshot means only that no completed
discovery pass is available, not that the spec is clear.

**Recovery:** Apply the line's remedy on the repository's default branch. Do not repair only a
feature branch or a local working tree: discovery reads the committed default-branch tree. After an
upgrade that adds this visibility, the first discovery pass may dispatch a previously invisible,
otherwise-buildable merged spec when the repository has no processed marker for it. That is expected;
review the plan before starting the daemon if those older specs are not ready to build.

**Verification:** Run `conduct-ts daemon status` after the next pass. A repaired spec disappears
from `BLOCKED` and is eligible for dispatch; a remaining entry includes its current remedy.

### 1. Read the halt marker first

```bash
head -1 .worktrees/<slug>/.pipeline/HALT
cat .worktrees/<slug>/.pipeline/HALT.class
```

`.pipeline/HALT` is a full stop for that feature: the daemon never advances, opens a PR, or
merges past it. The first non-empty line of the body is the reason the dashboard surfaces.

`.pipeline/HALT.class` classifies it. Every HALT the daemon writes now carries one — the daemon
stamps any HALT still missing a class at startup as `legacy`, once per feature, so the sidecar is
never absent for long. Content the reader doesn't recognize still reads as `unclassified`.

| Class | Meaning | Cleared by the re-kick sweep? |
| --- | --- | --- |
| `needs-human` | Only an operator can resolve it. | No — skipped on every sweep. |
| `mechanical` | The daemon may safely retry it. | Yes, on a base-branch advance. |
| `protected-artifact` | BUILD or SHIP found a genuine protected DECIDE-artifact violation. | Yes, on a base-branch advance; verification refuses again if the violation remains. |
| `legacy` | Predates total classification; stamped by the daemon's startup migration. | Yes, on a base-branch advance, same as `mechanical`. |
| *(absent / unrecognized)* | Treated as `unclassified`. | No — skipped on every sweep, same as `needs-human`. |

A feature that errors gets a diagnostic HALT written at the deterministic
`.worktrees/<slug>/.pipeline/HALT` path even when worktree creation itself fails. Read and clear
that marker after fixing the cause. If the daemon log reports `unrecoverable-state`, it could not
write that marker; repair the target directory or permissions first, then re-run the dispatch.

`NEVER-STARTED` is not a halt: the dashboard found no readable `conduct-state.json`, and the feature
remains dispatchable. Do not reclaim or unpark it merely to make it run. For a retained row, follow
its `remedy:` line: an open PR needs no action until it lands; a closed, unknown, or legacy PR state
can be handled with `conduct daemon reclaim-worktree <slug>` when reclaim is appropriate.

### 2. Classify the stall

```bash
grep -E 'build_stall|build_no_progress|zero_work_product|rate_limit|credentials_park' \
  .worktrees/<slug>/.pipeline/events.jsonl | tail -20
```

#### `no_task_progress`

The build step's circuit breaker. From attempt 2 onward, the step is declared stalled only when
**both** signals stay pinned across the attempt: the count of resolved plan tasks did not
increase, **and** HEAD did not move. The resolved count is the **union** of two sources:

- rows in `.pipeline/task-status.json` whose `status` is `completed` or `skipped`, and
- plan task ids carried by `Task: <id>` trailers on commits in
  `merge-base(origin/<default-branch>, HEAD)..HEAD`.

So a task committed with a valid `Task:` trailer counts as resolved even if its row was never
flipped. Work committed with **no** `Task:` trailer and no row update is invisible to the
*count* — but not to the breaker, because it still moves HEAD.

**Commit movement is the liveness authority
(adr-2026-07-23-commit-movement-liveness-floor).** The attributed-task count is advisory
routing and telemetry; it never independently proves a build is stuck. An attempt that lands
real, committed-but-un-trailered work moves HEAD while the count stays pinned, and is
classified `unattributed_progress` — telemetry, not a stall — instead of `no_task_progress`.
A SHA read that fails on either side of the attempt is treated fail-closed, degrading to the
old count-only behavior. A genuine wedge (zero commits, count pinned) still stalls and halts
exactly as before: count alone can never kill a build.

If the build step's retry budget then exhausts with at least one HEAD-moving attempt, the run
does **not** take the generic "retries exhausted" HALT. It routes into `build_review` — the
sole completion authority — through the same seam a normally-completed build uses, recording
the unresolved plan task ids in `conduct-state.json` (`build_routed_reason`). This route requires
a clean worktree. That is not an always-pass: `build_review` re-grades the diff independently and
can still FAIL the routed build, kicking it back to `build` under the same
`MAX_KICKBACKS_PER_GATE` bound as any other `build_review` kickback. A build with zero commit
movement across every attempt never routes.

#### Build halted with uncommitted paths

**Symptom:** `.pipeline/HALT` names one or more uncommitted paths, for example
`2 uncommitted paths: src/a.ts, test/a.test.ts`. The build cannot complete or use the exhausted-
but-working route while those paths remain dirty.

**Recovery:** inspect the named paths, then either commit the intended work or discard only the
named paths when it is not intended. Do not clear the halt first or re-dispatch around the dirty
tree. Once the worktree is clean, use [the resume procedure](#clear-a-halt-and-let-the-feature-resume).

**Verification:** `git status --porcelain` in the feature worktree prints no output before the
resumed build advances.

In daemon mode the engine synthesizes a remediation prompt into
`.pipeline/build-stall-question.md` and dispatches `/remediate`, bounded to 2 remediation
rounds per gate. A zero-work stall never terminal-HALTs from that path; it falls through to the
ordinary retry and park route.

#### Unresolved step command

**Symptom:** `.pipeline/HALT` reads `Cannot dispatch '<step>': /<command> is not available in
the provider skill catalog.` and its class is `mechanical`.

**Diagnosis:** the provider ran but reported the exact dispatched slash command as unknown —
the run's home is missing the skill that step renders to. This is a deterministic environment
failure: retrying, escalating model or effort, or walking providers cannot make a command
appear in a catalog that does not have it, so the conductor halts immediately instead of
spending further attempts.

**Recovery:** re-provision the provider home (or self-host sandbox) with the missing skill, then
clear the HALT using [the resume procedure](#clear-a-halt-and-let-the-feature-resume). Because
this is a `mechanical`-class HALT, the daemon's ordinary re-kick sweep also clears it on a
base-branch advance — but re-kicking without fixing the catalog just reproduces the halt on
the next dispatch.

**Verification:** after the next dispatch, the daemon log shows the step's command resolving
and the run advancing past it; it must not return to the same `commandUnresolved` HALT.

#### Provider preparation exhausted

**Symptom:** `.pipeline/HALT` begins `Provider preparation exhausted.` and its class is
`needs-human`. The daemon log or dashboard may also show the provider lifecycle as `recovering`
followed by `halted` with `preparation-timeout-exhausted` and recovery `1`.

**Diagnosis:** read the marker body:

```bash
cat .worktrees/<slug>/.pipeline/HALT
cat .worktrees/<slug>/.pipeline/HALT.class
```

It names the logical `step`, `phase: preparing`, attempt id, elapsed milliseconds, and recovery
count. The timeout applies only before a provider process starts: candidate resolution, session
setup, or self-host preparation did not complete within
`provider_preparation_timeout_minutes`. The first expiration already used the one automatic
replacement; because this is a `needs-human` HALT, the re-kick sweep will not clear it.

Do not diagnose this from `.pipeline/step-heartbeat`. Heartbeats are activity telemetry only, and a
quiet running provider is not automatically killed, retried, or replaced.

**Recovery:** repair the preparation failure. If preparation is expected to take longer, increase
`provider_preparation_timeout_minutes` in the active configuration; `0` or a negative value
disables that pre-spawn deadline. Do not use `step_heartbeat_stall_minutes`: it is a deprecated
compatibility no-op and cannot change provider lifecycle behavior. Then clear the HALT using
[the resume procedure](#clear-a-halt-and-let-the-feature-resume).

**Verification:** after the next dispatch, the dashboard/log shows a new `preparing` attempt and,
once spawned, `running`; it must not return to `halted` with
`preparation-timeout-exhausted`. Confirm the resumed feature with the general
[verification steps](#verification).

#### Live-boundary violation (self-host only)

If `.pipeline/HALT` reads `<live checkout|provider state> changed during self-host execution — N
added, N removed, N changed: …`, the self-host live boundary detected a change to the harness
checkout or to the operator's real `~/.claude`/`~/.codex` while a step was in flight. **The reason
names the paths** — each tagged `added`, `removed`, or `changed`, capped at eight entries followed by
`and N more`, with exact counts. Read them before investigating anything else.

- A path under the live checkout is usually an untracked file an operator session wrote — a
  permission or approval grant (Claude Code's `.claude/settings.local.json` is untracked and
  fingerprinted), a scratch or generated artifact, or a new file staged with `git add`. Git can
  say a path is tracked but not who wrote it, so the guard fails closed on everything it cannot
  attribute. An edit or deletion of an **already-tracked** file reports `M`/`D` and does not halt;
  a git operation that rewrites tracked content without leaving it modified (`git pull`,
  `git checkout`, `git stash`) does halt, because `git status` then comes back clean. Batch
  root-checkout work between dispatches, or do it inside a worktree — see the live-checkout rule
  in `AGENT_INSTRUCTIONS.md`'s **Daemon Operations Safety** section. Issue #1301 tracks the
  attribution machinery that will remove this false-halt class.
- A provider-state path that is config-like (`settings.json`, `config.toml`, `hooks.json`) means an
  unrelated interactive session changed operator config mid-build. That trip is deliberate and
  fail-closed — those files stay fingerprinted precisely because a real leak would look identical.
- A provider-state path that is pure telemetry or cache means the exclusion list needs a new entry;
  see [self-hosting: provider-state
  exclusions](../guides/self-hosting.md#provider-state-exclusions).

This is a `mechanical`-class HALT, so the daemon's ordinary re-kick sweep clears it on the next
base-branch advance. The step that was running keeps its own real verdict, so the re-kick resumes
after it rather than repeating it.

#### Retained draft PR identity is unavailable (self-host only)

**Symptom:** `.pipeline/HALT` begins `Self-host release gate HALT: retained draft PR identity is
unavailable — no OPEN pull request exists for <branch> into <base>.`

**Diagnosis:** the release gate reads its release metadata from the draft PR opened at SHIP-phase
entry. When the in-memory URL is absent — the ship-start `git push` failed, for instance — the engine
looks the PR up by branch instead, and only an **OPEN** PR whose head is that branch and whose base is
the build's base branch satisfies it. Reproduce the same lookup:

```bash
gh pr list --head <branch> --base <base> --state open --json url,state
```

- **Rows come back.** The gate should have resolved it; capture the daemon log line
  `[ship-draft-pr] branch lookup for <branch> …` and treat it as a bug.
- **Empty, but a PR exists in `--state all`.** It is closed or merged. That is not a draft the finish
  step may flip or rewrite — open a fresh PR for the branch, or land the work as already-shipped via
  `conduct shipped-record`.
- **Empty entirely.** No PR was ever opened; check whether the branch reached origin (`git push`
  failures are logged as `[ship-draft-pr] push of <branch> failed`) and push it.

**Recovery:** ensure an OPEN PR exists for the branch into the base with valid release metadata in its
body, then clear the HALT using [the resume
procedure](#clear-a-halt-and-let-the-feature-resume).

#### FINISH publication halts

A FINISH publication failure or non-converging progress halts one of three ways, and the marker says which:

- `FINISH publication retry exhausted: <reason>` — the reason was transient (transport, GitHub,
  filesystem, provider judgment, or a re-observation), so every attempt in the budget was spent
  before giving up.
- `FINISH publication cannot proceed: <reason> is not retryable — …` — the reason can never be
  satisfied by re-running the identical transition, so the run halted on the **first** observation
  and the retry budget was deliberately left unspent. Nothing but `judge_pr_prose` crosses the
  provider boundary between attempts, so no retry authors a commit, wires a missing effect, or
  reconciles a remote. These are `draft_pr_no-commits`, `draft_pr_skipped`,
  `draft_pr_lease-rejected`, and the four `*_effect_unavailable` reasons. Both halts are
  `needs-human`; recovery is the same — resolve the cited condition, then clear the HALT.
- `FINISH publication progress allowance exhausted after <N> transition(s); last transition: <transition>.
  Human review required.` — FINISH made verified publication progress, so none of the step retry
  budget was spent. The separate progress allowance reached its 12-transition bound before the
  publication state converged, and this is a `needs-human` halt.

**Diagnosis:** inspect the named last transition and the preceding FINISH publication events in the
daemon log. Twelve verified transitions without convergence means the publication state machine is
cycling or an external publication state is not settling; do not clear the HALT merely to repeat the
same cycle.

**Recovery:** reconcile the cited transition and the external PR/remote state until the next FINISH
entry can converge. Only then clear the HALT using [the resume
procedure](#clear-a-halt-and-let-the-feature-resume).

An unrecognised reason always keeps its retries: the classifier fails closed toward retrying.

#### `draft_pr_lease-rejected`

**Symptom:** `.pipeline/HALT` reads
`FINISH publication cannot proceed: draft_pr_lease-rejected is not retryable — the remote branch
carries commits this checkout has never observed …`.

**Diagnosis:** `establish_pr` publishes the feature branch with
`git push -u origin <branch> --force-with-lease`, because the finish-time `rebase` step has just
rewritten that branch's history — the branch diverges from its own remote by construction, and a
plain push could never succeed. A rejected **lease** means something else: the remote branch carries
commits this worktree has never observed, so the push was refused rather than overwriting them.
(An ordinary transport or permission failure reports `draft_pr_push-failed` instead.)

```bash
git -C .worktrees/<slug> fetch origin <branch>
git -C .worktrees/<slug> log --oneline HEAD..origin/<branch>
```

- **Rows come back.** Real unseen work is on the remote. Integrate it (rebase the feature branch onto
  `origin/<branch>`, or reconcile by hand) before letting FINISH retry.
- **Empty.** The remote-tracking ref was merely stale; the fetch above refreshes the lease.

**Recovery:** once `HEAD..origin/<branch>` is empty, clear the HALT using
[the resume procedure](#clear-a-halt-and-let-the-feature-resume). Never resolve this with a bare
`git push --force` — that discards the very commits the lease protected.

#### `halt_marker`

The `pipeline` skill wrote `.pipeline/halt-user-input-required` — a genuine question that no
retry will answer. Its content becomes the stall question:

```bash
cat .worktrees/<slug>/.pipeline/halt-user-input-required
cat .worktrees/<slug>/.pipeline/build-stall-question.md
```

The build completion gate returns "not done" while that marker exists, so a surviving marker
also blocks the build gate directly.

#### `ENVIRONMENT_CLAIM_REFUTED`

A step failed with a reason beginning `ENVIRONMENT_CLAIM_REFUTED`. That is not an environment
problem: the dispatch blamed the environment for blocking `git push` or `gh`, and the engine
disproved it from the dispatch it actually performed (unsandboxed `claude`, and a write fence whose
generated script carries no such rule). The failure message quotes the claim and states the facts.

Nothing needs fixing in the sandbox — do **not** go looking for one. The attempt is retried with the
disproof as its retry hint so the step performs the operation for real. If the same refutation
repeats until the budget is exhausted, the model is inventing the blocker rather than running the
command: escalate the step's model tier or take the finish over manually (a manual PR still needs
its `shipped-record`, see [shipped-record reconciliation](shipped-record-reconciliation.md)).

Claims from `codex` are never refuted — its unattended runs really are sandboxed
(`sandbox_mode="workspace-write"`), so a blocked operation there may be genuine.

#### Build-progress ceilings

A build that *is* resolving new tasks re-dispatches without consuming the fixed retry budget,
bounded by the `build_progress_halt` block. Defaults: enabled, `attempt_ceiling: 30`,
`dispatch_ceiling: 20`. Hitting the attempt ceiling parks with a distinct reason so you can tell
"genuinely stuck" apart from "still progressing but out of runway". Key details are in
[configuration](../reference/configuration.md).

The `▶ build <resolved>/<total>` line counts a task as resolved when its `.pipeline/task-status.json`
row reads `completed`/`skipped` **or** a commit on the branch carries its `Task: <id>` trailer — the
same union the build completion gate routes on. Nothing writes those rows back mid-build except the
`pipeline` skill's explicit `conduct task done`, so on a run where the agent only stamps trailers the
rows stay `pending` and the trailers are what moves the number. A `resolved` count that does not
advance while `commitCount` keeps ticking therefore means work is landing without task attribution —
check the commit trailers before treating it as a stall.

#### Rate limits

A rate-limited dispatch emits `rate_limit` and waits — to the deadline parsed from the provider
message when one is available, otherwise 300 seconds. The wait does **not** burn the retry
budget. HALTs written while a rate-limit episode is active are stamped so they can be recovered
when the episode ends.

> **Known limitation.** The episode stamp is in-memory, scoped to the running daemon process.
> Restart the daemon during an episode and its episode-caused halts are no longer recognized as
> recoverable — they must be cleared by hand or by a base-branch advance.
> Tracked in [#1023](https://github.com/jstoup111/ai-conductor/issues/1023).

#### Auth parks

`credentials_park` means the run is waiting on a credential source, not stuck on your code.
`credentials_park_progress` events report readiness probes as they happen. The park times out
after `harness_self_host.auth_park_timeout_minutes` (default 60), then HALTs with an actionable
reason naming the credential to refresh.

```bash
conduct-ts build-auth-status
```

Exit 0 means clean (`state=api-key` when there is no daemon-owned token, or `state=valid`).
Exit 1 covers `missing`, `unreadable`, `invalid`, and `unverifiable`, and prints the remediation
message with the token path.

#### Kickback loops

A gate that blocks routes work back to an earlier step. Each gate allows at most 2 kickbacks;
past that the run halts instead of looping. Separately, a kickback into `build` that ends with
zero net progress **and** an unchanged gate verdict escalates to a halt immediately rather than
spending the remaining budget. Read the verdict that keeps blocking:

```bash
cat .worktrees/<slug>/.pipeline/gates/<step>.json
```

The record is `{ satisfied, reason, checkedAt, kickback }`. `reason` is the exact string the
gate computed. The concepts behind gate verdicts are in [gates](../explanation/gates.md); the
per-step evidence files are listed in [artifacts](../reference/artifacts.md).

#### Refused no-op wiring kickback

**Symptom:** `.pipeline/HALT` reads `wiring_check kickback-to-build refused: the build made no
tree change (tree <hash> unchanged). Investigate the unchanged build before retrying.`, optionally
followed by `Build note: <quoted tail>`. The build step for this cycle never dispatched — no
provider call was made.

**Diagnosis:** the conductor checks `.pipeline/build-outcome.json` before re-entering `build` under
a `wiring_check` kickback. When the latest record already observed `outcome: "no-movement"` for the
identical cycle — same tree hash, same gate, same gate verdict, same model/effort rung — it refuses
to pay for a turn already known to change nothing and halts immediately instead. Read the record:

```bash
cat .worktrees/<slug>/.pipeline/build-outcome.json
```

The last entry's `category` (`disputes-gate`, `belongs-to-decide`, or `silent-no-movement`) reflects
either an agent-declared `.pipeline/build-dispute.json` or an inference from the build's note text,
and names what the prior build concluded: that the `wiring_check` finding is wrong, that the work
belongs back in DECIDE, or that nothing was said at all.

**Recovery:** decide between the gate and the build, using the quoted note as evidence — this
refusal never overrides `wiring_check`'s own verdict, and recording a dispute never turns a real
wiring gap into a pass (see [gates](../explanation/gates.md#kickback-and-remediation-routing)). If
the gate's finding is wrong, correct or waive it so the next kickback lands at a different verdict.
If the work genuinely belongs to an earlier step, return the feature to DECIDE. If the wiring gap is
real and the build simply has not addressed it yet, make a tree-changing attempt — any commit that
moves the tree hash is a different cycle and dispatches normally — then clear the HALT using
[the resume procedure](#clear-a-halt-and-let-the-feature-resume). A strictly more capable
model/effort rung also counts as a different cycle and is never refused.

**Verification:** after the next dispatch, `.pipeline/build-outcome.json` gains a new record whose
`treeBefore`/`treeAfter` differ from the refused cycle's, and the daemon log's `step_completed` line
for `build` shows the moved tree hashes rather than `unchanged`.

#### BUILD verification after a repair

**Symptom:** a repair returned to BUILD and you need to determine whether `wiring_check` or
`test_suite` reused evidence or derived it again.

**Diagnosis:** read the feature narrative, not merely the old gate files:

```bash
conduct-ts daemon logs | grep 'BUILD member .* settled:'
```

The daemon writes `BUILD member <member> settled: reuse (<basis>)` or `... recompute (<basis>)`.
`reuse (fingerprint-match)` reports still-valid full-suite evidence. A recompute line reports a
closed reason such as `recorded-head-versus-current-head`, `fingerprint-mismatch`, or
`fresh-evidence-required`. A prior passing verdict on disk is not a reason to skip a member: every
non-skipped BUILD-verification member is dispatched after repair, and the round join decides
satisfaction.

**Recovery:** do not create an operator park for the historical terminal-less stale-verdict path;
it is retired. Let the re-verification round settle. If it halts, use the marker's explicit reason
and [clear a halt and let the feature resume](#clear-a-halt-and-let-the-feature-resume).

**Verification:** the log contains one settle line for each successful non-skipped member, followed
by the normal group join or an explicit HALT. It must not stop after only a sibling dispatch with no
terminal result.

#### Setup failures

If the project's `bin/setup` failed inside the worktree, the feature may be quarantined:
`.pipeline/QUARANTINE` exists and a `wip/setup-quarantine-<slug>` branch holds the evidence.

### 3. Re-verify SHIP evidence with `--diagnose`

`--diagnose` re-runs the SHIP-gating completion predicates — `test_suite`, `manual_test`,
`retro`, `finish` — against the on-disk evidence and reports which ones cannot reproduce a pass.
It does not modify feature state.

```bash
conduct-ts inline --diagnose "<feature description>"
```

Run from the main checkout with the feature description, or from inside the worktree with no
description at all (`conduct-ts inline --diagnose`).

| Outcome | Output | Exit |
| --- | --- | --- |
| Evidence consistent | `State OK: … has consistent SHIP-phase evidence.` | 0 |
| No state for that description | `No conductor state found for "<desc>" — nothing to diagnose.` | 0 |
| Evidence gaps | Per-step gap report on stderr, plus remediation guidance | **1** |
| State says past `worktree` but no worktree exists | `Orphaned conductor state in <path>.` | **1** |

A non-zero exit here is the precise signal that the state is marked complete while the evidence
that would justify it is missing. That combination is what silently produced "complete" features
with no PR.

### 4. Read the run timeline with `--report`

```bash
conduct-ts inline --report
```

Read-only. Renders three tables from `.pipeline/events.jsonl` — Step Durations, Retry Hotspots,
and Token Spend — then exits 0. An unreadable events log exits 1. Run it from inside the
worktree; it reads `.pipeline/` relative to the current directory.

> **Known limitation.** `--report` cannot show halts or kickbacks. `loop_halt` and `kickback`
> are among the 28 of 62 event types the engine emits but never registers as readable, so they
> never reach `events.jsonl` and no report can surface them. Use `.pipeline/HALT` and
> `.pipeline/gates/<step>.json` instead. Tracked in [#1023](https://github.com/jstoup111/ai-conductor/issues/1023) and [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

### 5. Read the daemon's own narrative

```bash
conduct-ts daemon logs --lines 200
```

`.daemon/daemon.log` carries every dispatch line, per-step result, engine warning, and the
startup dashboard snapshot.

> **Known limitation.** The log rotates to `.daemon/daemon.log.1` only when it is reopened and
> already exceeds 1 MB, and no CLI reads the rotated file. A long-running daemon never rotates
> mid-run; once it does, the previous history is only reachable by opening
> `.daemon/daemon.log.1` directly. Tracked in [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

## Recovery

Pick the branch that matches the diagnosis. Every step says what it changes.

### The stall was a false negative — real work exists

The commits are on the branch but carry no `Task:` trailer, so the resolved-task count cannot
see them and the build completion gate keeps reporting those ids as pending. (The stall breaker
itself is not fooled — those commits move HEAD — but the count still drives the gate.)
Do not re-run the tasks. Make the work visible instead:

1. Confirm the commits exist and check their trailers:
   ```bash
   git -C .worktrees/<slug> log origin/<base-branch>..HEAD \
     --format='%h %s%n  Task: %(trailers:key=Task,valueonly)'
   ```
   Substitute your repository's default branch for `<base-branch>`. A blank `Task:` line means
   that commit is invisible to the stall breaker.
2. Flip the corresponding rows in `.worktrees/<slug>/.pipeline/task-status.json` to
   `"status": "completed"`. **What it changes:** the routing input for the build gate. A row
   already marked `completed` or `skipped` is preserved verbatim across every re-seed, so this
   edit survives.
3. Confirm the gate now sees them:
   ```bash
   conduct-ts inline --diagnose
   ```
   and re-read `.pipeline/gates/build.json` after the next dispatch — its `reason` should no
   longer list those task ids as pending.

`conduct-ts task done <id>` will not help here: it clears the `.pipeline/current-task` stamp and
never modifies `task-status.json`.

### The stall was real — the build genuinely cannot proceed

1. Read `.pipeline/build-stall-question.md` (or `.pipeline/halt-user-input-required`) and act on
   the question: fix the spec, the plan, or the code.
2. Remove the user-input marker if it is still present. **What it changes:** unblocks the build
   completion predicate, which returns "not done" while the file exists.
   ```bash
   rm -f .worktrees/<slug>/.pipeline/halt-user-input-required
   ```
3. Clear the halt (next section).

### The halt is a protected-artifact violation

Do not delete or edit `.pipeline/protected-artifact-seal.json`. The engine rebaselines a stale seal
automatically after a clean engine rebase, or during verification when it proves that every changed
artifact is byte-identical to the base-branch tip.

**First, identify an amendment request.** If the halt arose because BUILD discovered that an accepted
DECIDE assertion must change, do not amend or reseal it in BUILD. Route the feature back to its owning
DECIDE step (the daemon reaches the existing operator gate). There, add the correction beside the
original assertion before BUILD starts again:

```markdown
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

The note is additive: retain the original text and create no separate record. Re-author the plan
without a task targeting the other feature's sealed artifact, then run
`conduct-ts plan-protected-targets .docs/plans/<feature>.md` before landing. A clean result is
`No protected-target violations found.`; each violation is reported as `Task <id>: <path>`.

1. Read the refusal in `.daemon/daemon.log`:
   ```bash
   conduct-ts daemon logs | grep 'Protected artifact rotation refused'
   ```
2. Inspect the named path and act on the specific reason:
   - `Uncommitted protected artifact changed: <path>` — a workspace edit that was never committed.
     Restore the file from `HEAD`.
   - `Protected artifact changed: <path>` with a `Feature-authored committed change` cause — revert
     to the committed DECIDE content and route any actual amendment to DECIDE.
   - `Protected artifact provenance undeterminable: <path>` — the base ref could not be resolved, no
     merge-base exists between `HEAD` and the base branch, or the inheritance probe (`git diff`)
     failed. Supply the base ref, or rebase onto the base branch to establish shared history, then
     retry.
   - Anything else — resolve the reported baseline/base-tip lookup failure. A safe inherited
     base-branch change (including one where the base has since moved past what this feature's last
     rebase brought in, as long as this feature never touched the path) needs no manual seal repair;
     the next sanctioned rebase or verification rotates it.
3. Clear `HALT` and `HALT.class` using the next procedure. If the cause remains, verification
   refuses again before dispatch.

**The edit is intentional and operator-approved (e.g. a feature's plan or architecture was amended
mid-build after the first BUILD seal was created).** The committed amendment makes the existing
seal baseline stale. The engine has no automatic path
for this — a feature-authored change never rotates on its own, by design, so there is no default
action to take here without a human reading the diff first. Do not hand-edit
`.pipeline/protected-artifact-seal.json` (malformed JSON or a wrong fingerprint silently breaks
verification for every other artifact in the seal). Instead, review the diff, and only after
approving it, call the engine's own rotation function so it recomputes real fingerprints instead of
guessing at them:

```bash
npx tsx - <<'EOF'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rotateProtectedArtifactSeal } from '<projectRoot>/src/conductor/src/engine/protected-artifact-seal.js';

const projectRoot = '<projectRoot>';
const sealPath = join(projectRoot, '.pipeline/protected-artifact-seal.json');
const seal = JSON.parse(await readFile(sealPath, 'utf8'));

await rotateProtectedArtifactSeal({
  projectRoot,
  seal,
  toCommit: '<current HEAD sha>',
  trigger: 'operator-approved-manual-review',
  paths: ['<path under .docs/... that was reviewed and approved>'],
});
EOF
```

Run from that worktree's `src/conductor` directory (`npx tsx` needs its `node_modules`). This writes
a new baseline at the given commit and appends a `rebaselines` entry recording the trigger, so the
override is auditable rather than silent. Never invent a trigger string that implies engine
automation (`proactive-rebase`, `defensive-history-rewrite` are reserved for the engine's own call
sites) — use a distinct, honest label like `operator-approved-manual-review` so a later reader can
tell a human, not the engine, vouched for this rotation.

If REKICK encounters this refusal before starting git, the HALT begins
`protected-artifact seal error` and explicitly says no rebase is active. Do not use the rebase
resolver or run `git rebase --continue`; review and rotate the seal as above, then clear the HALT
and re-queue.

### A completed rebase still appears halted

**Symptom:** `git rebase --continue` completed successfully, but the dashboard still lists the
feature under HALTED and both `.pipeline/HALT` and `.pipeline/HALT.class` remain. Manual Git
commands complete the rebase; they do not reconcile the daemon's pipeline markers.

1. Park the feature before inspecting or changing its git state:
   ```bash
   conduct-ts daemon park <slug>
   ```
   Keep it parked through marker cleanup and verification. Do not unpark before clearing the stale
   halt; that makes the feature dispatchable while its recovery state is inconsistent.
2. From the feature worktree, prove that no rebase is active and the checkout is clean:
   ```bash
   cd .worktrees/<slug>
   git status
   test ! -d "$(git rev-parse --git-path rebase-merge)"
   test ! -d "$(git rev-parse --git-path rebase-apply)"
   test -z "$(git status --porcelain)"
   ```
   Stop if either rebase state directory exists, `git status` reports a rebase, or the porcelain
   output is non-empty. Finish and verify the rebase before removing any marker.
3. Return to the main checkout and remove both live halt files:
   ```bash
   cd ../..
   rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class
   ```
   Removing only `HALT` leaves a stale classification sidecar and does not complete recovery.
4. Verify that the rebase state directories and both live halt files are absent, then unpark:
   ```bash
   test ! -d "$(git -C .worktrees/<slug> rev-parse --git-path rebase-merge)"
   test ! -d "$(git -C .worktrees/<slug> rev-parse --git-path rebase-apply)"
   test ! -e .worktrees/<slug>/.pipeline/HALT
   test ! -e .worktrees/<slug>/.pipeline/HALT.class
   conduct-ts daemon unpark <slug>
   ```

The next dashboard snapshot should list the feature under ELIGIBLE or IN-PROGRESS rather than
PARKED or HALTED. The daemon log should show `↻ resume <slug>` after dispatch.

### Clear a halt and let the feature resume

**Blast radius:** clearing the halt makes the feature eligible for dispatch again on the next
poll. Fix the cause first, or it halts again immediately.

```bash
rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class
```

**What it changes:** the daemon registers a filesystem watcher on each halted feature's marker
and wakes when it is cleared, so removal is the resume signal. (With `--no-watch` the daemon
relies on polling instead; it still picks the feature up, just on the next poll.)

**How to confirm:** the next dashboard snapshot lists the slug under ELIGIBLE or IN-PROGRESS
rather than HALTED, and the log shows `↻ resume <slug>`.

### An auth park timed out

Refresh the credential the halt body names, then clear the halt as above. Re-check with
`conduct-ts build-auth-status` before clearing — a halt cleared against a still-broken
credential just re-parks and burns the timeout again.

### A rate-limit episode is in progress

Do nothing. The wait is deliberate and does not consume the retry budget. If you must stop the
daemon during an episode, see
[emergency stop a running feature](emergency-stop-a-running-feature.md) — and note that halts
raised during the episode will not be auto-recovered by the replacement process.

### The feature must stop being dispatched entirely

```bash
conduct-ts daemon park <slug>
```

**What it changes:** writes `.daemon/parked/<slug>` at the main repo root, which is checked
before every dispatch and first in the re-kick sweep. Full procedure and the ordering rules are
in [emergency stop a running feature](emergency-stop-a-running-feature.md).

## Verification

1. **No live halt marker remains** for a feature you intended to resume:
   ```bash
   ls .worktrees/<slug>/.pipeline/HALT 2>/dev/null || echo "no halt"
   ```
2. **SHIP evidence re-verifies** — from inside the worktree:
   ```bash
   conduct-ts inline --diagnose
   ```
   Expect exit 0 and `State OK:`. A non-zero exit still names the failing steps.
3. **The blocking gate now passes.** Re-read `.pipeline/gates/<step>.json` after the next
   dispatch: `satisfied` must be `true` and `checkedAt` must be newer than the halt you cleared.
4. **The task count moves.** After the next build attempt, the resolved-task count in
   `.pipeline/task-status.json` (unioned with `Task:` trailers) must be strictly higher than it
   was, and the log must not repeat `build_stall`.
5. **The feature reaches a terminal outcome.** The daemon log shows `■ done <slug>: done` with a
   PR link, not another `halted`/`error` line.

If the feature ships but the daemon keeps re-dispatching it, the shipped record is missing —
see [shipped record reconciliation](shipped-record-reconciliation.md).
