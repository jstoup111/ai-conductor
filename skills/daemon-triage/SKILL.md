---
name: daemon-triage
disable-model-invocation: true
description: "Use when a feature is stuck in daemon execution — halted, spinning, stalled, or silently not progressing — and an operator needs to know why. Diagnoses the failure and routes it to the right runbook. Operator-invoked only; never auto-dispatched, and never mutates anything without explicit per-action approval."
enforcement: advisory
phase: all
standalone: true
operator_only: true
phase_active_policy: advisory
requires: [verify-claims]
---

## Purpose

An operator's entry point when the daemon has a feature wedged. It answers three
questions, in order:

1. **What is the observable state?** — gathered from evidence, not inferred.
2. **Which failure class is this?** — resolved against a signal table, not a guess.
3. **What is the operator's next move?** — the one runbook that owns this class,
   plus the exact commands to run.

It may then **carry out** that recovery — but every mutation requires the
operator's explicit approval first, and approval is per-action, never blanket.

### The approval contract

**Diagnosis is unconditionally read-only.** Everything in §1–§3 — reading state,
classifying, choosing a runbook, writing the triage report — happens without
asking. Gathering evidence must never change the thing being measured.

**Every mutation stops and asks.** Before *any* action that changes state —
clearing a halt, parking or unparking, editing `.pipeline/`, any git command
that writes, restarting the daemon — present the action, what it changes, its
blast radius, and wait for the operator to approve that specific action. Then do
it. Do not batch several mutations behind one approval, and do not treat
approval of a diagnosis as approval to act on it.

**"Proceed" is not standing consent.** Approval covers the action just
described, once. The next mutation asks again, even if it is the obvious next
step in the same recovery.

> **This is deliberately conservative, and deliberately temporary.** Daemon
> recovery is where a confident wrong move costs the most, and the failure modes
> that hurt worst are the ones where the *display* is lying and the work is fine,
> or the halt is legitimate and clearing it just re-halts. Ask-first buys the
> operator a veto at exactly those moments. As classification proves reliable in
> practice, the safest, most reversible actions are the candidates to relax
> first — the destructive ones in §4 are not.

**Not a substitute for the runbooks.** The runbooks under `runbooks/` (symlinked
into this skill directory) remain the canonical procedures. This skill exists to
pick the right one correctly and to stop an operator from guessing.

## Preconditions — check these first, in order

### Operator-invoked only — record advisory context

This skill is intended only for direct operator invocation and must never be
auto-dispatched. The engine records a dispatched step in a phase marker in the
feature's worktree:

```bash
cat .pipeline/phase-active 2>/dev/null
```

The marker is advisory because it can survive a daemon crash. Check it first,
then run this read-only liveness corroboration:

```bash
conduct-ts daemon status
```

Read-only triage always continues, even when the marker or daemon status appears live.
When both signals make the recorded `<step>/<phase>` look live, record a warning
that operator-only triage is observing an apparently active dispatched step.
Diagnosis is unconditionally read-only, so this warning does not block evidence
gathering or classification.

If status reports the daemon as stale or stopped, or its session as down,
explicitly continue read-only triage and treat the marker as crash residue
evidence. If status does not corroborate the recorded step for any other reason,
treat the marker as uncorroborated evidence, not execution authority.

> The catalog marks this skill explicit-only for both providers: Claude reads
> `disable-model-invocation: true`, while Codex reads
> `policy.allow_implicit_invocation: false`. Step-session `skillOverrides` on
> Claude and pruning from the self-host Codex home remain defense in depth. The
> marker-plus-liveness warning is still required because an operator may invoke
> triage explicitly while a step appears active; it surfaces that context without
> blocking read-only diagnosis.

### Confirm you have a slug and a repo root

Triage is always scoped to one feature. Run from the **main checkout**, not from
inside a feature worktree — the daemon-level evidence (`.daemon/`) only exists at
the root.

```bash
conduct-ts daemon status
```

If the operator did not name a slug, list the halted and in-progress features from
that output and ask which one. Do not triage all of them at once.

## Practices

### 1. Gather Evidence — read-only, before any conclusion

Run these and read the output before forming any theory. Per `/verify-claims`,
a classification is a load-bearing claim: ground it in observed evidence with a
confidence estimate, and never route on an assumption you did not check.

Substitute the feature's slug for `<slug>` and your repository's default branch
for `<base-branch>` throughout.

```bash
# Daemon-level: liveness, last activity, what it thinks the state is
conduct-ts daemon status
conduct-ts daemon logs --lines 200 | grep -F "<slug>"

# The halt and its class — the single most decisive signal
head -1 .worktrees/<slug>/.pipeline/HALT 2>/dev/null
cat .worktrees/<slug>/.pipeline/HALT.class 2>/dev/null

# Classified stall events
grep -E 'build_stall|build_no_progress|zero_work_product|rate_limit|credentials_park' \
  .worktrees/<slug>/.pipeline/events.jsonl 2>/dev/null | tail -20

# Which step is live, and how stale is its heartbeat
cat .worktrees/<slug>/.pipeline/phase-active 2>/dev/null
cat .worktrees/<slug>/.pipeline/step-heartbeat 2>/dev/null

# Progress: rows vs. real commits (these disagree more often than you'd think)
cat .worktrees/<slug>/.pipeline/task-status.json 2>/dev/null
git -C .worktrees/<slug> log origin/<base-branch>..HEAD \
  --format='%h %s%n  Task: %(trailers:key=Task,valueonly)' 2>/dev/null

# Whichever gate is blocking
ls .worktrees/<slug>/.pipeline/gates/ 2>/dev/null
cat .worktrees/<slug>/.pipeline/gates/<step>.json 2>/dev/null

# Is it parked? Does the worktree even exist?
ls .daemon/parked/<slug> 2>/dev/null && echo PARKED
ls -d .worktrees/<slug> 2>/dev/null || echo "NO WORKTREE"
```

**Two traps this sequence exists to catch:**

- **A pinned counter is not a stalled build.** The displayed resolved count and
  the real progress signal are different things. Commits carrying `Task:`
  trailers count as resolved work even when their `task-status.json` rows were
  never flipped, and commit movement — not the count — is the liveness authority.
  A build showing `0/N` while HEAD advances every few minutes is *working*.
  Compare the git log against the rows before concluding anything.
- **A stale heartbeat belongs to whichever step wrote it.** Read the `step` field
  in `step-heartbeat`, not just its age. A heartbeat left behind by an earlier
  step says nothing about the step running now.

### 2. Classify — deterministic signal table first

Match the strongest signal you actually observed. Rows are ordered by decisiveness:
take the first that matches.

| Observed signal | Failure class | Runbook |
|---|---|---|
| `.daemon/parked/<slug>` exists | Operator-parked — not a failure; nothing dispatches until unparked | `runbooks/emergency-stop-a-running-feature.md` |
| `.worktrees/<slug>` missing, or state says past `worktree` with no directory | Worktree / evidence loss | `runbooks/worktree-and-evidence-recovery.md` |
| `HALT.class` is `needs-human` | Needs-human halt — an operator decision is required; clearing it without deciding just re-halts | `runbooks/stalled-or-stuck-feature.md` |
| `HALT` body reads `heartbeat stalled: no provider activity in …` | Watchdog kill (already handled; `mechanical`) | `runbooks/stalled-or-stuck-feature.md` |
| `HALT.class` is `mechanical`, or absent/unrecognized | Mechanical halt — daemon may retry; clears on base-branch advance | `runbooks/stalled-or-stuck-feature.md` |
| `credentials_park` event, or `build-auth-status` exits non-zero | Auth park — waiting on a credential, not on your code | `runbooks/stalled-or-stuck-feature.md` |
| `rate_limit` event, wait still in progress | Rate-limit episode — deliberate wait, does not burn retry budget | `runbooks/stalled-or-stuck-feature.md` |
| `.pipeline/halt-user-input-required` or `build-stall-question.md` present | Build asked a real question no retry will answer | `runbooks/stalled-or-stuck-feature.md` |
| `.pipeline/QUARANTINE` present, or `wip/setup-quarantine-<slug>` branch exists | Project setup failed inside the worktree | `runbooks/daemon-recovery.md` |
| Same halt reason repeating every poll; slug re-dispatched on a short cycle | Spin / re-dispatch loop | `runbooks/daemon-recovery.md` |
| `git worktree add` exits 128 repeatedly | Spin loop on worktree creation — park before touching git state | `runbooks/daemon-recovery.md` |
| Gate JSON `satisfied: false` with a `kickback` count at its bound | Kickback loop — a gate keeps rejecting the same work | `runbooks/stalled-or-stuck-feature.md` |
| Feature has a merged PR but keeps being re-dispatched | Shipped-record desync | `runbooks/shipped-record-reconciliation.md` |
| Daemon will not start, lock contention, orphaned session, stale engine | Daemon-level fault — not feature-specific | `runbooks/daemon-recovery.md` |
| Commits with `Task:` trailers exist and HEAD is advancing, but the display shows `0/N` | **Not a failure** — telemetry desync; the build is progressing | none; report and stop |

### 3. When no row matches — judgment, declared as such

If nothing in the table matches cleanly, reason from the evidence to the most
likely class — but say so explicitly. State: the signals you *did* observe, the
class you think it is, your confidence, and what single additional piece of
evidence would confirm it. Never present a judgment call in the same voice as a
table match.

If confidence is low and the next step is destructive, that low confidence is
itself the finding: recommend parking and escalating (§5) rather than guessing.

### 4. Safety rails — state these in every report that recommends action

These are not advice; each encodes a failure that has already destroyed operator
state. Any recommendation you emit — and any action you execute once approved —
must be consistent with all four. Operator approval does **not** relax them: an
approved delete is still enumerated explicitly and confirmed against that list,
because what the operator approved was the named target, not a pattern.

1. **Park before touching a feature's git state.** The daemon re-dispatches
   anything in its backlog and re-creates branches you delete. Park first, always.
   Never unpark-then-delete — that guarantees a re-creation spin.
2. **Never bulk-delete worktrees or branches.** No globs, no computed sets, no
   loop-deletes. Enumerate every path explicitly, print the list, confirm it,
   then delete. A guard built on an unverified shell array once deleted every
   worktree in the repo instead of the four intended.
3. **The branch is the source of truth; the worktree checkout is disposable —
   but its evidence is not.** Deleting `.worktrees/<slug>` destroys the
   per-worktree `.pipeline/` state, which is *not* reproducible from the branch,
   and causes false stall detection on already-committed work.
4. **A manually opened PR is not a harness finish.** The harness records a ship
   through its own shipped-record path. A hand-opened PR leaves the daemon
   re-dispatching the feature forever, with parking as the only stopgap.

### 5. Escalate — when to stop triaging

Stop and recommend park + file an issue (see `/intake` for the issue structure)
when any of these hold:

- The same failure has recurred after a correct, runbook-sanctioned recovery.
- The evidence contradicts itself (state says complete, evidence says otherwise)
  and no runbook covers the combination.
- The root cause is in the **harness**, not the feature — a gate misrouting, an
  engine seam that never fires in production, a watchdog misfiring. Feature-side
  recovery cannot fix these and will keep re-breaking.
- Recovery would require a destructive action you cannot justify from evidence.

Distinguish clearly in the report: **feature-side** problems get fixed in the
feature's own worktree; **harness-side** problems get an issue and a park, because
patching around them per-feature hides the defect.

### 6. Write the triage report

Write to the **daemon** directory, not the feature's `.pipeline/` — triage output
is not feature evidence and must never be mistaken for it by a gate:

```
.daemon/triage/<slug>-<UTC timestamp>.md
```

Structure:

```markdown
# Triage: <slug>

**When:** <UTC timestamp>
**Classification:** <class> (<table match | judgment, NN% confidence>)
**Runbook:** <path>

## Observed

Evidence actually gathered — command output, file contents, log lines.
Quote them; do not paraphrase.

## Assessment

What the evidence shows. Name explicitly what you ruled OUT and why.

## Recommended actions

Exact commands, in order, each with what it changes and its blast radius.
Mark any destructive step and what must be confirmed before it runs.

## Actions taken

Only what the operator approved and this skill then executed, each with the
approval it was granted under and the observed result. Empty if nothing was
approved — an empty section is the correct outcome for a diagnosis-only run,
not a gap.

## Escalation

Feature-side or harness-side. If harness-side, what the issue should say.
```

Report the classification and the recommendation to the operator directly — the
report is the audit trail, not the delivery mechanism. Write it **before**
proposing any mutation, so the evidence behind a recommendation is on disk
independent of whether the operator approves it. Append to *Actions taken* as
each approved action completes, not in a batch at the end: if a recovery goes
wrong midway, the record must already show what had actually run.

## Verification

- [ ] The skill was directly operator-invoked, never auto-dispatched
- [ ] `.pipeline/phase-active` was checked **first**, then `conduct-ts daemon
      status` supplied advisory liveness context
- [ ] Read-only triage continued for every marker/status combination; an
      apparently live step produced a warning, while stale/stopped daemon or
      session-down state treated the marker as crash residue evidence
- [ ] Evidence gathered before any classification was stated
- [ ] Classification cites the specific signal it matched, or is declared a
      judgment call with a confidence estimate
- [ ] Exactly one runbook named, and it exists at the referenced path
- [ ] Diagnosis mutated nothing — evidence gathering never changed the state
      being measured
- [ ] Every mutation was presented with its blast radius and **individually**
      approved before it ran; none was batched behind another's approval, and no
      approval was treated as standing consent
- [ ] Every recommended command states what it changes; destructive ones are
      marked and were confirmed against an explicit, enumerated target list
- [ ] Safety rails restated in any report recommending action
- [ ] Triage report written under `.daemon/triage/`, not `.pipeline/`, and
      written before any mutation was proposed
- [ ] *Actions taken* records each approved action and its result, appended as it
      completed — empty if the run was diagnosis-only
- [ ] Feature-side vs harness-side called explicitly
