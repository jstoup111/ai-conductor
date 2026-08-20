# ADR: Stable per-finding build_review dispositions are typed, transactional operator state

**Date:** 2026-08-13
**Status:** APPROVED
**Approved:** Operator-approved 2026-08-13
**Deciders:** James Stoup (operator) and architecture review for issue #1542
**Depends on:** `adr-2026-08-13-engine-managed-build-review-rubric-branches`
**Reuses:** `adr-2026-07-01-machine-scoped-operator-identity`,
`adr-2026-08-09-operator-only-scoped-artifact-reseal`,
`adr-2026-08-08-pipeline-owned-closeout-timestamps`, and
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`

## Context

A current `build_review` finding is free-form prose nested under a rubric. A later grader can report
the same concern with different wording, so hashing the sentence does not identify the concern.
Conversely, accepting every later finding under a rubric or file would suppress materially different
problems. The system needs a stable identity narrower than a rubric waiver and less brittle than a
text hash.

The disposition is a human risk decision, not grader judgement. It must be feature-scoped, survive
review laps and daemon re-dispatch, reject stale concurrent actions, carry operator attribution and
rationale, remain unavailable to autonomous provider subprocesses, and reach PR/shipped evidence.

The event-spine check distinguishes two concerns:

- accepted dispositions and the current raw verdict are durable state — exception C; and
- attempts, acceptances, refusals, rubric outcomes, and effective verdicts are occurrences carried
  by `ConductorEvent`.

The standalone operator command is a separate process and cannot safely append to the engine-owned
ledger. The already-approved `.pipeline/pipeline-events.jsonl` same-schema sibling pattern exists
for exactly this boundary, so no operator-specific event file or bespoke audit schema is warranted.

## Options Considered

### Option A: Accept a whole rubric, path, or future class of findings

- **Pros:** Simple state and matching; easy operator command.
- **Cons:** Acknowledges unknown future risk, violates individual-finding scope, and hides new
  defects under the accepted umbrella.

### Option B: Hash normalized finding prose

- **Pros:** Fully mechanical; no new structured result contract.
- **Cons:** Wording drift produces a new ID; aggressive normalization risks collapsing materially
  different concerns; cannot satisfy both persistence and narrowness.

### Option C: Versioned typed identity plus a guarded operator transaction

- **Pros:** Wording and line-number drift do not matter; the engine validates and hashes explicit
  semantic fields; collisions and stale laps fail closed; state and occurrences stay on their
  correct architecture paths.
- **Cons:** Every rubric needs a carefully designed identity schema; changing identity semantics
  intentionally invalidates old matches; concurrent state needs a lock and atomic writer.

## Decision

Choose **Option C**.

### 1. Separate semantic identity from presentation evidence

Every rubric skill emits each finding as a typed payload containing:

- the closed rubric ID and rubric contract version;
- an enumerated concern kind owned by that rubric contract;
- typed logical anchors that identify the subject and failed obligation;
- a human-readable actionable summary; and
- concrete evidence locations for inspection.

The engine validates anchor grammar and referential claims available from the immutable snapshot,
canonicalizes the identity fields, and derives `FindingId` from the rubric ID, contract version,
concern kind, and sorted logical anchors. Summary wording and line numbers are deliberately excluded.
The full canonical payload is stored beside the hash and compared on lookup, so a theoretical hash
collision never authorizes acceptance.

Identity contracts are rubric-specific rather than one free-form `key`:

- Tautology anchors the changed test, exercised behavior/assertion, and violation kind.
- Scope anchors the out-of-plan path or surface and its plan-scope relation.
- Root Cause anchors the stated defect/outcome and the implementation mechanism or locus judged
  symptomatic.
- Completeness anchors the approved plan outcome/task and the missing deliverable.
- Wiring anchors the production surface, expected entry point, and missing reachability relation.

Within one lap, two different findings that canonicalize to the same identity are a malformed branch
result and block as infrastructure failure. A contract version changes only when identity semantics
change; that change intentionally prevents an old disposition from silently matching the new
meaning. Pure wording changes retain the version and identity.

The LLM judges what concern and anchors apply as part of rubric evaluation. Everything after that
judgement — schema validation, canonicalization, ID creation, collision handling, and matching — is
deterministic.

### 2. Keep accepted risk in a feature-scoped durable store

Store dispositions in `.pipeline/build-review-dispositions.json`, versioned and scoped to the
canonical repository plus feature identity. Each accepted record carries the full identity payload,
finding ID, rubric, summary at acceptance, exact source lap, rationale, machine-resolved operator,
and acceptance time.

The store is never included in grader input. The raw aggregate remains an independent judgement;
the completion predicate and failure-detail renderer read the store afterward and suppress only the
matching finding's blocking effect. New, unmatched, malformed, legacy, and infrastructure findings
remain blocking.

### 3. Serialize the coordinator and CLI through one state transaction

All reads and writes that join current findings with dispositions use one feature-local
build-review state lock. The lock uses exclusive creation with bounded stale-owner reclamation;
state writes use a same-directory temporary file and atomic rename. Lock timeout or unreadable state
fails closed without changing a gate verdict.

The aggregate verdict and disposition store remain separate because existing stale-verdict recovery
may remove or replace `.pipeline/build-review.json`; accepted risk must survive that operation. The
lock prevents a join from replacing the inspected lap while an acceptance is validated. A crash
after a disposition write but before a later gate recomputation leaves the gate blocking, never
falsely passing; the next recomputation applies the durable disposition.

### 4. Expose two pre-boot, local CLI operations

Wire a `build-review` command family before pipeline startup:

- `findings` resolves a named feature worktree and prints the current lap, raw findings, accepted
  matches, unresolved findings, skips, and infrastructure failures.
- `accept` requires the feature, exact inspected lap ID, one current unresolved finding ID, and a
  non-empty rationale.

`accept` requires an interactive TTY and resolves machine-scoped operator identity through the
existing user-config then `gh` chain. Unresolved identity refuses. Provider sessions use piped stdin,
so maker, remediation, grader, and daemon-spawned agent subprocesses cannot pass the TTY gate. The
threat boundary is unattended harness activity, not a malicious local account capable of creating a
pseudo-terminal.

Under the state lock, `accept` refuses missing rationale, feature mismatch, stale lap, unknown or
already accepted finding, disabled/skipped rubric, and infrastructure failures. Every refusal leaves
the disposition store unchanged. One action accepts exactly one finding; there is no rubric-wide,
feature-wide, or future-finding wildcard.

Acceptance during an active kickback loop is visible to the next deterministic gate recomputation,
so the feature can converge without parking or waiting for the cumulative cap. This decision does
not make the command a general HALT clearer; existing halted-feature recovery remains authoritative.

### 5. Reuse the external-process event ledger and one reader contract

Generalize the existing external event writer for any allowlisted `ConductorEvent`, retaining
`.pipeline/pipeline-events.jsonl`. Serialize external writers so an operator command cannot interleave
with pipeline closeout emission. Generalize the tail from closeout-only to allowlisted external
events, and expose one feature-event reader that merges the engine and external ledgers by timestamp.

Disposition accepted/refused events are written even when no conductor process is active. When a
feature process is active, its tail re-emits new external records onto the live bus without
re-persisting them into the engine ledger. Standard report/KPI/dashboard readers use the merged
reader. No occurrence is reconstructed from disposition file timestamps.

### 6. Project authoritative state into publication

The finish publication coordinator reads the disposition store and uses one deterministic renderer
to upsert an accepted-risk section into the retained implementation PR. The shipped-record writer
uses the same renderer/data contract. Each entry includes finding ID, rubric, summary at acceptance,
rationale, operator, and acceptance time. Missing or unreadable disposition state cannot fabricate
accepted risk; a known accepted record that cannot be rendered blocks completion rather than silently
disappearing.

## Event-Spine Verdict

```text
Event spine
  Channel?    yes — disposition attempts/outcomes and effective verdicts are occurrences
  Concern:    occurrence for events; durable state for accepted decisions and current findings
  Verdict:    extend ConductorEvent; reuse pipeline-events.jsonl and the merged reader
  Exception:  A + B for the standalone CLI writer; C for verdict and disposition state
```

## Claim Verification

| Claim | Confidence | Basis |
|---|---:|---|
| Current free-form findings have no stable identity | 100% | Verified in the build-review verdict type, validator, prompt, and live issue evidence |
| A TTY gate prevents current autonomous provider subprocesses from invoking an operator-only command | 99% | Verified in both provider stdio paths and the approved/implemented reseal precedent |
| Machine-scoped identity already resolves user config before `gh` and fails closed where required | 100% | Approved identity ADR and current identity module |
| The existing external-process ledger already uses `ConductorEvent` and is merged by timestamp in one reporting path | 100% | Verified in `closeout-events.ts` and `build-tail-rollup.ts` |
| Generalizing all standard readers to one two-ledger helper is feasible without a data migration | 97% | Readers consume JSONL named fields; legacy absence of the external ledger already has a tolerant precedent |
| Typed rubric anchors can remain stable across prose changes while materially different structured identities remain blocking | 95% | Deterministic canonical payload design; operator approved the typed-anchor architecture; fail-closed collision/version rules cover ambiguity |

Operator-approved assumptions: individual CLI-only acceptance, rationale and attribution, exact-lap
binding, cross-lap persistence, stable identity independent of wording, no remote command input, and
PR/shipped visibility. No unconfirmed load-bearing assumption remains.

## Consequences

### Positive

- Operators accept one known risk without weakening the rubric or future findings.
- Stale-lap races and concurrent join/accept writes are mechanically refused.
- Raw grader quality, effective gate status, and accepted risk remain separately observable.
- State survives later laps and re-dispatch while remaining local to one feature.
- Event and publication consumers receive one schema and one authoritative state source.

### Negative

- Stable identity quality depends on five explicit rubric schemas and their version discipline.
- The shared external event writer and readers become a wider integration surface.
- TTY-gated acceptance intentionally excludes non-interactive operator automation.
- A halted feature still uses the existing explicit halt-recovery operation after disposition; the
  new command does not become a broad daemon lifecycle control.

### Follow-up Actions

- [ ] Define semantic finding types, rubric-specific anchor schemas, validators, and collision tests.
- [ ] Add the versioned disposition store, exclusive state lock, and atomic writer.
- [ ] Add findings/accept CLI parsing, worktree resolution, TTY guard, and machine identity.
- [ ] Generalize the external event writer/tail and merged feature-event reader.
- [ ] Add disposition/effective-verdict event rendering and report/KPI metrics.
- [ ] Add deterministic PR/shipped accepted-risk projection.
- [ ] Document CLI, configuration, rubric skills, gate semantics, recovery, and publication evidence.
