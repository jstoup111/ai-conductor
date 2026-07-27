# Evidence model

Why this harness proves progress with artifacts instead of accepting an agent's word for it, what counts as
evidence, and what breaks when evidence is lost. The file-by-file detail is in
[artifacts](../reference/artifacts.md).

## The core idea

Progress is proven, not asserted. A step is complete when a file on disk demonstrates it ran and produced
the right result — not when the agent that ran it says so.

This follows directly from the repo's design principle: be deterministic where possible and use an LLM only
where judgement is genuinely required. Deciding *what* the code should do requires judgement. Deciding
*whether a step ran* does not — it is a file check, a timestamp comparison, a hash. Anything mechanical is
the engine's job.

The corollary matters more than the principle. When an agent repeatedly violates a rule, the fix is
machinery that stamps, validates, or rejects at the moment of the mistake — not a stronger prompt.
Prompt-level rules drift under long unattended builds, and every drift costs an operator intervention.
Deterministic enforcement is instant, costs no tokens, and fails at the point of violation, where the
context to fix it still exists.

## Why self-reports are not trusted

An agent reporting on its own work is being asked to grade its own homework, in a session that has every
incentive to finish. The failure is not dishonesty; it is that the report and the work come from the same
context, so a mistaken belief in the work becomes a confident report about the work.

So the loop owns objective verdicts. After each step, the engine recomputes that step's verdict from on-disk
evidence and writes it to `.pipeline/gates/<step>.json`. It does not read a status the agent produced.

There is exactly one agent-authored verdict write: a **kickback**, where a downstream step invalidates an
upstream gate. That write is allowed because it makes *more* work, not less — and even then it must carry
provenance: which step re-opened the gate, and the evidence for it.

Two design details show how far this is taken:

- Commit trailers that attribute work to tasks were demoted from a gate to telemetry, because trailer
  discipline is prompt discipline. What replaced them is engine-stamped task ids and commit hooks.
- Build completion is derived from a judged comparison of the plan against the actual diff, rather than from
  the task rows an agent maintained.

## What counts as evidence

Evidence splits into two classes by where it lives, and the split is deliberate.

| Class | Location | Committed? | Examples | Lifetime |
| --- | --- | --- | --- | --- |
| Spec artifacts | `.docs/` | yes | plans, stories, PRDs, ADRs, conflict and coherence records, retros, shipped records | forever, on the branch |
| Run evidence | `.pipeline/` | no — gitignored | task status and evidence sidecar, gate verdicts, build review, wiring evidence, suite evidence, audit results | one worktree, one run |

Spec artifacts are the durable contract. They travel with the branch, they are what a reviewer reads, and
they are the input the SHIP audits compare the built code against.

Run evidence is regenerated every run and is deliberately kept out of git. Tracking it produced date-stamp
sprawl, rebase and merge conflicts between concurrent features, and dirty-tree halts at the finish-time
rebase — the evidence of the build kept breaking the build.

A third thing exists that is neither: markers whose *existence* is the whole signal — a halt marker, a
quarantine sentinel, a finish choice, a phase marker. The phase marker is deliberately line-oriented rather
than JSON so a shell hook can read it without a parser.

## Pass markers

The simplest form of evidence is a pass marker: a file a step must write after it passes, whose presence and
freshness the engine checks. Custom steps declare one directly with a config key, and the engine's check is
mechanical and strict:

| Condition | Verdict |
| --- | --- |
| no freshness floor available | not done — the gate refuses to verify without one |
| file missing | not done — the step must write it after a passing review |
| path exists but is not a regular file | not done |
| file older than the floor | stale — the step must rewrite it during this attempt |
| file present and fresh | done, with the freshness comparison recorded |

Note what is *not* checked: the contents. A pass marker proves a step reached its own success path during
this attempt. Gates that need to check a result — a verdict, a set of rows, a fingerprint — read the content
too, and several re-derive the answer from the code rather than trusting the file at all.

## Freshness, and why it is half the model

A file's existence proves a step ran *once*. Almost every real failure in this system is a file that proves
the wrong run. So every verdict is compared against a floor:

- **The session floor** — the run's start. Clears artifacts left by a previous run in the same worktree.
- **The attempt floor** — when a judging dispatch started. Preferred when present, because without it a
  review session that fails to rewrite its verdict silently re-scores the previous session's answer forever.
  That is not hypothetical; it is why the attempt floor exists.

A small filesystem-clock tolerance applies to the attempt floor only, absorbing the case where a verdict
written *during* the current dispatch records an mtime a few milliseconds before the captured floor. The
session floor is compared exactly — it is captured seconds before any write, so it needs no slack.

Stale review artifacts from a prior session are also swept at session start, before any gate can read them.

The complement to freshness is a **code stamp**: some gates record the commit their verdict was formed
against. If the code in that gate's surface has not changed since the stamp, the gate can short-circuit to
satisfied on a re-dispatch instead of re-judging identical bytes. The preserve path is deliberately withheld
from any marker that carries failure history, so a recorded failure can never be laundered into a pass.

## When evidence is lost

Because run evidence is per-worktree and gitignored, deleting a worktree destroys it. The branch keeps the
commits; the engine loses the proof it saw them.

What actually happens next:

- **False stalls on finished work.** With no task evidence, the resolved-task count reads zero, the progress
  delta degrades to "no progress", and the build is diagnosed as stalled on work that is already committed.
- **Repeated work.** Tasks the engine can no longer see as complete get re-attempted.
- **Lost run identity.** The recorded PR URL, branch identity, and session start go with it, so SHIP-tail
  freshness checks lose their floor and fall open on file presence.

Some of this self-heals. Task status is re-seeded from the plan on every build-gate evaluation, so deleting
or corrupting it recovers. Gate verdicts are recomputed rather than restored. What does not self-heal is the
evidence sidecar that records which commits satisfied which tasks — that has to be backfilled.

> **Known limitation.** Removing `.worktrees/<slug>` loses that worktree's `.pipeline/`, which causes false
> `no_task_progress` stalls on already-committed work. Park the feature before touching its git state,
> recreate the worktree from its branch, and backfill the evidence rather than letting the build redo
> finished tasks. Tracked in [#497](https://github.com/jstoup111/ai-conductor/issues/497).

Recovery procedure: [worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md).

## What this means for you

- **Do not tell the harness a step is done.** Produce the artifact it looks for. If a gate blocks, the
  answer is in the evidence it read, not in re-asserting the claim.
- **Treat a worktree as disposable but its `.pipeline/` as expensive.** The branch is the source of truth;
  see [architecture](architecture.md). Park a feature before touching its git state.
- **A manual finish still needs its record.** The shipped fact is a committed file, so work finished by hand
  outside the harness is invisible to the backlog until that file lands.
- **When you extend the harness, extend the evidence.** A new step needs something on disk that proves it
  ran, or it proves nothing. See [extending](../contributing/extending.md).

The gates that consume all of this — what each one checks, how it fails, and how a block gets routed — are
described in [gates](gates.md).
