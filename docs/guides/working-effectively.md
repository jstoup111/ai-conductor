---
title: Working effectively with the harness
parent: Guides
nav_order: 1
---

# Working effectively with the harness

How to get the most out of AI Conductor, and why it deliberately works differently from an
interactive coding assistant. Read this once before your second feature. The mechanics of each
command are in [first-feature.md](first-feature.md) and [engineer-loop.md](engineer-loop.md); this
page is about the working rhythm that makes those commands pay off.

The short version: **you own design, the daemon owns execution, and the queue is what makes both
fast.** The rest of this page explains why, with numbers from this repository's own telemetry.

## The delegation model

Think of the harness as a delegated engineering lane, not a pair-programming partner. You are the
tech lead; the daemon is the team.

A tech lead who writes every line themselves is the bottleneck. A tech lead who writes a clear
spec, hands it over, and reviews the result on the way back scales to however many people are
executing. The harness is built around that second shape. There are exactly two points where your
judgement shapes the work, and both are conversations you have with a document rather than with a
running process:

1. **You decide.** `ai-conductor compose` walks you through DECIDE: explore, stories, architecture,
   plan. This is where your design sense matters most, and the composer is built to make it a real
   discussion. The spec PR is the output.
2. **You merge the spec.** Merging says "build exactly this".
3. **The daemon builds.** It executes the plan in its own worktree, runs review, test-quality,
   audit, and architecture gates against the plan you merged, and opens an implementation PR.
4. **You review the implementation.** Same as any colleague's PR.

Between checkpoints 2 and 4 the daemon is doing the cheap, repetitive part: writing the code,
running the tests, fixing review findings, rebasing, authoring the PR. That work is worth
delegating precisely because it does not need your attention. What it frees up is your context.
While a build runs, you are not holding a half-finished implementation in your head, so you can
spend that attention on the next design problem instead.

## Why the spec artifacts are the asset

DECIDE produces stories, a plan, and ADRs, and it is tempting to read those as ceremony on the way
to code. They are the opposite: they are the part of the work that compounds.

Every ADR is a durable, written architectural decision with its reasoning attached. In most teams
that knowledge lives in a few people's heads, surfaces in code review when someone remembers it,
and leaves with them. Here it is committed under `.docs/decisions/` and read by machinery. The
composer reads the ADRs before it plans the next feature, so the plan starts from the real
constraints instead of rediscovering them. The as-built architecture review grades the build
against them, so a build that quietly violates one is kicked back rather than merged. The stories
and coherence record do the same for behavior: they say what the system is supposed to do, and
every later DECIDE plans against that record rather than against whoever is in the room.

That is why the first feature through the harness costs roughly the same as the tenth, and the
tenth is much better aligned. Each spec adds to a body of constraints that every future feature
inherits for free. The value of AI Conductor is not any single build; it is that the design
knowledge behind your codebase stops being tribal and starts being enforced. Keeping those
artifacts truthful is the single highest-leverage thing an engineer does here, which is the thread
running through the rest of this page.

## Why the queue matters: speed and throughput

The single biggest lever on how much you get out of the harness is **how many specs are in the
backlog**. A daemon with one spec in the queue works for an hour or two and then sits idle until
you notice, review, merge, and compose the next one. A daemon with six specs in the queue works
through the night.

The numbers below come from this repository's own telemetry: the Grafana stack the daemon exports
to (98 daemon runs in the last 7 days, per-step histograms over 90 days) and the cost blocks in
its 204 shipped records.

| Measure | Value | Source |
|---|---|---|
| One daemon run, pickup to settle | median 35 min, three-quarters under 56 min | Tempo, `conductor.run` spans |
| The `build` step | mean 37 min; `build_review` 3 min; `rebase` 13 min | Prometheus step histograms |
| Cost per shipped feature | median $8, mean $19, three-quarters under $27 | shipped records |
| Features shipped, July 2026 | 87 | shipped records |
| Features shipped, August 2026 | 134 | shipped records |
| Best single days | 10 to 13 implementation PRs merged | git history |

Two things follow from those figures.

**Wall-clock is dominated by your response time, not the build.** A feature that takes the daemon
an hour or two to build but waits eight hours for you to merge the spec and another eight to merge the
PR has a 17-hour cycle where one or two hours was machine time. Queue six specs on Monday and the daemon
delivers six PRs by Tuesday morning; work them one at a time and the same six take the week.

**The daemon is a baseline throughput floor for your team.** At roughly 4 features a day through
August, one repository's daemon was shipping at the pace of a small team, at a median of $8 per
feature. That floor only holds if the queue is never empty. The daemon runs features serially
within a repository, so "parallel" here means *your* time in parallel with *its* time: you compose
the next three specs while it builds the current one, and across multiple registered repositories
each daemon drains its own queue at the same time.

A rhythm that keeps the queue full:

- **Compose in sessions.** Sit down and turn three to six ideas into spec PRs in one block. Each
  `compose` run is short because the composer does the drafting; you answer its questions and
  check the stories.
- **Merge specs in batches.** Specs that came from a GitHub issue are dispatched by the issue's
  priority label; specs composed from a bare idea queue in a stable default order. If two specs
  touch the same code, `conflict-check` in DECIDE surfaces it before either is built.
- **Review implementation PRs in batches.** Draft PRs accumulate quietly; a PR flipping to
  ready-for-review is the signal something needs you.
- **Bundle related changes into one spec with several stories.** Every spec pays for explore,
  stories, plan, review, audit, and ship. Stories inside one spec share all of that. Three
  well-scoped specs are far cheaper and faster than ten one-line ones.

Two cases where splitting is right:

- **The work can run in parallel.** If two pieces of a change are independent, two specs let the
  daemon build one while you review the other, and across registered repositories they build at
  the same time. Bundle what is coupled; split what is not.
- **A directory of production files is being deleted.** That needs two diffs to stay reviewable.
  The composer will tell you when this applies.

## Keeping the plan and the build in step

Every gate in BUILD and SHIP measures the code against the plan and stories you merged. That is
what makes the gates trustworthy: `build_review` asks "does this diff deliver the plan?", the
as-built architecture review asks "does the code match the ADRs?", and the coherence record traces
tasks back to outcomes. The plan is the contract both sides are working to.

This means the most effective place to influence a build is **before** it starts, in the spec PR.
Read the stories and the plan's `Done when:` bullets with the care you would give a design review.
Anything the plan gets right, the build will deliver; anything it gets wrong, the build will
deliver faithfully.

It also means that changing the target while a build is in flight works against you, even when
the change is a good one. The engine tracks task evidence under the feature's `.pipeline/`
directory, and review verdicts are bound to specific commits. An edit that arrives outside the
engine's own dispatch shows up as one of:

- **Drift.** Review kickbacks cite findings against code that has already moved, and remediation
  laps re-open work the build considered done.
- **False stalls.** The evidence ledger no longer matches the branch, which reads as
  `no_task_progress` or a protected-artifact halt.
- **Discarded laps.** A halted lap loses its verdicts, and the restart repeats the review pass at
  full cost.
- **Self-host halts.** On this repository specifically, changing the live checkout while a
  dispatch runs trips the live-boundary guard and halts the feature outright.

### When you can touch the code

You are not locked out of the branch for the life of the build. There are three windows where your
hands on the code are welcome:

**1. While the feature is parked.** `ai-conductor daemon park <slug>` tells the daemon to let the
current step settle and then stop dispatching. Once it has settled, the worktree is yours. This is
the right move when the build is heading somewhere expensive and wrong, or when a halt needs a
small correction you can make faster than a new spec.

The one rule: **stay within the bounds of the plan.** The gates will grade whatever they find
against the merged plan and stories, so a change that implements a task the plan already
describes will pass, while a change that adds behavior the plan never mentioned will be flagged as
scope drift and kicked back. If what you want to change is the plan itself, amend the spec
artifacts and reseal them before unparking; the recipe is in the
[plan-gap section of the stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md#the-halt-is-a-plan-gap).
Commit your work, then `ai-conductor daemon unpark <slug>` and the build resumes from the last
settled step with your commits in place.

**2. After the PR is marked ready for review.** From that point it is an ordinary PR. Push review
commits, request changes, or squash as your team normally would.

The risk in this window is quieter than in the first one, and it is the more expensive of the
two. The stories and ADRs on `main` are what every future DECIDE reads to learn what the code is
supposed to do and why. A review commit that changes behavior or structure without touching those
artifacts leaves them describing a system that no longer exists. Nothing fails today. The cost
lands on the next feature, whose composer plans against stale constraints and whose build is then
graded against them. That is a net negative for the project, not a local shortcut.

So the test for a review-window edit is the same as for a parked one: does it stay inside what the
stories and ADRs already say? Renames, test fixes, and small correctness changes do. Anything
structural does not, and structural changes include refactors. If the implementation came back
with the wrong shape, one of two things is true: the plan was wrong, or the architectural
constraints were unclear. Both are DECIDE problems. Run the refactor through its own compose
loop so the ADRs are amended and the next build inherits the corrected structure, rather than
patching it into a PR where no future feature will ever see the reasoning.

**3. After a `needs-human` halt.** The halt record names what the engine could not resolve. Some
halts are answered by editing the worktree (a missing fixture, a flaky test), some by amending
the spec, and some by clearing the halt and letting it retry. The runbook linked below tells you
which.

Outside those windows, the most efficient response to "the spec was wrong" is usually the least
dramatic one: let the build finish, reject the PR with a note, and file the correction as an
intake issue. The daemon builds cheaply enough that a wrong PR costs you a review, not a rebuild.

## Where the useful feedback is

Engineers new to the harness often want more visibility during a build. That instinct comes from
tools where the human is the safety net. Here the gates are the safety net, and the daemon is
designed to interrupt you only when something changes what you should do next. Everything else is
telemetry for tuning the harness, and reading it during a build pulls you back into the execution
loop that delegation was meant to free you from.

**Signals worth acting on:**

| Signal | Where | What it means |
|---|---|---|
| Spec PR opened | `gh pr list --label spec` | The composer is done. Review the stories and plan, then merge. |
| Draft implementation PR | GitHub | The build reached SHIP. Nothing to do yet. |
| PR marked ready for review | GitHub | FINISH accepted the prose and wrote the shipped record. Review and merge. |
| `needs-human` halt | `ai-conductor daemon status`, `BLOCKED` section | The engine could not resolve something without you. Read the remedy it prints. |
| A `BLOCKED` merged spec | `ai-conductor daemon status` | Your spec did not land in the backlog. The status line names the reason and the fix. |

**Signals that are safe to ignore unless you are diagnosing a halt:**

- `ai-conductor daemon logs --follow`. Valuable when a feature has halted and you need the
  narrative. Not useful as a progress bar.
- Turn counts, cost lines, and `$` figures per step. These feed the shipped record and the
  operator's tuning, not your decision.
- Kickback and remediation laps. A `build_review` FAIL routing back to `build` is the system
  working as designed. It only becomes yours when it hits the kickback cap and halts.
- Commits landing on the feature branch. They are not stable until the PR is ready.

A comfortable cadence is once or twice a day: `ai-conductor daemon status` and
`gh pr list --state open`. If neither shows a halt or a ready PR, there is nothing waiting on you,
and that is the system working.

## It got stuck. What do I do?

Start with `/daemon-triage` from a Claude Code or Codex session in the project. It gathers the evidence
(daemon liveness, the halt marker and its class, stall events, the run timeline) and points you at
the right runbook, so you are not guessing from a log tail.

The runbooks it routes to, and when to reach for each directly:

- [Stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md). The general case: a
  `needs-human` halt, a stall, a plan gap, a protected-artifact violation, a rebase that halted.
  Its [Recovery](../runbooks/stalled-or-stuck-feature.md#recovery) section is organised by halt
  class.
- [Emergency stop a running feature](../runbooks/emergency-stop-a-running-feature.md). The build
  is doing something you need to stop now.
- [Abandoning a spec](../runbooks/abandoning-a-spec.md). The direction was wrong and you want the
  daemon to forget the feature rather than re-dispatch it.
- [Worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md). A worktree was
  removed or its `.pipeline/` state is gone.
- [Daemon recovery](../runbooks/daemon-recovery.md). The daemon itself is down, wedged, or holding
  a stale lock.
- [Shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md). A PR merged but
  the daemon keeps re-dispatching the feature.

The full list is in the [runbooks index](../runbooks/index.md).

Common questions are collected in the [FAQ](faq.md).
