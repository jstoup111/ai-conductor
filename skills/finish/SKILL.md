---
name: finish
disable-model-invocation: true
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

An author pass may inspect and repair only the retained PR's title and body,
and changes prose only by writing the returned prose handoff. A judgment pass may inspect
that same retained title and body, but returns only its bounded verdict.
It must not create, push, merge, ready, or otherwise change a PR; write shipment
evidence, completion markers, or outcome records; or infer deterministic
repository or external state.

Reading the feature's own diff, specification, plan, and story artifacts to
write that title and body is inside this boundary, not outside it — authoring
reader-facing prose is exactly the work FINISH keeps for a provider. Only
publication *mechanics* are the coordinator's.

## Fresh Verification

### 1. Fresh Verification

The FINISH provider session never runs tests or launches full-suite or aggregate verification.
It consumes the coordinator's evidence; missing or stale suite proof belongs to `test_suite`.

Before FINISH is dispatched, the coordinator obtains current proof from the
configured aggregate verifier: a `REUSED` or `EXECUTED` pass are equally valid. When it exits non-zero, the coordinator
**STOP**s before any choice or options, leaves `.pipeline/finish-choice` unwritten, and routes the
failure to `/tdd` or `/pipeline`.

## Operator Intent

Attended default and interactive foreground conduct asks the operator for `pr`,
`keep`, or `defer` before any publication observation or mutation. Only `pr`
and `keep` are eligible coordinator intents; `defer`, decline, or ambiguity
requires a human decision and performs no publication action.

Explicit `foreground-auto` and daemon modes use their engine policy. Do not
invent an alternative outcome.

## PR Prose Authoring

The engine seeds the SHIP-entry draft with the PR body template already
present — `## Why`, `## What Changed`, `## Testing`, and the `Closes` reference —
with each section explicitly marked "not yet authored", plus its own body-floor
marker. A body still carrying those markers is **unauthored by construction**,
and the coordinator detects that deterministically rather than asking anyone to
judge it.

When the coordinator dispatches `author_pr_prose`, write the prose handoff.
Read the full diff of the feature branch against its base branch together with
the feature's specification, plan, and story artifacts, then write `.pipeline/finish-pr-prose.json` with `version`, `title`, and `body` following
the `/pr` authoring contract (Claude Code invokes that skill as `/pr`; Codex
invokes it as `$pr`). Keep the template section shape, replace every "not yet
authored" marker and the body-floor marker with specific reader-facing content,
and preserve every `ai-conductor:step` region and its markers unchanged. The engine validates the handoff and performs the PR title and body write.

Never return a verdict instead of prose here, and never report that the body
cannot be authored because the diff was not supplied — obtaining the diff is
part of this pass. The coordinator re-reads the pull request afterwards; a body
that still carries the placeholder classification is a failed authoring pass,
not an accepted one, and no self-report substitutes for that observation.

## PR Prose Judgment

When the coordinator supplies a retained PR for judgment, inspect the retained
title/body and return one bounded quality verdict:

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
- `{"kind":"timed_out"}` when the bounded judgment could not complete before its deadline.
- `{"kind":"provider_unavailable"}` when no provider is available to make the bounded judgment.
- `{"kind":"refused","detail":"optional concrete blocker"}` when the provider cannot make
  the bounded judgment.

Every `revision_required` verdict is a deficient-prose objection: it routes the
retained PR to a separate authoring pass, then a fresh bounded judgment pass.
It should include a concrete `detail` naming what is deficient so that authoring
can address the objection. `detail` is optional on `revision_required` and `refused`; when
supplied, it must be a non-blank string. The coordinator owns all routing and publication
transitions.

Accepted prose authorizes the coordinator to continue with its deterministic
transitions. It does not itself authorize any publication effect.

## Worktree Retention Boundary

Daemon and automatic PR outcomes retain the feature worktree. Only the engine
mergeable sweep owns remote-default shipment cleanup, after the shipped-record
is proven on origin/default branch. FINISH does not delete a worktree.

## Verification

- [ ] Attended default and interactive foreground intent is explicit before
      publication activity.
- [ ] No provider action created, pushed, merged, readied, or recorded
      publication state.
