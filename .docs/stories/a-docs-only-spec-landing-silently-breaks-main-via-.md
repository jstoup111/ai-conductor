**Status:** Accepted

# Stories: Docs-only spec landings cannot silently break main through the live `.docs/` corpus (#3130)

Technical track, tier S. Source: jstoup111/ai-conductor#3130. Approved approach: the default-suite
tests whose verdict depends on the live repository `.docs/` corpus become one test tier; projection
limit checks in that tier assert that the shipped limits admit the live corpus instead of asserting
equality with recorded maxima; and CI runs that tier on every docs-only pull request, gated by
`ci-gate`. The PRD-audit recorded maxima are re-derived from the corpus at BUILD, as the 2026-09-30
PRD-audit architecture review (decision 1) prescribes.

Scope boundary (from the track marker): the PRD-audit, remediation, and as-built projection limit
checks, the ADR decision-corpus and ADR approval-corpus checks, and the KPI report's pinned
shipped-record check. Excluded: running the full conductor suite on docs-only PRs, post-merge CI
on main, and a `compose land` projection-limit gate.

## Story 1: Projection limit checks accept a new largest artifact that the limits still admit

**Requirement:** #3130 outcomes — a new largest planning artifact does not require a hand-edited engine constant to keep main green; the limits still admit every normal input and still bound the total envelope.

As a spec author landing a plan, stories, PRD, or coherence file larger than any before it, I want
the projection limit checks to pass whenever the shipped limits still admit that file, so that a
normal docs landing never needs an engine-constant edit to keep main green.

### Acceptance Criteria

#### Happy Path
- Given the live `.docs/` corpus gains a coherence file larger than the recorded PRD-audit coherence maximum but no larger than the shipped coherence limit, when the PRD-audit projection limit check runs, then it passes.
- Given the live `.docs/plans` corpus gains a plan whose serialized task section is larger than the recorded remediation tasks maximum but no larger than the shipped remediation tasks limit, when the remediation projection limit check runs, then it passes.
- Given this feature's BUILD, when the PRD-audit recorded maxima are compared with the live corpus at that BUILD, then every recorded maximum is at least the largest corresponding live input, so each derived limit admits the 68,397-byte coherence file already on main.
- Given the shipped PRD-audit and remediation limits, when the limit checks run, then every component limit and the total envelope are still finite, positive, and equal to their documented derivation from the recorded maxima, floors, and envelope overhead.

#### Negative Paths
- Given a live `.docs/coherence/` file larger than the shipped PRD-audit coherence limit, when the PRD-audit projection limit check runs, then it fails and its message names the dimension, the measured largest size, and the limit.
- Given a live `.docs/plans` file whose serialized task section exceeds the shipped remediation tasks limit, when the remediation projection limit check runs, then it fails naming the dimension, the measured size, and the limit.
- Given a shipped limit is changed so that it no longer equals its documented derivation from the recorded maxima, floors, and envelope overhead, when the limit check runs, then it fails even though the live corpus is admitted.

### Done When
- [ ] The PRD-audit and remediation corpus limit checks assert that each shipped limit is at least the largest corresponding live input, and neither asserts equality between a recorded maximum and the live corpus.
- [ ] `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` is re-recorded from the corpus at BUILD with the source artifact and measured size noted beside each changed constant, and the PRD-audit corpus check passes against the current main corpus.
- [ ] A test that substitutes a corpus with one over-limit file per checked dimension proves the admission check fails with the dimension, measured size, and limit in its message.

## Story 2: Docs-only pull requests run every live-corpus check

**Requirement:** #3130 outcome — landing a docs-only spec cannot leave main failing a test that the landing PR's own CI did not run; a bound that must change is caught on the PR that causes it.

As a maintainer of this repository, I want every default-suite check whose verdict depends on the
live `.docs/` corpus to run on docs-only pull requests and gate their merge, so that a docs landing
which would break one of those checks fails on its own PR instead of on the next unrelated PR.

### Acceptance Criteria

#### Happy Path
- Given a pull request whose every changed path is under `.docs/`, when CI runs, then a live-corpus job runs exactly the live-corpus test tier and `ci-gate` reports its result.
- Given a pull request that changes any path outside `.docs/`, when CI runs, then the live-corpus job is skipped and the full conductor suite, which still includes the live-corpus tier, runs as before.
- Given the live-corpus tier, when the default conductor suite runs locally or in the `conductor` shards, then every live-corpus check still runs exactly once in that suite.
- Given a docs-only pull request whose corpus passes every live-corpus check, when CI completes, then `ci-gate` is satisfied.

#### Negative Paths
- Given a docs-only pull request that adds a coherence file larger than the shipped PRD-audit coherence limit, when CI runs, then the live-corpus job fails and `ci-gate` fails on that pull request.
- Given a docs-only pull request that adds an APPROVED ADR whose numbered decision cannot be cited, when CI runs, then the live-corpus job fails and `ci-gate` fails on that pull request.
- Given the CI workflow loses the live-corpus job, its docs-only condition, its `ci-gate` dependency, or its tier selection, when the structural CI wiring test runs, then it fails naming the missing wiring.
- Given the live-corpus tier directory contains no test files, when the structural CI wiring test runs, then it fails rather than letting the job pass vacuously.

### Done When
- [ ] The PRD-audit, remediation, and as-built projection corpus limit checks, the ADR decision-corpus checks, the ADR approval-corpus check, and the KPI pinned shipped-record check live in one live-corpus test tier and no longer live in their former files.
- [ ] `.github/workflows/ci.yml` has a job that runs only that tier when `docs_only` is true, and `ci-gate` lists it in `needs` and fails on its `failure` or `cancelled` result.
- [ ] A structural test asserts the job, its docs-only condition, its tier selection, its `ci-gate` wiring, and a non-empty tier.
- [ ] Repository test-authoring guidance states that a test whose verdict depends on the live `.docs/` corpus belongs in the live-corpus tier.
