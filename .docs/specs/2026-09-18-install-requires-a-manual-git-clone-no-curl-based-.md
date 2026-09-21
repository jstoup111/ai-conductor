# PRD: One-line installer

**Date:** 2026-09-18
**Status:** Approved
**Source:** jstoup111/ai-conductor#1712

## Problem / Background

Installing the harness on a new machine is a multi-step, credential-gated procedure: the consumer
must choose a location, know which release branch to fetch, have SSH credentials configured with the
code host, fetch the harness by hand, and only then run the installer. Every new consumer and every
new machine pays this cost, and documentation has no single command it can embed as "how to
install". The first-run update-channel choice is now settable without a terminal prompt (#1711,
shipped), which removes the last blocker to an unattended install.

## Goals & Non-Goals

**Goals**
- A consumer on a fresh machine installs the harness by pasting one command, with no prior manual
  fetch and no code-host credentials.
- Running the same command again on an installed machine updates it (or does nothing) rather than
  producing a second installation.
- The one-line command becomes the documented primary install path (documentation accompanies this
  work; it carries no functional requirement of its own).

**Non-Goals**
- Changing what the existing installer does once it runs.
- Changing or migrating installations that were fetched by hand.
- Supporting machines that lack the harness's already-documented prerequisites.

## Users / Personas

- **New consumer** — setting the harness up for the first time; wants one command and a clear result.
- **Existing consumer on a new machine** — wants the same install everywhere, with their chosen
  update channel and providers, without an interactive prompt.
- **Existing consumer with a hand-fetched installation** — wants nothing to change.

## Functional Requirements

- **FR-1:** A consumer on a machine with no copy of the harness can install it by running a single
  published command, with no prior manual fetch step.
- **FR-2:** The one-line install acquires the harness anonymously over public HTTPS; it succeeds on a
  machine that has no credentials configured with the code host.
- **FR-3:** The one-line install places the harness at one canonical, documented location and then
  runs the existing install flow from it; on success the machine is in the same state a manual
  install on the same channel would have produced.
- **FR-4:** The consumer can choose the update channel when invoking the one-line install; the choice
  follows the existing first-run channel rules (#1711), including the documented default when none
  is given and no terminal is attached.
- **FR-5:** The consumer can choose which providers to install for when invoking the one-line install,
  with the same accepted values and default as the existing installer.
- **FR-6:** An unrecognized option or an invalid channel/provider value stops the install before
  anything is fetched or changed, with a message naming the bad value and the accepted ones.
- **FR-7:** Before fetching or changing anything, the one-line install checks for the harness's
  documented prerequisites; if any is missing it stops, names every missing prerequisite, and leaves
  the machine unchanged.
- **FR-8:** When the canonical location already holds a one-line-installed harness, re-running the
  command brings that installation up to date through the existing update behavior — or reports it
  is already current — and never creates a second installation.
- **FR-9:** When the canonical location exists but does not hold a harness installation, the install
  stops with a message naming the location and leaves its contents untouched.
- **FR-10:** A failure while acquiring the harness (for example, no network) stops the install with a
  non-zero result and a clear message, and leaves no partial installation at the canonical location
  that a later run would mistake for a complete one.
- **FR-11:** A hand-fetched installation at any other location keeps working exactly as today; the
  one-line install neither requires nor modifies it.
- **FR-12:** The published one-line command only ever delivers released harness code — never
  in-flight work.

## Non-Functional Requirements

- **Portability:** the one-line install runs under the plain system shell on the supported Linux and
  macOS platforms; it does not assume a particular interactive shell.
- **Safety:** an interrupted or truncated download of the install command itself must not execute a
  partial install.
- **Transparency:** the install prints what it is about to do and where, before doing it.

## Acceptance Criteria / Success Metrics

- On a clean machine with prerequisites and no code-host credentials, one pasted command ends with
  the installer's own health check reporting clean.
- A second run of the same command reports up-to-date or updates; exactly one installation exists.
- Each refusal path (bad option, missing prerequisite, foreign directory, acquisition failure) is
  covered by an automated test that also proves nothing was changed.
- The published command's URL serves the install script, verified after release.

## Scope

### In Scope
- The one-line install command and its hosting.
- Channel and provider selection on that command.
- Prerequisite, foreign-location, and acquisition-failure refusals.
- Re-run as update/no-op.
- Automated end-to-end coverage of the command.
- README and Quickstart changes.

### Out of Scope
- Versioned or checksummed release downloads.
- A consumer-chosen install location.
- A one-line uninstall.
- Acquisition without the version-control tool the harness already requires.

## Key Decisions & Rationale

- **Reuse the existing install and update flows** rather than reimplementing them — one behavior to
  maintain, and FR-3's parity guarantee holds by construction.
- **One canonical location, no override** — keeps re-run detection (FR-8/FR-9) unambiguous; an
  override is deferred until someone needs it.
- **Released code only (FR-12)** — the default install path must never hand a new consumer in-flight
  work, matching the existing stable-channel promise.

## Dependencies

- #1711 (shipped, PR #1720): first-run channel is settable without a terminal.
- The repository is public, so anonymous HTTPS acquisition is possible.
- The project documentation site publishes from the released branch.
- Git is already a documented prerequisite of the harness.

## Open Questions

- None blocking. The canonical location's exact path is a technical choice recorded in stories/plan.
