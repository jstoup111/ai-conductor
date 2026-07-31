# PRD Amendment: Codex Readiness Probe Failure Separation

**Date:** 2026-07-29
**Status:** Approved
**Source:** GitHub issue #1039
**Track:** Product
**Complexity:** Medium
**Amends:** #905 FR-7, FR-8, and FR-9 only; all other approved #905 requirements remain in force
**Artifact stem:** `codex-readiness-distinguishes-unavailable-doctor-p` (matches stories, plan, complexity, and coherence artifacts)
**Traceability:** FR-1 through FR-15 map to accepted Stories 1-5 and the approved 20-task plan.

**Approval:** Approved by James Stoup on 2026-07-30.

## Problem / Background

The harness currently treats two different situations as the same authentication failure: an external readiness check that affirmatively reports unusable credentials, and a check that fails to produce a trustworthy answer at all. Operators see both as one unverifiable credential state.

That ambiguity caused valid Codex credentials to be parked repeatedly for the full authentication-recovery timeout when an unrelated external check produced a new response shape. The eventual halt blamed credentials even though authentication was healthy, and retained evidence did not identify whether execution, timeout, or response interpretation had failed. Diagnosing the incident required manual reproduction outside the daemon.

A narrow precursor accepted the response shape observed in that incident. This amendment establishes the general product behavior for future readiness-check failures without changing credential selection, bounded execution, provider isolation, or affirmative credential recovery.

## Goals & Non-Goals

### Goals

- Distinguish inability to obtain a readiness answer from an affirmative credential rejection.
- Let ordinary Codex work proceed when only the readiness check is unavailable, while retaining a visible degraded diagnostic.
- Keep affirmative missing or unusable credential results blocking and recoverable through the existing bounded lifecycle.
- Make recovery from an inconclusive check bounded and attributable rather than consuming the full credential timeout under a false explanation.
- Give operators enough retained, secret-safe evidence to identify the probe failure class without reproducing the incident.
- Let operators review and tune the readiness-check timeout for their environment.

### Non-Goals

- Changing which Codex authentication source is selected or adding source fallback.
- Treating affirmative missing, rejected, expired, or unusable credentials as healthy.
- Changing provider routing, model selection, retry, escalation, rate-limit, permission, or session-recovery behavior.
- Changing Claude readiness, authentication, or recovery behavior.
- Exposing raw external diagnostic output, credential material, or credential fingerprints.
- Removing the readiness check or replacing it with substantive model work in every case.

## Users / Personas

- **Harness operator:** needs a readiness or authentication failure to name the actual failure class from retained evidence.
- **Daemon operator:** needs transient diagnostic failures to avoid hour-long false credential parks and misleading halts.
- **Autonomous daemon:** must distinguish authoritative credential evidence from unavailable evidence and take a bounded action for each.
- **Security-conscious maintainer:** needs richer diagnostics without credential or raw-payload leakage.

## Functional Requirements

- **FR-1:** Readiness reports an affirmative credential outcome separately from an outcome where the readiness check could not produce a trustworthy credential answer.
- **FR-2:** A readiness-check execution error, timeout, malformed response, unsupported response version, unrecognized response shape, conflicting source evidence, or ambiguous credential evidence is reported as a degraded probe failure rather than as missing or unusable credentials.
- **FR-3:** An ordinary unattended Codex dispatch proceeds after a degraded probe failure and retains that degradation for diagnosis.
- **FR-4:** Supported evidence that affirmatively reports the selected source as missing or unusable continues to block substantive work and enter source-specific authentication recovery.
- **FR-5:** A real Codex invocation that affirmatively rejects authentication continues to stop current work and enter source-specific authentication recovery, even if its preceding readiness check was degraded.
- **FR-6:** Retained evidence distinguishes execution error, timeout, and unparseable or unsupported response outcomes without requiring the operator to rerun the readiness check.
- **FR-7:** Retained readiness evidence contains only bounded, non-secret facts; it never contains raw diagnostic payloads, arbitrary exception text, credential values or fragments, credential paths, or credential fingerprints.
- **FR-8:** When authentication recovery is already active and its readiness check becomes degraded, recovery authorizes exactly one real Codex invocation to determine the selected source's actual state.
- **FR-9:** If that one recovery invocation succeeds or fails for a non-authentication reason, its ordinary result is authoritative and authentication recovery does not continue.
- **FR-10:** If that one recovery invocation affirmatively rejects authentication, the recovery episode ends with a probe-specific explanation identifying both the inconclusive check and the failed real invocation; it does not authorize another degraded-probe invocation cycle.
- **FR-11:** Recovery checks that continue to affirm missing or unusable credentials retain the existing bounded credential-recovery behavior and do not gain the degraded-probe trial.
- **FR-12:** Operators can configure a finite positive readiness-check timeout per project, with a documented default; invalid values are rejected rather than silently replaced.
- **FR-13:** Degraded readiness never changes authentication-source selection, provider/model fallback, retry counts, escalation state, or the classification precedence of the real invocation's rate-limit, permission, model, session, provider-availability, authentication, or ordinary result.
- **FR-14:** Every unattended Codex execution context exhibits the same degraded-readiness and bounded-recovery behavior.
- **FR-15:** Operator-visible recovery progress and terminal explanations distinguish degraded probe failure from credential failure using the same secret-safe failure classes.

## Non-Functional Requirements

- **Confidentiality:** No new diagnostic can disclose credential material, recoverable fragments, cached credential locations, raw readiness output, or unrestricted exception content.
- **Reliability:** Inability to obtain readiness evidence cannot manufacture a credential verdict; affirmative credential evidence remains authoritative.
- **Bounded recovery:** A degraded recovery check can authorize no more than one real invocation per recovery episode.
- **Diagnostic clarity:** Persisted daemon evidence is sufficient to distinguish process execution failure, timeout, response parsing/version failure, and affirmative credential rejection.
- **Determinism:** The same selected source, evidence class, and recovery-episode state produce the same disposition across every unattended call shape.
- **Backward compatibility:** All unrelated #905 behavior and all Claude behavior remain unchanged.

## Acceptance Criteria / Success Metrics

- Execution error, timeout, malformed response, unsupported response version, unrecognized response shape, conflicting source evidence, and ambiguous evidence each produce a degraded probe outcome that is distinguishable from affirmative credential failure.
- Ordinary Codex invocation begins after each degraded probe outcome and does not begin after affirmative missing or unusable evidence.
- An operator can determine the probe failure class, selected provider/source, and configured timeout where relevant from retained evidence alone.
- Adversarial secret-bearing output leaves no raw payload, credential material, path, fragment, hash, or arbitrary exception text in logs, events, state, or terminal explanations.
- Recovery authorizes at most one real invocation after an inconclusive recovery check; a real authentication rejection ends with a probe-specific explanation before the credential timeout and cannot recurse.
- Positive, default, zero, negative, non-number, and non-finite timeout cases exhibit the documented validation and default behavior.
- Representative primary, concurrent, recovery, and support execution contexts preserve identical disposition, no-fallback, no-budget, and selected-source behavior.
- Existing affirmative credential recovery, unrelated-health handling, Codex permission/rate/model/session classification, provider routing, and Claude suites remain unchanged in outcome.

## Scope

### In Scope

- Operator-visible readiness classification for inability-to-obtain-evidence outcomes.
- Ordinary dispatch behavior after degraded readiness.
- Bounded recovery behavior after a degraded recovery check.
- Secret-safe persisted diagnostic evidence and recovery explanations.
- Per-project readiness-check timeout control and validation.
- Consistency across all unattended Codex call shapes.
- Regression protection for existing credential, provider, and recovery behavior.

### Out of Scope

- Authentication-source selection or fallback.
- Credential creation, storage, refresh, rotation, or repair.
- A new credential source or hot-reload behavior.
- Changes to the external Codex client's own readiness response contract.
- Provider/model routing, retry/escalation policy, permission review, rate-limit coordination, or session behavior.
- Claude execution or authentication changes.
- New external services, persistent stores, or operator workflows.

## Key Decisions & Rationale

- **Unavailable evidence is not a credential verdict.** The daemon should report what it knows rather than convert diagnostic uncertainty into an authentication claim.
- **Real execution may settle an inconclusive check.** Ordinary work proceeds under visible degradation, and an active recovery episode receives one bounded real trial instead of another full false credential park.
- **Affirmative credential evidence remains blocking.** The amendment changes uncertainty handling, not the safety or recovery semantics for known missing or rejected credentials.
- **Diagnostics are structured and secret-safe.** Operators need failure class and bounded context, not raw external payloads that may contain credential-adjacent content.
- **Timeout behavior is reviewable per project.** Loaded or slow machines can tune the diagnostic boundary without silently changing authentication, invocation, or recovery timeouts.

## Dependencies

- The existing external Codex readiness command and its versioned, redacted summary response.
- Existing Codex substantive invocation and failure classification.
- Existing provider/source-specific authentication recovery, daemon diagnostic persistence, and event rendering.
- Existing project configuration loading and validation.

## Open Questions

- What closed representation best prevents invalid combinations between credential verdicts and degraded probe evidence?
- Which bounded response-shape facts provide useful diagnosis without retaining raw output or credential-adjacent summaries?
- How should the one permitted recovery invocation be represented so every serial, grouped, and auxiliary caller enforces the same episode bound?
- Where should the readiness timeout be resolved and injected so validation and runtime behavior cannot drift?

## Relationship to #905

This amendment replaces #905 FR-7, FR-8, and FR-9 only for failures to obtain trustworthy readiness evidence. For this case, degraded probe failure replaces blocking `unverifiable`, ordinary dispatch proceeds with retained degradation, and active recovery may perform the single bounded real invocation described above.

#905's `ready`, `missing`, and `unusable` meanings; affirmative credential blocking; selected-source behavior; no fallback; bounded authentication recovery; confidentiality; bounded execution; permission review; provider isolation; and every other #905 requirement remain authoritative.

## Verify-Claims Verdict

**CLEAR:** The operator confirmed degraded ordinary dispatch, an explicit probe-failure outcome, one real recovery invocation, and the one-trial/no-recursion bound. The conflict-check resolution confirmed that these behaviors require this narrow product amendment. No unconfirmed load-bearing product assumption remains.
