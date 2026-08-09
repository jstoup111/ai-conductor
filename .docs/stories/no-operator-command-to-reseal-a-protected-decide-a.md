**Status:** Accepted

# Stories: Operator-audited reseal of a protected DECIDE artifact (#1281)

**Track:** technical — no PRD exists, so these stories are the acceptance-criteria artifact.
Requirements cite the approved ADR sections they derive from rather than `FR-N`.

**Source:** jstoup111/ai-conductor#1281
**Governing decisions:** `adr-2026-08-09-operator-only-scoped-artifact-reseal` (APPROVED),
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` (APPROVED),
`architecture-review-2026-08-09-no-operator-command-to-reseal-a-protected-decide-a`
(APPROVED WITH CONDITIONS).

Documentation updates (the runbook recovery recipe and the CLI reference) accompany this functional
work and are tracked as Condition 5 of the architecture review; per the stories documentation
boundary they carry no story of their own.

---

## Story 1: The shared seal writer is extracted without changing rotation behavior

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §1

As a harness maintainer, I want the seal-file writing logic to exist in exactly one place so that
the automatic rotation path and the new operator reseal path can never diverge in how they persist
a seal.

### Acceptance Criteria

#### Happy Path
- Given a seal at baseline commit `A` and a workspace at commit `B` on rewritten history, when the
  existing automatic rotation runs, then the seal file it produces is byte-identical to the one
  produced before the extraction, including the appended `rebaselines` entry's `fromCommit`,
  `toCommit`, `trigger`, and `paths`.
- Given a rotation is permitted, when the shared writer persists the seal, then the file is written
  to a temporary path and atomically renamed into place, and the temporary path no longer exists
  afterward.
- Given a rotation is permitted and a rebaseline observer is supplied, when the shared writer
  completes, then the observer receives exactly one `protected_artifact_rebaseline` notification
  carrying the same `fromCommit`, `toCommit`, and `paths` recorded in the file.

#### Negative Paths
- Given the temporary-file write fails, when the shared writer runs, then the original seal file is
  left unmodified, the error propagates to the caller, and no rebaseline observer notification is
  sent.
- Given the atomic rename fails after a successful temporary write, when the shared writer runs,
  then the original seal file is left unmodified and the temporary file is removed rather than
  left behind as an orphan.
- Given the rebaseline observer itself throws, when the shared writer notifies it, then the seal
  file write still stands and the error does not propagate — telemetry never alters persistence
  policy.
- Given two processes attempt to persist a seal for the same worktree concurrently, when both
  complete, then the seal file contains one complete, parseable JSON document — never interleaved
  or truncated content.

### Done When
- [ ] A test asserting the pre-extraction behavior of the automatic rotation path exists, passes
      before the extraction, and still passes after it.
- [ ] Exactly one code path in `protected-artifact-seal.ts` performs the temporary-write, rename,
      `rebaselines` append, and observer notification; the rotation entry point delegates to it.
- [ ] The rotation entry point's exported signature and return value are unchanged.
- [ ] A failed write or rename leaves no `.tmp` file in `.pipeline/`, verified by test.

---

## Story 2: A scoped reseal re-fingerprints only the enumerated paths

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §1, §3

As an operator recovering a stranded feature, I want a reseal to update only the artifacts I name
so that no other artifact's sealed value is silently replaced.

### Acceptance Criteria

#### Happy Path
- Given a seal containing entries for paths `P1`, `P2`, and `P3`, and `P1` has been corrected and
  committed, when a reseal is requested naming only `P1`, then `P1`'s fingerprint equals the
  fingerprint of its content at the reseal commit, and `P2` and `P3` retain their previous sealed
  fingerprints byte-for-byte.
- Given a scoped reseal succeeds, when the resulting seal is read, then its entry set is exactly
  the entry set it had before — no path added, none removed.
- Given a scoped reseal succeeds, when the resulting seal is read, then `baselineCommit` equals the
  reseal commit, and a `rebaselines` entry records the prior baseline as `fromCommit`, the reseal
  commit as `toCommit`, and exactly the enumerated paths.
- Given a seal whose `baselineCommit` has advanced through a reseal, when the next BUILD entry
  verifies the workspace, then verification passes for every entry — the advanced baseline is
  consistent with every fingerprint the seal holds.

#### Negative Paths
- Given a reseal names a path that is absent from the seal's entry set, when the reseal is
  requested, then it is refused naming that path, the seal file is unmodified, and the process
  exits non-zero.
- Given a reseal names a path that is not under a protected artifact directory, when the reseal is
  requested, then it is refused naming that path and the seal file is unmodified.
- Given a named path has uncommitted modifications in the working tree, when the reseal is
  requested, then it is refused with a message directing the operator to commit first, and the seal
  file is unmodified.
- Given a named path has been deleted from the working tree, when the reseal is requested, then it
  is refused rather than silently removing the entry from the seal.
- Given the reseal commit cannot be resolved by git, when the reseal is requested, then it is
  refused naming the unresolvable commit and the seal file is unmodified.
- Given no `--path` is supplied at all, when the reseal is requested, then it is refused — there is
  no implicit "reseal everything" form.

### Done When
- [ ] A scoped reseal over a multi-entry seal leaves every unnamed entry's fingerprint byte-identical,
      verified by test.
- [ ] The resulting seal's entry-set cardinality and key set are unchanged, verified by test.
- [ ] `baselineCommit` equals the reseal commit and the `rebaselines` entry lists exactly the
      enumerated paths, verified by test.
- [ ] Each refusal above exits non-zero with the offending path named in the message, and leaves the
      seal file's bytes unchanged, verified by test.

---

## Story 3: Drift outside the enumerated paths refuses the whole reseal

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §2

As a harness maintainer, I want a reseal to refuse outright when an artifact I did not name has
also drifted so that an audited recovery can never launder a genuine violation.

### Acceptance Criteria

#### Happy Path
- Given a seal where only the enumerated path differs from its sealed value, when a reseal is
  requested, then it proceeds.
- Given an unnamed protected artifact differs from its sealed value but the existing verification
  logic classifies that difference as base-inherited, when a reseal is requested, then it proceeds —
  the guard tolerates exactly what verification already tolerates.
- Given an unnamed protected artifact appeared under the feature's feet via a rebase and
  verification classifies it as base-inherited, when a reseal is requested, then it proceeds.

> **Amended 2026-08-09 by #1281:** the happy path also covers own-feature **self-amendment**. Where
> verification classifies an unnamed protected artifact's difference as a tolerated self-amendment
> rather than a violation (`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`), the
> reseal proceeds and that artifact's sealed entry is left untouched — nothing is laundered, because
> its fingerprint is not rewritten. Added because Story 3's Done When requires reusing the existing
> classification routine, and that routine returns tolerated self-amendments on a *success* verdict;
> leaving the case unstated would have forced an implementer to guess. See
> `.docs/conflicts/no-operator-command-to-reseal-a-protected-decide-a.md`.

#### Negative Paths
- Given an unnamed protected artifact has a feature-authored committed change that verification
  classifies as a violation, when a reseal is requested, then the entire reseal is refused, the
  message names that artifact, the seal file is unmodified, and no enumerated path is resealed
  either — the refusal is all-or-nothing.
- Given two unnamed protected artifacts have drifted, when a reseal is requested, then the refusal
  names the offending artifact rather than failing with an unattributed error.
- Given an unnamed protected artifact has been deleted, when a reseal is requested, then the reseal
  is refused naming it.
- Given a new protected artifact exists in the workspace that the seal has no entry for and
  verification does not classify it as base-inherited, when a reseal is requested, then the reseal
  is refused naming it.
- Given the base ref needed to classify inheritance cannot be resolved, when a reseal is requested,
  then it is refused as undeterminable rather than defaulting to either tolerate or violate.

### Done When
- [ ] The guard's drift determination is produced by the same classification routine that BUILD-time
      verification uses; no second, independent fingerprint-comparison implementation exists in the
      codebase, verified by inspection and by a test that a base-inherited difference is tolerated
      identically on both paths.
- [ ] A refused reseal leaves the seal file byte-identical, verified by test.
- [ ] The refusal message contains the offending path, verified by test.
- [ ] An undeterminable-provenance case refuses rather than proceeding, verified by test.

---

## Story 4: `conduct reseal` exists as a documented command requiring a rationale

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §4

As an operator, I want reseal to be a first-class command with a mandatory stated reason so that
recovery is one auditable invocation instead of hand-edited JSON.

### Acceptance Criteria

#### Happy Path
- Given a halted feature whose corrected artifact is committed, when the operator runs the reseal
  command with a slug, one or more paths, and a non-empty reason, then the command exits zero and
  reports which paths were resealed.
- Given the command is invoked, when `--help` is requested for the CLI, then the reseal command and
  its flags are listed alongside the other subcommands.
- Given a slug, when the command runs, then it resolves that feature's worktree and operates on
  that worktree's seal — never the primary checkout's.

#### Negative Paths
- Given `--reason` is omitted, when the command is invoked, then it is refused and nothing is
  written.
- Given `--reason` is supplied as an empty or whitespace-only string, when the command is invoked,
  then it is refused and nothing is written.
- Given a flag is supplied twice with conflicting values, when the command is invoked, then it is
  refused rather than silently taking one.
- Given an unknown flag is supplied, when the command is invoked, then it is refused rather than
  ignored.
- Given a slug containing a path separator or a relative-path segment, when the command is invoked,
  then it is refused — the slug must not escape the worktree base.
- Given a slug with no corresponding worktree, when the command is invoked, then it is refused
  naming the slug, and no directory is created.
- Given the resolved worktree has no seal file, when the command is invoked, then it is refused
  stating no seal exists rather than creating one.

### Done When
- [ ] Argument detection is a pure parse with no I/O, returning null for every malformed form above,
      verified by unit test.
- [ ] The command is declared in the CLI command table and appears in `--help` output.
- [ ] The operator's reason is recorded verbatim in the seal's `rebaselines` entry, verified by test.
- [ ] Every refusal above exits non-zero and writes nothing, verified by test.

---

## Story 5: Reseal is reachable only by an operator, never by a pipeline step

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §4; architecture review
Condition 1

As a harness maintainer, I want reseal to be mechanically unreachable from inside a build so that
an agent cannot launder its own protected-artifact violation.

### Acceptance Criteria

#### Happy Path
- Given an operator at an interactive terminal, when they invoke reseal with valid arguments, then
  it proceeds.
- Given the command is dispatched, when it runs, then it resolves and exits without booting the
  pipeline.
- Given the harness's step registry is enumerated, when it is searched for a reseal step, then none
  exists — no step name maps to this behavior.

#### Negative Paths
- Given stdin is not an interactive terminal, when reseal is invoked with otherwise-valid arguments,
  then it is refused, nothing is written, and the message states that reseal is an operator action.
- Given a build agent invokes reseal from within a step's subprocess, when the command runs, then it
  is refused for the same reason and the seal is unmodified.
- Given the daemon attempts to dispatch reseal as a step, when the step name is resolved, then no
  step exists to dispatch.
- Given an environment variable or argument purporting to bypass the interactive check, when reseal
  is invoked, then the check is not bypassed — no override flag exists.

### Done When
- [ ] Interactivity is determined through an injectable seam so tests can drive both branches without
      a real terminal.
- [ ] A non-interactive invocation exits non-zero and leaves the seal file byte-identical, verified
      by test.
- [ ] The claim that a step's provider subprocess presents non-interactive stdin is verified against
      the real execution path and the evidence is cited in the implementation. If it proves false,
      the check is replaced by an explicit engine-set in-band marker — it is not removed.
- [ ] No step definition, step-name mapping, or dispatch table entry references reseal, verified by
      inspection.

---

## Story 6: A performed or refused reseal is recorded in the worktree audit trail

**Requirement:** adr-2026-08-09-reseal-audit-rides-the-existing-event-spine

As an operator or auditor, I want every reseal attempt to leave a durable record of who did what
and why so that an override is never silent.

### Acceptance Criteria

#### Happy Path
- Given a reseal succeeds, when the audit trail is read, then it contains a record naming the
  enumerated paths, each path's prior and new fingerprint, the operator's verbatim reason, and the
  from/to commits.
- Given a reseal succeeds, when the emitted event is inspected, then it is a member of the existing
  conductor event union, routed through the existing sink declaration table.
- Given a reseal succeeds, when the daemon's event rendering encounters the event, then it renders a
  human-readable line rather than falling through unhandled.
- Given a reseal succeeds, when the seal file is read, then its `rebaselines` array carries the
  durable record of the new baseline independently of the event.

#### Negative Paths
- Given a reseal is refused for unlisted drift, when the audit trail is read, then a refusal record
  exists naming the refusal condition and the offending path — the alternate branch still records,
  it does not return early and skip the write.
- Given a reseal is refused for a missing rationale or a non-interactive invocation, when the audit
  trail is read, then the refusal is likewise recorded.
- Given the audit trail directory does not yet exist, when a reseal record is written, then the
  directory is created and the record lands rather than the write being dropped.
- Given the audit trail file is being appended to by another process concurrently, when a reseal
  record is written, then both records are complete, parseable JSON lines with no interleaving.
- Given the audit write fails, when a reseal has already persisted the seal, then the failure is
  surfaced to the operator rather than swallowed, and the seal's own `rebaselines` entry still
  carries the durable record.
- Given an existing audit-trail consumer reads a reseal record, when it encounters the operator
  origin, then it handles it without treating it as a pipeline step.

### Done When
- [ ] No new audit file, ledger, or bespoke record format is introduced; the record lands in the
      existing worktree audit trail, verified by inspection.
- [ ] Both the performed and the refused variants are declared in the event sink table, with the
      performed variant routed to the audit trail.
- [ ] The audit record's origin distinguishes an operator action from a pipeline step without using
      a sentinel step name, verified by type and by test.
- [ ] Every existing consumer of the audit record type is updated for the widened origin, verified by
      a compile-clean build and by inspection of each consumer.
- [ ] A refused reseal produces an audit record, verified by test for each refusal condition.

---

## Story 7: `--clear-halt` retires only a halt that the seal produced

**Requirement:** adr-2026-08-09-operator-only-scoped-artifact-reseal §4; #1281 desired outcome 4

As an operator, I want a successful reseal to optionally clear the halt it resolves so that
recovery is one command rather than three manual steps — without clearing halts it did not resolve.

### Acceptance Criteria

#### Happy Path
- Given a worktree halted with a protected-artifact halt classification, when a reseal succeeds with
  `--clear-halt`, then the halt reason is preserved to the cleared-halt marker, and both the halt
  marker and its classification marker are removed.
- Given `--clear-halt` is not supplied, when a reseal succeeds, then the halt marker and its
  classification marker are left in place untouched.
- Given the halt is cleared, when the daemon next polls, then the feature is eligible for dispatch
  again.

#### Negative Paths
- Given the worktree's halt classification is something other than a protected-artifact halt, when a
  reseal succeeds with `--clear-halt`, then the halt markers are left in place and the command
  reports that the halt was not cleared and why — the reseal itself still stands.
- Given the worktree carries no halt marker at all, when a reseal succeeds with `--clear-halt`, then
  the command succeeds without error and reports there was no halt to clear.
- Given the worktree carries a halt marker but no classification marker, when a reseal succeeds with
  `--clear-halt`, then the halt is not cleared — an unclassified halt is not assumed to be a seal
  halt.
- Given the reseal itself is refused, when `--clear-halt` was supplied, then no halt marker is
  touched — clearing is conditional on the reseal succeeding.
- Given removing the halt marker fails partway after the cleared-halt marker was written, when the
  command completes, then the failure is reported rather than leaving the operator believing the
  feature is unblocked.

### Done When
- [ ] Clearing is gated on the existing protected-artifact halt classification constant, not on a
      new string literal, verified by inspection.
- [ ] The halt reason survives into the cleared-halt marker, verified by test.
- [ ] A non-matching halt classification leaves both markers present while the reseal still succeeds,
      verified by test.
- [ ] A refused reseal leaves all halt markers untouched, verified by test.

---

## Story 8: A feature-authored protected-artifact edit still halts

**Requirement:** #1281 desired outcome 6; adr-2026-08-09-operator-only-scoped-artifact-reseal §2

As a harness maintainer, I want the tamper-detection boundary to behave exactly as it does today
for work the harness itself performs so that adding an operator escape hatch does not weaken the
gate.

### Acceptance Criteria

#### Happy Path
- Given a build commits a change to a protected artifact belonging to another feature, when
  verification runs, then it fails naming that artifact, exactly as before this feature.
- Given a build modifies a protected artifact in the working tree without committing, when
  verification runs, then it fails naming that artifact.
- Given a build deletes a protected artifact, when verification runs, then it fails naming that
  artifact.
- Given a build adds a protected artifact that is not base-inherited, when verification runs, then
  it fails naming that artifact.

#### Negative Paths
- Given a build has committed a violating change to a protected artifact, when that same build
  attempts to invoke the reseal command from within its own step, then the invocation is refused and
  verification continues to fail — the violation is not launderable from inside the pipeline.
- Given an operator performs a scoped reseal of path `P1`, when a build subsequently commits a
  violating change to unrelated path `P2`, then verification fails naming `P2` — the reseal did not
  broaden what the seal tolerates.
- Given an operator performs a scoped reseal, when verification next runs against an otherwise-clean
  workspace, then it passes without requiring any further manual intervention.

### Done When
- [ ] The existing verification test suite for protected-artifact violations passes unchanged, with
      no assertion relaxed or removed, verified by diff review.
- [ ] A test demonstrates that a reseal of one path does not suppress a violation on another path.
- [ ] A test demonstrates that an in-step reseal invocation is refused while the violation remains
      detected.
