**Status:** Accepted

# Stories: Live daemon E2E build step never runs a real agent

**Feature:** live-daemon-e2e-build-step-never-runs-a-real-agent (jstoup111/ai-conductor#1311)
**Tier:** M · **Track:** technical (no PRD — acceptance criteria live here)
**Approved ADRs:** `adr-2026-08-04-live-tier-provisions-its-own-provider-home`,
`adr-2026-08-04-unresolved-step-command-fails-by-name`

Requirement tags reference the issue's stated desired outcomes, 1-based in the order the
bullets appear under its **Desired outcome** heading:

| Tag | Desired outcome |
|---|---|
| DO-1 | The live E2E build step produces a genuine agent turn, not an immediate unknown-command return |
| DO-2 | The seeded fixture task completes with `madeCommit`, `touchedFixture`, and `taskTrailer` all true |
| DO-3 | An unavailable step command fails naming that specific cause, not a downstream empty-diff review FAIL |
| DO-4 | A genuine build regression still fails the test and is distinguishable from an environment failure |
| DO-5 | The signal holds for any harness step command the live tier dispatches, not only `/pipeline` |

---

## Story 1: The live tier provisions the commands it dispatches, from the checkout under test

**Requirement:** DO-1, DO-2

As the maintainer of the live daemon E2E tier, I want the fixture to supply the dispatched agent
with the harness skills from the repository being tested, so that the build step actually runs
instead of returning "Unknown command" in 43 milliseconds.

### Acceptance Criteria

#### Happy Path
- Given a credentialed runner with the `claude` CLI installed and no harness skills in the
  ambient environment, when the live smoke runs, then the build step's dispatch produces a
  genuine agent turn — the run reports non-zero turns and non-zero token usage rather than
  returning `Unknown command: /pipeline` with zero of both.
- Given that dispatch completes, when the smoke evaluates its outcome assertions, then
  `terminal`, `madeCommit`, `touchedFixture`, and `taskTrailer` are all true — the same
  assertion block the tier already has, now reached with real work behind it.
- Given the provisioned provider home, when its contents are inspected, then the skills it
  exposes are a **copy** taken from the repository checkout under test, not a link to it and
  not a globally installed harness catalog.
- Given the run is credentialed, when the dispatch environment is built, then the credential
  is present because the fixture supplied it explicitly — composed onto the home's environment
  rather than inherited from it.
- Given the smoke runs on a developer machine that already has a global harness install
  pointing at a different checkout, when the build step dispatches, then it resolves the
  commands from the checkout under test — the global install does not determine the result.
- Given a runner with no operator state file of any kind, when the tier runs, then it still
  passes: provisioning reads no `~/.claude.json`, no operator `settings.json`, and no global
  skill catalog.

#### Negative Paths
- Given a repository root with no `skills/` directory, when provisioning is attempted, then
  it fails closed with an error naming the missing directory and no dispatch is made.
- Given provisioning fails for any reason, when the smoke reports, then the failure identifies
  provisioning as the cause and no paid dispatch has occurred.
- Given a completed run of either outcome, when the repository checkout under test is
  inspected, then it is unchanged **including untracked paths** — no artifact written through
  into it, so a concurrent self-host build's live-boundary check cannot be tripped.
- Given the run finishes, whether it passed or failed, then the provisioned home has been
  removed and no directory is left behind.
- Given a non-Claude matrix leg, when its home is provisioned, then its credential arrives
  through that provider's own auth preparation and no `CLAUDE_CODE_OAUTH_TOKEN` is present in
  its environment.
- Given the tier runs, when the operator's own environment is inspected afterwards, then no
  global state has been written: nothing under the real `~/.claude` and no `bin/install`
  invocation.
- Given an uncredentialed runner, when the test file is loaded, then provisioning does not
  execute at all — the existing capability and credential skip predicate is evaluated first,
  and provisioning happens only inside a case that was actually selected.

---

## Story 2: A missing step command fails before any spend, naming the command

**Requirement:** DO-3, DO-5

As a maintainer reading a failed run, I want an unavailable step command to be reported by name
before the run spends anything, so that I am not paying a review dispatch to be told the diff
was empty.

### Acceptance Criteria

#### Happy Path
- Given every registry-rendered command the run can dispatch resolves in the provisioned home,
  when the preflight runs, then it passes and the run proceeds to dispatch.
- Given the preflight runs, when its cost is measured, then it makes no provider call, no
  network request, and no subprocess call — resolution is answered from the filesystem alone.

#### Negative Paths
- Given the provisioned home is missing the `pipeline` skill, when the smoke runs, then it
  fails before any dispatch with a message naming `pipeline`, the command string that would
  have been sent, and the directory that was searched.
- Given a run fails the preflight, when the dispatch record is read, then **no provider
  invocation occurred** — this is asserted from a dispatch counter, not from a token total,
  because an absent `tokenUsage` reads as zero and would make a real dispatch look free.
- Given any run of the tier, when the token meter reports, then results whose usage could not
  be parsed are counted as `unmetered` rather than as zero, so the token-cap assertion cannot
  pass on unattributed spend.
- Given the provisioned home is missing a step command other than `pipeline`, when the smoke
  runs, then it fails naming that command — the behavior is not special-cased to the build step.
- Given more than one dispatchable command is missing, when the preflight fails, then the
  message names every missing command, not only the first.
- Given an uncredentialed advisory run, when the tier executes, then it **skips** — a missing
  credential remains a skip and is never converted into a preflight failure.
- Given a provisioning or preflight failure in a run that was not skipped, when the result is
  recorded, then it is reported as `failed`, never as an unmet capability, so a gating caller
  cannot read it as an honest skip.

---

## Story 3: An unresolved step command is never reported as a successful invocation

**Requirement:** DO-3, DO-4

As the harness, I want a dispatch whose step command did not resolve to be classified as a named
failure rather than a success, so that the same defect outside this test tier is attributable at
the moment it happens.

### Acceptance Criteria

#### Happy Path
- Given a provider result whose envelope reports zero turns and a result naming the exact
  command that was dispatched as unknown, when the provider classifies it, then the result is
  unsuccessful and carries a reason identifying the unresolved command.
- Given that classification, when an operator or the conductor reads the failure, then the
  reported cause names the command, so the diagnosis does not require reconstructing it from a
  provider log line.
- Given an ordinary successful dispatch, when the provider classifies it, then it remains
  successful and no unresolved-command reason is set.

#### Negative Paths
- Given a successful multi-turn dispatch whose agent output merely mentions the phrase
  "unknown command", when the provider classifies it, then it remains a success — prose alone
  never triggers the classification.
- Given a zero-turn result that does not name the dispatched command as unknown, when the
  provider classifies it, then no unresolved-command reason is set — zero turns alone is not
  the signal.
- Given a result naming a different command than the one dispatched, when it is classified,
  then no unresolved-command reason is set.
- Given an envelope reporting zero input and zero output tokens, when the classification runs,
  then it still works: the turn count is read from the parsed envelope, not from a token-usage
  field that is never populated in that case.
- Given an unresolved-command result, when its exit code is examined, then the classification
  does not depend on the exit code — the observed failure exits 0.
- Given an unresolved-command result, when the conductor routes it, then it consumes no retry
  attempt, triggers no effort or model escalation, and walks no provider-candidate ladder —
  retrying cannot make a missing skill resolve.
- Given an unresolved-command result that produces a HALT, when the halt is written, then it
  carries an explicit class of `mechanical`, because re-provisioning resolves it.

---

## Story 4: A genuine build regression stays distinguishable from an environment failure

**Requirement:** DO-4

As a maintainer, I want a real regression in the build path to fail differently from a
provisioning problem, so that the tier keeps the diagnostic value it was built for.

### Acceptance Criteria

#### Happy Path
- Given the environment provisions correctly and the preflight passes, when the pipeline
  dispatches a real agent that fails to carry the fixture task to a finish, then the smoke
  still fails on its outcome assertions, and its output shows a resolved command and a real
  dispatch — not an environment failure.
- Given a failure of either class, when the maintainer reads the run output, then which class
  it is can be determined without re-running anything locally.

#### Negative Paths
- Given a genuine build regression, when the smoke fails, then no unresolved-command reason
  appears in its output — the two classes are never conflated.
- Given the tier's assertions, when they are reviewed, then none of them asserts a turn count,
  a dispatch count, or agent wording as an outcome, per
  `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`; turn counts appear only in
  diagnostics.
- Given a failing run of either class, when diagnostics are emitted, then the existing shared
  `dumpPipelineDiagnostics` output is still produced — this feature adds attribution, it does
  not remove evidence.

---

## Story 5: Command coverage follows the step registry, and its boundary is stated

**Requirement:** DO-5

As a maintainer adding a new step to the harness, I want the live tier's command checking to pick
it up automatically, and I want the limits of that guarantee written down rather than assumed.

### Acceptance Criteria

#### Happy Path
- Given the set of commands the preflight checks, when it is derived, then it comes from the
  central step-to-skill registry, and no skill name is written literally in the preflight.
- Given a new step with a skill is added to that registry, when the live tier runs with no
  further edit to this feature's code, then that step's command is covered by the preflight.
- Given a step declared engine-native in the registry, when the preflight runs, then it is not
  checked — an engine-native step dispatches no command and must not produce a spurious failure.

#### Negative Paths
- Given a skill name is hardcoded anywhere in the preflight, when the suite runs, then a test
  fails identifying the hardcoded name — the registry must remain the enumeration source for
  registry-rendered commands.
- Given a step declared only in project configuration — a custom step or a parallel-group
  skill override, which dispatches as its raw state key rather than through the registry —
  when the preflight's coverage is documented, then that surface is recorded as a **known
  non-covered case** rather than claimed as covered.
- Given a step is removed from the registry, when the preflight runs, then it is no longer
  checked, and no stale entry keeps the tier red.
- Given a provider whose commands render with a different prefix, when the preflight builds the
  command string it reports, then it uses the shared rendering rather than assuming a leading
  slash, so the reserved second matrix leg reports correctly.
- Given both the daemon-entry install-freshness check and this preflight exist, when their
  responsibilities are documented, then the split is explicit — install-freshness owns the
  operator's global catalog at daemon entry, the preflight owns the run's own provisioned home
  — and neither is expected to cover the other's surface.
