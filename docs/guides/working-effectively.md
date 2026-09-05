---
title: Working effectively with the harness
parent: Guides
nav_order: 7
---

# Working effectively with the harness

How to get good results from AI Conductor, and why it deliberately does not work the way an
interactive coding assistant does. Read this once before your second feature. The mechanics of
each command are in [first-feature.md](first-feature.md) and [engineer-loop.md](engineer-loop.md);
this page is about habits.

The two habits that cause the most trouble are **steering a build while it runs** and **feeding the
daemon one small feature at a time**. Both feel productive. Both make the tool worse.

## The mental model

The harness is a batch system with two human checkpoints, not a pair-programming partner.

1. **You decide.** In `ai-conductor compose` you and the composer produce a spec: stories, a plan,
   ADRs. This is the only place where your judgement shapes the work, and it is meant to be a real
   conversation. Spend your time here.
2. **You merge the spec.** The spec PR is your sign-off that the plan is what you want built.
3. **The daemon builds.** It works the plan in a worktree, runs review, test-quality, and
   architecture gates against the plan you merged, and opens a draft implementation PR.
4. **You merge the implementation.** Review the PR like any other. If it is wrong, the fix is a
   new spec (or an intake issue), not a nudge to the running build.

Everything between checkpoints 2 and 4 is machinery. It is designed to run without you.

## Do not steer a build while it runs

Every gate in BUILD and SHIP measures the code against the merged plan and stories. That is what
makes the gates trustworthy: `build_review` asks "does this diff deliver the plan?", the
architecture review asks "does the as-built match the ADRs?", and the coherence record traces
tasks back to outcomes. If you change the target mid-flight, the gates are now grading against a
plan nobody is building.

What actually happens when engineers edit the worktree, amend the plan, or push commits to the
feature branch during a build:

- **Drift.** The build's own commits, your commits, and the plan disagree. Review kickbacks cite
  findings against code that has already changed, and remediation laps re-open work the build
  thought was done.
- **False stalls and halts.** Per-worktree state under `.pipeline/` tracks task evidence. An
  out-of-band edit that does not go through the engine leaves that ledger stale, which shows up
  as `no_task_progress` or a protected-artifact halt.
- **Wasted spend.** A halted lap discards its verdicts. Each restart repeats the review pass at
  full cost.
- **Self-host halts.** On this repository specifically, changing the live checkout while a
  dispatch runs trips the live-boundary guard and halts the feature outright.

If you realise mid-build that the spec is wrong, you have three sane options, in order of
preference:

1. **Let it finish, then reject the PR** and file the correction as an intake issue. Cheapest.
   The daemon builds fast; a wrong PR costs you a review, not a rebuild.
2. **Park it** (`ai-conductor daemon park <slug>`), amend the spec artifacts, reseal, and unpark.
   Use this when the build is clearly heading somewhere expensive and wrong. The recipe is in
   [stalled-or-stuck-feature.md](../runbooks/stalled-or-stuck-feature.md).
3. **Abandon it** ([abandoning-a-spec.md](../runbooks/abandoning-a-spec.md)) and compose again.

Never option four: editing the worktree by hand and hoping the build picks it up.

## Do not feed the daemon one feature at a time

The daemon drains a backlog. Its cost model assumes a queue: while one feature is in review you
are composing the next, and the queue keeps the machine busy without you watching it. Working one
feature end-to-end, waiting for the PR, merging, then composing the next turns a batch system into
a slow interactive one and puts you back in the loop the harness exists to remove you from.

A better rhythm:

- **Compose in sessions.** Sit down and turn three to six ideas into spec PRs in one block. Each
  `compose` run is short because the composer does the drafting; your job is to answer its
  questions and check the stories.
- **Merge specs in batches.** The daemon picks them up by priority band. If two specs touch the
  same code, `conflict-check` in DECIDE is where that is meant to surface, not the merge queue.
- **Review implementation PRs in batches.** Draft PRs accumulate; ready-for-review PRs are the
  signal that something needs you.
- **Size features for the tiers.** A feature that needs a Small tier and a feature that needs a
  Large tier both run through the same pipeline; the tier scales the gates, not the overhead. Ten
  one-line features cost far more total than three well-scoped ones, because each pays for
  explore, stories, plan, review, and ship. Bundle related changes into one spec with several
  stories.

Splitting is still right in exactly one case: when a change deletes a directory of production
files, or otherwise needs two diffs to stay reviewable. The composer will tell you.

## Where to get feedback, and where not to

Engineers new to the harness ask for more visibility during a build. The daemon gives you
exactly the feedback that changes a decision and deliberately withholds the rest. Reading logs
while a build runs is low-value work that pulls you back into the loop.

**Signals worth acting on:**

| Signal | Where | What it means |
|---|---|---|
| Spec PR opened | `gh pr list` | The composer is done; review the stories and plan, then merge. |
| Draft implementation PR | GitHub | The build reached SHIP. Nothing to do yet. |
| PR marked ready for review | GitHub | FINISH accepted the prose and wrote the shipped record. Review and merge. |
| `needs-human` halt | `ai-conductor daemon status`, `BLOCKED` section | The engine could not resolve something without you. Read the remedy it prints. |
| A `BLOCKED` merged spec | `ai-conductor daemon status` | Your spec did not land in the backlog. The status line names the reason and the fix. |

**Signals to ignore unless you are debugging:**

- `ai-conductor daemon logs --follow`. Useful when a feature is halted and you need the narrative.
  Useless as a progress bar.
- Turn counts, cost lines, and `$` figures per step. These are telemetry for the operator who
  tunes the harness, not for the engineer waiting on a PR.
- Kickback and remediation laps. A `build_review` FAIL routing back to `build` is the system
  working, not a bug. It only becomes your problem if it hits the kickback cap and halts.
- Commits landing on the feature branch. They are not stable until the PR is ready.

A reasonable check-in cadence is once or twice a day, running `ai-conductor daemon status` and
`gh pr list --state open`. If neither shows a halt or a ready PR, there is nothing for you to do.

## FAQ

**The build is taking a long time. Should I check on it?**
No. Run `ai-conductor daemon status`. If the feature's badge is `● running` and nothing is in
`BLOCKED`, it is working. Long builds are usually review laps, which are self-correcting.

**I want to see what it is doing so I can catch mistakes early.**
Mistakes are caught by the gates against the plan you merged. The place to catch them early is
the spec PR: read the stories and the plan's `Done when:` bullets carefully before merging. A
mistake in the plan will be faithfully built.

**Can I make a small tweak to the feature branch before the PR is ready?**
Do not. Wait for ready-for-review, then push review commits or request changes like any PR.
Pushing while the build runs is the drift scenario above.

**The spec is wrong and the build has already started.**
Let it finish and reject the PR, or park it and amend. See the three options above.

**I have five small related changes. Five specs or one?**
One spec with five stories. Each spec pays the full DECIDE and SHIP overhead; stories inside a
spec are cheap.

**Can I skip DECIDE and just have it build from a sentence?**
No. The plan is what the gates grade against. A one-sentence plan produces a build with nothing to
check itself against, which is how you get confident, wrong code.

**The daemon opened a PR I disagree with. What now?**
Review it and request changes, exactly as you would for a colleague's PR. If the whole direction
is wrong, do not just close it: follow [abandoning-a-spec.md](../runbooks/abandoning-a-spec.md) so
the daemon does not re-dispatch the feature.

**Something halted and the remedy text does not help.**
That is an intake issue. [intake.md](intake.md) explains how to file one with the evidence the
next DECIDE needs. Do not patch around it in the worktree.

**Why can't it just ask me when it is unsure?**
It does, by halting `needs-human` with the assumption it could not resolve. That is the only
interruption it makes, on purpose. Anything short of that threshold it resolves from the spec,
which is why the spec is where your attention belongs.
