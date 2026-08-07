---
name: finish
description: "Use at the FINISH boundary to gather an operator's publication intent and judge reader-facing PR prose; the engine-owned publication coordinator performs all deterministic publication mechanics."
enforcement: gating
phase: ship
standalone: true
requires: []
---

## Purpose

FINISH keeps human authority over interactive publication choices and retains one
reader-facing quality judgment for a pull request's title and body. The
engine-owned publication coordinator observes evidence, advances deterministic
publication transitions, and records completion.

## Responsibility Boundary

The coordinator, not this skill, owns every mechanical action: verifying SHIP
and publication evidence, creating or reusing a PR identity, pushing commits,
creating durable shipment evidence, marking a PR ready, and recording the
final outcome.

For `judge_pr_prose`, this skill may inspect and repair only the retained PR's
title and body. It must not create, push, merge, ready, or otherwise change a
PR; write shipment evidence, completion markers, or outcome records; or infer
deterministic repository or external state.

## Fresh Verification

### 1. Fresh Verification

Before any provider receives FINISH work, the coordinator uses the engine's
configured aggregate verifier for current completion evidence. It reuses a
current passing result; when evidence is missing or stale, the verifier obtains
the required current result. A previous session's report, marker, or provider
response does not substitute for current repository and external evidence.
Only an `EXECUTED PASS` or `REUSED PASS` result satisfies this boundary.

When that verifier exits non-zero, the coordinator **STOP**s before any choice
or options and leaves `.pipeline/finish-choice` unwritten. It preserves the
evidence and routes an implementation failure to `/tdd` or `/pipeline`; it does
not dispatch FINISH or hand off to `/pr`.

## Operator Intent

Attended default and interactive foreground conduct asks the operator for `pr`,
`keep`, or `defer` before any publication observation or mutation. Only `pr`
and `keep` are eligible coordinator intents; `defer`, decline, or ambiguity
requires a human decision and performs no publication action.

Explicit `foreground-auto` and daemon modes use their engine policy. Do not
invent an alternative outcome.

## PR Prose Judgment

When the coordinator supplies a retained PR for judgment, make one bounded
title/body quality and repair pass:

- Accept prose that is specific, reader-oriented, and structurally complete.
- Identify a concrete title/body defect when prose is placeholder, halt text, or
  structurally incomplete.
- If the provider is unavailable or cannot make the judgment, report that
  bounded failure without changing publication state.

The engine seeds the SHIP-entry draft with the PR body template already in
place — `## Why`, `## What Changed`, `## Testing`, and the `Closes` reference —
with each section explicitly marked "not yet authored". That skeleton is the
structure the judgment expects to see filled in, not prose to accept: a body
still carrying those markers, or the engine's body-floor marker, is placeholder
by construction.

Accepted prose authorizes the coordinator to continue with its deterministic
transitions. It does not itself authorize any publication effect.

## Completion

FINISH completes only when the coordinator reports coherent, verified outcome
evidence. Publication-only failures stay at FINISH; implementation-invalid
evidence is routed by the conductor with its cited proof. Ambiguous or
operator-owned outcomes halt for human review.

## Worktree Retention Boundary

Daemon and automatic PR outcomes retain the feature worktree. Only the engine
mergeable sweep owns remote-default shipment cleanup, after the shipped-record
is proven on origin/default branch. FINISH does not delete a worktree.

## Verification

- [ ] Attended default and interactive foreground intent is explicit before
      publication activity.
- [ ] The provider judged and, when needed, repaired only the retained PR
      title/body, at most once per observed prose revision.
- [ ] No provider action created, pushed, merged, readied, or recorded
      publication state.
- [ ] The coordinator, rather than prompt compliance, determined the terminal
      completion or halt disposition.
