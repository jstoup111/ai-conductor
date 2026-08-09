**Status:** Accepted

# Stories: prd_audit passes on a partial report

Technical track — there is no PRD, so these stories are the acceptance-criteria artifact.
Grounded in `adr-2026-08-09-prd-audit-coverage-complete-manifest` (APPROVED).

Terminology used throughout:
- **manifest** — `.pipeline/prd-audit.json`, the machine-read pass signal carrying the FR roster
  the audit covered and a verdict per roster entry.
- **report** — `.pipeline/prd-audit.md`, the human-readable view. No longer the trust path.
- **complete** — the manifest exists, parses, has a non-empty roster, and every roster entry
  carries a verdict.
- **incomplete** — any failure of the above. Distinct from a *blocking verdict*, which is an FR
  that was audited and found wanting.

---

## Story 1: An audit missing a verdict for any FR cannot pass

**Requirement:** ADR decision — manifest is the pass signal

As the conductor, I want the `prd_audit` completion predicate to require a verdict for every FR in
the manifest's roster, so that an audit which stopped early can never be recorded as a pass.

### Acceptance Criteria

#### Happy Path
- Given a manifest whose roster is `FR-1, FR-2, FR-3` and which carries a non-blocking verdict for
  all three, when the predicate evaluates completion, then it returns done and writes the code
  stamp.

#### Negative Paths
- Given a manifest whose roster is `FR-1, FR-2, FR-3` but which carries verdicts for only `FR-1`
  and `FR-2`, when the predicate evaluates completion, then it returns not-done and its reason
  names `FR-3` as lacking a verdict.
- Given no manifest on disk but a fresh report whose table shows every FR `ALIGNED`, when the
  predicate evaluates completion, then it returns not-done, because the report is not the pass
  signal.
- Given a manifest containing malformed JSON, when the predicate evaluates completion, then it
  returns not-done with a reason naming the parse failure, and does not fall back to scanning the
  report.
- Given a manifest that parses but whose roster is an empty list, when the predicate evaluates
  completion, then it returns not-done, because an empty roster cannot evidence that any FR was
  audited.
- Given a manifest whose roster entry carries a verdict string the parser does not recognize, when
  the predicate evaluates completion, then it returns not-done rather than treating the
  unrecognized value as non-blocking.
- Given an incomplete manifest, when the predicate returns not-done, then no code stamp is written,
  so a later run cannot preserve the outcome.

### Done When
- [ ] `prd_audit` returns not-done for each of: absent manifest, unparseable manifest, empty roster,
      roster entry with no verdict, roster entry with an unrecognized verdict
- [ ] The not-done reason names the specific FRs lacking a verdict, not just a count
- [ ] A complete, all-non-blocking manifest returns done and writes `.pipeline/prd-audit-code-stamp.json`
- [ ] No path writes a code stamp when the manifest is incomplete

---

## Story 2: A partial audit is not spared from the stale-evidence sweep as if authoritative

**Requirement:** ADR decision 1 — one predicate, four sites (`artifacts.ts:681`)

As the conductor, I want `sweptArtifactStillValid` to treat an incomplete audit as not-valid, so a
partial audit is never retained as though it were a finished one.

### Acceptance Criteria

#### Happy Path
- Given a complete manifest with all non-blocking verdicts and a code stamp that still validates,
  when the stale-evidence sweep runs before a re-dispatch, then the manifest and report are spared.

#### Negative Paths
- Given an incomplete manifest whose code stamp still validates, when the sweep runs, then the
  outcome is `spare-for-resume` — the file is retained as resume input but is **never** reported
  as a valid finished verdict and never satisfies the gate.

> **Amended 2026-08-09 by #1398:** the sweep outcome is three-valued (`spare-as-valid` /
> `spare-for-resume` / `delete`), not a boolean, so "kept on disk" and "trustworthy verdict" are
> separate answers. Resolution of blocking Conflict 1 (oscillating) in
> `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`, where this story and
> Story 7 were shown to be mutually unsatisfiable while one boolean carried both meanings.
- Given a manifest present with a blocking verdict and a validating code stamp, when the sweep
  runs, then the artifacts are not spared as valid, matching today's behavior for a blocking report.
- Given no manifest at all but a stale report present, when the sweep runs, then the report is not
  spared as valid.

### Done When
- [ ] The sweep outcome for `prd_audit` is three-valued, and `spare-as-valid` is returned only when
      the manifest is complete, non-blocking, and the code stamp validates
- [ ] An incomplete manifest never yields `spare-as-valid`, at this site or any other
- [ ] `spare-for-resume` is consumed only as resume input and is rejected anywhere a verdict is read
- [ ] A test asserts the incomplete case at this site specifically, not only via the main predicate

---

## Story 3: A partial audit is never preserved by the code-validity preserve path

**Requirement:** ADR decision 1 — one predicate, four sites (`artifacts.ts:2257`)

As the conductor, I want the `#817` preserve pre-check to re-ask the completeness question, so a
pass formed from a partial audit cannot be reused on a later run.

### Acceptance Criteria

#### Happy Path
- Given a code stamp present, a validating surface, and a complete non-blocking manifest, when the
  preserve pre-check runs, then completion is preserved without re-dispatching the audit.

#### Negative Paths
- Given a code stamp present and a validating surface, but a manifest whose roster has an FR with
  no verdict, when the preserve pre-check runs, then completion is **not** preserved and the step
  re-dispatches.
- Given a code stamp present and a validating surface, but no manifest on disk, when the preserve
  pre-check runs, then completion is not preserved.
- Given a code stamp written by an older engine version alongside a report but no manifest, when
  the preserve pre-check runs, then completion is not preserved and the feature re-audits once.

### Done When
- [ ] The preserve pre-check consults the same completeness predicate as the main path
- [ ] A stamped-but-incomplete audit re-dispatches instead of being preserved
- [ ] A pre-existing feature with a stamp and report but no manifest re-audits exactly once, then
      passes normally

---

## Story 4: The daemon's kickback classifier does not read a partial audit as clean

**Requirement:** ADR decision 1 — one predicate, four sites (`classifyPrdAuditGaps`, `artifacts.ts:3267`)

As the daemon, I want gap classification to distinguish an incomplete audit from a clean one, so I
never advance the SHIP tail on an audit that did not finish.

### Acceptance Criteria

#### Happy Path
- Given a complete manifest with every verdict non-blocking, when the classifier runs, then it
  reports clean, as today.
- Given a complete manifest whose blocking verdicts are all `impl-gap`, when the classifier runs,
  then it reports impl-only and the daemon self-heals via BUILD, as today.

#### Negative Paths
- Given an incomplete manifest with no blocking verdicts among the entries present, when the
  classifier runs, then it does **not** report clean; it reports incompleteness.
- Given an incomplete manifest that also carries a blocking `intended-drift` verdict, when the
  classifier runs, then incompleteness is reported and does not mask the blocking gap; the
  classification carries both facts, and routing precedence between them is Story 6's concern.

> **Amended 2026-08-09 by #1398:** this story reports both facts but does not decide the
> destination. Precedence when both hold is fixed in Story 6 — incompleteness wins. Resolution of
> blocking Conflict 2 (state-conflict) in
> `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`, where the destination was
> undefined for a reachable state.
- Given a manifest from a prior session that is not fresh, when the classifier runs, then it is
  ignored exactly as today, and its staleness is not mistaken for incompleteness.

### Done When
- [ ] `classifyPrdAuditGaps` returns a distinct classification for an incomplete audit
- [ ] Clean and impl-only classifications are unchanged for complete manifests
- [ ] Incompleteness and a blocking verdict can be reported together without either masking the other

---

## Story 5: A roster that understates the PRD is rejected where FR ids are enumerable

**Requirement:** ADR decision — Option A cross-check

As the conductor, I want the manifest's roster cross-checked against `FR-N` ids enumerated from the
approved PRDs, so an audit cannot pass by declaring a roster smaller than the PRD.

### Acceptance Criteria

#### Happy Path
- Given approved specs enumerating `FR-1` through `FR-4` and a manifest whose roster is exactly
  those four with verdicts, when the predicate evaluates completion, then it returns done.

#### Negative Paths
- Given approved specs enumerating `FR-1` through `FR-4` and a manifest whose roster is only `FR-1`
  through `FR-3`, when the predicate evaluates completion, then it returns not-done and its reason
  names `FR-4` as absent from the roster.
- Given a spec file prefixed `SUPERSEDED-` containing `FR-9`, when FR ids are enumerated, then
  `FR-9` is excluded and its absence from the roster does not block.
- Given approved specs containing no literal `FR-N` ids at all, when the predicate evaluates
  completion, then the cross-check is skipped, the manifest's own completeness requirement still
  applies, and the reason recorded states that the cross-check could not be performed — the gate
  never silently degrades to passing on absence of evidence.
- Given a manifest whose roster contains an FR id that appears in no approved spec, when the
  predicate evaluates completion, then this does not block, because a superset roster still
  evidences full coverage.
- Given approved specs where the same `FR-2` id appears in two non-superseded files, when ids are
  enumerated, then it is counted once and does not require two roster entries.

### Done When
- [ ] FR ids are enumerated from non-`SUPERSEDED-` files under `.docs/specs/` only
- [ ] A roster missing an enumerated FR blocks and names the missing id
- [ ] A roster that is a superset of the enumerated ids does not block
- [ ] Specs with no enumerable ids skip the cross-check while manifest completeness still applies,
      and the skip is stated in the recorded reason
- [ ] Duplicate ids across specs are de-duplicated

---

## Story 6: An incomplete audit re-dispatches prd_audit and never routes to BUILD

**Requirement:** ADR decision 2 — incompleteness routing

As the operator, I want an incomplete audit to send the work back to `prd_audit`, so the daemon
does not churn BUILD on a gap BUILD cannot close.

### Acceptance Criteria

#### Happy Path
- Given an incomplete audit in an auto-mode run, when the conductor routes the unsatisfied gate,
  then it re-dispatches `prd_audit` and does not construct a BUILD-targeted remediation work order.
- Given an audit that is **both** incomplete and carries a blocking `impl-gap` verdict, when the
  conductor routes, then incompleteness takes precedence: it re-dispatches `prd_audit`, preserves
  the recorded blocking verdicts, and re-evaluates them once coverage is complete.
- Given an audit that is **both** incomplete and carries a blocking `intended-drift` verdict, when
  the conductor routes in auto mode, then incompleteness still takes precedence and it re-dispatches
  rather than halting, because the drift finding is not yet drawn from a complete picture.

> **Amended 2026-08-09 by #1398:** precedence when an audit is simultaneously incomplete and
> carrying a blocking verdict is now explicit — incompleteness wins. Resolution of blocking
> Conflict 2 (state-conflict) in
> `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`, where Story 4 required both
> facts to be reported while this story sent each to a different destination without saying which
> applied when both held.
- Given a re-dispatched `prd_audit` that is the only dispatchable validation member, when the group
  resolves, then it takes the width-1 serial path and receives the serial retry budget rather than
  the single-attempt branch budget.

#### Negative Paths
- Given a complete audit carrying a blocking `impl-gap` verdict, when the conductor routes, then it
  still routes to BUILD exactly as today — the new classification must not capture genuine gaps.
- Given a complete audit carrying a blocking `intended-drift` verdict, when the conductor routes in
  auto mode, then it still halts for a human exactly as today.
- Given an audit that remains incomplete after the serial retry budget is exhausted, when the
  conductor exhausts retries, then it halts with a reason naming the FRs that never received a
  verdict, rather than looping indefinitely.
- Given an incomplete audit in interactive mode, when the gate is evaluated, then the operator is
  shown the missing FRs and no BUILD kickback is proposed.

### Done When
- [ ] Incompleteness is classified distinctly from a blocking-verdict gap at the routing site
- [ ] No code path converts an incomplete audit into a BUILD-targeted remediation work order
- [ ] When both incompleteness and a blocking verdict hold, incompleteness determines the
      destination, for `impl-gap` and `intended-drift` alike, with the blocking verdicts preserved
- [ ] `impl-gap` still routes to BUILD and `intended-drift` still halts, both unchanged
- [ ] Exhausted retries on a persistently incomplete audit halt with the missing FRs named
- [ ] Routing is asserted for both the group path and the serial path

---

## Story 7: A partial audit resumes when code is unchanged and restarts when code has moved

**Requirement:** ADR decision 3 — partial resume rides the `#817` code stamp

As the operator, I want an unchanged implementation to re-audit only the FRs lacking a verdict, and
a changed implementation to re-audit everything, so re-audits cost only what they must.

### Acceptance Criteria

#### Happy Path
- Given an incomplete manifest and a `feature-runtime` surface that has not moved since the stamp,
  when the step re-dispatches, then the sweep returns `spare-for-resume`, the manifest survives on
  disk purely as resume input, and the skill audits only the FRs lacking a verdict, preserving the
  verdicts already recorded.

> **Amended 2026-08-09 by #1398:** survival is expressed as the `spare-for-resume` sweep outcome
> rather than as generic sparing, so retaining the file never implies the audit is valid.
> Resolution of blocking Conflict 1 (oscillating) in
> `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`.
- Given an incomplete manifest and a `feature-runtime` surface that has moved since the stamp, when
  the step re-dispatches, then the manifest and report are deleted and every FR is audited afresh.

#### Negative Paths
- Given a surviving partial manifest, when the re-audit completes, then the predicate still
  independently verifies coverage — a resumed run is granted no exemption from Story 1.
- Given a surviving partial manifest whose preserved verdicts include a blocking one, when the
  re-audit completes, then that blocking verdict is still present and still blocks; resume must not
  drop it.
- Given no code stamp at all alongside an incomplete manifest, when the step re-dispatches, then the
  engine cannot establish that code is unchanged and re-audits every FR, failing safe toward more
  work rather than less.
- Given a surviving partial manifest and a re-audit that is itself killed early, when the predicate
  evaluates completion, then it still returns not-done — repeated partial resumes never accumulate
  into a false pass.
- Given a resumed audit, when the report is rewritten, then it reflects the full merged verdict set
  and not only the FRs audited in the resuming run.

### Done When
- [ ] An unchanged-surface re-dispatch preserves the manifest and re-audits only missing FRs
- [ ] A changed-surface re-dispatch deletes the manifest and re-audits all FRs
- [ ] A missing code stamp forces a full re-audit
- [ ] Preserved blocking verdicts survive a resume and still block
- [ ] Consecutive partial resumes cannot produce a pass without full coverage
- [ ] The rewritten report shows merged verdicts across the original and resuming runs

---

## Story 8: A genuinely complete audit still passes with no added friction

**Requirement:** ADR consequence — no regression to the clean path

As the operator, I want a feature whose FRs all audit clean to pass exactly as before, so the new
gate costs nothing on the happy path.

### Acceptance Criteria

#### Happy Path
- Given a complete manifest with every verdict `ALIGNED`, when the SHIP tail runs, then `prd_audit`
  passes, no review marker is written, and the tail advances to retro and finish with no operator
  prompt.
- Given a complete and clean audit followed by a rebase whose delta does not touch the feature's
  runtime surface, when post-rebase invalidation runs, then `prd_audit` is preserved and not
  re-dispatched, exactly as `#655` specifies today.

#### Negative Paths
- Given a complete audit in which one FR is a human-`ACCEPTED` divergence, when the predicate
  evaluates completion, then it passes, because `ACCEPTED` remains non-blocking as today.
- Given a complete and clean audit followed by a rebase whose delta **does** touch the feature's
  runtime surface, when post-rebase invalidation runs, then `prd_audit` is invalidated and
  re-dispatched, exactly as today.
- Given a complete and clean audit, when the finish-time validation fence recomputes member
  verdicts, then `prd_audit` is reported green and finish is not blocked.

### Done When
- [ ] A complete all-`ALIGNED` audit passes with no review-required marker written
- [ ] A regression test confirms `#655` delta-aware preservation of a complete `prd_audit` still holds
      in both the preserve and invalidate directions
- [ ] `ACCEPTED` divergences remain non-blocking
- [ ] The finish-time validation fence reports a complete clean audit as green
