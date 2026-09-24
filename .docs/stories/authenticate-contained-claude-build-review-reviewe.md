**Status:** Accepted

# Stories: Authenticate contained Claude build_review reviewers

Track: technical (no PRD). Tier: M (negative path per criterion).
Source: jstoup111/ai-conductor#2737. Architecture: `.docs/decisions/architecture-review-2026-09-24-authenticate-contained-claude-build-review-reviewe.md`, adr-2026-07-07-daemon-owned-build-credential Decisions 6–8, adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D2.3 and D3.2.

## Story 1: A contained Claude reviewer authenticates with the daemon build token

**Requirement:** #2737 desired outcome, first bullet

As an operator running a daemon on a non-self-host project with the default setup, I want a contained Claude build_review reviewer to authenticate with the credential my daemon already holds, so that custom rubrics produce verdicts without extra setup.

### Acceptance Criteria

#### Happy Path
- Given a non-self-host project with no `build_auth` block and a readable daemon build token, when a custom-policy build_review member is dispatched to Claude under containment, then the reviewer's environment carries the daemon token as `CLAUDE_CODE_OAUTH_TOKEN` and the member settles with a judged verdict.
- Given the same project and a lap that includes a custom-policy member, when a built-in peer rubric of that lap is dispatched to Claude under containment, then that peer's environment also carries the daemon token and the peer settles with a judged verdict.
- Given a self-host project in `daemon-token` mode with a readable daemon build token, when a contained Claude member is dispatched, then its environment carries the same daemon token as `CLAUDE_CODE_OAUTH_TOKEN`.

#### Negative Paths
- Given a reviewer launched with the daemon token, when the provider rejects it with an authentication error during the review, then the member settles with the existing retryable `provider-error` cause and not with `reviewer-credential-unavailable`.
- Given the daemon environment already carries a different `CLAUDE_CODE_OAUTH_TOKEN`, when a contained Claude reviewer's environment is built in `daemon-token` mode, then the variable holds the daemon token and not the inherited value.

### Done When
- [ ] A test drives the custom-policy containment path with a daemon-token fixture and observes `CLAUDE_CODE_OAUTH_TOKEN` equal to the fixture in the environment handed to the Claude provider launch.
- [ ] A test drives the built-in-peer containment path of a custom-policy lap with the same fixture and observes the same variable.
- [ ] A test with a conflicting inherited token observes the daemon token in the reviewer environment.
- [ ] A test shows an authentication rejection after launch settles as `provider-error`.

## Story 2: The credential follows the resolved build-auth mode without fallback

**Requirement:** #2737 desired outcome, first bullet

As an operator, I want the contained reviewer to use exactly the credential my build-auth mode names, and never silently switch credential or billing, so that reviewers behave like the rest of my daemon.

### Acceptance Criteria

#### Happy Path
- Given a project in `api-key` mode with `ANTHROPIC_API_KEY` in the daemon environment, when a contained Claude member is prepared, then the reviewer receives that key, no `CLAUDE_CODE_OAUTH_TOKEN` is added, and the daemon token file is not read.
- Given a project with no `build_auth` block, when a contained Claude member is prepared, then the credential is resolved in `daemon-token` mode, the same mode the daemon-level credential gate resolves for that project.

#### Negative Paths
- Given `daemon-token` mode whose token file is missing, empty, or unreadable, when a contained Claude member is prepared, then no reviewer is launched and the member is refused with `reviewer-credential-unavailable` naming the mode, the token path, and its state.
- Given `api-key` mode with no `ANTHROPIC_API_KEY` in the daemon environment and a readable daemon token, when a contained Claude member is prepared, then no reviewer is launched, the member is refused with `reviewer-credential-unavailable` naming the missing API key, and the daemon token is not used.
- Given any mode, when a contained Claude member is prepared, then the operator's stored Claude login under the host config directory is not read.

### Done When
- [ ] A table-driven test covers each mode and credential-state combination above and asserts the chosen credential, the environment variable name, or the refusal with its named state.
- [ ] A filesystem seam records no read of the stored Claude login path in any case.
- [ ] A test proves the reviewer's mode and the daemon gate's mode come from the same resolution for a project with no `build_auth` block.

## Story 3: Containment guarantees are unchanged when a credential is supplied

**Requirement:** #2737 desired outcome, second bullet

As an operator relying on review containment, I want authentication to add exactly one value and nothing else, so that a reviewer still cannot write protected paths or read host state beyond what authentication requires.

### Acceptance Criteria

#### Happy Path
- Given a contained Claude member dispatched with the daemon token, when the reviewer is launched, then its mount set, write probes, and host-state probe are identical to a dispatch without a credential and its environment differs only by the one credential variable.
- Given a contained Claude member dispatched with the daemon token, when review scratch is inspected after launch preparation, then it contains no credential file and no copy of the host Claude config directory.

#### Negative Paths
- Given the daemon environment also holds tracker or other-provider secrets such as `GITHUB_TOKEN` and `OPENAI_API_KEY`, when a contained Claude reviewer environment is built, then none of them is present.
- Given a resolved credential, when events, refusal detail, halt bodies, and daemon log lines for the lap are inspected, then the credential value appears in none of them.
- Given a contained Codex member in the same lap, when its environment is built, then it carries no Claude credential and its seeded Codex login behaves as before.
- Given a non-contained Claude step in the same non-self-host run, when its environment is built, then no daemon token is added to it.

### Done When
- [ ] A test compares mount arguments and probe results for a dispatch with and without the credential and finds them equal.
- [ ] A test lists review scratch after preparation and finds no credential file.
- [ ] A test searches every emitted event payload, refusal detail, and halt body in a lap for the fixture token value and finds none.
- [ ] Tests show Codex reviewer and non-contained Claude step environments unchanged.

## Story 4: A missing credential halts before any review attempt is spent

**Requirement:** #2737 desired outcome, third bullet

As an operator, I want a build_review that cannot authenticate to stop immediately and tell me which credential is missing, so that I do not lose three review laps to `Not logged in`.

### Acceptance Criteria

#### Happy Path
- Given `daemon-token` mode and no daemon token file, when a lap with a contained Claude member runs, then no Claude reviewer is launched, the member settles with `reviewer-credential-unavailable`, and the feature halts `needs-human` with a body naming the mode, the token path and its state, and the shared build-auth remediation message.
- Given that refusal, when the build_review ledger is read afterwards, then the mechanical-fault counter is unchanged and no kickback budget was consumed.

#### Negative Paths
- Given the operator clears that halt without supplying a credential, when build_review runs again, then it refuses again in the same way before any reviewer launch and the mechanical-fault counter is still unchanged.
- Given a lap whose settled cause is `projection-oversized`, when it is routed after this change, then it still publishes its aggregate, skips the mechanical-fault counter, and halts `needs-human` exactly as before.
- Given a lap whose Claude member fails with a transient `provider-error`, when it is routed after this change, then it still consumes one mechanical-fault lap and re-runs under the existing allowance.
- Given a built-in-only lap with no custom member, when it runs without a daemon token, then its dispatch and enablement behave as before this change and no credential refusal is raised.

### Done When
- [ ] A test runs a lap with no daemon token and asserts zero provider launches, the `reviewer-credential-unavailable` cause on the `build_review_rubric_infrastructure_failure` event, a `needs-human` halt, and an unchanged mechanical-fault counter.
- [ ] The halt body contains the mode, the token path, its state, and the shared remediation text.
- [ ] Regression tests show `projection-oversized` and `provider-error` routing unchanged.
