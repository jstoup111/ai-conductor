**Status:** Accepted

# Stories: Stage intake outcomes for an unclaimed source ref (#1340)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is body resolution for a by-ref idea, the worktree-time report when no outcome layer could be staged, and the coherence refusal's never-staged branch. Reconciliation with the neighbouring land-message defect and any gate redesign remain outside this slice.

## Story 1: Stage the same outcome layer for an unclaimed source ref as for a claimed one

As an operator pointing the composer loop at a specific issue, I want the outcome layer staged from the issue itself so that a by-ref idea reaches the land gate with the same traceability layer a dequeued idea has.

### Acceptance Criteria

#### Happy Path

- Given a source ref with no persisted claim record and no explicit body argument, when the per-idea worktree is created, then the worktree carries a staged outcomes file naming that ref and every verbatim Desired-outcome bullet of the referenced issue.
- Given a persisted claim record or an explicit body argument for the same ref, when the per-idea worktree is created, then that body is staged and no issue lookup is performed.

#### Negative Paths

- Given the issue lookup fails or reports the issue does not exist, when the per-idea worktree is created, then the command still succeeds, the worktree exists, and no staged outcomes file is written.
- Given a source ref that the GitHub issue-reference grammar cannot parse, when the per-idea worktree is created, then no issue lookup is attempted and the command still succeeds with the worktree present.

### Done When

- [ ] A command-level fixture with an injected tracker runner and no claim record produces a staged outcomes file whose reference line and bullet list match the injected issue body.
- [ ] A claim-record fixture and an explicit-body fixture each record zero issue-view invocations on the injected runner.
- [ ] Lookup-failure, issue-not-found, and unparseable-reference fixtures each exit zero with the worktree directory present and no staged outcomes file.

## Story 2: Report a missing outcome layer while the worktree is being created

As an operator, I want to learn that no outcome layer could be staged at the moment the worktree is created so that I am not told several steps later by a gate naming the wrong artifact.

### Acceptance Criteria

#### Happy Path

- Given a source ref whose Desired-outcome body could not be resolved from any source, when the per-idea worktree is created, then the command's diagnostic output names the source ref, the staging file that was not written, and the argument that supplies the body directly.

#### Negative Paths

- Given an idea with no source ref at all, when the per-idea worktree is created, then no missing-outcome diagnostic is emitted and the outcome layer stays not required, exactly as before.
- Given a source ref whose body resolved but carries no Desired-outcome bullets, when the per-idea worktree is created, then the staging file is written and no missing-outcome diagnostic is emitted.

### Done When

- [ ] An unresolvable-reference fixture captures one diagnostic line containing the source ref, the staging file path, and the body argument name.
- [ ] A no-source-ref fixture captures no missing-outcome diagnostic, exits zero, and writes no staging file.
- [ ] A resolved-but-bulletless fixture writes the staging file and captures no missing-outcome diagnostic.

## Story 3: Distinguish a never-staged outcome layer from a genuinely absent id

As an operator reading a land refusal, I want the message to say when the outcome layer was never staged so that deleting correct outcome rows is never the shortest path to a green land.

### Acceptance Criteria

#### Happy Path

- Given a coherence row cites an outcome id and the land resolved no outcome bullets at all, when the coherence gate refuses, then the refusal states that the outcome layer was never staged, names the staging file, and does not direct the operator to correct the coherence record.

#### Negative Paths

- Given a coherence row cites an outcome id beyond a non-empty resolved outcome bullet set, when the coherence gate refuses, then the refusal keeps its existing wording naming the offending row and the cited id.
- Given a coherence row cites a non-outcome id and the land resolved no outcome bullets, when the coherence gate refuses, then the refusal keeps its existing wording naming the offending row and the cited id.

### Done When

- [ ] A gate fixture with zero resolved outcome bullets and an outcome-citing row yields a refusal containing the staging file path and the never-staged explanation, and not the existing instruction to correct the coherence record.
- [ ] A gate fixture with two resolved outcome bullets and an out-of-range outcome id yields the existing refusal text unchanged.
- [ ] A gate fixture with zero resolved outcome bullets and a fabricated story citation yields the existing refusal text unchanged.

## Negative-category review

Dependency unavailability and timeouts are covered by the lookup-failure path, which must never fail worktree creation; invalid input is covered by the unparseable-reference and bulletless-body paths; data integrity is covered by the requirement that an explicit body and a persisted claim record still win over a lookup, so a stale or edited issue cannot silently displace an operator-supplied body. Partial failure is covered by the rule that a failed lookup leaves no half-written staging file and still yields a usable worktree. Authorization failure surfaces through the same lookup-failure path, because the tracker seam reports a credential refusal the same way it reports an outage, and both must degrade rather than abort. Concurrency, resource exhaustion, cascade deletion, and immutability categories are inapplicable: this slice adds one read of a single issue and one write of an already-specified gitignored file, introduces no shared mutable state, no queue, no datastore, and no deletion. Idempotency is inherent — re-running worktree creation rewrites the same staging file from the same source.
