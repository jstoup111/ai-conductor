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
creating durable shipment evidence, applying PR presentation repair, marking a
PR ready, and recording the final outcome.

This skill must not create, edit, push, merge, discard, or ready a pull request.
It must not write shipment evidence, completion markers, or outcome records.
It never asks a provider to infer deterministic repository or external state.

## Fresh Verification

The coordinator requires fresh verification evidence before it records a
completion outcome. A previous session's report, marker, or provider response
does not substitute for current repository and external evidence.

## Interactive Intent

In interactive conduct, ask the operator for an explicit publication intent.
Only `pr` and `keep` are eligible for the coordinator. A deferred, declined,
ambiguous, merge, or discard choice requires a human decision and must not cause
any mechanical publication action.

In foreground automatic and daemon conduct, intent comes from the configured
mode policy. Do not invent an alternative outcome. In particular, unattended
operation never merges or discards work.

For compatibility with the interactive lifecycle, the available operator
choices remain:

**Option 1: Merge locally**

**Option 2: Push & PR**

**Option 3: Keep as-is**

**Option 4: Discard**

## PR Prose Judgment

When the coordinator supplies a PR for judgment, inspect only its title and
body. Make one bounded quality pass:

- Accept prose that is specific, reader-oriented, and structurally complete.
- Identify a concrete title/body defect when prose is placeholder, halt text, or
  structurally incomplete.
- If the provider is unavailable or cannot make the judgment, report that
  bounded failure without changing publication state.

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
is proven on origin/default branch. The coordinator does not delete a worktree.
Only the engine mergeable sweep owns remote-default shipment cleanup.

After Option 1's local merge completes successfully, delegate cleanup to worktree-manager.
Pass worktree-manager the proof case and evidence for Option 1: completed local merge, shipped record on the local default branch, and recorded `merge-local` outcome.

After Option 4's discard is explicitly confirmed, delegate cleanup to worktree-manager.
Pass worktree-manager the proof case and evidence for Option 4: explicitly confirmed discard and recorded `discard` outcome.

Claude Code only: delegate worktree-manager cleanup through the Agent tool with model="haiku".
Other supported hosts delegate worktree-manager cleanup through their provider-native subagent facility and configured provider policy.

## Verification

- [ ] Interactive intent is explicit when human authority is required.
- [ ] The provider judged only PR title/body prose, at most once per observed
      prose revision.
- [ ] No provider action created, pushed, merged, discarded, readied, or
      recorded publication state.
- [ ] The coordinator, rather than prompt compliance, determined the terminal
      completion or halt disposition.
