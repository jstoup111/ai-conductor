# ADR: An unresolvable containment check is a ConductorEvent on a hook-owned sibling ledger

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** Operator (single-telemetry-spine direction, standing; ratified during DECIDE for
intake jstoup111/ai-conductor#1390)
**Source:** intake `jstoup111/ai-conductor#1390`, desired outcome 4
**Related:** `adr-2026-08-09-non-blocking-plan-scope-containment`,
`adr-2026-08-08-pipeline-owned-closeout-timestamps`,
`adr-2026-07-10-intra-step-build-progress-events`

## Context

Intake #1390's fourth desired outcome: *"a containment check that cannot reach a verdict (tool
crash, unresolvable state) does not silently permit the commit — the ambiguity is visible in the
build record."*

Today it is not visible anywhere durable. `runScopeCheck` returns `1` for four distinct
conditions — no `Task:` trailer, task not `in_progress`, no declared `files[]`, and **any thrown
exception** (`scope-check-cli.ts:65-99`, verified 2026-08-09). The generated hook collapses all of
them into one branch:

```bash
if [[ "$rc" != "0" ]]; then
  echo "commit-msg: scope-check abstained (exit $rc); allowing commit" >&2
fi
```

The line goes to the committing process's stderr and is gone. This has already been observed in
practice — `test/integration/git-hooks-attribution.test.ts` output captured in the
`pipeline-commits-files-outside-the-active-plan-bef` kickback ledger shows `conduct-ts scope-check`
exiting 1 after printing a CLI usage banner, with the commit allowed and no record kept.

A crash and a legitimate "not applicable" are therefore indistinguishable, both to the hook and to
every later reader. A containment system whose failures are invisible cannot be trusted or tuned.

### Why this is not simply "fail closed"

The obvious remedy — refuse the commit when the check errors — is rejected. A crashed checker would
then block **every** commit in the build, converting a tool bug into a total build outage, and it
contradicts the operator direction in `adr-2026-08-09-non-blocking-plan-scope-containment` that
nothing at this boundary blocks. Visibility, not blocking, is the requirement.

### Event-spine procedure

Run per this repository's mandatory procedure (`.agents/skills/event-spine/SKILL.md`) **before**
the design was authored.

```
Concern 1 — the containment check could not reach a verdict at this commit
  Channel?    yes  — a durable trace where today only a swallowed stderr line exists
  Concern:    occurrence in time
  Verdict:    extend the ConductorEvent union + single-writer sibling ledger, same schema
  Exception:  A and B

Concern 2 — accepted scope widenings (path + rationale)
  Channel?    no   — the skill does not apply
  Concern:    durable state, read by name
  Verdict:    add nothing new; extend the existing git-derived harvest
  Exception:  C
```

**Exception A** — `conduct-ts scope-check` is a separate OS process spawned by git's `commit-msg`
hook. It has no `ConductorEventEmitter` and no engine in scope; there is nothing to emit onto.
This is the same ground on which `adr-2026-07-10-intra-step-build-progress-events` rejected
runner-push.

**Exception B** — appending from that process to `.pipeline/events.jsonl` would put two writers on
one file. `appendFileSync` is atomic only below `PIPE_BUF` (4096 bytes on Linux) and existing
records routinely exceed it, while `parseLedger` (`timing-rollup.ts:26-39`) returns `null` on **any**
single malformed line, degrading every rollup computed over that ledger. One writer per ledger file
is a correctness requirement here, not a preference.

**Concern 2 falls under exception C** — git commit messages are the durable record of a widening,
and `per-task-commit-floor.ts` already derives widenings from them deterministically at the
build-step boundary. Adding an event for the same fact would create a second source of truth for
state the repository already reads by name.

### Reconciliation with `adr-2026-08-08-pipeline-owned-closeout-timestamps`

That ADR is APPROVED and establishes exactly this pattern — a `conduct-ts` primitive appending
`ConductorEvent`s, in the existing union, to a pipeline-owned sibling ledger merged by `ts`.

**Its implementation has not landed.** Verified 2026-08-09: `grep -rn "pipeline-events.jsonl"`
over `src/` and `docs/` returns nothing on `main`, and the work sits in **PR #1395, OPEN and in
needs-remediation**. This feature therefore cannot write to `.pipeline/pipeline-events.jsonl` — it
does not exist — and must not take a dependency on an open, stuck PR.

This is not a workaround. Under that ADR's own sub-decision D2, one writer per ledger file, the git
hook process and the pipeline CLI are **different writers** and must not share an append target
regardless of landing order. A distinct hook-owned file is the correct shape under the established
rule, not a deviation from it.

## Options Considered

### Option A: Keep the stderr line, add nothing — REJECTED
- **Cons:** fails desired outcome 4 outright. The ambiguity remains invisible to the daemon log,
  the UI renderer, the OTel visualizer, and the event sinks.

### Option B: Stamp an ambiguity marker into an artifact the build already writes — REJECTED
For example a counter in `.pipeline/task-status.json` or a field on the kickback ledger.
- **Cons:** this is the §3 corollary of the event-spine skill in its purest form — a new telemetry
  channel wearing an existing file as a disguise, invisible to every bus consumer. The identical
  option was rejected for intake #1176.

### Option C: Append `ConductorEvent`s to the shared `.pipeline/events.jsonl` — REJECTED
- **Pros:** one file, no merge.
- **Cons:** two writers on one ledger; exception B's interleaving corruption, whose failure mode is
  a whole-ledger `parseLedger` null rather than one degraded record, and which is invisible until
  read.

### Option D: Wait for PR #1395 and write to `.pipeline/pipeline-events.jsonl` — REJECTED
- **Cons:** takes a hard dependency on an open PR in needs-remediation, of unknown landing date.
  And it would still be wrong on the merits: D2 of that ADR requires one writer per file, and the
  hook process is a different writer from the pipeline CLI.

### Option E: New `ConductorEvent` variant on a hook-owned sibling ledger — CHOSEN
`conduct-ts scope-check` appends to `.pipeline/hook-events.jsonl`, in the existing `ConductorEvent`
union. The engine tails and merges it by `ts` exactly as it will the pipeline's ledger.
- **Pros:** one union, one parser, one reader path — compliant by the schema-not-file test. Works
  with no engine present, which is required because the hook runs inside `git commit`. Single writer
  per file eliminates the corruption in Option C. Additive union members are backward-compatible
  because consumers read named fields.
- **Cons:** a third ledger file once #1395 lands, so readers merge three sources and must tolerate
  clock skew between writers (mitigated — all write `ts` from the same host clock). A malformed line
  still degrades the merged rollup, but blast radius is confined to hook-authored events.

## Decision

**Adopt Option E.** Three sub-decisions.

**E1 — A new `ConductorEvent` variant records the unresolvable check.** Added to the union in
`src/conductor/src/types/events.ts`, carrying at minimum the commit's task id where resolvable, the
failure classification, and `ts`. `runScopeCheck`'s exit codes split so the condition is
distinguishable at all: **0** = allowed, in-floor or not-applicable (silent); **0 with advisory
stderr** = out-of-floor, recorded per
`adr-2026-08-09-non-blocking-plan-scope-containment`; **3** = the check could not reach a verdict.
Exit **2** is left unused and reserved, so a future enforcement decision can adopt it without
re-numbering.

**E2 — One writer per ledger file.** The engine keeps `.pipeline/events.jsonl`; the git-hook process
owns `.pipeline/hook-events.jsonl`. Readers merge by `ts`. This mirrors
`adr-2026-08-08-pipeline-owned-closeout-timestamps` D2 and is chosen for the same reason.

**E3 — Writing is best-effort; reading is tolerant.** The appender must never throw into the hook:
a failure to record must not fail a commit, because the entire premise of
`adr-2026-08-09-non-blocking-plan-scope-containment` is that this boundary does not block. Readers
must tolerate an absent ledger and report the condition as unrecorded, because every existing
worktree predates the file. Tolerant in both directions — this is deliberately weaker than the
closeout ADR's gate-enforced emission, because there is no gate here to enforce it and inventing one
would reintroduce blocking.

## Consequences

**Positive**
- A crashed or unresolvable containment check becomes visible to every existing bus consumer
  instead of scrolling past in one process's stderr.
- Not-applicable stops masquerading as failure, so the signal is usable for tuning the floor.
- The hook keeps its non-blocking contract; a tool bug degrades observability, never the build.

**Negative / accepted**
- A third ledger file after #1395 lands. Accepted: it is the direct consequence of the
  one-writer-per-file correctness rule, and the merge is by `ts` over one union.
- Best-effort writing means a recorded ambiguity can itself be lost (disk full, permissions). This
  is the correct trade against failing a commit, and the loss is bounded to telemetry.
- Exit code 3 is a new contract between the CLI and the generated hook. Both are engine-owned and
  change together; consumers on an older hook see exit 3 fall into the existing non-0/non-2 branch
  and behave exactly as today — degraded, never broken.

## Related

- `adr-2026-08-09-non-blocking-plan-scope-containment` — the floor, the rationale resolution, and
  the never-refuse contract.
- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — the sibling-ledger pattern this follows;
  implementation pending in PR #1395.
- `adr-2026-07-10-intra-step-build-progress-events` — the original rejection of runner-push that
  establishes exception A.
