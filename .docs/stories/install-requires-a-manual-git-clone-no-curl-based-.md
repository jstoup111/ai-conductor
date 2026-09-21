**Status:** Accepted

# Stories: one-line installer (jstoup111/ai-conductor#1712)

PRD: `.docs/specs/2026-09-18-install-requires-a-manual-git-clone-no-curl-based-.md`

Terms used below: **the one-liner** is the published install command piped into the system shell;
**the canonical location** is `~/.ai-conductor/harness`; **the existing installer** and **the existing
updater** are the install and update flows the harness already ships.

## Story 1: Fresh install from one command

**Requirement:** FR-1, FR-2, FR-3

As a new consumer, I want to install the harness by pasting one command so that I do not have to fetch it by hand or configure code-host credentials first.

### Acceptance Criteria

#### Happy Path
- Given a machine with every prerequisite, no harness at the canonical location, and no code-host credentials, when the one-liner runs, then a complete harness checkout exists at the canonical location, acquired over anonymous HTTPS, and the run exits 0.
- Given the same machine, when the one-liner runs, then the existing installer is run from the canonical location and the resulting machine state matches what a manual install on the same channel produces.
- Given the same machine, when the one-liner runs, then before acquiring anything it prints the canonical location and the channel it will install.

#### Negative Paths
- Given the one-liner's own download is cut off part-way through, when the shell receives the truncated text, then nothing is acquired and nothing is installed.

### Done When
- [ ] An automated end-to-end test runs the script against a local stand-in for the published repository, with an isolated home directory, and finds a git checkout at the canonical location and exit 0.
- [ ] The same test proves the existing installer was invoked from the canonical location.
- [ ] A test feeds the script truncated at several points to the shell and proves no acquisition or install step ran.

## Story 2: Choosing channel and providers

**Requirement:** FR-4, FR-5

As an existing consumer on a new machine, I want to pick my update channel and providers on the one-liner so that the install needs no interactive prompt.

### Acceptance Criteria

#### Happy Path
- Given no channel is supplied and no terminal is attached, when the one-liner runs, then the stable channel is acquired and the existing installer records its documented stable fallback.
- Given a channel is supplied either as an option after the shell's argument separator or through the existing channel environment variable, when the one-liner runs, then the harness is acquired at that channel's released ref (stable branch for stable, main branch for main, newest semver tag for tagged) and the existing installer records that channel.
- Given providers are supplied, when the one-liner runs, then the existing installer receives exactly that provider selection.
- Given both an option and the environment variable name a channel, when the one-liner runs, then the option wins, matching the existing installer's precedence.

#### Negative Paths
- Given the tagged channel is chosen and the repository has no semver tag reachable, when the one-liner runs, then it exits non-zero naming the missing tag and leaves the canonical location absent.

### Done When
- [ ] The end-to-end test asserts the checked-out ref for each of stable, main, and tagged.
- [ ] The test asserts the channel and provider values reach the existing installer unchanged, for both the option form and the environment form.

## Story 3: Rejecting bad options before touching anything

**Requirement:** FR-6

As a consumer, I want a mistyped option rejected immediately so that a typo never leaves a half-configured machine.

### Acceptance Criteria

#### Happy Path
- Given a help option, when the one-liner runs, then usage listing the channel and provider options is printed and the run exits 0 without acquiring anything.

#### Negative Paths
- Given an unrecognized option, when the one-liner runs, then it exits non-zero naming the option, and nothing is acquired or changed.
- Given a channel value other than stable, tagged, or main, when the one-liner runs, then it exits non-zero naming the bad value and the three accepted ones, and nothing is acquired or changed.
- Given a provider value the existing installer does not accept, when the one-liner runs, then it exits non-zero naming the bad value and the accepted ones, and nothing is acquired or changed.

### Done When
- [ ] Tests for each rejection assert a non-zero exit, the named value in the message, and that the canonical location does not exist afterward.

## Story 4: Prerequisite check before any change

**Requirement:** FR-7

As a new consumer, I want to be told everything my machine is missing in one pass so that I can fix it all before retrying.

### Acceptance Criteria

#### Happy Path
- Given every documented prerequisite (git, the GitHub CLI, Node.js, npm, tmux, and python3 with PyYAML) is present, when the one-liner runs, then the prerequisite check passes silently and the install proceeds.

#### Negative Paths
- Given two prerequisites are missing, when the one-liner runs, then it exits non-zero with one message naming both, and the canonical location does not exist afterward.
- Given python3 is present but PyYAML is not importable, when the one-liner runs, then PyYAML is named as missing and nothing is acquired.

### Done When
- [ ] A test with a restricted command search path proves every missing prerequisite is named in a single run and nothing was acquired.

## Story 5: Re-running updates instead of installing twice

**Requirement:** FR-8

As an installed consumer, I want the same one-liner to bring me up to date so that I never need a second procedure or end up with two installations.

### Acceptance Criteria

#### Happy Path
- Given the canonical location holds a harness checkout that is already current, when the one-liner runs, then it reports that the installation is current, exits 0, and the checkout's commit is unchanged.
- Given the canonical location holds a harness checkout that is behind its channel, when the one-liner runs, then the existing updater is invoked from that checkout and no new acquisition happens.

#### Negative Paths
- Given the existing updater fails, when the one-liner runs, then the one-liner exits with the updater's non-zero status and its message, and the checkout is left as the updater left it.
- Given two runs of the one-liner start at the same moment on a fresh machine, when both reach acquisition, then exactly one checkout results and the losing run exits non-zero or hands off to the update path — never a corrupted or duplicated installation.

### Done When
- [ ] A test runs the script twice and asserts one checkout, a second-run exit 0, and that the second run invoked the existing updater rather than acquiring.
- [ ] A test with a failing stand-in updater asserts the exit status is propagated.

## Story 6: Refusing a directory that is not ours

**Requirement:** FR-9

As a consumer, I want the installer to leave an unrelated directory alone so that it never overwrites my files.

### Acceptance Criteria

#### Happy Path
- Given the canonical location does not exist but its parent already holds the harness's user configuration, when the one-liner runs, then the install proceeds and the existing configuration file is byte-for-byte unchanged by acquisition.

#### Negative Paths
- Given the canonical location exists and is not a git checkout, when the one-liner runs, then it exits non-zero naming the location, and the directory's contents are byte-for-byte unchanged.
- Given the canonical location is a git checkout whose origin is some other repository, when the one-liner runs, then it exits non-zero naming the location and the unexpected origin, and nothing is changed.

### Done When
- [ ] Tests for both refusals compare a content listing of the directory before and after and find them identical.

## Story 7: Acquisition failure leaves nothing behind

**Requirement:** FR-10

As a consumer on an unreliable network, I want a failed download to leave a clean slate so that retrying just works.

### Acceptance Criteria

#### Happy Path
- Given a previous run failed during acquisition, when the one-liner runs again with the network restored, then it performs a fresh install and exits 0.

#### Negative Paths
- Given the repository cannot be reached, when the one-liner runs, then it exits non-zero with a message naming the address it could not reach, and the canonical location does not exist afterward.
- Given acquisition is interrupted part-way, when the run ends, then no directory remains at the canonical location that a later run would treat as an installation.

### Done When
- [ ] A test pointing the script at an unreachable source asserts non-zero exit and an absent canonical location, then re-runs against a reachable source and asserts success.

## Story 8: Hand-fetched installations are untouched

**Requirement:** FR-11

As a consumer with a hand-fetched installation, I want nothing about it to change so that this feature costs me nothing.

### Acceptance Criteria

#### Happy Path
- Given a hand-fetched checkout at some other location and no use of the one-liner, when its existing installer and updater are run, then they behave exactly as before this feature.

#### Negative Paths
- Given a hand-fetched checkout at some other location, when the one-liner runs, then that checkout's files and git state are byte-for-byte unchanged, and the one-liner installs to the canonical location only.

### Done When
- [ ] A test places a second checkout outside the canonical location, runs the script, and asserts that checkout's commit and working tree are unchanged.
- [ ] The existing installer and updater test suites pass unmodified.

## Story 9: The published command only delivers released code

**Requirement:** FR-12

As a new consumer, I want the default one-liner to give me released code so that I never run in-flight work by accident.

### Acceptance Criteria

#### Happy Path
- Given the documentation site publishes its documentation tree from the released branch, when the site configuration is inspected, then the install script sits inside that tree and is not excluded from publication.
- Given the script is also reachable inside a checkout at a second, conventional path, when the two paths are compared, then they resolve to the same single file, so they can never drift.

#### Negative Paths
- Given the documentation site's build would transform or drop the script, when the site is built, then an automated check fails — the script must be published verbatim as a plain file.

### Done When
- [ ] A repository check asserts the script exists in the published documentation tree as a regular file with no site-generator front matter, and that the second path is a link to it.
- [ ] The same check asserts the site configuration does not exclude the script.
