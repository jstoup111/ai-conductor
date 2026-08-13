---
name: finish
description: "Use at the FINISH boundary to gather an operator's publication intent, author the retained PR's reader-facing prose when it is still unauthored, and judge that prose; the engine-owned publication coordinator performs all deterministic publication mechanics."
enforcement: gating
phase: ship
standalone: true
requires: []
---

## Purpose

FINISH keeps human authority over interactive publication choices, authors the
retained pull request's reader-facing title and body when the coordinator
observes them as still unauthored, and retains one reader-facing quality
judgment for that title and body. The engine-owned publication coordinator
observes evidence, selects which of those two passes is required, advances
deterministic publication transitions, and records completion.

## Responsibility Boundary

The coordinator, not this skill, owns every mechanical action: verifying SHIP
and publication evidence, creating or reusing a PR identity, pushing commits,
creating durable shipment evidence, marking a PR ready, and recording the
final outcome.

For `author_pr_prose` and `judge_pr_prose` alike, this skill may
inspect and repair only the retained PR's title and body.
It must not create, push, merge, ready, or otherwise change a PR; write shipment
evidence, completion markers, or outcome records; or infer deterministic
repository or external state.

Reading the feature's own diff, specification, plan, and story artifacts to
write that title and body is inside this boundary, not outside it — authoring
reader-facing prose is exactly the work FINISH keeps for a provider. Only
publication *mechanics* are the coordinator's.

## Fresh Verification

### 1. Fresh Verification

Before any provider receives FINISH work, the coordinator uses the engine's
configured aggregate verifier for current completion evidence. It reuses a
current passing result; when evidence is missing or stale, the verifier obtains
the required current result. A previous session's report, marker, or provider
response does not substitute for current repository and external evidence.

Both passing verdicts are equally acceptable proof: `REUSED` for a current
passing result the verifier reused, and `EXECUTED` for one it obtained during
this pass. The coordinator never requires `EXECUTED` when `REUSED` is available
— re-running a suite that is already current buys no evidence and costs the
whole suite's runtime.

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

## PR Prose Authoring

The engine seeds the SHIP-entry draft with the PR body template already in
place — `## Why`, `## What Changed`, `## Testing`, and the `Closes` reference —
with each section explicitly marked "not yet authored", plus its own body-floor
marker. A body still carrying those markers is **unauthored by construction**,
and the coordinator detects that deterministically rather than asking anyone to
judge it.

When the coordinator dispatches `author_pr_prose`, write the prose. Read the
full diff of the feature branch against its base branch together with the
feature's specification, plan, and story artifacts, then rewrite the retained
PR's title and body in place following the `/pr` authoring contract (Claude Code
invokes that skill as `/pr`; Codex invokes it as `$pr`). Keep the template
section shape, replace every "not yet authored" marker and the body-floor marker
with specific reader-facing content, and preserve release metadata already
present.

Never return a verdict instead of prose here, and never report that the body
cannot be authored because the diff was not supplied — obtaining the diff is
part of this pass. The coordinator re-reads the pull request afterwards; a body
that still carries the placeholder classification is a failed authoring pass,
not an accepted one, and no self-report substitutes for that observation.

## PR Prose Judgment

When the coordinator supplies a retained PR for judgment, make one bounded
title/body quality and repair pass:

- Accept prose that is specific, reader-oriented, and structurally complete.
- Identify a concrete title/body defect when prose is placeholder, halt text, or
  structurally incomplete.
- If the provider is unavailable or cannot make the judgment, report that
  bounded failure without changing publication state.

An unauthored body never reaches this pass — it is routed to `author_pr_prose`
first. If one somehow arrives here, report `revision_required` with reason
`placeholder` and stop: the coordinator owns the authoring pass, so this pass is
never the place to write missing prose.

### Verdict Contract

For the bounded PR-prose judgment, return exactly one JSON object and no
unstructured substitute. The provider-facing verdict vocabulary is:

- `{"kind":"accepted"}` when the retained title and body are acceptable.
- `{"kind":"revision_required","reason":"placeholder","detail":"optional concrete observation"}`
  when the retained prose is placeholder text.
- `{"kind":"revision_required","reason":"halt","detail":"optional concrete observation"}`
  when the retained prose contains halt text.
- `{"kind":"revision_required","reason":"structurally_incomplete","detail":"optional concrete observation"}`
  when the retained prose is missing required reader-facing structure.
- `{"kind":"refused","detail":"optional concrete blocker"}` when the provider cannot make
  the bounded judgment.

`detail` is optional for `revision_required` and `refused`. When supplied, it
must be a non-blank string describing the concrete observation or blocker. The
coordinator trims it and bounds it to 1,000 characters; overlong detail is
truncated with a visible marker. The coordinator, not the provider, owns all
routing and publication transitions.

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
- [ ] An unauthored PR body was authored from the feature's own diff before any
      prose judgment was requested.
- [ ] The provider judged and, when needed, repaired only the retained PR
      title/body, at most once per observed prose revision.
- [ ] No provider action created, pushed, merged, readied, or recorded
      publication state.
- [ ] The coordinator, rather than prompt compliance, determined the terminal
      completion or halt disposition.
