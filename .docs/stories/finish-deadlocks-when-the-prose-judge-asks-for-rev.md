**Status:** Accepted

# Stories: FINISH prose revision lap (issue #2006)

Technical track — acceptance criteria derive from the intake desired outcomes and the approved
design (adr-2026-08-13 amendment 2026-08-28; adr-2026-08-01 D4 note).

## Story 1: Observation expresses judged-deficient prose

As the FINISH publication coordinator, I want the observation snapshot to classify authored prose
whose current revision carries a persisted deficient verdict as `revision_required`, so that
routing can distinguish "never judged" from "judged and found deficient".

### Acceptance Criteria

#### Happy Path
- Given a PR whose observed title/body revision digest has a persisted `revision_required` verdict with reason `structurally_incomplete` in the prose-judgment store, when publication state is observed, then the snapshot reports `pr.prose = 'revision_required'`
- Given a PR whose observed revision digest has a persisted `revision_required` verdict with reason `placeholder`, when publication state is observed, then the snapshot reports `pr.prose = 'revision_required'`
- Given a PR whose observed revision digest has a persisted `accepted` verdict, when publication state is observed, then the snapshot reports `pr.prose = 'accepted'` exactly as before

#### Negative Paths
- Given a PR whose body was edited after the deficient verdict was persisted (observed revision digest no longer matches any stored verdict), when publication state is observed, then the snapshot reports `pr.prose = 'stale'` and the new revision is eligible for a fresh judgment
- Given a PR carrying a halt signal (needs-remediation label, title prefix, banner, or body marker) whose revision digest also has a persisted deficient verdict, when publication state is observed, then the snapshot reports `pr.prose = 'halt'` — halt classification strictly precedes `revision_required`
- Given a persisted `revision_required` verdict with reason `halt` for the observed revision, when publication state is observed, then the snapshot does NOT report `revision_required` (that verdict keeps its human-required routing and never enters the authoring lap)
- Given a missing, unreadable, or malformed prose-judgment store, when publication state is observed, then observation does not throw and authored prose reports `stale` (today's behavior — degrades to a fresh judgment, never to a halt)
- Given an engine-floored placeholder body whose digest coincidentally has a stored verdict, when publication state is observed, then the snapshot reports `placeholder` (placeholder detection precedes verdict lookup)

### Done When
- [ ] The `PublicationSnapshot` prose union includes `revision_required`, and every match site over the union compiles exhaustively with no catch-all branch treating it as `stale`
- [ ] A unit test drives the observation function with a faked store carrying each verdict kind/reason and asserts the exact prose classification for each of the paths above
- [ ] Classification precedence is asserted by test as: empty → `placeholder`, halt signal → `halt`, floored body → `placeholder`, accepted verdict → `accepted`, deficient verdict (placeholder|structurally_incomplete) → `revision_required`, otherwise → `stale`

## Story 2: Selector routes judged-deficient prose to authoring — the deadlock is gone

As the FINISH publication coordinator, I want `revision_required` prose to select the authoring
transition, so that the judge's revision request reaches the authoring pass the engine already
routes to, without operator intervention.

### Acceptance Criteria

#### Happy Path
- Given a snapshot with `pr.prose = 'revision_required'` (identity `one`, branch pushed, release readiness valid), when the next publication transition is selected, then it is `author_pr_prose`
- Given a judgment that returns `revision_required`/`structurally_incomplete` and persists it, when the resulting `author_pr_prose` retry is reconciled against a fresh observation, then the fresh observation also selects `author_pr_prose` and the retry proceeds instead of resolving `human_required: publication_transition_unmoved`

#### Negative Paths
- Given a snapshot with `pr.prose = 'revision_required'` but a halted PR (`pr.halted = true`), when a publication retry is reconciled, then the result is `human_required: halt_state_pr` before any authoring or judgment dispatch
- Given a snapshot with `pr.prose = 'stale'` (no persisted deficient verdict), when the next transition is selected, then it remains `judge_pr_prose` — the selector routes to authoring only on the persisted-verdict evidence
- Given a retry naming a transition the fresh observation genuinely does not select (any non-prose example, e.g. a `write_shipped_record` retry after the record appears), when the retry is reconciled, then it still resolves `human_required: publication_transition_unmoved` — the guard's original purpose is intact

### Done When
- [ ] A unit test over the selector asserts `revision_required` → `author_pr_prose` with all upstream dimensions valid
- [ ] A coordinator-level test reproduces issue #2006's exact cycle (authored body, persisted `structurally_incomplete` verdict for its digest) and asserts the dispatch advances into the authoring transition instead of halting `publication_transition_unmoved`
- [ ] An unchanged test still proves the reconcile guard halts on a genuinely unselectable retry

## Story 3: The authoring pass receives the judge's objection and produces a re-judged revision

As the PR-prose authoring pass, I want the judge's concrete objection delivered with the authoring
request when the verdict carried one, so that the rewrite addresses what the judge found deficient,
and the new revision earns a fresh judgment.

### Acceptance Criteria

#### Happy Path
- Given a persisted deficient verdict carrying a non-empty `detail`, when the authoring transition dispatches its request, then the request includes that detail as revision guidance and the rendered provider task contains it
- Given an authoring pass that rewrites the body (new revision digest, no persisted verdict for it), when publication state is re-observed, then prose reports `stale` and the next selected transition is `judge_pr_prose` — the lap continues through the real judge

#### Negative Paths
- Given a persisted deficient verdict with no `detail` (as on PR #1946), when the authoring transition dispatches, then the request carries no guidance field and the authoring pass still runs its full rewrite — absence of detail never blocks the lap
- Given an authoring pass that returns a byte-identical revision (digest unchanged, deficient verdict still applies), when the post-effect observation is evaluated, then the advance-path dimension guard reports the authoring transition as not having moved `pr.prose` and resolves `human_required` — an unproductive authoring pass cannot silently loop

### Done When
- [ ] The authoring request type carries an optional judge-objection field; a test asserts it is populated from the persisted verdict's `detail` and omitted when absent
- [ ] A test drives author→re-observe→judge with fakes and asserts the new revision is judged (provider judgment dispatched for the new digest) rather than reusing the old verdict
- [ ] A test asserts the identical-revision authoring outcome resolves `human_required` via the existing dimension guard

## Story 4: Non-convergence terminates at the existing bound, and prose halts carry the objection

As an operator, I want repeated author-then-judge laps to stop at the existing bounded
publication-progress allowance with a halt that states the judge's concrete objection when one
exists, so that a non-converging judge costs bounded provider spend and the halt is actionable.

### Acceptance Criteria

#### Happy Path
- Given a judge that returns `revision_required`/`structurally_incomplete` with detail for every revision the author produces, when FINISH runs, then author→judge laps repeat only until the existing publication-progress allowance is exhausted and the run halts rather than looping
- Given a prose-related `human_required` halt whose originating verdict carried a `detail`, when the halt reason is rendered, then the rendered text includes that detail verbatim

#### Negative Paths
- Given a prose-related `human_required` halt whose originating verdict carried no `detail`, when the halt reason is rendered, then the message still names the condition and next action without an empty or placeholder detail clause
- Given a converging lap (second revision accepted), when FINISH runs, then no allowance-exhaustion halt occurs and publication proceeds to the shipped record — the bound only fires on genuine non-convergence

### Done When
- [ ] A coordinator test with an always-deficient fake judge asserts the run terminates via the existing allowance (no new counter, no config knob) and the terminal halt text includes the judge's last objection detail
- [ ] The existing allowance constants and derivation are unchanged by the diff
- [ ] A test asserts halt rendering with and without verdict detail

## Story 5: The provider verdict contract documents the lap

As the FINISH judgment decoder, I want the documented verdict contract to match the shipped
vocabulary and routing, so that the load-bearing contract tests and the provider prompt stay in
agreement with the engine.

### Acceptance Criteria

#### Happy Path
- Given the shipped verdict vocabulary, when the judgment decoder's contract tests run against the documented contract in the finish skill, then they pass with the documented verdict set matching the decoder exactly
- Given the judge prompt contract, when a `revision_required` verdict is rendered by the provider, then the contract instructs it to include a concrete objection `detail` describing what is deficient

#### Negative Paths
- Given a provider reply that omits `detail` on a `revision_required` verdict, when the reply is decoded, then it decodes successfully as a detail-less revision requirement — the contract requests detail but the decoder never rejects its absence
- Given an undecodable provider reply, when it is decoded, then it still maps to `malformed_response` and earns a fresh judgment session — unchanged routing

### Done When
- [ ] The finish skill's documented verdict contract section reflects the revision lap (deficient verdicts route to authoring; detail requested) and the decoder contract tests pass against it
- [ ] Decoder behavior for `malformed_response`, `refused`, `timed_out`, and `provider_unavailable` is asserted unchanged
