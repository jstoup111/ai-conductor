# ADR: Two example modes — headless self-asserting vs guided launcher

Status: APPROVED
Date: 2026-07-22
Feature: flow-examples (#786)

## Context

The five flows split on whether they can run without a live Claude REPL:

- **Headless-capable:** `inline --auto`, `daemon` (drain), `intake-loop --once`, and the
  engineer *primitives* (`worktree` → `land` → `handoff`) all run to a defined checkpoint
  with no interactive session.
- **Interactive-only:** `inline --interactive` and the full `engineer` loop spawn a real
  `claude` REPL (`engineer-cli.ts:390-396`) and cannot self-assert a result.

> **Amended 2026-08-26 by #1436:** `inline --auto` is no longer headless-capable — it was
> deprecated by #1509 (the flag now rejects and exits 1) and its example is retired by
> #1436. The daemon is the sole unattended flow; the headless-capable set is `daemon`
> (drain), `intake-loop --once`, and the engineer primitives. The headless self-asserting
> shape (`PASS/FAIL <flow>/<tier>`) is unchanged for the surviving examples.

A single script shape cannot serve both: one needs to assert an exit signal, the other
needs to hand the terminal to a human.

## Decision

Provide two example modes, chosen per flow:

1. **Headless self-asserting** — `inline.sh`, `daemon.sh`, `engineer.sh`, `intake-loop.sh`.
   The script resolves the tier prompt, runs the flow to completion, then asserts the
   flow's checkpoint artifact exists and prints:
   - `PASS <flow>/<tier>` and exits 0, or
   - `FAIL <flow>/<tier>: <captured reason>` and exits non-zero.

2. **Guided launcher** — `interactive.sh` (and `engineer.sh --interactive`). The script
   runs `sandbox_up`, prints the completion checkpoint the operator should watch for, then
   `exec`s the real interactive command with stdio inherited. It is explicitly *not*
   self-asserting; a human drives the REPL and observes the checkpoint.

Prompts are `.md` files. A tier passed as `$1` selects `prompts/<tier>.md`; with no arg on
a TTY the script prompts `Which prompt? [s/m/l]`; with no arg and no TTY it errors with
usage (never silently defaults).

## Consequences

- Headless examples double as the seed fixtures the eval (#807) will drive for
  per-combination pass/fail — the eval can invoke the same scripts and read their exit code.
- Interactive examples remain runnable and instructive without pretending to self-verify —
  no false green from a flow that actually needs a human.
- `engineer.sh` carries both modes: default headless over the deterministic primitives
  (seeded `.docs/` fixtures → land → handoff), and `--interactive` as a guided full-loop
  launch.

## Alternatives considered

- **Only headless examples, skip interactive flows** — rejected: the issue enumerates every
  flow; dropping the two interactive ones leaves the set incomplete.
- **Drive interactive flows with `claude -p` under the hood** — rejected for the examples
  layer: that is the scripted-provider concern of the eval (#807), not a human-facing demo.
