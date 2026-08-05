**Status:** Accepted

# Stories: Inherited-revision tolerance in the protected-artifact seal

Track: technical. Source: jstoup111/ai-conductor#1315 and
`adr-2026-08-05-provenance-based-protected-artifact-inheritance` (APPROVED).

Outcome ids `DO-1`..`DO-4` are 1-based in the order the bullets appear under the **Desired outcome**
heading of jstoup111/ai-conductor#1315.

## Story 1: A branch that never touched an artifact carries it at any revision

**Requirement:** TI-1 (DO-1) — an unmodified, legitimately-inherited protected artifact does not
halt, even when the base branch has amended it since the branch's merge-base.

As a feature branch mid-BUILD, I want a protected artifact I never authored or edited to be
recognised as inherited regardless of which revision I hold so that another feature amending its own
landed plan does not halt my build and discard the step's work.

### Acceptance Criteria

#### Happy Path

- Given a protected artifact owned by another feature exists at the branch's merge-base, and the base
  branch has since committed an amendment to it, and the branch's own commits contain no change to
  that path, when the seal is verified, then the path is tolerated and the step proceeds.
- Given that same branch, when the artifact is absent from the seal entirely because the seal's
  baseline predates the artifact's arrival, then the `added` refusal branch tolerates it on the same
  provenance grounds as the `changed` branch.
- Given a workspace copy that is byte-identical to the base tip but differs from `HEAD`, when the
  seal is verified, then it is still tolerated — the pre-existing base-tip acceptance is retained
  and not replaced (review condition C-1).
- Given a fully clean workspace with no fingerprint mismatch and no unexpected path, when the seal is
  verified, then no git probe is invoked at all and the lazy base-ref resolution is preserved.

#### Negative Paths

- Given the branch holds an older revision of another feature's artifact **and** has also committed
  its own edit to that path, when the seal is verified, then it refuses — being behind does not
  excuse a modification.
- Given the branch never committed a change to the path but the working tree copy differs from
  `HEAD`, when the seal is verified, then it refuses — an uncommitted edit is not inheritance.
- Given a protected artifact that exists in neither the branch's history nor the base branch, when
  the seal is verified, then the `added` refusal stands unchanged.

### Done When

- [ ] A fixture reproducing #1315's shape — base branch amends an artifact after the branch's
      merge-base, branch untouched — verifies clean where it previously refused.
- [ ] The base-tip acceptance case has its own test and still passes.
- [ ] The clean-workspace path is asserted to make zero git invocations.

---

## Story 2: Widening inheritance is not a laundering path

**Requirement:** TI-2 (DO-2) — a branch that actually modified a protected artifact it does not own
still halts, with the same fail-closed strictness as today.

As the protected-artifact seal, I want every accepted inheritance to rest on a fact the build agent
cannot manufacture so that relaxing the false-positive case does not create a route for real
tampering to pass.

### Acceptance Criteria

#### Happy Path

- Given an accepted inheritance, when the acceptance is explained, then it rests on either
  byte-equality with the base ref's copy or on the branch's own commit range containing no change to
  the path — both derived from a ref the agent does not write.
- Given the branch legitimately amends an artifact whose stem names its **own** feature, when the
  seal is verified, then the existing self-amendment reporting path is reached unchanged and the
  amendment is still reported durably.

#### Negative Paths

- Given a build agent commits a modification to another feature's protected artifact, when the seal
  is verified, then it refuses — the commit appears in the branch's own range against its merge-base.
- Given a build agent edits another feature's protected artifact in the working tree without
  committing, when the seal is verified, then it refuses — the copy differs from `HEAD`.
- Given a build agent reverts another feature's artifact to an older revision that genuinely existed
  on the base branch, when the seal is verified, then it refuses — a historical revision is not an
  accepted provenance, only "this branch did not change it" is.
- Given a protected artifact expected by the seal is deleted from the workspace, when the seal is
  verified, then the `deleted` refusal is unchanged and no inheritance reasoning applies to it.

### Done When

- [ ] Adversarial fixtures cover committed modification, uncommitted edit, and revert-to-historical-
      revision, and all three still refuse.
- [ ] The own-feature self-amendment tests continue to pass without modification to their assertions.
- [ ] The `deleted` branch has a test proving it is not reachable by the inheritance predicate.

---

## Story 3: A refusal says which of the two things went wrong

**Requirement:** TI-3 (DO-3) — the refusal distinguishes "this branch modified an artifact it does
not own" from "this branch is behind the base on someone else's artifact", and names the recovery.

As an operator reading `.pipeline/HALT`, I want the refusal to tell me which failure I am looking at
and what to do about it so that I can act without reading engine source.

### Acceptance Criteria

#### Happy Path

- Given the branch committed a change to an artifact it does not own, when the seal refuses, then the
  first line classifies it as a changed protected artifact naming the path, and a later line names
  the recovery: revert to the committed DECIDE content, and route a genuine amendment to DECIDE.
- Given an uncommitted worktree edit, when the seal refuses, then the first line distinguishes it
  from a committed change and a later line names restoring the path from `HEAD`.
- Given any refusal, when the message is rendered, then the terse classification occupies the first
  non-empty line, because the daemon dashboard surfaces only that line (review condition C-3).

#### Negative Paths

- Given a refusal message is produced, when the halt is written, then no production code path
  branches on the message text — the machine-readable discriminator remains `.pipeline/HALT.class`,
  whose value for this path is unchanged.
- Given the branch is behind the base on an artifact it never touched, when the seal runs, then there
  is no refusal at all to classify — the tolerance accepts it, and no halt text is produced.

### Done When

- [ ] Each refusal cause has a test asserting its first line and the presence of its recovery text.
- [ ] A test pins that the halt class written for the BUILD path is still `protected-artifact`.
- [ ] Documentation describing the refusals matches the emitted strings.

---

## Story 4: Undeterminable provenance fails closed and says so

**Requirement:** TI-4 (DO-4) — when a stale or unresolvable base is what makes an inherited artifact
look modified, the refusal says so, and a rebase is identifiable as the fix from the halt text alone.

As an operator, I want the seal to distinguish "I proved you modified this" from "I could not
determine provenance" so that I do not go looking for a tampering that did not happen.

### Acceptance Criteria

#### Happy Path

- Given no base ref resolves — neither `origin/<base>` nor `<base>` exists, or no base branch was
  supplied at all, as on an interactive `conduct` run — when a protected artifact fails its
  fingerprint check, then the refusal states that provenance could not be determined and names the
  missing base ref as the reason.
- Given a base ref resolves but the branch shares no merge-base with it, when provenance is probed,
  then the refusal names the absent merge-base and identifies rebasing onto the base branch as the
  recovery.
- Given a git probe exits non-zero for any other reason, when provenance is probed, then the refusal
  names the failed probe rather than reporting a modification.

#### Negative Paths

- Given any probe failure, when the seal evaluates the tolerance, then the tolerance is denied — a
  failure never yields acceptance (review condition C-4).
- Given provenance is undeterminable, when the halt is written, then the step still halts exactly as
  it does today; only the explanation changes, never the fail-closed outcome.
- Given the base ref resolves and probes succeed, when the artifact was genuinely modified, then the
  undeterminable wording is not used — a real modification is never reported as an unknown.

### Done When

- [ ] Absent base ref, absent merge-base, and non-zero git exit each have a test asserting refusal
      plus the reason named in the text.
- [ ] A test asserts that an interactive-style verification with no `baseBranch` still halts, with
      the undeterminable explanation rather than a bare classification.
- [ ] No probe-failure path can return an accepting verdict.
