**Status:** Accepted

# Stories: Provenance-based protected-artifact seal rotation (#1229)

**Track:** technical — no PRD. Acceptance criteria are defined here.
**Design:** `.docs/architecture/manual-rebase-strands-protected-artifact-seal.md`
**Decisions:** `adr-2026-08-09-seal-rotation-authorship-predicate`, `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`
**Review:** `architecture-review-2026-08-09-manual-rebase-strands-protected-artifact-seal` (APPROVED WITH CONDITIONS)

Requirement tags reference the approved decision records: `ADR1-N` is decision item N of
`adr-2026-08-09-seal-rotation-authorship-predicate`; `ADR2-N` is decision item N of
`adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`; `COND-N` is condition N of the
architecture review.

Per this repository's test-isolation policy, no story here involves a third-party boundary. Unit
scenarios exercise the pure rotation decision table directly; integration and acceptance scenarios
use real git fixtures.

---

## Story 1: A protected artifact the base branch alone advanced does not block rotation

**Requirement:** ADR1-1, COND-6

As the daemon, I want a protected artifact that only the base branch changed to be recognised as
none of this feature's doing, so that a feature which is merely behind its base is not accused of
tampering.

### Acceptance Criteria

#### Happy Path
- Given a seal whose baseline is not an ancestor of HEAD, and a protected artifact present at the
  base tip but absent from HEAD, and HEAD has not changed that path since the merge-base, when the
  rotation verdict is evaluated, then the verdict is permitted and that path is not among the paths
  that blocked it.
- Given the same conditions, when rotation is applied, then the seal's `baselineCommit` becomes the
  current HEAD commit and its `protectedArtifacts` fingerprints match the content committed at HEAD.
- Given a protected artifact present at both HEAD and the base tip with differing content, where
  HEAD has not changed the path since the merge-base, when the rotation verdict is evaluated, then
  the verdict is permitted.
- Given several diverging paths where every one is base-ahead, when the rotation verdict is
  evaluated, then the verdict is permitted and no path is reported as blocking.

#### Negative Paths
- Given one path that is base-ahead and a second path that HEAD changed since the merge-base, when
  the rotation verdict is evaluated, then the verdict is refused naming the second path only, and
  the seal file's bytes are unchanged.
- Given a base-ahead path, when the rotation verdict is evaluated, then no refusal is emitted
  carrying a `feature-authored` classification for that path.
- Given a seal whose baseline IS an ancestor of HEAD and a base-ahead path, when the rotation
  verdict is evaluated, then the verdict is refused as `same-history-ancestor` and the seal is not
  rotated — being behind base never authorises rotation on unrewritten history.

### Done When
- [ ] `evaluateProtectedArtifactSealRotation` returns `{ permitted: true }` for a diverging path
      whose supplied authorship value is not-authored, and that path is absent from the returned
      `paths` array.
- [ ] After a permitted rotation, `.pipeline/protected-artifact-seal.json` has `baselineCommit`
      equal to HEAD and one appended `rebaselines[]` entry.
- [ ] A mixed base-ahead / feature-authored input returns
      `{ permitted: false, condition: 'head-differs-from-base', path: <the authored path> }`.
- [ ] No test asserts a `feature-authored` string for any base-ahead path.

---

## Story 2: A protected artifact this feature changed still refuses rotation and halts

**Requirement:** ADR1-1, COND-3

As an operator, I want a genuine feature-authored change to another feature's DECIDE artifact to
keep halting the build, so that widening the rotation predicate does not open a tamper hole.

### Acceptance Criteria

#### Happy Path
- Given a protected artifact whose content at HEAD differs from the base tip, and HEAD changed that
  path since the merge-base, when the rotation verdict is evaluated, then the verdict is refused
  naming that path.
- Given that refusal, when the seal verdict is composed, then the result is a failure whose reason
  names the path and identifies it as a feature-authored committed change.
- Given that refusal, when it is reported, then the emitted refusal carries the `feature-authored`
  classification.

#### Negative Paths
- Given a protected artifact this feature committed a deletion of, when the rotation verdict is
  evaluated, then the verdict is refused naming that path — a deletion is authorship.
- Given a protected artifact this feature edited and then reverted to the base tip's exact content
  in a later commit, when the rotation verdict is evaluated, then that path does not diverge and
  does not block rotation.
- Given a feature-authored divergence, when the seal verdict is composed and `inspectSeal` passed,
  then the composed verdict is still a failure — the narrow non-escalation rule does not cover this
  refusal class.
- Given a feature-authored divergence, when rotation is refused, then
  `.pipeline/protected-artifact-seal.json` is byte-identical to its prior content.

### Done When
- [ ] A supplied authorship value of authored produces
      `{ permitted: false, condition: 'head-differs-from-base', path }` regardless of blob contents.
- [ ] The composed verdict for that case is `{ ok: false }` with a reason naming the path.
- [ ] Every pre-existing protected-artifact violation test passes with no assertion relaxed,
      removed, or re-scoped.

  > **Amended 2026-08-09 by #1229:** this checkbox over-claims and is narrowed. Every existing
  > assertion that pins a *violation* — a feature-authored committed change, an uncommitted
  > workspace edit, a deletion, a missing seal — remains invariant and must pass untouched. One
  > existing case is exempt: the rotation decision-table assertion at
  > `src/conductor/test/engine/protected-artifact-seal.test.ts:232`/`:244` pins
  > `head-differs-from-base` for an input that supplies no authorship, which the corrected
  > predicate no longer decides from blob contents alone. That case must gain an explicit
  > authorship input, and supplying a previously absent input is not a relaxation. It is the only
  > permitted change to an existing assertion; any other would be a regression. See
  > `.docs/conflicts/manual-rebase-strands-protected-artifact-seal.md` Conflict 1.

- [ ] A test asserts the seal file is byte-identical after a refused rotation.

---

## Story 3: Indeterminate provenance is treated as feature-authored

**Requirement:** ADR1-2, COND-2

As a security reviewer, I want an unanswerable authorship question to fail closed, so that a
degraded git environment can never be used to launder a protected-artifact change.

### Acceptance Criteria

#### Happy Path
- Given a diverging path whose supplied authorship value is indeterminate, when the rotation verdict
  is evaluated, then the verdict is refused naming that path, identically to an authored path.

#### Negative Paths
- Given no merge-base exists between HEAD and the base branch, when authorship is resolved for a
  diverging path, then the resolved value is indeterminate and rotation is refused.
- Given the authorship probe's `git diff` invocation exits non-zero, when authorship is resolved for
  a diverging path, then the resolved value is indeterminate and rotation is refused.
- Given neither `origin/<base>` nor `<base>` resolves, when the rotation context is resolved, then
  rotation is refused as `base-tip-unresolved` and no authorship probe is attempted.
- Given an indeterminate authorship value, when the rotation verdict is evaluated, then the verdict
  is never permitted and the path is never classified base-ahead.
- Given an indeterminate authorship value, when the refusal is reported, then the emitted evidence
  records the provenance as indeterminate rather than asserting the feature touched the path.

### Done When
- [ ] Three separate tests drive the no-merge-base, failed-diff, and unresolvable-base-ref branches
      to a refused verdict.
- [ ] A test asserts no input combination containing an indeterminate authorship value yields
      `{ permitted: true }`.
- [ ] The `base-tip-unresolved` path performs zero authorship probes.

---

## Story 4: Authorship is resolved outside the pure rotation evaluator

**Requirement:** ADR2-1, ADR2-2, ADR2-3, COND-1

As a maintainer, I want the rotation decision table to stay unit-testable without a git fixture, so
that the adversarial cases guarding this boundary remain cheap to enumerate.

### Acceptance Criteria

#### Happy Path
- Given the pure rotation evaluator, when it is called with authorship supplied as data, then it
  returns a verdict without performing any git invocation or filesystem read.
- Given the repository-level evaluator, when it runs, then it resolves authorship for the diverging
  paths and supplies those values to the pure evaluator.
- Given the supplied authorship datum, when it is inspected, then it distinguishes three states —
  authored, not-authored, and indeterminate — rather than collapsing indeterminate at the boundary.
- Given a diverging path, when authorship is resolved, then it is derived from the same merge-base
  probe the inspection path already uses, not a second definition.

#### Negative Paths
- Given the pure evaluator's module, when it is inspected, then it contains no `execa` call and no
  git helper import added by this change.
- Given a seal whose baseline is an ancestor of HEAD, when the repository-level evaluator runs, then
  it short-circuits before resolving authorship for any path and performs no additional git work.
- Given a protected path that does not diverge, when the repository-level evaluator runs, then no
  authorship probe is performed for it.
- Given an authorship value omitted for a diverging path, when the rotation verdict is evaluated,
  then that path is treated as indeterminate and refused — never as not-authored by default.

### Done When
- [ ] The rotation decision-table tests construct authorship values directly and create no git
      repository.
- [ ] A test asserts the common ancestor path performs no authorship probe.
- [ ] `evaluateProtectedArtifactSealRotation` remains synchronous and side-effect-free.
- [ ] An omitted or unknown authorship entry resolves to a refused verdict.

---

## Story 5: A rotation refusal does not fail a passing inspection unless it evidences tampering

**Requirement:** ADR1-3, COND-3

As the daemon, I want an inability to repair the seal to leave the seal alone rather than halt the
feature, so that an opportunistic repair failing is not mistaken for a violation.

### Acceptance Criteria

#### Happy Path
- Given `inspectSeal` passed and rotation was refused as `base-tip-unresolved`, when the seal verdict
  is composed, then the result is the passing inspection verdict and the seal is left unrotated.
- Given `inspectSeal` passed and rotation was refused as `head-unresolvable`, when the seal verdict
  is composed, then the result is the passing inspection verdict.
- Given `inspectSeal` passed and rotation was refused as `same-history-ancestor`, when the seal
  verdict is composed, then the result is the passing inspection verdict — unchanged from today.

#### Negative Paths
- Given `inspectSeal` passed and rotation was refused as `workspace-differs-from-head`, when the seal
  verdict is composed, then the result is a failure naming the path and instructing restoration from
  HEAD — this refusal class still escalates.
- Given `inspectSeal` passed and rotation was refused for a provenance-confirmed feature-authored
  path, when the seal verdict is composed, then the result is a failure naming the path.
- Given `inspectSeal` failed, when rotation is refused for any reason, then the composed verdict
  reports the inspection's own failure reason and is not replaced by a rotation reason.
- Given a refusal class that does not escalate, when the seal verdict is composed, then the seal file
  is left byte-identical and no `rebaselines[]` entry is appended.

### Done When
- [ ] A test per environmental refusal class asserts a passing inspection survives the refusal.
- [ ] A test asserts `workspace-differs-from-head` still produces a failing composed verdict.
- [ ] A test asserts a provenance-confirmed feature-authored refusal still produces a failing
      composed verdict.
- [ ] A test asserts a non-escalating refusal appends no `rebaselines[]` entry.

---

## Story 6: Rotation telemetry carries the evidence that classified it

**Requirement:** ADR1-4, COND-6

As an operator triaging a halted feature, I want the rotation event to tell me why a path was
classified as it was, so that I can distinguish a stranded seal from a real violation without
forensic git inspection.

### Acceptance Criteria

#### Happy Path
- Given a refused rotation naming a path, when the refusal is emitted, then the event carries the
  merge-base commit used and whether HEAD changed that path since it.
- Given a permitted rotation that excluded base-ahead paths, when the rebaseline is emitted, then the
  event carries those paths.
- Given either event, when the daemon renders it, then a human-readable line is produced rather than
  an unhandled fall-through.
- Given a refused rotation, when the emitted event is inspected, then its classification reflects the
  resolved provenance rather than being derived from the refusal condition alone.

#### Negative Paths
- Given this change, when the event union is inspected, then no new event variant, no new
  `.pipeline` ledger file, and no sidecar file has been introduced — only existing variants gained
  fields.
- Given a consumer reading the prior event shape, when it receives an event carrying the new fields,
  then it continues to function — the fields are additive and optional.
- Given a refusal whose provenance was indeterminate, when the event is emitted, then it records
  indeterminate rather than claiming HEAD touched the path.
- Given telemetry emission throws, when a rotation is evaluated, then the rotation verdict and the
  composed seal verdict are unchanged — observation never alters policy.

### Done When
- [ ] The refused event carries the merge-base commit and a per-path authorship indication.
- [ ] The rebaseline event carries the base-ahead path list.
- [ ] `daemon-cli.ts`'s renderer produces a line for both variants and a test asserts it.
- [ ] A test asserts no new `ConductorEvent` variant and no new ledger file was added.
- [ ] A test asserts a throwing observer does not change either verdict.

---

## Story 7: The rotation audit trail covers every protected directory

**Requirement:** COND-4

As an operator reading a seal's lineage, I want the recorded rotation paths to cover every protected
directory, so that ADR movement is not silently missing from the audit trail triage now depends on.

### Acceptance Criteria

#### Happy Path
- Given an engine-managed rebase where the base branch advanced a file under `.docs/decisions`, when
  the post-rebase rotation records its `rebaselines[]` entry, then that file appears in the entry's
  `paths`.
- Given a rebase that advanced files under several protected directories, when the entry is
  recorded, then every changed protected path appears, ordered deterministically.

#### Negative Paths
- Given a rebase that changed no protected artifact, when the entry is recorded, then its `paths` is
  empty and the rotation still occurs.
- Given a rebase that changed a file outside the protected directories, when the entry is recorded,
  then that file does not appear in `paths`.
- Given the path-diff invocation fails, when the entry is recorded, then `paths` is empty and the
  rotation still completes rather than throwing.

### Done When
- [ ] The directory list used for the rotation path diff equals `PROTECTED_ARTIFACT_DIRECTORIES`
      with no directory omitted, asserted by a test that fails if the two drift apart.
- [ ] A test asserts a `.docs/decisions` change appears in the recorded `paths`.
- [ ] A test asserts an unprotected path never appears.

---

## Story 8: The reported incident sequence completes without operator intervention

**Requirement:** COND-6, ADR1-1

As an operator, I want the exact reported sequence to run to completion untouched, so that this
class of false halt is demonstrably gone rather than argued away at the unit level.

### Acceptance Criteria

#### Happy Path
- Given a real git fixture reproducing the incident — a feature branch rebased onto a base commit,
  the base branch then advancing with a new protected artifact the feature never authored, and a
  seal stranded on the pre-rebase baseline — when seal verification runs, then it passes.
- Given that same fixture, when verification completes, then the seal's `baselineCommit` has advanced
  to the post-rebase HEAD with no manual JSON edit and no reseal command invoked.
- Given that same fixture, when verification completes, then no `HALT` marker and no `HALT.class`
  marker is written.
- Given that same fixture, when the emitted events are inspected, then none carries a
  `feature-authored` classification.

#### Negative Paths
- Given the same fixture but with the feature having itself committed an edit to a protected
  artifact owned by another feature, when seal verification runs, then it fails naming that path and
  the halt still occurs.
- Given the same fixture but with an uncommitted workspace edit to a protected artifact, when seal
  verification runs, then it fails and the halt still occurs.
- Given the fixture's feature branch with no remote and no resolvable base ref, when seal
  verification runs, then it does not rotate the seal and does not halt a workspace that is
  otherwise clean.

### Done When
- [ ] An integration test builds the fixture with real git commands and asserts verification passes
      and the baseline advanced.
- [ ] The same test asserts no `HALT` or `HALT.class` marker exists afterward.
- [ ] Two negative variants of the fixture assert the halt still occurs for genuine violations.
- [ ] The test invokes no reseal command and edits no JSON by hand.
