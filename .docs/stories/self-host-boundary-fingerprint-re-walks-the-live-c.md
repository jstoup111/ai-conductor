**Status:** Accepted

# Stories: One live-boundary snapshot per self-host dispatch

Source: jstoup111/ai-conductor#3621. Technical track, Tier S. A "dispatch" below is one admitted self-host step dispatch (one `LiveBoundaryCoordinator.runDispatch`); for `build_review` it is one lap. A "candidate preparation" is any call of the dispatch's self-host candidate preparation, including the baseline preparations a multi-provider rubric runs before its reviewers start.

## Story 1: A dispatch walks the live checkout once to fingerprint and once to verify

**Requirement:** #3621 desired outcome 1

As the operator, I want every candidate in one self-host dispatch to share one live-boundary snapshot, so that a lap's filesystem cost does not grow with the number of rubric reviewers or providers.

### Acceptance Criteria

#### Happy Path
- Given one self-host dispatch that runs four candidate preparations of the same provider against the same live checkout, when the dispatch completes, then the live checkout is walked exactly twice in that dispatch: once to fingerprint and once to verify.
- Given one self-host dispatch whose candidates come from two providers with different provider homes, when the dispatch completes, then the live checkout is walked exactly twice and each provider home is walked exactly twice (once to fingerprint, once to verify).
- Given several candidate preparations in one dispatch that request the snapshot concurrently, when they all resolve, then a single live-checkout fingerprint walk serves every one of them.

#### Negative Paths
- Given two consecutive self-host dispatches where the provider state changed between them, when the second dispatch prepares its first candidate, then it takes a fresh snapshot instead of reusing the first dispatch's baseline, and the second dispatch verifies clean.
- Given the first fingerprint attempt in a dispatch throws, when that candidate's preparation ends, then no fingerprint event is emitted, that candidate's provider is not invoked, and the next candidate preparation in the same dispatch attempts a new fingerprint instead of reusing the failure.
- Given a dispatch in which no candidate reaches self-host preparation, when the dispatch completes, then no fingerprint is taken, no coordinator window is opened, and no verification runs.

### Done When
- [ ] A test that counts manifest walks shows four candidate preparations in one dispatch produce one live-checkout fingerprint walk and one live-checkout verify walk.
- [ ] A test with two provider homes in one dispatch shows one fingerprint walk and one verify walk per provider home.
- [ ] A test running two dispatches in sequence shows two independent snapshots, and the second dispatch verifies clean after a provider-state change made between them.

## Story 2: Live-checkout drift during any candidate still halts at the next dispatch boundary

**Requirement:** #3621 desired outcome 2

As the operator, I want the shared snapshot to detect drift made during any candidate's run exactly as the per-candidate snapshots did, so that sharing the walk never weakens the live-boundary guard.

### Acceptance Criteria

#### Happy Path
- Given one dispatch with several candidates and unproven containment, when an untracked file appears in the live checkout during any one candidate's run, then the dispatch's verification records a live-boundary violation naming that added path and the next dispatch boundary writes the mechanical HALT.
- Given one dispatch with several candidates and proven containment, when the live checkout drifts during a candidate's run, then the dispatch persists exactly one `contained_live_checkout_drift` record and exactly one `self_host_containment_verdict`, and no HALT is written.
- Given a dispatch whose candidates have all torn down when its step run settles, when the dispatch returns, then its verification has already completed, so the next dispatch boundary sees any violation it recorded.
- Given a step that succeeded while the live checkout drifted, when the next dispatch boundary is reached, then the completed step keeps its own success verdict and the run halts there with the boundary reason and a mechanical class.

#### Negative Paths
- Given a candidate that is still unwinding after its dispatch has returned, when the dispatch returns, then verification waits until that candidate tears down, and a live-checkout change made before that teardown is still recorded as a violation.
- Given a dispatcher root mutation queued while a dispatch holds a snapshot, when every candidate has torn down but the dispatch's verification has not finished, then the mutation waits until that verification finishes.
- Given a candidate whose preparation fails after the dispatch's snapshot was taken, when the dispatch ends, then the snapshot is still verified once and the dispatch's coordinator window is closed, so no later root mutation is blocked.
- Given the live checkout is restored to its snapshot state before the verification runs, when the dispatch verifies, then no violation is recorded, exactly as a per-candidate window that saw the same restore would record none.

### Done When
- [ ] A conductor test with several candidates in one dispatch writes an untracked live-checkout file during the second candidate's run and observes a mechanical HALT naming that path at the next dispatch boundary.
- [ ] A test with a candidate that tears down after its dispatch returns shows verification runs after that teardown and records a change made just before it.
- [ ] A coordinator test shows a root mutation queued during the dispatch runs only after the dispatch's single verification completes, including when a candidate's preparation failed after the snapshot.

## Story 3: The daemon log shows one fingerprint line per snapshot, not per candidate

**Requirement:** #3621 desired outcome 3

As the operator reading `.daemon/daemon.log`, I want one boundary fingerprint line per snapshot taken, so that a lap with many reviewers does not bury its own progress lines.

### Acceptance Criteria

#### Happy Path
- Given one dispatch with several candidates of one provider, when the dispatch completes, then exactly one `self_host_boundary_fingerprint` event is emitted and persisted, carrying both the `live checkout` and the `provider state` measurement, and the daemon log renders one `self-host boundary fingerprint` line for it.
- Given one dispatch whose candidates use two provider homes, when the dispatch completes, then exactly two `self_host_boundary_fingerprint` events are emitted: the first carries the `live checkout` and first `provider state` measurements, the second carries only the second home's `provider state` measurement.

#### Negative Paths
- Given a dispatch whose first fingerprint attempt throws, when the dispatch completes, then no `self_host_boundary_fingerprint` event is emitted for the failed attempt.
- Given a `self_host_boundary_fingerprint` subscriber that throws, when the event is emitted, then the candidate's provider is still invoked and the dispatch's containment verdict is still emitted.

### Done When
- [ ] A conductor test with two candidate preparations in one dispatch persists exactly one `self_host_boundary_fingerprint` event to `.pipeline/events.jsonl`, replacing the test that expected one per candidate.
- [ ] A test with two provider homes in one dispatch observes exactly two `self_host_boundary_fingerprint` events, the second carrying only a `provider state` surface.
