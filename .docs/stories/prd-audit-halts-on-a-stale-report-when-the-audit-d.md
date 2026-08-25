**Status:** Accepted

# Stories: Engine-stamped run identity for SHIP-tail verdict artifacts (#1838)

Track: technical. Design authority: adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity (D1–D9).
Gates in scope: prd_audit, architecture_review_as_built, manual_test. build_review and custom-step markers out of scope.

## Story 1: Engine stamps run identity at the dispatch settle boundary

As the conductor, I want each SHIP-tail verdict dispatch's run identity recorded beside the existing code stamp so that every reader can tell this lap's verdict from an earlier one.

### Acceptance Criteria

#### Happy Path
- Given a prd_audit dispatch settles after writing its report, when the engine records the settle, then the gate-code-validity sidecar carries the dispatch's attempt id as the run identity beside `codeStamp`
- Given the three verdict gates run concurrently in a validation group, when each branch settles, then its stamp is written on that branch's own settle path before the join reads any verdict

#### Negative Paths
- Given the provider's output text embeds a run-identity value, when the engine stamps the sidecar, then the provider-supplied value is ignored and the engine's own attempt id is recorded (never validated as an echo)
- Given the sidecar cannot be written (e.g. `.pipeline/` unwritable), when the settle records it, then the failure is reported loudly for that branch and the engine does not throw or silently mark the verdict identity-stamped
- Given two validation-group branches settle near-simultaneously, when both stamp their own sidecars, then neither branch's stamp overwrites or blocks the other's (each gate has its own sidecar file)

### Done When
- [ ] After a verdict-gate dispatch settles, the gate's sidecar file contains both `codeStamp` and the run-identity field equal to that dispatch's attempt id
- [ ] A unit test proves the stamp is engine-authored: a doctored provider output carrying a bogus identity leaves the sidecar with the engine's value
- [ ] A validation-group test proves each branch's stamp exists before the group join evaluates verdicts

## Story 2: Post-dispatch write handshake makes a non-writing audit fail visibly

As the conductor, I want to verify immediately after a verdict dispatch settles that the gate's declared outputs were produced by this dispatch so that a silently non-writing audit is a visible step failure, not a success.

### Acceptance Criteria

#### Happy Path
- Given a prd_audit dispatch writes `.pipeline/prd-audit.md` during its run, when the handshake runs after settle, then the attempt is eligible for completion checking with no handshake finding
- Given any terminal dispatch outcome (success, error, halt), when the step concludes, then the handshake observation is recorded — not only on the success path

#### Negative Paths
- Given a dispatch settles ✓ but wrote neither report nor marker, when the handshake runs, then the attempt is scored failed with a reason naming each missing artifact, the expected run identity, and the found identity/mtime of whatever is on disk
- Given a dispatch settles ✓ but only the report (not the marker) was rewritten, when the handshake runs, then the reason names specifically the artifact that was not produced
- Given the handshake's own read throws (unreadable file, corrupt sidecar), when it evaluates, then the attempt is treated as not-verified (fail-closed for the verdict) while the engine itself does not crash

### Done When
- [ ] Replaying the 2026-08-23 shape (settle ✓, artifacts untouched from a prior lap) yields a failed attempt whose reason names `.pipeline/prd-audit.md`, the expected attempt id, and the stale identity/mtime — and never quotes the stale report's findings
- [ ] The handshake path is exercised for all three gates in tests, serial and validation-group
- [ ] Handshake evaluation never throws out of the step loop (corrupt-input test)

## Story 3: All readers judge identity, not just the completion predicate

As the routing/halt machinery, I want every reader of a SHIP-tail verdict artifact to consult one shared identity check so that no reader can act on a prior lap's findings.

### Acceptance Criteria

#### Happy Path
- Given a report stamped with the current dispatch's identity and blocking rows, when `classifyPrdAuditGaps` runs, then those rows drive routing as today
- Given a report stamped with the current identity and no blocking rows, when the completion predicate runs, then the gate passes as today

#### Negative Paths
- Given a report whose stamp identifies an earlier lap of the same session, when `classifyPrdAuditGaps` runs, then it returns no blocking rows from that report and the caller treats the state as "no fresh verdict" — the stale rows never reach a kickback hint or halt reason
- Given a stale-identity report, when the completion predicate scores the step, then the reason states the verdict was not produced by this run and names the artifact, expected identity, and found identity — with none of the stale findings quoted as current
- Given the gate-code-validity preserve path (#817) holds a PASS sidecar while the on-disk report is from an older lap with blocking rows, when the predicate evaluates, then the stale report is not re-read as a current clean/blocking verdict

### Done When
- [ ] `classifyPrdAuditGaps` (and the halt writers it feeds) take the shared identity input; a regression test with a same-session earlier-lap report produces zero blocking classifications
- [ ] The stale-artifact sweep remains gated on the same shared helper (#817 D4) — a test proves the sweep and the readers agree on the same artifact
- [ ] grep of the diff shows no reader retains a private session-only mtime freshness check for the three gates

## Story 4: Identity mismatch reruns within budget, then halts self-describingly

As the retry classifier, I want a missing/prior-identity verdict scored as "absent" so that the judge reruns within the existing budget and exhaustion produces a halt an operator can act on.

### Acceptance Criteria

#### Happy Path
- Given the handshake scored "no verdict for this run", when `classifyRetryDecision` runs, then the decision is rerun (routeClass absent), not route
- Given a rerun then writes a correctly-stamped verdict, when the completion predicate runs, then the lap proceeds normally

#### Negative Paths
- Given the retry budget is exhausted with the verdict still missing/mismatched, when the step concludes, then a `needs-human` halt is written through `writeHaltMarker` whose reason names the step, the artifact, the expected run identity, and the found identity/mtime — and quotes no stale findings
- Given the mismatch, when the decision is made, then it is made on a typed facet — a test that rewords the reason text does not change the routing outcome
- Given a fresh adverse (blocking) verdict with a matching stamp, when classification runs, then it still routes (named-route) — identity checking does not convert genuine failures into endless reruns

### Done When
- [ ] Classifier unit tests cover: mismatch⇒rerun, matching-adverse⇒route, exhaustion⇒needs-human halt with artifact+both-identities in the reason
- [ ] The halt rides the existing seam so the committed halt record carries the same detail
- [ ] No new retry budget, config key, or event member is introduced (diff inspection)

## Story 5: Recovery is clear-and-rerun — no hand-deletion

As an operator, I want clearing the halt to be sufficient so that recovery does not require knowing which `.pipeline/` files to delete.

### Acceptance Criteria

#### Happy Path
- Given a stale-identity halt was cleared (HALT + HALT.class removed), when the daemon re-dispatches the feature, then the re-run treats prior-identity artifacts as absent input and a fresh audit runs

#### Negative Paths
- Given the prior lap's stale report and marker are still on disk after halt-clear, when the re-dispatched gate evaluates before the fresh audit writes, then the stale pair does not reproduce the halt (the failure mode where clearing alone re-halted is gone)
- Given the fresh audit then writes a stamped blocking verdict, when the gate evaluates, then the blocking verdict is honored — recovery does not whitewash genuine findings

### Done When
- [ ] An integration test reproduces #1838's recovery: stale artifacts present, halt cleared, re-dispatch succeeds without any manual `.pipeline/` deletion
- [ ] A companion test proves a fresh stamped blocking verdict after recovery is still honored (no whitewash)

## Story 6: Unstamped artifacts fall back to mtime; kill-switch reverts cleanly

As the engine, I want legacy artifacts and disabled deployments to behave exactly as today so that the contract rolls out and reverts safely.

### Acceptance Criteria

#### Happy Path
- Given a verdict artifact with no run-identity stamp (written pre-upgrade), when readers evaluate it, then today's mtime-floor behavior applies unchanged
- Given the existing gate-code-validity kill-switch is off, when the gates run, then identity checking is bypassed and pure mtime behavior applies end-to-end

#### Negative Paths
- Given an unstamped stale artifact, when readers evaluate it, then it is not treated as MORE trusted than today (fallback never widens acceptance)
- Given a corrupt/unparseable sidecar, when the identity helper reads it, then it degrades to the unstamped path without throwing

### Done When
- [ ] Fallback tests: unstamped-fresh passes, unstamped-stale fails, identical to pre-change behavior
- [ ] Kill-switch test: with the flag off, no identity comparison occurs and existing suites pass unchanged

## Story 7: manual_test composes with its whitewash machinery

As the manual_test gate, I want run identity added without weakening the #367 guards so that anti-whitewash behavior is preserved.

### Acceptance Criteria

#### Happy Path
- Given a manual-test run appends its `## Attempt N` section and the engine stamps the run identity, when the gate evaluates, then the latest attempt section is judged exactly as today plus the identity check

#### Negative Paths
- Given results flip FAIL→PASS with HEAD unmoved, when the gate evaluates, then the whitewash guard still blocks regardless of a matching run-identity stamp
- Given the results file was not appended this dispatch (prior lap's latest section only), when the gate evaluates, then the identity check scores "no fresh verdict" instead of re-judging the old section

### Done When
- [ ] Existing #367 whitewash tests pass unchanged with identity stamping enabled
- [ ] A stale-section test proves the prior lap's attempt section is never re-judged as current
