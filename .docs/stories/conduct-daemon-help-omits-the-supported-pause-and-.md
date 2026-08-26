**Status:** Accepted

# Stories: conduct daemon --help omits the supported pause and resume verbs

Source: jstoup111/ai-conductor#1850
Track: technical (tier S)

## Story 1: Help lists the pause and resume verbs

As an operator under time pressure, I want `conduct daemon --help` to list every verb the daemon dispatcher accepts, so that I can pause and resume dispatch without hand-editing files under `.daemon/`.

### Acceptance Criteria

#### Happy Path
- Given the built CLI, when the operator runs `conduct daemon --help`, then the output lists `pause` and `resume` in the daemon command list, each with a one-line description
- Given the built CLI, when the operator runs `conduct daemon --help`, then the `pause` description states it halts dispatch (writes the pause marker) and the `resume` description states it resumes dispatch, without instructing any manual `.daemon/` file edit

#### Negative Paths
- Given the help declarations exist only for documentation, when `conduct daemon pause` is invoked, then it is still dispatched by the pre-boot supervisor dispatcher (never routed to a commander action or a daemon run), and prints `daemon paused` or `already paused`

### Done When
- [ ] `conduct daemon --help` output contains a `pause` line and a `resume` line in the daemon subcommand list, each with a non-empty one-line description
- [ ] The rendered help for the daemon subtree includes per-verb sections for `pause` and `resume` (matching the existing pattern for `start`/`stop`/`restart`)
- [ ] `conduct daemon pause` and `conduct daemon resume` behavior is unchanged (verbs still dispatch through the supervisor path)

## Story 2: Help output cannot drift from the dispatcher verb set

As a maintainer, I want a mechanical check that the daemon help names every dispatcher-accepted verb, so that a verb added to the dispatcher later cannot ship without appearing in help.

### Acceptance Criteria

#### Happy Path
- Given the current dispatcher verb set (management verbs plus the observe/park sub-verbs), when the drift test runs against the rendered daemon help, then it passes because every dispatcher-accepted verb name appears as a declared subcommand in the help output

#### Negative Paths
- Given a verb present in the dispatcher's accepted verb set but absent from the daemon help declarations, when the drift test runs, then it fails and its failure message names the missing verb

### Done When
- [ ] A unit test derives the daemon verb set from the same module the dispatcher uses (`src/conductor/src/engine/daemon-command.ts`) — not from a hand-copied list in the test — and asserts every verb appears as a declared subcommand name in `renderDaemonHelp()` output
- [ ] The test fails with a message naming any dispatcher verb missing from help (demonstrated by the pre-fix state: `pause`/`resume` would fail it)
- [ ] The test runs in the default suite (no external services, no smoke opt-in)
